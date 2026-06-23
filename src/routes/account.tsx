import { Hono } from 'hono'
import type { FC, PropsWithChildren } from 'hono/jsx'
import type { Env, User } from '../types'
import { SharedHead } from '../views/head'
import { Logo } from '../views/logo'
import { MarketingLayout } from '../views/layouts/marketing'
import { requireAuth } from '../middleware/auth'
import { csrf } from '../middleware/csrf'
import { t, getI18n, SUPPORTED_LOCALES, listTimezones, isValidTimezone, type MessageKey } from '../i18n'
import { rateLimit } from '../middleware/rate-limit'
import { updateUser, updateUserEmail, getUserByEmail, getUserById, updateNotificationPrefs, ensureUserFeedToken, rotateUserFeedToken } from '../db/users'
import { softDeleteAccount } from '../services/account'
import { getVendorByUserId } from '../db/vendors'
import { getFirstCoupleWedding } from '../db/weddings'
import {
  NOTIFICATION_TYPES,
  parseNotificationPrefs,
  isNotificationEnabled,
  verifyUnsubscribeToken,
  type NotificationKey,
  type NotificationType,
} from '../services/notification-prefs'
import { trimOrNull, isValidEmail } from '../lib/validation'
import { generateToken } from '../lib/crypto'
import { sendEmailMessage, emailChangeVerifyEmail, emailChangeNotifyEmail } from '../services/email'
import { auditLog } from '../middleware/audit'
import { deleteCookie } from 'hono/cookie'
import { listPasskeys, deletePasskey } from '../db/passkeys'
import type { PasskeyCredential } from '../types'
import { redactedVendorProfile } from '../lib/redaction'
import { formatDate } from '../lib/date'
import { createZip, safeZipPath, type ZipEntry } from '../lib/zip'
import { getStorageWithSecrets } from '../storage'

const account = new Hono<Env>()

account.use('/account/*', requireAuth, csrf)
account.use('/account', requireAuth, csrf)

// ─── Account layout ───

const AccountLayout: FC<PropsWithChildren<{ title?: string; user: User; csrfToken: string; backUrl: string }>> = ({
  title,
  user,
  csrfToken,
  backUrl,
  children,
}) => (
  <html lang={getI18n().language}>
    <head>
      <SharedHead title={title} />
      <meta name="csrf-token" content={csrfToken} />
    </head>
    <body class="bg-papaya-50 text-gray-900 antialiased font-sans">
      <header class="bg-grapefruit-700 px-4 py-3 sm:px-8">
        <div class="max-w-2xl mx-auto flex items-center justify-between">
          <a href={backUrl} class="flex items-center gap-2 text-sm font-bold text-papaya-200 hover:text-white transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
            {t('common.back')}
          </a>
          <a href="/" class="flex items-center gap-2 text-lg font-bold tracking-tight text-papaya">
            <Logo class="w-6 h-6" />
            Wedding Computer
          </a>
          <div class="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center text-xs font-bold text-white">
            {user.name.charAt(0).toUpperCase()}
          </div>
        </div>
      </header>
      <main class="max-w-2xl mx-auto px-4 py-6 sm:px-8 sm:py-8">{children}</main>
    </body>
  </html>
)

// ─── Helpers ───

async function getBackUrl(db: D1Database, userId: string): Promise<string> {
  const vendor = await getVendorByUserId(db, userId)
  if (vendor) return '/app'
  const coupleWedding = await getFirstCoupleWedding(db, userId)
  if (coupleWedding) return `/wedding/${coupleWedding.wedding_id}`
  return '/'
}

const inputClass =
  'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent'

// ─── Profile page ───

