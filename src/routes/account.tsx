import { Hono } from 'hono'
import type { FC, PropsWithChildren } from 'hono/jsx'
import type { Env, User } from '../types'
import { SharedHead } from '../views/head'
import { Logo } from '../views/logo'
import { requireAuth } from '../middleware/auth'
import { csrf } from '../middleware/csrf'
import { updateUser, updateUserEmail, getUserByEmail, deleteUser } from '../db/users'
import { getVendorByUserId } from '../db/vendors'
import { getFirstCoupleWedding } from '../db/weddings'
import { trimOrNull, isValidEmail } from '../lib/validation'
import { generateToken } from '../lib/crypto'
import { sendEmailMessage, emailChangeVerifyEmail, emailChangeNotifyEmail } from '../services/email'
import { auditLog } from '../middleware/audit'
import { destroySession } from '../services/auth'
import { deleteCookie, getCookie } from 'hono/cookie'

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
  <html lang="en">
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
            Back
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
  const saved = c.req.query('saved')
  const error = c.req.query('error')
  const emailSent = c.req.query('email_sent')

  return c.html(
    <AccountLayout title="Your profile" user={user} csrfToken={c.get('csrfToken')} backUrl={backUrl}>
      {saved && (
        <div class="bg-horizon-50 border border-horizon-600/20 text-horizon-700 text-sm font-bold rounded-xl p-3 mb-6">
          Profile saved.
        </div>
      )}
      {error && (
        <div class="bg-grapefruit-50 border border-grapefruit-600/20 text-grapefruit-700 text-sm font-bold rounded-xl p-3 mb-6">
          {decodeURIComponent(error)}
        </div>
      )}
      {emailSent && (
        <div class="bg-horizon-50 border border-horizon-600/20 text-horizon-700 text-sm font-bold rounded-xl p-3 mb-6">
          Check your new email address for a verification link.
        </div>
      )}

      <h1 class="text-xl font-bold mb-1">Your profile</h1>
      <p class="text-sm text-gray-500 mb-6">
        This information is shared with vendors and couples on your weddings.
      </p>

      {/* ─── Profile photo ─── */}
      <section class="mb-8">
        <h2 class="text-base font-bold mb-3">Profile photo</h2>
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
              Upload photo
              <input type="file" name="avatar" accept="image/*" class="hidden" onchange="this.form.submit()" />
            </label>
          </form>
          {user.avatar_r2_key && (
            <form method="post" action="/account/avatar/remove">
              <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
              <button type="submit" class="text-sm text-gray-400 hover:text-grapefruit-600 transition-colors">
                Remove
              </button>
            </form>
          )}
        </div>
      </section>

      {/* ─── Personal details ─── */}
      <form method="post" action="/account" class="space-y-6">
        <input type="hidden" name="_csrf" value={c.get('csrfToken')} />

        <section>
          <h2 class="text-base font-bold mb-3">Personal details</h2>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="name">Full name</label>
              <input type="text" id="name" name="name" value={user.name} required class={inputClass} />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="phone">Phone</label>
              <input type="tel" id="phone" name="phone" value={user.phone ?? ''} class={inputClass} />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="date_of_birth">Date of birth</label>
              <input type="date" id="date_of_birth" name="date_of_birth" value={user.date_of_birth ?? ''} class={inputClass} />
            </div>
          </div>
        </section>

        <section>
          <h2 class="text-base font-bold mb-3">Address</h2>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="address_line_1">Address line 1</label>
              <input type="text" id="address_line_1" name="address_line_1" value={user.address_line_1 ?? ''} class={inputClass} />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="address_line_2">Address line 2</label>
              <input type="text" id="address_line_2" name="address_line_2" value={user.address_line_2 ?? ''} class={inputClass} />
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="city">City</label>
                <input type="text" id="city" name="city" value={user.city ?? ''} class={inputClass} />
              </div>
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="state">State</label>
                <input type="text" id="state" name="state" value={user.state ?? ''} class={inputClass} />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="postcode">Postcode</label>
                <input type="text" id="postcode" name="postcode" value={user.postcode ?? ''} class={inputClass} />
              </div>
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="country">Country</label>
                <input type="text" id="country" name="country" value={user.country ?? ''} class={inputClass} placeholder="Australia" />
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 class="text-base font-bold mb-3">Social &amp; web</h2>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="instagram">Instagram</label>
              <input type="text" id="instagram" name="instagram" value={user.instagram ?? ''} class={inputClass} placeholder="@handle" />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="facebook">Facebook</label>
              <input type="text" id="facebook" name="facebook" value={user.facebook ?? ''} class={inputClass} placeholder="Profile URL or name" />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="tiktok">TikTok</label>
              <input type="text" id="tiktok" name="tiktok" value={user.tiktok ?? ''} class={inputClass} placeholder="@handle" />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="linkedin">LinkedIn</label>
              <input type="text" id="linkedin" name="linkedin" value={user.linkedin ?? ''} class={inputClass} placeholder="Profile URL" />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="website">Website</label>
              <input type="url" id="website" name="website" value={user.website ?? ''} class={inputClass} placeholder="https://..." />
            </div>
          </div>
        </section>

        <button
          type="submit"
          class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
        >
          Save profile
        </button>
      </form>

      {/* ─── Email address (separate form) ─── */}
      <section class="mt-10 pt-8 border-t border-gray-200">
        <h2 class="text-base font-bold mb-2">Email address</h2>
        <p class="text-sm text-gray-500 mb-4">
          Your email is used for signing in and receiving notifications. Changing it requires verification.
        </p>
        <form method="post" action="/account/email" class="flex gap-3 items-end">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
          <div class="flex-1">
            <label class="block text-sm font-bold text-gray-700 mb-1.5" for="new_email">Current: {user.email}</label>
            <input type="email" id="new_email" name="new_email" required class={inputClass} placeholder="New email address" />
          </div>
          <button
            type="submit"
            class="bg-white border border-gray-200 text-gray-700 py-3 px-5 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors shrink-0"
          >
            Change email
          </button>
        </form>
      </section>

      {/* ─── Data management ─── */}
      <section class="mt-10 pt-8 border-t border-gray-200">
        <h2 class="text-base font-bold mb-2">Your data</h2>
        <p class="text-sm text-gray-500 mb-4">
          Download or delete all your data.
        </p>
        <div class="flex flex-col sm:flex-row gap-3">
          <a
            href="/account/export"
            class="inline-block bg-white border border-gray-200 text-gray-700 py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors text-center"
          >
            Export data (JSON)
          </a>
          <form method="post" action="/account/delete" onsubmit="return confirm('Are you sure? This will permanently delete your account and all data. This cannot be undone.')">
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <button
              type="submit"
              class="bg-grapefruit-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-grapefruit-700 transition-colors"
            >
              Delete account
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
    data.vendor_profile = vendor
    data.contacts = contacts
    data.invoices = invoices
    data.calendar_events = events.results
  }

  await auditLog(c, 'data_export', 'user', user.id).catch(() => {})

  return c.json(data, 200, {
    'Content-Disposition': `attachment; filename="wedding-computer-export-${new Date().toISOString().slice(0, 10)}.json"`,
  })
})

// ─── Account deletion ───

account.post('/account/delete', async (c) => {
  const user = c.get('user')
  const sessionId = getCookie(c, 'wc_session')

  // Delete avatar from R2
  if (user.avatar_r2_key && c.env.STORAGE) {
    await c.env.STORAGE.delete(user.avatar_r2_key).catch(() => {})
  }

  await auditLog(c, 'account_deleted', 'user', user.id).catch(() => {})
  await deleteUser(c.env.DB, user.id)

  if (sessionId) {
    await destroySession(c.env.DB, c.env.KV, sessionId).catch(() => {})
  }
  deleteCookie(c, 'wc_session', { path: '/' })
  return c.redirect('/')
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

export default account