account.get('/account', async (c) => {
  const user = c.get('user')
  const backUrl = await getBackUrl(c.env.DB, user.id)
  const mintedFeedToken = await ensureUserFeedToken(c.env.DB, user)
  const feedRevealId = c.req.query('feed_reveal')
  let revealedFeedToken = mintedFeedToken
  if (!revealedFeedToken && feedRevealId && /^[0-9a-f]{32}$/.test(feedRevealId)) {
    const revealKey = `user_feed_token_reveal:${user.id}:${feedRevealId}`
    revealedFeedToken = await c.env.KV.get(revealKey)
    if (revealedFeedToken) await c.env.KV.delete(revealKey)
  }
  const feedUrl = revealedFeedToken ? `${c.env.APP_URL}/cal/u/${revealedFeedToken}` : null
  const hasFeedToken = !!(user.feed_token || revealedFeedToken)
  const saved = c.req.query('saved')
  const error = c.req.query('error')
  const emailSent = c.req.query('email_sent')

  return c.html(
    <AccountLayout title={t('account.profileTitle')} user={user} csrfToken={c.get('csrfToken')} backUrl={backUrl}>
      {saved && (
        <div class="bg-horizon-50 border border-horizon-600/20 text-horizon-700 text-sm font-bold rounded-xl p-3 mb-6">
          {t('account.profileSaved')}
        </div>
      )}
      {error && (
        <div class="bg-grapefruit-50 border border-grapefruit-600/20 text-grapefruit-700 text-sm font-bold rounded-xl p-3 mb-6">
          {decodeURIComponent(error)}
        </div>
      )}
      {emailSent && (
        <div class="bg-horizon-50 border border-horizon-600/20 text-horizon-700 text-sm font-bold rounded-xl p-3 mb-6">
          {t('account.emailSent')}
        </div>
      )}

      <h1 class="text-xl font-bold mb-1">{t('account.profileTitle')}</h1>
      <p class="text-sm text-gray-500 mb-6">
        {t('account.profileHint')}
      </p>

      {/* ─── Profile photo ─── */}
      <section class="mb-8">
        <h2 class="text-base font-bold mb-3">{t('account.profilePhoto')}</h2>
        <div class="flex items-center gap-4">
          {user.avatar_r2_key ? (
            <img
              src={`/avatar/${user.id}`}
              alt={user.name}
              class="w-16 h-16 rounded-full object-cover border-2 border-gray-200"
            />
          ) : (
            <div class="w-16 h-16 bg-grapefruit-100 rounded-full flex items-center justify-center text-xl font-bold text-grapefruit-700">
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
          <form method="post" action="/account/avatar" enctype="multipart/form-data">
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <label class="cursor-pointer bg-white border border-gray-200 text-gray-700 py-2 px-4 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors inline-block">
              {t('account.uploadPhoto')}
              <input type="file" name="avatar" accept="image/*" class="hidden" onchange="this.form.submit()" />
            </label>
          </form>
          {user.avatar_r2_key && (
            <form method="post" action="/account/avatar/remove">
              <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
              <button type="submit" class="text-sm text-gray-400 hover:text-grapefruit-600 transition-colors">
                {t('common.remove')}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* ─── Personal details ─── */}
      <form method="post" action="/account" class="space-y-6">
        <input type="hidden" name="_csrf" value={c.get('csrfToken')} />

        <section>
          <h2 class="text-base font-bold mb-3">{t('account.personalDetails')}</h2>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="name">{t('account.fullName')}</label>
              <input type="text" id="name" name="name" value={user.name} required class={inputClass} />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="phone">{t('account.phone')}</label>
              <input type="tel" id="phone" name="phone" value={user.phone ?? ''} class={inputClass} />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="date_of_birth">{t('account.dateOfBirth')}</label>
              <input type="date" id="date_of_birth" name="date_of_birth" value={user.date_of_birth ?? ''} class={inputClass} />
            </div>
          </div>
        </section>

        <section>
          <h2 class="text-base font-bold mb-3">{t('account.address')}</h2>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="address_line_1">{t('account.addressLine1')}</label>
              <input type="text" id="address_line_1" name="address_line_1" value={user.address_line_1 ?? ''} class={inputClass} />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="address_line_2">{t('account.addressLine2')}</label>
              <input type="text" id="address_line_2" name="address_line_2" value={user.address_line_2 ?? ''} class={inputClass} />
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="city">{t('account.city')}</label>
                <input type="text" id="city" name="city" value={user.city ?? ''} class={inputClass} />
              </div>
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="state">{t('account.state')}</label>
                <input type="text" id="state" name="state" value={user.state ?? ''} class={inputClass} />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="postcode">{t('account.postcode')}</label>
                <input type="text" id="postcode" name="postcode" value={user.postcode ?? ''} class={inputClass} />
              </div>
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="country">{t('account.country')}</label>
                <input type="text" id="country" name="country" value={user.country ?? ''} class={inputClass} placeholder={t('account.countryPlaceholder')} />
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 class="text-base font-bold mb-3">{t('account.socialWeb')}</h2>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="instagram">Instagram</label>
              <input type="text" id="instagram" name="instagram" value={user.instagram ?? ''} class={inputClass} placeholder="@handle" />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="facebook">Facebook</label>
              <input type="text" id="facebook" name="facebook" value={user.facebook ?? ''} class={inputClass} placeholder={t('account.socialProfilePlaceholder')} />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="tiktok">TikTok</label>
              <input type="text" id="tiktok" name="tiktok" value={user.tiktok ?? ''} class={inputClass} placeholder="@handle" />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="linkedin">LinkedIn</label>
              <input type="text" id="linkedin" name="linkedin" value={user.linkedin ?? ''} class={inputClass} placeholder={t('account.socialUrlPlaceholder')} />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="website">{t('account.website')}</label>
              <input type="url" id="website" name="website" value={user.website ?? ''} class={inputClass} placeholder="https://..." />
            </div>
          </div>
        </section>

        <button
          type="submit"
          class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
        >
          {t('account.saveProfile')}
        </button>
      </form>

      {/* ─── Email address (separate form) ─── */}
      <section class="mt-10 pt-8 border-t border-gray-200">
        <h2 class="text-base font-bold mb-2">{t('account.emailAddress')}</h2>
        <p class="text-sm text-gray-500 mb-4">
          {t('account.emailAddressHint')}
        </p>
        <form method="post" action="/account/email" class="flex gap-3 items-end">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
          <div class="flex-1">
            <label class="block text-sm font-bold text-gray-700 mb-1.5" for="new_email">{t('account.currentEmail', { email: user.email })}</label>
            <input type="email" id="new_email" name="new_email" required class={inputClass} placeholder={t('account.newEmailPlaceholder')} />
          </div>
          <button
            type="submit"
            class="bg-white border border-gray-200 text-gray-700 py-3 px-5 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors shrink-0"
          >
            {t('account.changeEmail')}
          </button>
        </form>
      </section>

      {/* ─── Language & region ─── */}
      <section class="mt-10 pt-8 border-t border-gray-200">
        <h2 class="text-base font-bold mb-2">{t('account.languageRegion')}</h2>
        <p class="text-sm text-gray-500 mb-4">{t('account.languageRegionHint')}</p>
        <form method="post" action="/account/locale" class="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
          <div class="flex-1 w-full">
            <label class="block text-sm font-bold text-gray-700 mb-1.5" for="locale">{t('account.language')}</label>
            <select id="locale" name="locale" class={inputClass}>
              {SUPPORTED_LOCALES.map((l) => (
                <option value={l.tag} selected={(user.locale ?? getI18n().locale) === l.tag}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div class="flex-1 w-full">
            <label class="block text-sm font-bold text-gray-700 mb-1.5" for="timezone">{t('account.timezone')}</label>
            <select id="timezone" name="timezone" class={inputClass}>
              {listTimezones().map((tz) => (
                <option value={tz} selected={(user.timezone ?? getI18n().timezone) === tz}>
                  {tz.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            class="bg-white border border-gray-200 text-gray-700 py-3 px-5 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors shrink-0"
          >
            {t('common.save')}
          </button>
        </form>
      </section>

      {/* ─── Email notifications ─── */}
      <section class="mt-10 pt-8 border-t border-gray-200">
        <h2 class="text-base font-bold mb-2">{t('account.notifications.title')}</h2>
        <p class="text-sm text-gray-500 mb-4">
          {t('account.notifications.accountHint')}
        </p>
        <a
          href="/account/notifications"
          class="inline-block bg-white border border-gray-200 text-gray-700 py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
        >
          {t('account.notifications.manage')}
        </a>
      </section>

      {/* ─── Calendar feed ─── */}
      <section class="mt-10 pt-8 border-t border-gray-200">
        <h2 class="text-base font-bold mb-2">{t('timeline.feed.heading' as MessageKey)}</h2>
        <p class="text-sm text-gray-500 mb-4">{t('timeline.feed.desc' as MessageKey)}</p>
        {feedUrl ? (
          <>
            <label class="block text-sm font-bold text-gray-700 mb-1.5">{t('timeline.feed.label' as MessageKey)}</label>
            <input
              type="text"
              readonly
              value={feedUrl}
              onclick="this.select()"
              class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-gray-50 font-mono text-gray-600 focus:outline-none focus:ring-2 focus:ring-horizon-600"
            />
            <p class="text-xs text-gray-500 mt-2">{t('account.calendar.oneTime' as MessageKey)}</p>
          </>
        ) : hasFeedToken ? (
          <p class="text-sm text-gray-600 mb-3">{t('account.calendar.active' as MessageKey)}</p>
        ) : null}
        <form method="post" action="/account/feed-token/regenerate" class="mt-3">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
          <button
            type="submit"
            class="bg-white border border-gray-200 text-gray-700 py-2 px-4 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
          >
            {hasFeedToken ? t('account.calendar.regenerate' as MessageKey) : t('account.calendar.generate' as MessageKey)}
          </button>
        </form>
      </section>

      {/* ─── Passkeys ─── */}
      <PasskeySection passkeys={await listPasskeys(c.env.DB, user.id)} csrfToken={c.get('csrfToken')} />

      {/* ─── Data management ─── */}
      <section class="mt-10 pt-8 border-t border-gray-200">
        <h2 class="text-base font-bold mb-2">{t('account.data.title')}</h2>
        <p class="text-sm text-gray-500 mb-4">
          {t('account.data.hint')}
        </p>
        <div class="flex flex-col sm:flex-row gap-3">
          <a
            href="/account/export"
            class="inline-block bg-white border border-gray-200 text-gray-700 py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors text-center"
          >
            {t('account.data.exportArchive' as MessageKey)}
          </a>
          <form method="post" action="/account/delete" onsubmit={`return confirm(${JSON.stringify(t('account.data.deleteConfirm'))})`}>
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <button
              type="submit"
              class="bg-grapefruit-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-grapefruit-700 transition-colors"
            >
              {t('account.data.deleteAccount')}
            </button>
          </form>
        </div>
      </section>
    </AccountLayout>
  )
})

// ─── Save profile ───

account.post('/account', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return c.redirect('/account?error=Name+is+required')

  await updateUser(c.env.DB, user.id, {
    name,
    phone: trimOrNull(body.phone),
    date_of_birth: trimOrNull(body.date_of_birth),
    address_line_1: trimOrNull(body.address_line_1),
    address_line_2: trimOrNull(body.address_line_2),
    city: trimOrNull(body.city),
    state: trimOrNull(body.state),
    postcode: trimOrNull(body.postcode),
    country: trimOrNull(body.country),
    instagram: trimOrNull(body.instagram),
    facebook: trimOrNull(body.facebook),
    tiktok: trimOrNull(body.tiktok),
    linkedin: trimOrNull(body.linkedin),
    website: trimOrNull(body.website),
  })

  return c.redirect('/account?saved=1')
})

// ─── Language & region ───

account.post('/account/locale', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()

  const locale = typeof body.locale === 'string' ? body.locale.trim() : ''
  const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : ''

  if (!SUPPORTED_LOCALES.some((l) => l.tag === locale)) {
    return c.redirect('/account?error=Unsupported+language')
  }
  if (!isValidTimezone(timezone)) {
    return c.redirect('/account?error=Invalid+timezone')
  }

  await updateUser(c.env.DB, user.id, { locale, timezone })
  return c.redirect('/account?saved=1')
})

account.post('/account/feed-token/regenerate', async (c) => {
  const user = c.get('user')
  const token = await rotateUserFeedToken(c.env.DB, user.id)
  const revealId = await generateToken(16)
  await c.env.KV.put(`user_feed_token_reveal:${user.id}:${revealId}`, token, { expirationTtl: 300 })
  await auditLog(c, user.feed_token ? 'user_feed_token_rotated' : 'user_feed_token_generated', 'user', user.id).catch(() => {})
  return c.redirect(`/account?feed_reveal=${revealId}`)
})

// ─── Request email change ───

account.post('/account/email', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const newEmail = typeof body.new_email === 'string' ? body.new_email.trim().toLowerCase() : ''

  if (!isValidEmail(newEmail)) {
    return c.redirect('/account?error=Please+enter+a+valid+email+address')
  }

  if (newEmail === user.email) {
    return c.redirect('/account?error=That%27s+already+your+email')
  }

  // Check if email is already taken
  const existing = await getUserByEmail(c.env.DB, newEmail)
  if (existing) {
    return c.redirect('/account?error=That+email+is+already+in+use')
  }

  // Store email change request in KV (15 min TTL)
  const token = await generateToken(32)
  await c.env.KV.put(
    `email_change:${token}`,
    JSON.stringify({ userId: user.id, newEmail, oldEmail: user.email }),
    { expirationTtl: 60 * 15 }
  )

  // Send verification to new email
  await sendEmailMessage({
    db: c.env.DB,
    resendApiKey: c.env.RESEND_API_KEY,
    vendorId: null,
    to: newEmail,
    subject: 'Verify your new email address',
    html: emailChangeVerifyEmail(`${c.env.APP_URL}/account/email/verify?token=${token}`, user.name),
    isSystem: true,
  })

  return c.redirect('/account?email_sent=1')
})

// ─── Verify email change ───

account.get('/account/email/verify', async (c) => {
  const token = c.req.query('token')
  if (!token) return c.redirect('/account?error=Invalid+or+expired+link')

  const data = await c.env.KV.get(`email_change:${token}`)
  if (!data) return c.redirect('/account?error=Invalid+or+expired+link')

  await c.env.KV.delete(`email_change:${token}`)
  const { userId, newEmail, oldEmail } = JSON.parse(data) as {
    userId: string
    newEmail: string
    oldEmail: string
  }

  // Double-check new email isn't taken (race condition guard)
  const existing = await getUserByEmail(c.env.DB, newEmail)
  if (existing) {
    return c.redirect('/account?error=That+email+is+already+in+use')
  }

  await updateUserEmail(c.env.DB, userId, newEmail)

  // Notify old email
  await sendEmailMessage({
    db: c.env.DB,
    resendApiKey: c.env.RESEND_API_KEY,
    vendorId: null,
    to: oldEmail,
    subject: 'Your email address was changed',
    html: emailChangeNotifyEmail(newEmail),
    isSystem: true,
  }).catch(() => {})

  return c.redirect('/account?saved=1')
})

// ─── Notification preferences ───

type PrefSection = { heading: MessageKey; types: NotificationType[] }

// Group the registry into role-aware page sections. Only the sections a user
// sees here are written back on save, so a vendor can't accidentally clear
// admin or couple keys (and vice versa).
function prefSections(opts: { isVendor: boolean; isCouple: boolean; isAdmin: boolean }): PrefSection[] {
  const sections: PrefSection[] = []
  if (opts.isVendor) {
    sections.push({
      heading: 'account.notifications.section.business',
      types: NOTIFICATION_TYPES.filter((t) => t.audience === 'vendor'),
    })
  }
  sections.push({
    heading: 'account.notifications.section.weddings',
    types: NOTIFICATION_TYPES.filter(
      (t) =>
        (t.audience === 'all' && t.key !== 'announcements') ||
        (t.audience === 'couple' && opts.isCouple)
    ),
  })
  sections.push({
    heading: 'account.notifications.section.platform',
    types: NOTIFICATION_TYPES.filter((t) => t.key === 'announcements'),
  })
  if (opts.isAdmin) {
    sections.push({
      heading: 'account.notifications.section.admin',
      types: NOTIFICATION_TYPES.filter((t) => t.audience === 'admin'),
    })
  }
  return sections
}

async function userPrefSections(db: D1Database, user: User): Promise<PrefSection[]> {
  const [vendor, coupleWedding] = await Promise.all([
    getVendorByUserId(db, user.id),
    getFirstCoupleWedding(db, user.id),
  ])
  return prefSections({ isVendor: !!vendor, isCouple: !!coupleWedding, isAdmin: user.is_admin === 1 })
}

account.get('/account/notifications', async (c) => {
  const user = c.get('user')
  const backUrl = await getBackUrl(c.env.DB, user.id)
  const saved = c.req.query('saved')
  const sections = await userPrefSections(c.env.DB, user)

  return c.html(
    <AccountLayout title={t('account.notifications.title')} user={user} csrfToken={c.get('csrfToken')} backUrl={backUrl}>
      {saved && (
        <div class="bg-horizon-50 border border-horizon-600/20 text-horizon-700 text-sm font-bold rounded-xl p-3 mb-6">
          {t('account.notifications.saved')}
        </div>
      )}

      <h1 class="text-xl font-bold mb-1">{t('account.notifications.title')}</h1>
      <p class="text-sm text-gray-500 mb-6">
        {t('account.notifications.pageHint')}
      </p>

      <form method="post" action="/account/notifications" class="space-y-8">
        <input type="hidden" name="_csrf" value={c.get('csrfToken')} />

        {sections.map((section) => (
          <section>
            <h2 class="text-base font-bold mb-3">{t(section.heading)}</h2>
            <div class="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
              {section.types.map((type) => (
                <label class="flex items-start gap-3 p-4 cursor-pointer">
                  <input
                    type="checkbox"
                    name={`pref_${type.key}`}
                    checked={isNotificationEnabled(user.notification_prefs, type.key)}
                    class="mt-0.5 w-4 h-4 accent-horizon-600 shrink-0"
                  />
                  <span>
                    <span class="block text-sm font-bold text-gray-900">{t(type.labelKey)}</span>
                    <span class="block text-sm text-gray-500">{t(type.descriptionKey)}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        ))}

        <button
          type="submit"
          class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
        >
          {t('account.notifications.savePreferences')}
        </button>
      </form>

      <p class="text-xs text-gray-400 mt-6">
        {t('account.notifications.unsubscribeHint')}
      </p>
    </AccountLayout>
  )
})

account.post('/account/notifications', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()

  // Recompute the visible sections server-side: only keys this user was shown
  // get written, and everything else in their prefs is preserved.
  const sections = await userPrefSections(c.env.DB, user)
  const prefs = parseNotificationPrefs(user.notification_prefs)
  for (const section of sections) {
    for (const t of section.types) {
      prefs[t.key] = body[`pref_${t.key}`] === 'on'
    }
  }
  await updateNotificationPrefs(c.env.DB, user.id, prefs)

  return c.redirect('/account/notifications?saved=1')
})

// ─── Public unsubscribe (signed token, no session) ───
//
// These live outside the /account/* auth+csrf guards: the HMAC-signed token in
// the URL is the authorisation. GET shows a confirm page (so mail-client link
// prefetching can't silently unsubscribe anyone); POST executes — both for the
// confirm button and for RFC 8058 List-Unsubscribe-Post one-click requests.

function unsubLabel(key: NotificationKey): string {
  const type = NOTIFICATION_TYPES.find((t) => t.key === key)
  return type ? t(type.labelKey) : key
}

const UnsubscribePage: FC<{ heading: string; message: unknown; button?: { token: string } }> = ({
  heading,
  message,
  button,
}) => (
  <MarketingLayout title={t('account.unsubscribe.title')}>
    <div class="max-w-md mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
      <h1 class="text-2xl sm:text-3xl font-bold tracking-tight mb-3">{heading}</h1>
      <p class="text-gray-600 leading-relaxed mb-8">{message}</p>
      {button ? (
        <form method="post" action={`/email/unsubscribe?token=${encodeURIComponent(button.token)}`}>
          <button
            type="submit"
            class="inline-block bg-grapefruit-600 text-white px-6 py-3 rounded-xl text-sm font-bold hover:bg-grapefruit-700 transition-colors"
          >
            {t('account.unsubscribe.button')}
          </button>
        </form>
      ) : (
        <a
          href="/"
          class="inline-block bg-horizon-600 text-white px-6 py-3 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
        >
          {t('account.unsubscribe.backHome')}
        </a>
      )}
      <p class="text-sm text-gray-500 mt-8">
        {t('account.unsubscribe.managePrefix')}{' '}
        <a href="/account/notifications" class="font-bold text-horizon-700 hover:underline">
          {t('account.unsubscribe.accountLink')}
        </a>
        .
      </p>
    </div>
  </MarketingLayout>
)

account.get('/email/unsubscribe', async (c) => {
  const token = c.req.query('token') ?? ''
  const parsed = token ? await verifyUnsubscribeToken(c.env.SESSION_SECRET, token) : null

  if (!parsed) {
    return c.html(
      <UnsubscribePage heading={t('account.unsubscribe.title')} message={t('account.unsubscribe.invalid')} />
    )
  }

  return c.html(
    <UnsubscribePage
      heading={t('account.unsubscribe.title')}
      message={t('account.unsubscribe.confirmMessage', { label: unsubLabel(parsed.key) })}
      button={{ token }}
    />
  )
})

account.post('/email/unsubscribe', rateLimit(30, 60), async (c) => {
  const token = c.req.query('token') ?? ''
  const parsed = token ? await verifyUnsubscribeToken(c.env.SESSION_SECRET, token) : null

  if (!parsed) {
    return c.html(
      <UnsubscribePage heading={t('account.unsubscribe.title')} message={t('account.unsubscribe.invalid')} />,
      400
    )
  }

  const target = await getUserById(c.env.DB, parsed.userId)
  if (target) {
    const prefs = parseNotificationPrefs(target.notification_prefs)
    prefs[parsed.key] = false
    await updateNotificationPrefs(c.env.DB, target.id, prefs)
  }

  // Mail providers' one-click POSTs only need a 2xx; humans get a real page.
  return c.html(
    <UnsubscribePage
      heading={t('account.unsubscribe.doneTitle')}
      message={t('account.unsubscribe.doneMessage', { label: unsubLabel(parsed.key) })}
    />
  )
})

// ─── Avatar upload ───

account.post('/account/avatar', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const file = body.avatar

  if (!file || !(file instanceof File) || file.size === 0) {
    return c.redirect('/account?error=No+file+selected')
  }

  // Validate file
  const maxSize = 5 * 1024 * 1024 // 5MB
  if (file.size > maxSize) {
    return c.redirect('/account?error=File+too+large+(max+5MB)')
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  if (!allowedTypes.includes(file.type)) {
    return c.redirect('/account?error=Invalid+file+type.+Use+JPG%2C+PNG%2C+WebP%2C+or+GIF')
  }

  const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1]
  const r2Key = `avatars/${user.id}.${ext}`

  if (!c.env.STORAGE) {
    return c.redirect('/account?error=File+storage+not+configured')
  }

  // Delete old avatar if different extension
  if (user.avatar_r2_key && user.avatar_r2_key !== r2Key) {
    await c.env.STORAGE.delete(user.avatar_r2_key).catch(() => {})
  }

  await c.env.STORAGE.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type },
  })

  await updateUser(c.env.DB, user.id, { avatar_r2_key: r2Key })
  return c.redirect('/account?saved=1')
})

// ─── Avatar remove ───

account.post('/account/avatar/remove', async (c) => {
  const user = c.get('user')

  if (user.avatar_r2_key && c.env.STORAGE) {
    await c.env.STORAGE.delete(user.avatar_r2_key).catch(() => {})
  }

  await updateUser(c.env.DB, user.id, { avatar_r2_key: null, avatar_url: null })
  return c.redirect('/account?saved=1')
})

// ─── Data export ───

type ExportFileRow = {
  id: string
  r2_key: string
  filename: string
}

async function exportableWeddingDocuments(db: D1Database, userId: string): Promise<ExportFileRow[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT d.id, d.r2_key, d.filename
       FROM documents d
       JOIN wedding_members wm ON wm.wedding_id = d.wedding_id
       WHERE wm.user_id = ? AND wm.status = 'active'
         AND (
           d.uploaded_by_user_id = ?
           OR d.visibility = 'wedding'
           OR EXISTS (SELECT 1 FROM document_shares ds WHERE ds.document_id = d.id AND ds.user_id = ?)
         )
       ORDER BY d.created_at DESC`
    )
    .bind(userId, userId, userId)
    .all<ExportFileRow>()
  return rows.results
}

async function exportableFormFiles(db: D1Database, userId: string, vendorId: string | null): Promise<ExportFileRow[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT ff.id, ff.r2_key, ff.filename
       FROM form_files ff
       JOIN form_submissions fs ON fs.id = ff.submission_id
       LEFT JOIN wedding_members wm ON wm.wedding_id = fs.wedding_id AND wm.user_id = ? AND wm.status = 'active'
       WHERE ff.vendor_id = ?
          OR (
            fs.wedding_id IS NOT NULL AND wm.user_id IS NOT NULL
            AND (wm.role = 'couple' OR fs.shared_with_team = 1 OR wm.vendor_profile_id = ff.vendor_id)
          )
       ORDER BY ff.created_at DESC`
    )
    .bind(userId, vendorId ?? '')
    .all<ExportFileRow>()
  return rows.results
}

account.get('/account/export', async (c) => {
  const user = c.get('user')

  const weddings = await c.env.DB
    .prepare(
      `SELECT w.* FROM weddings w
       JOIN wedding_members wm ON wm.wedding_id = w.id
       WHERE wm.user_id = ? ORDER BY w.created_at DESC`
    )
    .bind(user.id)
    .all()

  const vendor = await getVendorByUserId(c.env.DB, user.id)

  const data: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      date_of_birth: user.date_of_birth,
      address_line_1: user.address_line_1,
      address_line_2: user.address_line_2,
      city: user.city,
      state: user.state,
      postcode: user.postcode,
      country: user.country,
      instagram: user.instagram,
      facebook: user.facebook,
      tiktok: user.tiktok,
      linkedin: user.linkedin,
      website: user.website,
      created_at: user.created_at,
    },
    weddings: weddings.results,
  }

  if (vendor) {
    const { listContacts } = await import('../db/contacts')
    const { listInvoices } = await import('../db/invoices')
    const [contacts, invoices, events] = await Promise.all([
      listContacts(c.env.DB, vendor.id, {}),
      listInvoices(c.env.DB, vendor.id),
      c.env.DB.prepare('SELECT * FROM calendar_events WHERE vendor_id = ? ORDER BY date DESC').bind(vendor.id).all(),
    ])
    data.vendor_profile = redactedVendorProfile(vendor)
    data.contacts = contacts
    data.invoices = invoices
    data.calendar_events = events.results
  }

  const entries: ZipEntry[] = [
    {
      path: 'wedding-computer-export.json',
      data: JSON.stringify(data, null, 2),
    },
  ]

  if (vendor) {
    try {
      const storage = await getStorageWithSecrets(c.env, vendor)
      const queue: string[] = ['']
      for (const prefix of queue) {
        const listed = await storage.list(prefix)
        for (const file of listed.files) {
          const path = safeZipPath(`markdown/${file.path}`)
          if (path.endsWith('/')) continue
          const stored = await storage.read(file.path).catch(() => null)
          if (stored) entries.push({ path, data: stored.content })
        }
        if (listed.cursor) {
          let cursor: string | undefined = listed.cursor
          while (cursor) {
            const next = await storage.list(prefix, cursor)
            for (const file of next.files) {
              const path = safeZipPath(`markdown/${file.path}`)
              if (path.endsWith('/')) continue
              const stored = await storage.read(file.path).catch(() => null)
              if (stored) entries.push({ path, data: stored.content })
            }
            cursor = next.cursor
          }
        }
      }
    } catch (err) {
      entries.push({
        path: 'export-warnings/storage.txt',
        data: `Storage files could not be included: ${err instanceof Error ? err.message : 'unknown error'}`,
      })
    }
  }

  if (c.env.STORAGE) {
    for (const file of await exportableWeddingDocuments(c.env.DB, user.id)) {
      const object = await c.env.STORAGE.get(file.r2_key).catch(() => null)
      if (object) {
        entries.push({
          path: `uploads/wedding-documents/${file.id}-${safeZipPath(file.filename)}`,
          data: await object.arrayBuffer(),
        })
      }
    }

    for (const file of await exportableFormFiles(c.env.DB, user.id, vendor?.id ?? null)) {
      const object = await c.env.STORAGE.get(file.r2_key).catch(() => null)
      if (object) {
        entries.push({
          path: `uploads/form-files/${file.id}-${safeZipPath(file.filename)}`,
          data: await object.arrayBuffer(),
        })
      }
    }
  }

  await auditLog(c, 'data_export', 'user', user.id).catch(() => {})

  const zip = createZip(entries)
  return c.body(zip, 200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="wedding-computer-export-${new Date().toISOString().slice(0, 10)}.zip"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  })
})

// ─── Account deletion ───

account.post('/account/delete', async (c) => {
  const user = c.get('user')

  await auditLog(c, 'account_delete_scheduled', 'user', user.id).catch(() => {})
  // Soft-delete: 30-day grace, logged out everywhere. Signing back in restores
  // it; the nightly cron hard-purges (R2/KV/D1) after the window.
  await softDeleteAccount(c.env, user)

  deleteCookie(c, 'wc_session', { path: '/' })
  return c.redirect('/login?deleted=1')
})

// ─── Serve avatar ───

account.get('/avatar/:userId', async (c) => {
  const userId = c.req.param('userId')

  if (!c.env.STORAGE) return c.notFound()

  // Look up user to get their r2 key
  const { getUserById } = await import('../db/users')
  const user = await getUserById(c.env.DB, userId)
  if (!user?.avatar_r2_key) return c.notFound()

  const object = await c.env.STORAGE.get(user.avatar_r2_key)
  if (!object) return c.notFound()

  const headers = new Headers()
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'image/jpeg')
  headers.set('Cache-Control', 'public, max-age=3600')

  return new Response(object.body, { headers })
})

// ─── Passkey delete ───

account.post('/account/passkeys/:id/delete', async (c) => {
  const user = c.get('user')
  const passkeyId = c.req.param('id')

  await deletePasskey(c.env.DB, passkeyId, user.id)
  return c.redirect('/account?saved=1')
})

// ─── Passkey section component ───

function PasskeySection({ passkeys, csrfToken }: { passkeys: PasskeyCredential[]; csrfToken: string }) {
  const optionsFailed = JSON.stringify(t('account.passkeys.optionsFailed'))
  const namePrompt = JSON.stringify(t('account.passkeys.namePrompt'))
  const registrationFailed = JSON.stringify(t('account.passkeys.registrationFailed'))
  const unsupported = JSON.stringify(t('account.passkeys.unsupported'))

  return (
    <section class="mt-10 pt-8 border-t border-gray-200">
      <h2 class="text-base font-bold mb-2">{t('account.passkeys.title')}</h2>
      <p class="text-sm text-gray-500 mb-4">
        {t('account.passkeys.hint')}
      </p>

      {passkeys.length > 0 && (
        <div class="space-y-2 mb-4">
          {passkeys.map((pk) => (
            <div class="flex items-center justify-between bg-white border border-gray-200 rounded-xl p-3">
              <div>
                <p class="text-sm font-bold text-gray-900">
                  {pk.device_name ?? t('account.passkeys.defaultName')}
                  {pk.backed_up ? <span class="text-xs text-gray-400 ml-2">{t('account.passkeys.synced')}</span> : null}
                </p>
                <p class="text-xs text-gray-500">
                  {t('account.passkeys.added', { date: formatDate(pk.created_at) })}
                  {pk.last_used_at ? ` · ${t('account.passkeys.lastUsed', { date: formatDate(pk.last_used_at) })}` : ''}
                </p>
              </div>
              <form method="post" action={`/account/passkeys/${pk.id}/delete`} onsubmit={`return confirm(${JSON.stringify(t('account.passkeys.removeConfirm'))})`}>
                <input type="hidden" name="_csrf" value={csrfToken} />
                <button type="submit" class="text-xs text-gray-400 hover:text-grapefruit-600 transition-colors">
                  {t('common.remove')}
                </button>
              </form>
            </div>
          ))}
        </div>
      )}

      <button
        id="add-passkey-btn"
        type="button"
        class="bg-white border border-gray-200 text-gray-700 py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
      >
        {t('account.passkeys.add')}
      </button>
      <p id="passkey-msg" class="text-sm mt-2 hidden"></p>

      <script dangerouslySetInnerHTML={{ __html: `
(function() {
  var btn = document.getElementById('add-passkey-btn');
  var msgEl = document.getElementById('passkey-msg');
  if (!btn || !window.PublicKeyCredential) {
    if (btn) btn.style.display = 'none';
    return;
  }

  function b64urlToArr(b64) {
    var s = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function arrToB64url(arr) {
    var bin = '';
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }

  btn.addEventListener('click', async function() {
    msgEl.classList.add('hidden');
    try {
      var csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
      var headers = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      var optRes = await fetch('/auth/passkey/register/options', {
        method: 'POST', headers: headers
      });
      if (!optRes.ok) throw new Error(${optionsFailed});
      var opts = await optRes.json();

      var publicKey = {
        challenge: b64urlToArr(opts.challenge),
        rp: opts.rp,
        user: {
          id: b64urlToArr(opts.user.id),
          name: opts.user.name,
          displayName: opts.user.displayName
        },
        pubKeyCredParams: opts.pubKeyCredParams,
        timeout: opts.timeout,
        attestation: opts.attestation,
        authenticatorSelection: opts.authenticatorSelection
      };
      if (opts.excludeCredentials) {
        publicKey.excludeCredentials = opts.excludeCredentials.map(function(c) {
          return { id: b64urlToArr(c.id), type: c.type };
        });
      }

      var cred = await navigator.credentials.create({ publicKey: publicKey });
      var deviceName = prompt(${namePrompt}, '') || null;

      var verRes = await fetch('/auth/passkey/register/verify', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          deviceName: deviceName,
          credential: {
            id: cred.id,
            rawId: arrToB64url(new Uint8Array(cred.rawId)),
            type: cred.type,
            response: {
              clientDataJSON: arrToB64url(new Uint8Array(cred.response.clientDataJSON)),
              attestationObject: arrToB64url(new Uint8Array(cred.response.attestationObject))
            },
            authenticatorAttachment: cred.authenticatorAttachment || undefined
          }
        })
      });
      var result = await verRes.json();
      if (result.verified) {
        window.location.reload();
      } else {
        msgEl.textContent = result.error || ${registrationFailed};
        msgEl.className = 'text-sm text-grapefruit-700 mt-2';
        msgEl.classList.remove('hidden');
      }
    } catch(e) {
      if (e.name !== 'NotAllowedError') {
        msgEl.textContent = ${unsupported};
        msgEl.className = 'text-sm text-grapefruit-700 mt-2';
        msgEl.classList.remove('hidden');
      }
    }
  });
})();
`}} />
    </section>
  )
}

export default account
