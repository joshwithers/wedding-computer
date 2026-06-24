import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { rateLimit, consumeRateLimit } from '../../middleware/rate-limit'
import {
  listWeddingsForVendor,
  getWedding,
  createWedding,
  updateWedding,
  addWeddingMember,
  setWeddingMemberRoles,
  getWeddingMembers,
  getMembership,
  getAnyMembership,
} from '../../db/weddings'
import { listDocumentsForWedding } from '../../db/documents'
import { listInvoicesForWedding, type InvoiceWithPaymentSummary } from '../../db/invoices'
import { getContact, updateContact } from '../../storage/contacts'
import { getStorageWithSecrets } from '../../storage'
import { pushAllWeddingFiles } from '../../services/storage-push'
import { createActivity } from '../../db/activities'
import type { Bindings, VendorProfile, Wedding, Form } from '../../types'
import { findOrCreateUser, sendCoupleInvite } from '../../services/auth'
import { getUserByEmail } from '../../db/users'
import { requireString, trimOrNull, isValidEmail } from '../../lib/validation'
import { formatDate, formatDateTime, formatTime, daysUntil, addHoursToTime } from '../../lib/date'
import { createEvent } from '../../db/calendar'
import { track } from '../../services/analytics'
import { listVendorTypes, vendorTypeLabel, type VendorType } from '../../db/vendor-types'
import { searchVendorsForWedding, getVendorWithEmail, getVendorByUserId } from '../../db/vendors'
import { sanitizeInstagramHandle } from '../../lib/instagram'
import { geocodeWeddingLocation } from '../../services/geocode'
import { getWeddingTodo, upsertWeddingTodo } from '../../db/todos'
import { listTemplates, getDefaultTemplate } from '../../db/todos'
import { TodoSection } from './checklists'
import { appendWeddingLog, listWeddingLog } from '../../db/wedding-log'
import { listCoupleVendors } from '../../db/couple-vendors'
import { buildCredits, formatInstagramCredits, formatWebCredits, formatHtmlCredits, rolesLabel, parseMemberRoles, type CreditEntry } from '../../services/wedding-credits'
import { displayRoles, CELEBRANT_SLUG, celebrantTermsDiffer } from '../../lib/celebrant-term'
import {
  getTimelineControllers,
  createTimelineRequest,
} from '../../db/timeline-requests'
import { isManagerVendor, categoriesLabel } from '../../lib/categories'
import { weddingDisplayTitle } from '../../lib/wedding-display'
import { sendVendorWelcomeInvite } from '../../services/auth'
import { ensureCoupleContact } from '../../services/couple-contact'
import { TIMELINE_FIELDS } from '../../services/timeline-edit'
import { applyWeddingUpdate, resolveAndMaterialize, weddingSunMinutes } from '../../db/timeline'
import { t, tp } from '../../i18n'
import { weddingCapStatus } from '../../services/plan-limits'
import { markTimelineDirty } from '../../services/timeline-notify'
import { WeddingDoc } from '../../views/wedding-doc'
import { loadDocTabs } from '../../db/wedding-docs'
import { shouldShowWeather } from '../../views/weather'
import { renderWeatherCard, setWeatherUnit } from '../weather-handlers'
import {
  listForms,
  getForm,
  createFormSend,
  listFormSendsForWedding,
  listWeddingSubmissions,
  setSubmissionTeamVisibility,
  formSubmissionFields,
  type WeddingFormSend,
  type WeddingSubmission,
} from '../../db/forms'
import { WebLinks } from '../../views/web-links'
import { listWebLinks } from '../../db/web-links'
import { renderTimelineSection } from '../timeline-handlers'
import { getTimelineLead } from '../../services/timeline-permissions'
import { getOrGenerateClimateNote } from '../../services/climate'
import { socialUrl, socialDisplay } from '../../lib/social'
import { CopyButton } from '../../views/icons'

/** Couple contact row loaded for the wedding-page couple panel. */
type CoupleContact = {
  id: string
  first_name: string | null
  last_name: string | null
  partner_first_name: string | null
  partner_last_name: string | null
  email: string | null
  partner_email: string | null
  phone: string | null
  partner_phone: string | null
  address: string | null
  instagram: string | null
  facebook: string | null
  tiktok: string | null
  website: string | null
}

/** Join first + last into a trimmed display name, or null if both empty. */
function fullName(first: string | null, last: string | null): string | null {
  const n = [first, last].map((s) => s?.trim()).filter(Boolean).join(' ')
  return n || null
}

/** A small inline action link (mailto / tel / sms / external). */
function ContactAction({ href, label }: { href: string; label: string }) {
  const external = /^https?:/i.test(href)
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      class="inline-flex items-center px-2.5 py-1 rounded-full bg-papaya-100 text-gray-700 text-xs font-medium hover:bg-papaya-200"
    >
      {label}
    </a>
  )
}

/** A small inline "copy to clipboard" icon button. */
function CopyAction({ value }: { value: string }) {
  return (
    <CopyButton
      value={value}
      title={t('weddings.couple.copy')}
      class="w-7 h-7 rounded-full bg-papaya-50 border border-papaya-200 text-gray-500 hover:bg-papaya-100"
    />
  )
}

/** One partner's name + contact actions. */
function PartnerRow({ name, email, phone }: { name: string; email: string | null; phone: string | null }) {
  return (
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm font-medium text-gray-900">{name}</span>
      {email && <ContactAction href={`mailto:${email}`} label={t('weddings.couple.email')} />}
      {email && <CopyAction value={email} />}
      {phone && <ContactAction href={`tel:${phone.replace(/\s+/g, '')}`} label={t('weddings.couple.call')} />}
      {phone && <ContactAction href={`sms:${phone.replace(/\s+/g, '')}`} label={t('weddings.couple.text')} />}
      {phone && <CopyAction value={phone} />}
    </div>
  )
}

/** Couple contact panel shown at the top of the wedding detail page. */
function CouplePanel({ contact, canManage }: { contact: CoupleContact; canManage: boolean }) {
  const p1Name = fullName(contact.first_name, contact.last_name)
  const p2Name = fullName(contact.partner_first_name, contact.partner_last_name)

  // "Both" actions — only when we have two addressable parties.
  const emails = [contact.email, contact.partner_email].filter((e): e is string => !!e)
  const phones = [contact.phone, contact.partner_phone]
    .filter((p): p is string => !!p)
    .map((p) => p.replace(/\s+/g, ''))
  const showEmailBoth = emails.length > 1
  const showSmsBoth = phones.length > 1

  const socials: Array<{ net: 'instagram' | 'facebook' | 'tiktok' | 'website'; label: string }> = [
    { net: 'instagram', label: 'Instagram' },
    { net: 'facebook', label: 'Facebook' },
    { net: 'tiktok', label: 'TikTok' },
    { net: 'website', label: t('weddings.couple.website') },
  ]
  const socialLinks = socials
    .map((s) => ({ ...s, raw: contact[s.net], href: socialUrl(s.net, contact[s.net]) }))
    .filter((s) => !!s.href)

  return (
    <div class="bg-white border border-papaya-300/40 rounded-2xl p-4 mb-6">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-xs font-bold uppercase tracking-wide text-gray-400">{t('weddings.couple.title')}</h3>
        {canManage && (
          <a href={`/app/contacts/${contact.id}/edit`} class="text-xs text-gray-400 hover:text-horizon-700">
            {t('weddings.couple.editContact')}
          </a>
        )}
      </div>

      <div class="space-y-2.5">
        {p1Name && <PartnerRow name={p1Name} email={contact.email} phone={contact.phone} />}
        {p2Name && <PartnerRow name={p2Name} email={contact.partner_email} phone={contact.partner_phone} />}

        {(showEmailBoth || showSmsBoth) && (
          <div class="flex flex-wrap items-center gap-2 pt-0.5">
            {showEmailBoth && (
              <ContactAction href={`mailto:${emails.join(',')}`} label={t('weddings.couple.emailBoth')} />
            )}
            {showSmsBoth && (
              <ContactAction href={`sms://open?addresses=${phones.join(',')}`} label={t('weddings.couple.smsBoth')} />
            )}
          </div>
        )}

        {contact.address && (
          <p class="text-sm text-gray-600">
            <span class="text-gray-400">{t('weddings.couple.address')}: </span>
            {contact.address}
          </p>
        )}

        {socialLinks.length > 0 && (
          <div class="flex flex-wrap items-center gap-2 pt-0.5">
            {socialLinks.map((s) => (
              <ContactAction
                href={s.href!}
                label={s.net === 'website' ? s.label : socialDisplay(s.raw as string)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Compare old and new wedding data and return human-readable change descriptions. */
function diffWeddingChanges(
  oldW: Wedding,
  newData: Record<string, string | number | null | undefined>
): string[] {
  const labels: Record<string, string> = {
    title: 'Title', date: 'Date', time: 'Ceremony time', location: 'City/Region',
    status: 'Status', ceremony_type: 'Ceremony type',
    ceremony_location: 'Ceremony venue', reception_location: 'Reception venue',
    reception_time: 'Reception time', getting_ready_location: 'Getting ready (1) venue',
    getting_ready_time: 'Getting ready (1) time', getting_ready_1_label: 'Getting ready (1) label',
    getting_ready_2_location: 'Getting ready (2) venue', getting_ready_2_label: 'Getting ready (2) label',
    getting_ready_2_time: 'Getting ready (2) time', portrait_location: 'Portraits venue',
    portrait_time: 'Portraits time', emoji: 'Emoji', notes: 'Notes',
  }

  const changes: string[] = []
  for (const [key, label] of Object.entries(labels)) {
    const oldVal = (oldW as Record<string, unknown>)[key] ?? null
    const newVal = newData[key] ?? null
    if (newVal === undefined) continue // field not in form
    if (String(oldVal ?? '') !== String(newVal ?? '')) {
      if (newVal) {
        changes.push(`${label} changed to "${newVal}"`)
      } else {
        changes.push(`${label} cleared`)
      }
    }
  }
  return changes
}

const WEDDING_STATUSES = [
  { value: 'planning', label: 'Planning' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

/** Viewer-localised label for a wedding status value. */
function weddingStatusLabel(value: string): string {
  switch (value) {
    case 'planning': return t('weddings.status.planning')
    case 'confirmed': return t('weddings.status.confirmed')
    case 'completed': return t('weddings.status.completed')
    case 'cancelled': return t('weddings.status.cancelled')
    default: return value.charAt(0).toUpperCase() + value.slice(1)
  }
}

const weddings = new Hono<Env>()

weddings.use('/app/*', requireAuth, csrf, requireVendor)


// ─── Wedding list ───
weddings.get('/app/weddings', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const items = await listWeddingsForVendor(c.env.DB, user.id)
  const cap = await weddingCapStatus(c.env.DB, vendor, user.id)

  const upcoming = items.filter((w) => w.status !== 'completed' && w.status !== 'cancelled')
  const past = items.filter((w) => w.status === 'completed' || w.status === 'cancelled')

  return c.html(
    <AppLayout title={t('weddings.title.weddings')} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-4xl">
        <div class="flex items-center justify-between gap-4 mb-6">
          <div>
            <p class="text-sm text-gray-500">
              {tp('weddings.list.count', items.length)}
            </p>
            {!cap.isPro && (
              <p class="text-xs text-gray-400 mt-0.5">
                {cap.remaining === 1 ? t('weddings.cap.lastOne') : t('weddings.cap.used', { count: cap.count, limit: cap.limit })}
              </p>
            )}
          </div>
          {cap.atCap ? (
            <a
              href="/app/subscription/checkout"
              class="bg-horizon-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              {t('weddings.cap.upgradeButton')}
            </a>
          ) : (
            <a
              href="/app/weddings/new"
              class="bg-horizon-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              {t('weddings.list.newWedding')}
            </a>
          )}
        </div>

        {items.length === 0 ? (
          <div class="text-center py-12 bg-white border border-papaya-300/30 rounded-2xl">
            <p class="text-gray-500 text-sm mb-2">{t('weddings.list.emptyTitle')}</p>
            <p class="text-xs text-gray-400">
              {t('weddings.list.emptyBody')}
            </p>
          </div>
        ) : (
          <div class="space-y-8">
            {upcoming.length > 0 && (
              <div>
                <h2 class="text-sm font-bold text-gray-500 mb-3">{t('weddings.list.upcoming')}</h2>
                <WeddingGrid weddings={upcoming} />
              </div>
            )}
            {past.length > 0 && (
              <div>
                <h2 class="text-sm font-bold text-gray-500 mb-3">{t('weddings.list.past')}</h2>
                <WeddingGrid weddings={past} />
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  )
})

// ─── New wedding ───
weddings.get('/app/weddings/new', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const cap = await weddingCapStatus(c.env.DB, vendor, user.id)
  if (cap.atCap) {
    return c.html(
      <AppLayout title={t('weddings.title.new')} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
        <WeddingCapPrompt limit={cap.limit} />
      </AppLayout>
    )
  }
  const contactId = c.req.query('contact')
  const types: string[] = vendor.ceremony_types ? JSON.parse(vendor.ceremony_types) : []

  return c.html(
    <AppLayout title={t('weddings.title.new')} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        <WeddingForm
          action="/app/weddings/new"
          csrfToken={c.get('csrfToken')}
          contactId={contactId}
          ceremonyTypes={types}
        />
      </div>
    </AppLayout>
  )
})

weddings.post('/app/weddings/new', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!

  // Soft cap guard — also enforced server-side so a direct POST can't bypass
  // the hidden form. Existing weddings stay editable; only new ones are blocked.
  const cap = await weddingCapStatus(c.env.DB, vendor, user.id)
  if (cap.atCap) {
    return c.html(
      <AppLayout title={t('weddings.title.new')} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
        <WeddingCapPrompt limit={cap.limit} />
      </AppLayout>
    )
  }

  const body = await c.req.parseBody()

  try {
    const title = requireString(body.title, 'Title')
    const durationRaw = trimOrNull(body.duration_hours)
    const durationHours = durationRaw ? parseFloat(durationRaw) : null
    const wedding = await createWedding(c.env.DB, {
      title,
      date: trimOrNull(body.date),
      time: trimOrNull(body.time),
      duration_hours: durationHours && !isNaN(durationHours) ? durationHours : null,
      location: trimOrNull(body.location),
      notes: trimOrNull(body.notes),
      ceremony_type: trimOrNull(body.ceremony_type) ?? 'wedding',
      created_by_user_id: user.id,
    })

    await addWeddingMember(c.env.DB, {
      wedding_id: wedding.id,
      user_id: user.id,
      role: 'vendor',
      vendor_profile_id: vendor.id,
      vendor_role: vendor.category,
      can_manage: true,
    })

    // Seed the ceremony slot row from the headline time so timeline_items stays
    // the source of truth — otherwise the first projection would blank the column.
    const ceremonyTime = trimOrNull(body.time)
    if (ceremonyTime) {
      await applyWeddingUpdate(c.env.DB, wedding.id, { time: ceremonyTime }, user.id)
    }

    // Auto-create calendar event if wedding has a date
    const weddingDate = trimOrNull(body.date)
    const startTime = trimOrNull(body.time)
    if (weddingDate) {
      const endTime = startTime && durationHours ? addHoursToTime(startTime, durationHours) : null
      await createEvent(c.env.DB, vendor.id, {
        title,
        date: weddingDate,
        start_time: startTime,
        end_time: endTime,
        type: 'booking',
        wedding_id: wedding.id,
        all_day: !startTime,
      })
    }

    track(c.env.DB, vendor.id, 'wedding_created', {
      weddingId: wedding.id,
      metadata: { ceremony_type: trimOrNull(body.ceremony_type) ?? 'wedding' },
    })

    await appendWeddingLog(c.env.DB, wedding.id, user.id, 'Wedding created').catch(() => {})

    // Auto-deploy default checklist template if one exists
    const defaultTemplate = await getDefaultTemplate(c.env.DB, vendor.id)
    if (defaultTemplate) {
      await upsertWeddingTodo(c.env.DB, vendor.id, wedding.id, defaultTemplate.content, defaultTemplate.id)
    }

    // Push wedding files to storage — keeps running after the
    // response is sent; without waitUntil the runtime may cancel it
    c.executionCtx.waitUntil(pushAllWeddingFiles(c.env, vendor, wedding.id))
    c.executionCtx.waitUntil(
      geocodeWeddingLocation(c.env, wedding.id).catch((err) => console.error('[weddings] geocode failed:', err))
    )

    // Link contact and auto-invite couple
    const contactId = trimOrNull(body.contact_id)
    if (contactId) {
      const storage = await getStorageWithSecrets(c.env, vendor)
      const contactResult = await getContact(storage, c.env.DB, vendor.id, contactId)
      if (contactResult) {
        const contact = contactResult.contact
        await updateContact(storage, c.env.DB, vendor.id, contactId, {
          wedding_id: wedding.id,
          status: 'booked',
        })
        await createActivity(c.env.DB, contactId, 'status_change', `Promoted to wedding: ${title}`)
        if (contact.status !== 'booked') {
          track(c.env.DB, vendor.id, 'booking_confirmed', { contactId, weddingId: wedding.id })
        }

        const inviteData = {
          vendorName: vendor.business_name,
          weddingTitle: title,
          weddingDate: trimOrNull(body.date) ? formatDate(String(body.date)) : null,
        }

        if (contact.email) {
          const name = `${contact.first_name} ${contact.last_name}`
          const isNewUser = !(await getUserByEmail(c.env.DB, contact.email))
          const coupleUser = await findOrCreateUser(c.env.DB, contact.email, name)
          await addWeddingMember(c.env.DB, { wedding_id: wedding.id, user_id: coupleUser.id, role: 'couple' })
          sendCoupleInvite(c.env.DB, c.env.KV, c.env.RESEND_API_KEY, c.env.APP_URL, {
            email: contact.email, coupleName: contact.first_name, ...inviteData,
          }).catch((e) => console.error('[INVITE]', e.message))
          if (isNewUser) {
            await c.env.EMAIL_QUEUE.send({
              type: 'notify_admin_signup',
              payload: JSON.stringify({ kind: 'couple', name, email: contact.email }),
            }).catch((e) => console.error('[INVITE] admin signup enqueue failed', e.message))
          }
        }

        if (contact.partner_email) {
          const partnerName = [contact.partner_first_name, contact.partner_last_name].filter(Boolean).join(' ') || contact.partner_email.split('@')[0]
          const isNewUser = !(await getUserByEmail(c.env.DB, contact.partner_email))
          const partnerUser = await findOrCreateUser(c.env.DB, contact.partner_email, partnerName)
          await addWeddingMember(c.env.DB, { wedding_id: wedding.id, user_id: partnerUser.id, role: 'couple' })
          sendCoupleInvite(c.env.DB, c.env.KV, c.env.RESEND_API_KEY, c.env.APP_URL, {
            email: contact.partner_email, coupleName: contact.partner_first_name ?? partnerName, ...inviteData,
          }).catch((e) => console.error('[INVITE]', e.message))
          if (isNewUser) {
            await c.env.EMAIL_QUEUE.send({
              type: 'notify_admin_signup',
              payload: JSON.stringify({ kind: 'couple', name: partnerName, email: contact.partner_email }),
            }).catch((e) => console.error('[INVITE] admin signup enqueue failed', e.message))
          }
        }
      }
    }

    return c.redirect(`/app/weddings/${wedding.id}`)
  } catch (e: any) {
    return c.redirect(`/app/weddings/new?error=${encodeURIComponent(e.message)}`)
  }
})

// ─── Invite couple (the people getting married) ───
weddings.post('/app/weddings/:id/invite', rateLimit(20, 60), async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || !membership.can_manage) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  const email = String(body.email).trim().toLowerCase()
  const name = String(body.name).trim()

  if (!isValidEmail(email) || !name) {
    return peopleResult(c, weddingId, { errorCode: 'invalid' })
  }

  const isNewUser = !(await getUserByEmail(c.env.DB, email))
  const coupleUser = await findOrCreateUser(c.env.DB, email, name)
  // Guard against the upsert's role-flip / resurrection foot-guns: never demote an
  // existing vendor/guest into a couple, or silently re-activate a removed member.
  const existing = await getAnyMembership(c.env.DB, weddingId, coupleUser.id)
  if (existing) {
    if (existing.role !== 'couple') return peopleResult(c, weddingId, { errorCode: 'already_other' })
    if (existing.status === 'removed') return peopleResult(c, weddingId, { errorCode: 'removed' })
    return peopleResult(c, weddingId, {}) // already an active couple — idempotent no-op
  }
  await addWeddingMember(c.env.DB, {
    wedding_id: weddingId,
    user_id: coupleUser.id,
    // Couples are NOT can_manage: the shared wedding doc + others' web links are
    // intentionally read-only to them (canWriteDoc gates on can_manage); couples
    // still edit their wedding + manage vendors via role-based checks.
    role: 'couple',
  })

  c.executionCtx.waitUntil(appendWeddingLog(c.env.DB, weddingId, user.id, 'Couple added', name).catch((e) => console.error('[wedding-log] append failed', e)))

  const wedding = await getWedding(c.env.DB, weddingId)
  sendCoupleInvite(c.env.DB, c.env.KV, c.env.RESEND_API_KEY, c.env.APP_URL, {
    email,
    coupleName: name.split(' ')[0],
    vendorName: vendor.business_name,
    weddingTitle: wedding?.title ?? 'Your wedding',
    weddingDate: wedding?.date ? formatDate(wedding.date) : null,
  }).catch((e) => console.error('[INVITE]', e.message))

  // Other vendors on this wedding learn the couple has been added
  await c.env.EMAIL_QUEUE.send({
    type: 'notify_couple_joined',
    payload: JSON.stringify({ weddingId, coupleName: name, excludeVendorProfileId: vendor.id }),
  }).catch((e) => console.error('[INVITE] couple_joined enqueue failed', e.message))

  if (isNewUser) {
    await c.env.EMAIL_QUEUE.send({
      type: 'notify_admin_signup',
      payload: JSON.stringify({ kind: 'couple', name, email }),
    }).catch((e) => console.error('[INVITE] admin signup enqueue failed', e.message))
  }

  track(c.env.DB, vendor.id, 'couple_invited', { weddingId })

  return peopleResult(c, weddingId, { invited: true })
})

// ─── Add guest / other person to wedding ───
weddings.post('/app/weddings/:id/add-guest', rateLimit(60, 60), async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || !membership.can_manage) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  const email = String(body.email).trim().toLowerCase()
  const name = String(body.name).trim()
  const canManageGuest = body.can_manage === '1' || body.can_manage === 'on'

  if (!isValidEmail(email) || !name) {
    return peopleResult(c, weddingId, { errorCode: 'invalid' })
  }

  const guestUser = await findOrCreateUser(c.env.DB, email, name)
  // Guard against role-flip / resurrection: never demote an existing vendor/couple
  // into a guest, or silently re-activate a removed member, via the upsert.
  const existing = await getAnyMembership(c.env.DB, weddingId, guestUser.id)
  if (existing) {
    if (existing.role !== 'guest') return peopleResult(c, weddingId, { errorCode: 'already_other' })
    if (existing.status === 'removed') return peopleResult(c, weddingId, { errorCode: 'removed' })
    return peopleResult(c, weddingId, {}) // already an active guest — idempotent no-op
  }
  await addWeddingMember(c.env.DB, {
    wedding_id: weddingId,
    user_id: guestUser.id,
    role: 'guest',
    can_manage: canManageGuest,
  })

  c.executionCtx.waitUntil(appendWeddingLog(c.env.DB, weddingId, user.id, 'Guest added', name).catch((e) => console.error('[wedding-log] append failed', e)))

  // Send them the same invite email so they can access the wedding
  const wedding = await getWedding(c.env.DB, weddingId)
  sendCoupleInvite(c.env.DB, c.env.KV, c.env.RESEND_API_KEY, c.env.APP_URL, {
    email,
    coupleName: name.split(' ')[0],
    vendorName: vendor.business_name,
    weddingTitle: wedding?.title ?? 'Your wedding',
    weddingDate: wedding?.date ? formatDate(wedding.date) : null,
  }).catch((e) => console.error('[INVITE]', e.message))

  return peopleResult(c, weddingId, { invited: true })
})

// ─── Autolookup: typeahead of existing Wedding Computer vendors ───
// Lazy (only fires when the manager types), so it adds nothing to the wedding
// page load. Returns name/category/city only — never the email.
weddings.get('/app/weddings/:id/vendor-search', rateLimit(60, 60), async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('id')
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || !membership.can_manage) return c.html('')
  // Per-account cap (the IP+path limit resets per wedding id) so the global
  // vendor directory can't be bulk-enumerated by rotating wedding ids.
  if (!(await consumeRateLimit(c.env.KV, `vsearch:${vendor.id}`, 120, 60))) return c.html('')

  const q = (c.req.query('q') ?? '').trim()
  if (q.length < 2) return c.html('')
  const matches = await searchVendorsForWedding(c.env.DB, weddingId, q)
  if (matches.length === 0) return c.html('')

  const csrfToken = c.get('csrfToken')
  return c.html(
    <div class="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
      {matches.map((m) => {
        const place = [m.location_city, m.location_state].filter(Boolean).join(', ')
        return (
          <form method="post" action={`/app/weddings/${weddingId}/add-vendor`} hx-post={`/app/weddings/${weddingId}/add-vendor`} hx-target="#people-section" hx-swap="outerHTML" hx-disabled-elt="find button">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input type="hidden" name="vendor_profile_id" value={m.id} />
            <button type="submit" class="block w-full text-left px-4 py-2.5 hover:bg-papaya-50 transition-colors border-b border-gray-100 last:border-0">
              <span class="text-sm font-medium text-gray-900">{m.business_name}</span>
              <span class="text-xs text-gray-500 block">
                {vendorTypeLabel({ slug: m.category, label: m.category })}
                {place ? ` · ${place}` : ''}
              </span>
            </button>
          </form>
        )
      })}
    </div>
  )
})

// ─── Add vendor to wedding ───
weddings.post('/app/weddings/:id/add-vendor', rateLimit(30, 60), async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || !membership.can_manage) return c.text('Not found', 404)

  const body = await c.req.parseBody()

  // Autolookup path: an existing Wedding Computer vendor was picked. Resolve the
  // email server-side (never exposed to the searcher) and add them by id, with
  // their own profile category as the role.
  const pickedId = String(body.vendor_profile_id ?? '').trim()
  if (pickedId) {
    const vp = await getVendorWithEmail(c.env.DB, pickedId)
    if (!vp?.user_email) return peopleResult(c, weddingId, { errorCode: 'vendor_not_found' })
    // getAnyMembership (not active-only) + explicit checks, identical to the email
    // branch: never demote an existing couple/guest or resurrect a removed member.
    const existingVp = await getAnyMembership(c.env.DB, weddingId, vp.user_id)
    if (existingVp) {
      if (existingVp.role !== 'vendor') return peopleResult(c, weddingId, { errorCode: 'already_other' })
      if (existingVp.status === 'removed') return peopleResult(c, weddingId, { errorCode: 'removed' })
      return peopleResult(c, weddingId, {}) // already an active vendor — idempotent no-op
    }
    await addWeddingMember(c.env.DB, {
      wedding_id: weddingId,
      user_id: vp.user_id,
      role: 'vendor',
      vendor_profile_id: vp.id,
      vendor_role: vp.category,
      can_manage: isManagerVendor(vp),
      is_financial_party: false,
    })
    // Background: a heads-up email. Doesn't block the redirect.
    c.executionCtx.waitUntil(
      c.env.EMAIL_QUEUE.send({
        type: 'notify_vendor_added_to_wedding',
        payload: JSON.stringify({ weddingId, vendorEmail: vp.user_email, vendorName: vp.business_name, addedBy: vendor.business_name }),
      }).catch(() => {})
    )
    // Share the couple's full contact details with the newly-added vendor.
    c.executionCtx.waitUntil(ensureCoupleContact(c.env, vp, weddingId))
    c.executionCtx.waitUntil(appendWeddingLog(c.env.DB, weddingId, user.id, 'Vendor added', vp.business_name).catch((e) => console.error('[wedding-log] append failed', e)))
    track(c.env.DB, vendor.id, 'vendor_added', { weddingId, metadata: { vendorId: vp.id } })
    return peopleResult(c, weddingId, { invited: true })
  }

  const email = String(body.email).trim().toLowerCase()
  const name = String(body.name).trim()
  const vendorRole = String(body.vendor_role || '').trim() || null
  // Prefilled handle so credits work before an invited vendor has an account.
  const invitedInstagram = sanitizeInstagramHandle(String(body.instagram || ''))
  const canManage = body.can_manage === '1' || body.can_manage === 'on'
  const isFinancialParty = body.is_financial_party === '1' || body.is_financial_party === 'on'

  if (!isValidEmail(email) || !name) {
    return peopleResult(c, weddingId, { errorCode: 'invalid' })
  }

  // Find or create the vendor user
  const vendorUser = await findOrCreateUser(c.env.DB, email, name)

  // Same role-flip / resurrection guard as the autolookup branch: don't let an
  // email invite demote an existing couple/guest or revive a removed member.
  const existingVendor = await getAnyMembership(c.env.DB, weddingId, vendorUser.id)
  if (existingVendor) {
    if (existingVendor.role !== 'vendor') return peopleResult(c, weddingId, { errorCode: 'already_other' })
    if (existingVendor.status === 'removed') return peopleResult(c, weddingId, { errorCode: 'removed' })
    return peopleResult(c, weddingId, {}) // already an active vendor — idempotent no-op
  }

  // Check if they have a vendor profile
  const vendorProfile = await getVendorByUserId(c.env.DB, vendorUser.id)

  // Planners and venues administer the weddings they're on.
  const assignedRole = vendorRole ?? vendorProfile?.category ?? null
  const isManager = vendorProfile
    ? isManagerVendor(vendorProfile)
    : assignedRole === 'planner' || assignedRole === 'venue'

  await addWeddingMember(c.env.DB, {
    wedding_id: weddingId,
    user_id: vendorUser.id,
    role: 'vendor',
    vendor_profile_id: vendorProfile?.id ?? null,
    vendor_role: assignedRole,
    // Only keep the prefilled handle while they have no profile of their own;
    // once they onboard, vendor_profiles.instagram is the source of truth.
    invited_instagram: vendorProfile ? null : invitedInstagram,
    can_manage: canManage || isManager,
    is_financial_party: isFinancialParty,
  })

  c.executionCtx.waitUntil(appendWeddingLog(c.env.DB, weddingId, user.id, 'Vendor added', name).catch((e) => console.error('[wedding-log] append failed', e)))

  // Everything past the membership write is BACKGROUND (waitUntil) — the redirect
  // returns immediately; none of this blocks it. The welcome path in particular
  // makes a live Resend HTTP call that used to gate the whole submit.
  if (vendorProfile) {
    // A short "you've been added" heads-up to the new member.
    c.executionCtx.waitUntil(
      c.env.EMAIL_QUEUE.send({
        type: 'notify_vendor_added_to_wedding',
        payload: JSON.stringify({ weddingId, vendorEmail: email, vendorName: name, addedBy: vendor.business_name }),
      }).catch(() => {})
    )
    // Share the couple's full contact details with the newly-added vendor.
    c.executionCtx.waitUntil(ensureCoupleContact(c.env, vendorProfile, weddingId))
  } else {
    // New to Wedding Computer — introduce the platform (welcome email + magic link).
    c.executionCtx.waitUntil(
      (async () => {
        const wedding = await getWedding(c.env.DB, weddingId)
        if (!wedding) return
        await sendVendorWelcomeInvite(c.env.DB, c.env.KV, c.env.RESEND_API_KEY, c.env.APP_URL, {
          email,
          inviterName: vendor.business_name,
          inviterRole: vendor.category,
          inviterVendorId: vendor.id,
          weddingId,
          weddingTitle: wedding.title,
          weddingDate: wedding.date ? formatDate(wedding.date) : null,
          vendorRole: assignedRole,
        })
      })().catch((e: any) => console.error('[weddings] vendor welcome invite failed', e?.message))
    )
  }

  track(c.env.DB, vendor.id, 'vendor_added', { weddingId, metadata: { vendorEmail: email } })

  return peopleResult(c, weddingId, { invited: true })
})

// ─── Set a vendor member's type(s) for this wedding ───
// A vendor may declare many types; on a given wedding they're credited as one or
// more. Manager-only; keeps the singular vendor_role in sync for legacy readers.
weddings.post('/app/weddings/:id/members/:userId/roles', rateLimit(60, 60), async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('id')
  const targetUserId = c.req.param('userId')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || !membership.can_manage) return c.text('Not found', 404)

  // The target must be a vendor member of THIS wedding. Pull their declared
  // types so we can validate the submission server-side (the form only offers
  // these, but a crafted POST could send anything).
  const target = await c.env.DB
    .prepare(
      `SELECT wm.role, vp.categories, vp.category
       FROM wedding_members wm
       LEFT JOIN vendor_profiles vp ON vp.id = wm.vendor_profile_id
       WHERE wm.wedding_id = ? AND wm.user_id = ? AND wm.status = 'active'`
    )
    .bind(weddingId, targetUserId)
    .first<{ role: string; categories: string | null; category: string | null }>()
  if (!target || target.role !== 'vendor') return c.text('Not found', 404)

  // Allowed roles = the vendor's own declared types, plus the admin catalog
  // (covers email-invited vendors with no profile yet).
  const types = await listVendorTypes(c.env.DB)
  let declared: string[] = []
  if (target.categories) {
    try {
      const arr = JSON.parse(target.categories)
      if (Array.isArray(arr)) declared = arr.filter((s): s is string => typeof s === 'string')
    } catch { /* ignore */ }
  }
  if (!declared.length && target.category) declared = [target.category]
  const allowed = new Set([...declared, ...types.map((t) => t.slug)])

  const body = await c.req.parseBody({ all: true })
  const raw = body.vendor_roles
  const roles = (Array.isArray(raw) ? raw : raw != null ? [raw] : [])
    .map((r) => String(r).trim())
    .filter((r) => r && allowed.has(r))
    .slice(0, 12) // generous cap; guards against an abusive payload

  await setWeddingMemberRoles(c.env.DB, weddingId, targetUserId, roles)
  return peopleResult(c, weddingId, {})
})

// ─── Remove a vendor from this wedding (manager-only, soft remove) ───
weddings.post('/app/weddings/:id/members/:userId/remove', rateLimit(30, 60), async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('id')
  const targetUserId = c.req.param('userId')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || !membership.can_manage) return c.text('Not found', 404)
  // A manager can't remove themselves here (avoid orphaning the wedding).
  if (targetUserId === user.id) return peopleResult(c, weddingId, {})

  const target = await getMembership(c.env.DB, weddingId, targetUserId)
  if (!target || target.role !== 'vendor') return c.text('Not found', 404)

  await c.env.DB
    .prepare("UPDATE wedding_members SET status = 'removed' WHERE wedding_id = ? AND user_id = ? AND role = 'vendor'")
    .bind(weddingId, targetUserId)
    .run()

  c.executionCtx.waitUntil(
    (async () => {
      const u = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(targetUserId).first<{ name: string }>()
      await appendWeddingLog(c.env.DB, weddingId, user.id, 'Vendor removed', u?.name ?? null)
    })().catch(() => {})
  )

  if (target.vendor_profile_id) {
    // Mirror the removal into the couple's tracked vendors + drop the vendor's
    // tagged calendar events for this wedding so it leaves their feed.
    await c.env.DB
      .prepare("UPDATE couple_vendors SET status = 'removed' WHERE wedding_id = ? AND vendor_profile_id = ?")
      .bind(weddingId, target.vendor_profile_id)
      .run()
    c.executionCtx.waitUntil(
      c.env.DB
        .prepare("DELETE FROM calendar_events WHERE wedding_id = ? AND vendor_id = ? AND notes LIKE 'wc:%'")
        .bind(weddingId, target.vendor_profile_id)
        .run()
        .then(() => {})
        .catch((e) => console.error('[weddings] remove vendor: calendar cleanup failed', e)),
    )
  }
  return peopleResult(c, weddingId, {})
})

// ─── Grant/revoke wedding-manager (can_manage) for a member (manager-only) ───
weddings.post('/app/weddings/:id/members/:userId/manage', rateLimit(60, 60), async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('id')
  const targetUserId = c.req.param('userId')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || !membership.can_manage) return c.text('Not found', 404)

  const target = await getMembership(c.env.DB, weddingId, targetUserId)
  if (!target) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  const grant = body.manage === '1'

  if (!grant) {
    // Never leave a wedding with zero managers (lock-out). Grant someone else
    // first, then demote.
    const managers = await c.env.DB
      .prepare("SELECT COUNT(*) AS n FROM wedding_members WHERE wedding_id = ? AND status = 'active' AND can_manage = 1")
      .bind(weddingId)
      .first<{ n: number }>()
    if ((managers?.n ?? 0) <= 1) {
      return peopleResult(c, weddingId, { errorCode: 'last_manager' })
    }
  }

  await c.env.DB
    .prepare("UPDATE wedding_members SET can_manage = ? WHERE wedding_id = ? AND user_id = ?")
    .bind(grant ? 1 : 0, weddingId, targetUserId)
    .run()
  return peopleResult(c, weddingId, {})
})

// ─── Wedding detail ───
weddings.get('/app/weddings/:id', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('id')

  // These four are independent — fire them together instead of four serial D1
  // round-trips (the click-to-load latency users feel is mostly serial depth).
  // `lead` is threaded into the timeline section so buildProps skips its own
  // serial getTimelineLead fetch.
  const [membership, wedding, allMembers, lead] = await Promise.all([
    getMembership(c.env.DB, weddingId, user.id),
    getWedding(c.env.DB, weddingId),
    getWeddingMembers(c.env.DB, weddingId),
    getTimelineLead(c.env.DB, weddingId),
  ])
  if (!membership) return c.text('Wedding not found', 404)
  if (!wedding) return c.text('Wedding not found', 404)

  const days = wedding.date ? daysUntil(wedding.date) : null
  const hasCoupleOrGuest = allMembers.some((m) => m.role === 'couple' || m.role === 'guest')
  const invited = c.req.query('invited')
  const flashError = peopleErrorMessage(c.req.query('error'))

  const canManage = !!membership.can_manage
  // Everyone on a wedding sees the full team — being added IS the access grant.
  const members = allMembers

  const uploaded = c.req.query('uploaded')
  const deleted = c.req.query('deleted')

  // Everything below is independent of everything else (it only needs
  // membership/wedding/members/canManage, already resolved) — fire it all at
  // once instead of ~16 serial D1 round-trips. Per-call .catch fallbacks keep a
  // missing optional table from rejecting the whole batch.
  const basePath = `/app/weddings/${weddingId}`
  const [
    documents,
    weddingInvoices,
    vendorTypes,
    linkedContact,
    weddingTodo,
    todoTemplates,
    docTabs,
    webLinks,
    sendableFormsAll,
    formSends,
    formResponses,
    timelineSection,
    coupleVendors,
    log,
  ] = await Promise.all([
    listDocumentsForWedding(c.env.DB, weddingId, user.id),
    listInvoicesForWedding(c.env.DB, vendor.id, weddingId),
    canManage ? listVendorTypes(c.env.DB) : Promise.resolve([]),
    c.env.DB
      .prepare(
        `SELECT id, first_name, last_name, partner_first_name, partner_last_name,
                email, partner_email, phone, partner_phone,
                address, instagram, facebook, tiktok, website
         FROM contacts WHERE vendor_id = ? AND wedding_id = ? LIMIT 1`,
      )
      .bind(vendor.id, weddingId)
      .first<CoupleContact>(),
    getWeddingTodo(c.env.DB, vendor.id, weddingId),
    listTemplates(c.env.DB, vendor.id),
    loadDocTabs(c.env.DB, weddingId, membership, user.id),
    listWebLinks(c.env.DB, weddingId),
    listForms(c.env.DB, vendor.id),
    listFormSendsForWedding(c.env.DB, weddingId, vendor.id),
    listWeddingSubmissions(c.env.DB, weddingId, { role: 'vendor', vendorId: vendor.id }),
    // Reuse the already-loaded wedding + lead so buildProps doesn't re-fetch them.
    renderTimelineSection(c, weddingId, membership, user, basePath, { wedding, lead }),
    listCoupleVendors(c.env.DB, weddingId).catch(() => [] as Awaited<ReturnType<typeof listCoupleVendors>>),
    listWeddingLog(c.env.DB, weddingId, 20).catch(() => [] as Awaited<ReturnType<typeof listWeddingLog>>),
  ])

  const sendableForms = sendableFormsAll.filter((f) => f.type === 'custom' && f.is_active)
  const credits = buildCredits(members, coupleVendors)
  const timelinePending = c.req.query('timeline_pending')

  return c.html(
    <AppLayout
      title={weddingDisplayTitle(wedding)}
      user={user}
      vendor={vendor}
      csrfToken={c.get('csrfToken')}
    >
      <div class="max-w-3xl">
        {flashError && (
          <div class="mb-4 bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl px-4 py-2.5">{flashError}</div>
        )}
        <div class="flex items-start justify-between mb-6">
          <div>
            <p class="text-sm text-gray-500 mb-1">
              <a href="/app/weddings" class="hover:text-gray-900">{t('weddings.list.breadcrumb')}</a> /
            </p>
            <h2 class="text-xl font-bold">{weddingDisplayTitle(wedding)}</h2>
            {wedding.ceremony_type && wedding.ceremony_type !== 'wedding' && (
              <span class="inline-block mt-1 px-2.5 py-0.5 bg-papaya-200 text-gray-700 text-xs font-medium rounded-full">
                {wedding.ceremony_type.charAt(0).toUpperCase() + wedding.ceremony_type.slice(1)}
              </span>
            )}
            {wedding.date && (
              <p class="text-sm text-gray-600 mt-1">
                {formatDate(wedding.date)}
                {days !== null && days > 0 && (
                  <span class="text-gray-400"> {t('weddings.detail.daysAway', { days })}</span>
                )}
              </p>
            )}
          </div>
          {canManage && (
            <a
              href={`/app/weddings/${wedding.id}/edit`}
              class="border border-gray-200 px-3 py-1.5 rounded-xl text-sm hover:bg-papaya-50"
            >
              {t('weddings.detail.edit')}
            </a>
          )}
        </div>

        {linkedContact && <CouplePanel contact={linkedContact} canManage={canManage} />}

        {timelinePending && (
          <div class="bg-papaya-100 border border-papaya-300/50 text-gray-700 text-sm rounded-xl p-3 mb-4">
            {t('weddings.timeline.sentForApproval')}
          </div>
        )}

        {/* Pending timeline-change approvals (incl. wedding-headline requests like
            a date change) render inside the run-sheet's own diff cards now —
            see renderTimelineSection / TimelineBody. */}

        {/* Details — one dense card instead of a scatter of single-value boxes */}
        <div class="mb-6">
          <h3 class="text-sm font-bold text-gray-500 mb-3">{t('weddings.detail.details')}</h3>
          <div class="bg-white border border-papaya-300/30 rounded-2xl p-4">
            <dl class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4">
              <div>
                <dt class="text-xs text-gray-500 mb-1">{t('weddings.detail.status')}</dt>
                <dd><WeddingStatusBadge status={wedding.status} /></dd>
              </div>
              {wedding.date && (
                <div>
                  <dt class="text-xs text-gray-500 mb-1">{t('weddings.detail.date')}</dt>
                  <dd class="text-sm font-medium text-gray-900">{formatDate(wedding.date)}</dd>
                </div>
              )}
              {wedding.time && (
                <div>
                  <dt class="text-xs text-gray-500 mb-1">{t('weddings.detail.time')}</dt>
                  <dd class="text-sm font-medium text-gray-900">
                    {formatTime(wedding.time) +
                      (wedding.duration_hours
                        ? ` (${wedding.duration_hours % 1 === 0 ? wedding.duration_hours + 'h' : Math.floor(wedding.duration_hours) + 'h 30m'})`
                        : '')}
                  </dd>
                </div>
              )}
              {wedding.location && (
                <div>
                  <dt class="text-xs text-gray-500 mb-1">{t('weddings.detail.cityRegion')}</dt>
                  <dd class="text-sm font-medium text-gray-900">{wedding.location}</dd>
                </div>
              )}
              <div>
                <dt class="text-xs text-gray-500 mb-1">{t('weddings.detail.yourRole')}</dt>
                <dd class="text-sm font-medium text-gray-900">
                  {membership.vendor_role ? membership.vendor_role.charAt(0).toUpperCase() + membership.vendor_role.slice(1) : categoriesLabel(vendor)}
                  {membership.can_manage ? t('weddings.detail.managerSuffix') : ''}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-gray-500 mb-1">{t('weddings.detail.created')}</dt>
                <dd class="text-sm font-medium text-gray-900">{formatDate(wedding.created_at)}</dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Weather — live forecast within a week, else the AI climate note. */}
        {shouldShowWeather(days, wedding.location_lat, wedding.location_lng) && (
          <div class="mb-6">
            <h3 class="text-sm font-bold text-gray-500 mb-3">{t('weather.heading')}</h3>
            <div
              id="wx-card"
              class="bg-white border border-papaya-300/30 rounded-2xl p-4"
              hx-get={`/app/weddings/${wedding.id}/weather`}
              hx-trigger="load, every 3600s"
              hx-swap="innerHTML"
            >
              <p class="text-xs text-gray-400">{t('weather.loading')}</p>
            </div>
          </div>
        )}
        {wedding.location && wedding.date && !shouldShowWeather(days, wedding.location_lat, wedding.location_lng) && (
          <div class="mb-6">
            <h3 class="text-sm font-bold text-gray-500 mb-3">{t('climate.heading')}</h3>
            <div
              class="bg-white border border-papaya-300/30 rounded-2xl p-4"
              hx-get={`/app/weddings/${wedding.id}/climate`}
              hx-trigger="load"
              hx-swap="innerHTML"
            >
              <p class="text-xs text-gray-400">{t('climate.loading')}</p>
            </div>
          </div>
        )}

        {/* People */}
        <PeopleSection
          wedding={wedding}
          members={members}
          canManage={canManage}
          vendorTypes={vendorTypes}
          csrfToken={c.get('csrfToken')}
          currentUserId={user.id}
          invited={invited}
        />

        {/* Your team (agencies) */}
        {vendor.is_agency === 1 && (
          <div class="mb-6">
            <h3 class="text-sm font-bold text-gray-500 mb-3">{t('weddings.detail.yourTeam')}</h3>
            <div
              class="bg-white border border-papaya-300/30 rounded-2xl p-4"
              hx-get={`/app/weddings/${wedding.id}/team-assignments`}
              hx-trigger="load"
              hx-swap="innerHTML"
            >
              <p class="text-xs text-gray-400">{t('weddings.detail.loadingTeam')}</p>
            </div>
          </div>
        )}

        {/* Places */}
        <WeddingPlaces wedding={wedding} />

        {/* Todo Checklist */}
        <TodoSection
          weddingId={wedding.id}
          todo={weddingTodo}
          templates={todoTemplates}
          csrfToken={c.get('csrfToken')}
        />

        {/* Invoices & Payments */}
        <WeddingInvoices
          weddingId={wedding.id}
          invoices={weddingInvoices}
          contactId={linkedContact?.id ?? null}
        />

        {/* Collaborative notes — Everyone + Vendors only + Private tabs */}
        <WeddingDoc
          tabs={docTabs}
          baseUrl={`/app/weddings/${wedding.id}/docs`}
          csrfToken={c.get('csrfToken')}
        />

        {/* Web links */}
        <WebLinks
          links={webLinks}
          basePath={`/app/weddings/${wedding.id}`}
          currentUserId={user.id}
          canManage={canManage}
        />

        {/* Run sheet / unified wedding timeline */}
        {timelineSection}

        {/* Forms — beneath the run sheet */}
        <VendorFormsCard
          weddingId={weddingId}
          vendorId={vendor.id}
          appUrl={c.env.APP_URL}
          csrfToken={c.get('csrfToken')}
          sendableForms={sendableForms}
          sends={formSends}
          responses={formResponses}
        />

        {/* Files */}
        <WeddingFiles
          weddingId={wedding.id}
          documents={documents}
          members={allMembers}
          userId={user.id}
          csrfToken={c.get('csrfToken')}
          uploaded={!!uploaded}
          deleted={!!deleted}
        />

        {/* Vendor Credits */}
        {credits.length > 0 && (
          <WeddingCredits credits={credits} weddingTitle={wedding.title} />
        )}

        {/* Wedding Log */}
        {log.length > 0 && (
          <div class="mt-6">
            <h3 class="text-sm font-bold text-gray-500 mb-3">{t('weddings.detail.activityLog')}</h3>
            <div class="bg-white border border-papaya-300/30 rounded-2xl p-4">
              <div class="space-y-2">
                {log.map((entry) => (
                  <div class="flex items-start gap-2 text-xs">
                    <span class="text-gray-400 whitespace-nowrap shrink-0">
                      {formatDateTime(entry.created_at)}
                    </span>
                    <span class="text-gray-500">
                      <strong class="text-gray-700">{entry.user_name ?? t('weddings.detail.system')}</strong>
                      {': '}
                      {entry.action}
                      {entry.detail && (
                        <span class="text-gray-400"> — {entry.detail}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
})

// ─── Expected weather (AI climate note, lazy-loaded) ───
function ClimateNote({ note, state }: { note?: string; state: 'ready' | 'empty' | 'error' }) {
  if (state === 'empty') return <p class="text-xs text-gray-400">{t('climate.empty')}</p>
  if (state === 'error') return <p class="text-xs text-gray-400">{t('climate.error')}</p>
  return (
    <div class="flex gap-3">
      <span class="text-2xl leading-none shrink-0">🌤️</span>
      <p class="text-sm text-gray-700 leading-relaxed">{note}</p>
    </div>
  )
}

weddings.get('/app/weddings/:id/climate', async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('id')
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.text('Not found', 404)
  const wedding = await getWedding(c.env.DB, weddingId)
  if (!wedding) return c.text('Not found', 404)
  if (!wedding.location || !wedding.date) return c.html(<ClimateNote state="empty" />)
  const result = await getOrGenerateClimateNote(c.env, {
    location: wedding.location,
    city: wedding.location_city,
    country: wedding.location_country,
    dateStr: wedding.date,
  })
  if (!result) return c.html(<ClimateNote state="error" />)
  return c.html(<ClimateNote state="ready" note={result.note} />)
})

weddings.get('/app/weddings/:id/weather', (c) =>
  renderWeatherCard(c, c.req.param('id'), `/app/weddings/${c.req.param('id')}`)
)

weddings.post('/app/weddings/:id/weather/unit', (c) =>
  setWeatherUnit(c, c.req.param('id'), `/app/weddings/${c.req.param('id')}`)
)

// Wedding notes (shared / vendors / private) are served by the unified
// collaborative-docs endpoints in routes/vendor/wedding-docs.tsx.
//
// Per-vendor bump in/out is now a private, anchorable timeline section (visible
// in the run sheet, opt-in to the vendor's own calendar) — see the unified
// timeline in routes/vendor/timeline.tsx. The old /bumps form + wc:bump_*
// calendar fan-out have been retired.

// ─── Edit wedding ───
weddings.get('/app/weddings/:id/edit', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || !membership.can_manage) return c.text('Not found', 404)

  const wedding = await getWedding(c.env.DB, weddingId)
  if (!wedding) return c.text('Not found', 404)

  const types: string[] = vendor.ceremony_types ? JSON.parse(vendor.ceremony_types) : []

  const error = c.req.query('error')

  return c.html(
    <AppLayout title={t('weddings.title.editPrefix', { title: wedding.title })} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        <p class="text-sm text-gray-500 mb-4">
          <a href={`/app/weddings/${wedding.id}`} class="hover:text-gray-900">{wedding.title}</a> / {t('weddings.edit.breadcrumbSuffix')}
        </p>
        {error && (
          <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-3 mb-4">
            {error}
          </div>
        )}
        <WeddingForm
          action={`/app/weddings/${wedding.id}/edit`}
          csrfToken={c.get('csrfToken')}
          wedding={wedding}
          ceremonyTypes={types}
        />
      </div>
    </AppLayout>
  )
})

weddings.post('/app/weddings/:id/edit', async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || !membership.can_manage) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  try {
    const title = requireString(body.title, 'Title')
    const oldWedding = await getWedding(c.env.DB, weddingId)
    const newStatus = (body.status as Wedding['status']) || undefined
    const emoji = trimOrNull(body.emoji)

    // The trimmed edit form only submits these. Ceremony/reception/getting-ready/
    // portrait times live in the timeline (run sheet) now, and the shared "Notes"
    // is the "Everyone" scoped note (weddings.notes), edited on the wedding page.
    // Both are managed elsewhere, so we never write — and must never clear — them
    // from this form.
    const updateData: Record<string, unknown> = {
      title,
      date: trimOrNull(body.date),
      location: trimOrNull(body.location),
      ceremony_type: trimOrNull(body.ceremony_type),
      emoji,
    }
    // Only include status if the form submitted one (avoid clearing it)
    if (newStatus) updateData.status = newStatus
    // Only update duration_hours if the form included it
    if (body.duration_hours !== undefined) {
      const durationRaw = trimOrNull(body.duration_hours)
      const durationHours = durationRaw ? parseFloat(durationRaw) : null
      updateData.duration_hours = durationHours && !isNaN(durationHours) ? durationHours : null
    }

    // Timeline control: when a managing planner/venue is on this wedding,
    // timeline changes from anyone else are queued for their approval.
    const touchesTimeline = TIMELINE_FIELDS.some(
      (f) =>
        f in updateData &&
        ((updateData[f] ?? null) !== ((oldWedding as any)?.[f] ?? null))
    )
    if (touchesTimeline) {
      const controllers = await getTimelineControllers(c.env.DB, weddingId)
      const isController = controllers.some((tc) => tc.user_id === user.id)
      if (controllers.length > 0 && !isController) {
        const requesterVendor = c.get('vendor')!
        const changes = oldWedding
          ? diffWeddingChanges(oldWedding, updateData as any)
          : []
        const request = await createTimelineRequest(c.env.DB, {
          wedding_id: weddingId,
          requested_by_user_id: user.id,
          requested_by_label: requesterVendor.business_name,
          target: 'wedding',
          op: 'update',
          payload: updateData,
          summary: changes.length > 0 ? changes.join('; ') : null,
        })
        await appendWeddingLog(c.env.DB, weddingId, user.id, 'Timeline change requested', request.summary).catch(() => {})
        await c.env.EMAIL_QUEUE.send({
          type: 'notify_timeline_change_requested',
          payload: JSON.stringify({
            weddingId,
            requesterLabel: requesterVendor.business_name,
            summary: request.summary,
            controllerUserIds: controllers.map((tc) => tc.user_id),
          }),
        }).catch((e: any) => console.error('[weddings] timeline request notify enqueue failed', e.message))
        // The pending request appears in timeline.md — refresh the vault
        c.executionCtx.waitUntil(pushAllWeddingFiles(c.env, requesterVendor, weddingId))
        return c.redirect(`/app/weddings/${weddingId}?timeline_pending=1`)
      }
    }

    console.log('[weddings] edit', weddingId, 'fields:', Object.keys(updateData).join(','))
    // Headline times are timeline sections (the source of truth): route the slot
    // fields onto the named slot rows and write date/durations/etc. directly, then
    // refresh the derived columns — no direct column write the projection clobbers.
    await applyWeddingUpdate(c.env.DB, weddingId, updateData as Record<string, string | number | null>, user.id, oldWedding as any)
    console.log('[weddings] edit', weddingId, 'updateWedding succeeded')
    // Headline-time change applied directly — notify the run-sheet team (debounced).
    if (touchesTimeline) await markTimelineDirty(c.env.KV, weddingId, user.id).catch(() => {})
    c.executionCtx.waitUntil(
      geocodeWeddingLocation(c.env, weddingId)
        .catch((err) => console.error('[weddings] geocode failed:', err))
        // A new date or location moves the sun, so re-solve sun-anchored
        // sections once fresh coordinates are in.
        .then(() => weddingSunMinutes(c.env.DB, weddingId))
        .then((sun) => resolveAndMaterialize(c.env.DB, weddingId, sun))
        .catch((err) => console.error('[weddings] timeline re-solve failed:', err))
    )

    // Log changes
    if (oldWedding) {
      const changes = diffWeddingChanges(oldWedding, {
        title, date: trimOrNull(body.date),
        location: trimOrNull(body.location), status: newStatus as string | undefined,
        ceremony_type: trimOrNull(body.ceremony_type),
        emoji,
      })
      if (changes.length > 0) {
        try {
          await appendWeddingLog(c.env.DB, weddingId, user.id, 'Wedding updated', changes.join('; '))
        } catch { /* table might not exist yet */ }
      }
    }

    const vendor = c.get('vendor')!

    // Push all wedding files to storage — waitUntil keeps the
    // push alive after the redirect is sent
    c.executionCtx.waitUntil(pushAllWeddingFiles(c.env, vendor, weddingId))

    if (newStatus === 'confirmed' && oldWedding?.status !== 'confirmed') {
      track(c.env.DB, c.get('vendor')!.id, 'booking_confirmed', { weddingId })
      await c.env.EMAIL_QUEUE.send({
        type: 'notify_booking_confirmed',
        payload: JSON.stringify({ weddingId }),
      })
    }

    return c.redirect(`/app/weddings/${weddingId}`)
  } catch (e: any) {
    console.error('[weddings] edit failed:', weddingId, e.message, e.stack?.split('\n').slice(0, 3).join(' | '))
    return c.redirect(`/app/weddings/${weddingId}/edit?error=${encodeURIComponent(e.message)}`)
  }
})

// Timeline-change approvals (run-sheet AND wedding-headline requests) are handled
// by the unified timeline htmx route — POST /app/weddings/:id/timeline/requests/
// :reqId/:decision in routes/vendor/timeline.tsx → timeline-handlers `decide`,
// which applies via applyRequest + afterWrite. The old standalone box + route
// here were removed to keep a single approval UI and apply path.

// ─── Promote contact to wedding ───
weddings.get('/app/contacts/:id/promote', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const cap = await weddingCapStatus(c.env.DB, vendor, user.id)
  if (cap.atCap) {
    return c.html(
      <AppLayout title={t('weddings.title.createWedding')} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
        <WeddingCapPrompt limit={cap.limit} />
      </AppLayout>
    )
  }
  const storage = await getStorageWithSecrets(c.env, vendor)
  const contactResult = await getContact(storage, c.env.DB, vendor.id, c.req.param('id'))
  if (!contactResult) return c.text('Contact not found', 404)
  const contact = contactResult.contact

  const defaultTitle = contact.partner_first_name
    ? `${contact.first_name} & ${contact.partner_first_name}`
    : `${contact.first_name} ${contact.last_name}`

  const types: string[] = vendor.ceremony_types ? JSON.parse(vendor.ceremony_types) : []

  return c.html(
    <AppLayout title={t('weddings.title.createWedding')} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        <p class="text-sm text-gray-500 mb-4">
          {t('weddings.promote.fromContact')}{' '}
          <a href={`/app/contacts/${contact.id}`} class="font-medium text-gray-900 hover:underline">
            {contact.first_name} {contact.last_name}
          </a>
        </p>
        <WeddingForm
          action="/app/weddings/new"
          csrfToken={c.get('csrfToken')}
          contactId={contact.id}
          ceremonyTypes={types}
          defaults={{
            title: defaultTitle,
            date: contact.wedding_date,
            location: contact.wedding_location,
          }}
        />
      </div>
    </AppLayout>
  )
})

// Send one of the vendor's custom forms to this wedding's couple.
weddings.post('/app/weddings/:id/forms/send', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('id')
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.text('Wedding not found', 404)

  const body = await c.req.parseBody()
  const formId = typeof body.form_id === 'string' ? body.form_id : ''
  const form = formId ? await getForm(c.env.DB, vendor.id, formId) : null
  if (!form || form.type !== 'custom') {
    return c.redirect(`/app/weddings/${weddingId}?error=form#forms`)
  }
  await createFormSend(c.env.DB, vendor.id, {
    form_id: form.id,
    wedding_id: weddingId,
    created_by_user_id: user.id,
  })
  return c.redirect(`/app/weddings/${weddingId}#forms`)
})

// Owning vendor opens a response to the whole vendor team (or closes it).
weddings.post('/app/weddings/:id/forms/submissions/:subId/visibility', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('id')
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.text('Wedding not found', 404)

  const body = await c.req.parseBody()
  await setSubmissionTeamVisibility(c.env.DB, vendor.id, c.req.param('subId'), body.shared === '1')
  return c.redirect(`/app/weddings/${weddingId}#forms`)
})

// ─── Vendor profile — the "vendor social network" view ───
// Any vendor can view another vendor's profile (the platform assumes vendors are
// on it and collaborate). Public-ish details are always shown; direct contact
// (email/phone) appears when you're working together (share a wedding).
function vendorInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'
}
function ensureHttp(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

weddings.get('/app/vendors/:id', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const csrfToken = c.get('csrfToken')
  const targetId = c.req.param('id')

  const target = await getVendorWithEmail(c.env.DB, targetId)
  if (!target) {
    return c.html(
      <AppLayout title={t('weddings.title.vendor')} user={user} vendor={vendor} csrfToken={csrfToken}>
        <div class="max-w-2xl"><p class="text-sm text-gray-500">{t('weddings.profile.notFound')}</p></div>
      </AppLayout>,
      404,
    )
  }

  // Mutual weddings — where BOTH the viewer's vendor and this vendor are active members.
  const mutual = await c.env.DB
    .prepare(
      `SELECT DISTINCT w.id, w.title, w.emoji, w.date
       FROM weddings w
       JOIN wedding_members a ON a.wedding_id = w.id AND a.vendor_profile_id = ? AND a.status = 'active'
       JOIN wedding_members b ON b.wedding_id = w.id AND b.vendor_profile_id = ? AND b.status = 'active'
       ORDER BY (w.date IS NULL), w.date DESC`,
    )
    .bind(vendor.id, targetId)
    .all<{ id: string; title: string; emoji: string | null; date: string | null }>()
    .then((r) => r.results)

  const isSelf = vendor.id === targetId
  const collaborating = isSelf || mutual.length > 0
  const place = [target.location_city, target.location_state, target.location_country].filter(Boolean).join(', ') || target.location
  const cat = categoriesLabel(target)

  return c.html(
    <AppLayout title={target.business_name} user={user} vendor={vendor} csrfToken={csrfToken}>
      <div class="max-w-2xl">
        <p class="text-sm text-gray-500 mb-4">
          <a href="/app/weddings" class="hover:text-gray-900">{t('weddings.list.breadcrumb')}</a> / {t('weddings.profile.breadcrumbVendor')}
        </p>

        <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 sm:p-6 mb-6">
          <div class="flex items-start gap-4">
            <div class="w-14 h-14 rounded-2xl bg-papaya-200 text-grapefruit-700 flex items-center justify-center text-lg font-bold flex-shrink-0">
              {vendorInitials(target.business_name)}
            </div>
            <div class="min-w-0 flex-1">
              <h2 class="text-xl font-bold text-gray-900">{target.business_name}{isSelf && <span class="ml-2 text-xs font-normal text-gray-400">{t('weddings.profile.you')}</span>}</h2>
              <p class="text-sm text-gray-500 mt-0.5">{cat}{place ? ` · ${place}` : ''}</p>
              {target.bio && <p class="text-sm text-gray-600 mt-3 whitespace-pre-wrap">{target.bio}</p>}
              <div class="flex flex-wrap items-center gap-4 mt-3 text-sm">
                {target.website && <a href={ensureHttp(target.website)} target="_blank" rel="noopener noreferrer" class="text-horizon-700 font-bold hover:underline">{t('weddings.profile.website')}</a>}
                {target.instagram && <a href={`https://instagram.com/${sanitizeInstagramHandle(target.instagram)}`} target="_blank" rel="noopener noreferrer" class="text-horizon-700 font-bold hover:underline">{t('weddings.profile.instagram')}</a>}
              </div>
            </div>
          </div>

          {collaborating && !isSelf && (target.user_email || target.phone) && (
            <div class="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-2 text-sm">
              {target.user_email && <a href={`mailto:${target.user_email}`} class="bg-horizon-600 text-white px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-horizon-700 transition-colors">{t('weddings.profile.email')}</a>}
              {target.phone && <a href={`tel:${target.phone}`} class="border border-gray-200 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-papaya-50 transition-colors">{t('weddings.profile.call', { phone: target.phone })}</a>}
            </div>
          )}
        </div>

        {!isSelf && (
          <div class="mb-6">
            <h3 class="text-sm font-bold text-gray-500 mb-3">
              {mutual.length > 0 ? tp('weddings.profile.weddingsTogether', mutual.length) : t('weddings.profile.noneTogether')}
            </h3>
            {mutual.length > 0 && (
              <div class="bg-white border border-papaya-300/30 rounded-2xl divide-y divide-gray-50">
                {mutual.map((w) => (
                  <a href={`/app/weddings/${w.id}`} class="flex items-center justify-between px-4 py-3 hover:bg-papaya-50 transition-colors">
                    <span class="text-sm font-medium text-gray-900">{w.emoji ? `${w.emoji} ` : ''}{w.title}</span>
                    <span class="text-xs text-gray-400">{w.date ? formatDate(w.date) : t('weddings.profile.dateTbd')}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  )
})

export default weddings

// Forms a vendor has sent to this couple + the responses they can see. Lets
// them send another form, copy a send link, view answers, and open a response
// to the whole vendor team.
function VendorFormsCard({
  weddingId,
  vendorId,
  appUrl,
  csrfToken,
  sendableForms,
  sends,
  responses,
}: {
  weddingId: string
  vendorId: string
  appUrl: string
  csrfToken: string
  sendableForms: Form[]
  sends: WeddingFormSend[]
  responses: WeddingSubmission[]
}) {
  return (
    <div class="mb-6" id="forms">
      <h3 class="text-sm font-bold text-gray-500 mb-3">{t('weddings.forms.title')}</h3>
      <div class="bg-white border border-papaya-300/30 rounded-2xl p-4 space-y-4">
        {sendableForms.length > 0 ? (
          <form method="post" action={`/app/weddings/${weddingId}/forms/send`} class="flex items-end gap-2">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <div class="flex-1 min-w-0">
              <label class="block text-xs text-gray-500 mb-1" for="form_id">{t('weddings.forms.sendToCouple')}</label>
              <select id="form_id" name="form_id" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent">
                {sendableForms.map((f) => <option value={f.id}>{f.title}</option>)}
              </select>
            </div>
            <button type="submit" class="bg-horizon-600 text-white py-2 px-4 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors shrink-0">{t('weddings.forms.send')}</button>
          </form>
        ) : (
          <p class="text-sm text-gray-500">
            {t('weddings.forms.emptyPrefix')} <a href="/app/forms" class="text-horizon-600 hover:underline font-medium">{t('weddings.forms.emptyLink')}</a> {t('weddings.forms.emptySuffix')}
          </p>
        )}

        {sends.length > 0 && (
          <div class="space-y-2 pt-1">
            {sends.map((s) => (
              <div class="flex items-center justify-between gap-2 text-sm border-t border-gray-100 pt-2">
                <div class="min-w-0">
                  <p class="font-medium text-gray-900 truncate">{s.form_title}</p>
                  <p class="text-xs text-gray-400">{tp('weddings.forms.responseCount', s.response_count)}</p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <a href={`/form/${s.token}`} target="_blank" rel="noopener" class="text-xs text-horizon-600 hover:underline">{t('weddings.forms.open')}</a>
                  <CopyButton value={`${appUrl}/form/${s.token}`} title={t('weddings.forms.copyLink')} class="w-7 h-7 rounded-full bg-papaya-50 border border-papaya-200 text-gray-500 hover:bg-papaya-100" />
                </div>
              </div>
            ))}
          </div>
        )}

        {responses.length > 0 && (
          <div class="space-y-2 pt-1">
            <p class="text-xs font-bold text-gray-400 uppercase tracking-wide">{t('weddings.forms.responses')}</p>
            {responses.map((sub) => {
              const fields = formSubmissionFields(sub.form_config, sub.data)
              const own = sub.vendor_id === vendorId
              const shared = sub.shared_with_team === 1
              return (
                <details class="border border-gray-100 rounded-xl overflow-hidden">
                  <summary class="cursor-pointer select-none px-3 py-2 text-sm flex items-center justify-between gap-2 hover:bg-papaya-50">
                    <span class="font-medium text-gray-900 truncate">{sub.form_title}</span>
                    <span class="text-xs text-gray-400 shrink-0">{formatDateTime(sub.created_at)}</span>
                  </summary>
                  <div class="px-3 pb-3 pt-1 border-t border-gray-100">
                    {!own && <p class="text-xs text-gray-400 mb-2">{t('weddings.forms.sharedBy', { name: sub.vendor_name ?? '' })}</p>}
                    <dl class="space-y-2">
                      {fields.map((f) => (
                        <div>
                          <dt class="text-xs text-gray-500">{f.label}</dt>
                          <dd class="text-sm text-gray-900 whitespace-pre-wrap">
                            {f.file ? (
                              <a href={`/form-file/${f.file.id}`} target="_blank" rel="noopener" class="text-horizon-600 hover:underline font-medium">{f.file.name} &darr;</a>
                            ) : (f.value || '—')}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {own && (
                      <form method="post" action={`/app/weddings/${weddingId}/forms/submissions/${sub.id}/visibility`} class="mt-3">
                        <input type="hidden" name="_csrf" value={csrfToken} />
                        <input type="hidden" name="shared" value={shared ? '0' : '1'} />
                        <button type="submit" class="text-xs font-bold text-horizon-600 hover:underline">
                          {shared ? t('weddings.forms.makePrivate') : t('weddings.forms.shareAll')}
                        </button>
                        <p class="text-xs text-gray-400 mt-0.5">{shared ? t('weddings.forms.sharedHint') : t('weddings.forms.privateHint')}</p>
                      </form>
                    )}
                  </div>
                </details>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Components ───

import type { WeddingWithRole } from '../../db/weddings'
import type { DocumentWithUploader } from '../../db/documents'

// Soft-cap interstitial shown when a free vendor tries to add a wedding beyond
// the active limit. Existing weddings remain editable — this only blocks new.
function WeddingCapPrompt({ limit }: { limit: number }) {
  return (
    <div class="max-w-xl mx-auto text-center">
      <div class="bg-white rounded-2xl p-8 sm:p-10">
        <div class="w-14 h-14 bg-horizon-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <svg class="w-7 h-7 text-horizon-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
        <h2 class="text-xl font-bold text-gray-900 mb-2">{t('weddings.cap.title')}</h2>
        <p class="text-sm text-gray-600 mb-8 max-w-sm mx-auto">{t('weddings.cap.body', { limit })}</p>
        <a
          href="/app/subscription/checkout"
          class="inline-block bg-horizon-600 text-white rounded-xl px-8 py-3 text-sm font-bold hover:bg-horizon-700 transition-colors"
        >
          {t('weddings.cap.cta')}
        </a>
        <div class="mt-4">
          <a href="/app/weddings" class="text-sm text-gray-500 hover:text-gray-700">{t('weddings.cap.manage')}</a>
        </div>
      </div>
    </div>
  )
}

type WeddingMemberRow = {
  user_id: string
  user_name: string
  user_email: string
  role: string
  vendor_role: string | null
  business_name: string | null
  can_manage: number
}

function WeddingGrid({ weddings }: { weddings: WeddingWithRole[] }) {
  return (
    <div class="grid sm:grid-cols-2 gap-4">
      {weddings.map((w) => {
        const days = w.date ? daysUntil(w.date) : null
        return (
          <a
            href={`/app/weddings/${w.id}`}
            class="bg-white border border-papaya-300/30 rounded-2xl p-4 hover:border-horizon-600/30 hover:bg-papaya-50 transition-colors"
          >
            <div class="flex items-start justify-between mb-2">
              <div>
                <h3 class="font-medium text-gray-900">{weddingDisplayTitle(w)}</h3>
                {w.ceremony_type && w.ceremony_type !== 'wedding' && (
                  <span class="inline-block mt-0.5 text-xs text-gray-500">{w.ceremony_type.charAt(0).toUpperCase() + w.ceremony_type.slice(1)}</span>
                )}
              </div>
              <WeddingStatusBadge status={w.status} />
            </div>
            {w.date && (
              <p class="text-sm text-gray-600">{formatDate(w.date)}</p>
            )}
            {w.location && (
              <p class="text-sm text-gray-500">{w.location}</p>
            )}
            {days !== null && days > 0 && (
              <p class="text-xs text-gray-400 mt-2">{t('weddings.list.daysAway', { days })}</p>
            )}
          </a>
        )
      })}
    </div>
  )
}

function WeddingStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    planning: 'bg-horizon-50 text-horizon-700',
    confirmed: 'bg-green-50 text-green-700',
    completed: 'bg-papaya-200 text-gray-600',
    cancelled: 'bg-grapefruit-50 text-grapefruit-700',
  }
  return (
    <span class={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {weddingStatusLabel(status)}
    </span>
  )
}

type PeopleMemberRow = Awaited<ReturnType<typeof getWeddingMembers>>[number]

// Map an error CODE (carried in ?error= for full-page reloads, and shared with
// the htmx partial) to a localised message. Codes keep reflected query text out
// of the page and keep everything translatable.
function peopleErrorMessage(code: string | null | undefined): string | null {
  switch (code) {
    case 'last_manager': return t('weddings.people.lastManager')
    case 'already_other': return t('weddings.people.alreadyOtherRole')
    case 'removed': return t('weddings.people.removedCannotReadd')
    case 'invalid': return t('weddings.people.invalidEmailName')
    case 'vendor_not_found': return t('weddings.people.vendorNotFound')
    default: return null
  }
}

// A single member/vendor/couple/guest row with its inline controls. Extracted so
// the htmx partial (renderPeopleSection) and the full page render the same markup.
function MemberRow({ m, wedding, canManage, vendorTypes, csrfToken, currentUserId }: {
  m: PeopleMemberRow
  wedding: Wedding
  canManage: boolean
  vendorTypes: VendorType[]
  csrfToken: string
  currentUserId: string
}) {
  const basePath = `/app/weddings/${wedding.id}`
  const isVendor = m.role === 'vendor'
  const currentRoles = parseMemberRoles(m.vendor_roles, m.vendor_role)
  let declared: string[] = []
  if (m.vendor_categories) {
    try {
      const arr = JSON.parse(m.vendor_categories)
      if (Array.isArray(arr)) declared = arr.filter((s): s is string => typeof s === 'string' && !!s)
    } catch { /* ignore */ }
  }
  if (!declared.length && m.vendor_primary_category) declared = [m.vendor_primary_category]
  const offerTypes = declared.length ? declared.map((s) => ({ slug: s, label: s })) : vendorTypes
  const canEditTypes = canManage && isVendor
  const roleLabel = isVendor
    ? rolesLabel(displayRoles(currentRoles, m.celebrant_term))
    : m.role.charAt(0).toUpperCase() + m.role.slice(1)
  return (
    <div class="text-sm">
      <div class="flex items-center justify-between">
        <div>
          {m.vendor_profile_id ? (
            <a href={`/app/vendors/${m.vendor_profile_id}`} class="font-medium text-gray-900 hover:text-horizon-700 hover:underline">
              {m.business_name ?? m.user_name}
            </a>
          ) : (
            <p class="font-medium text-gray-900">{m.business_name ?? m.user_name}</p>
          )}
          <p class="text-xs text-gray-500">{m.user_email}</p>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          {canEditTypes ? (
            <details class="group/edit relative">
              <summary
                class="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none inline-flex items-center gap-1 text-xs text-gray-500 hover:text-horizon-700 transition-colors"
                title={t('weddings.people.editTypes')}
              >
                <span>{roleLabel}</span>
                <svg class="w-3 h-3 text-gray-300 group-hover/edit:text-horizon-500 group-open/edit:text-horizon-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </summary>
              <div class="absolute right-0 z-30 mt-1.5 w-56 bg-white ring-1 ring-gray-900/10 shadow-xl rounded-xl p-3 text-left">
                <form method="post" action={`${basePath}/members/${m.user_id}/roles`} hx-post={`${basePath}/members/${m.user_id}/roles`} hx-target="#people-section" hx-swap="outerHTML" hx-disabled-elt="find button">
                  <input type="hidden" name="_csrf" value={csrfToken} />
                  <p class="text-[11px] font-medium text-gray-400 mb-2">{t('weddings.people.editTypesHint')}</p>
                  <div class="flex flex-wrap gap-1.5 mb-3">
                    {offerTypes.map((ty) => {
                      const on = currentRoles.includes(ty.slug)
                      return (
                        <label class="cursor-pointer">
                          <input type="checkbox" name="vendor_roles" value={ty.slug} checked={on} class="sr-only peer" />
                          <span class="inline-block text-xs px-2.5 py-1 rounded-full border transition-colors bg-white border-gray-200 text-gray-600 hover:border-gray-300 peer-checked:bg-horizon-50 peer-checked:border-horizon-300 peer-checked:text-horizon-700">{vendorTypeLabel(ty)}</span>
                        </label>
                      )
                    })}
                  </div>
                  <button type="submit" class="w-full bg-horizon-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-horizon-700 transition-colors">
                    {t('weddings.people.saveTypes')}
                  </button>
                </form>
              </div>
            </details>
          ) : (
            <span class="text-xs text-gray-500">{roleLabel}</span>
          )}
          {canManage && isVendor ? (
            m.can_manage ? (
              <form method="post" action={`${basePath}/members/${m.user_id}/manage`} hx-post={`${basePath}/members/${m.user_id}/manage`} hx-target="#people-section" hx-swap="outerHTML" hx-disabled-elt="find button" class="flex">
                <input type="hidden" name="_csrf" value={csrfToken} />
                <input type="hidden" name="manage" value="0" />
                <button type="submit" title={t('weddings.people.removeManager')} class="text-[10px] font-bold text-horizon-700 bg-horizon-50 hover:bg-grapefruit-50 hover:text-grapefruit-700 px-1.5 py-0.5 rounded transition-colors">{t('weddings.detail.managerBadge')}</button>
              </form>
            ) : (
              <form method="post" action={`${basePath}/members/${m.user_id}/manage`} hx-post={`${basePath}/members/${m.user_id}/manage`} hx-target="#people-section" hx-swap="outerHTML" hx-disabled-elt="find button" class="flex">
                <input type="hidden" name="_csrf" value={csrfToken} />
                <input type="hidden" name="manage" value="1" />
                <button type="submit" class="text-[10px] font-medium text-gray-400 hover:text-horizon-600 px-1.5 py-0.5 rounded transition-colors">{t('weddings.people.makeManager')}</button>
              </form>
            )
          ) : (
            !!m.can_manage && (
              <span class="text-[10px] text-horizon-600 font-bold bg-horizon-50 px-1.5 py-0.5 rounded">{t('weddings.detail.managerBadge')}</span>
            )
          )}
          {canManage && isVendor && m.user_id !== currentUserId && (
            <form
              method="post"
              action={`${basePath}/members/${m.user_id}/remove`}
              hx-post={`${basePath}/members/${m.user_id}/remove`}
              hx-target="#people-section"
              hx-swap="outerHTML"
              hx-disabled-elt="find button"
              hx-confirm={t('weddings.people.removeConfirm', { name: m.business_name ?? m.user_name })}
              class="flex"
            >
              <input type="hidden" name="_csrf" value={csrfToken} />
              <button type="submit" title={t('weddings.people.remove')} aria-label={t('weddings.people.remove')} class="text-gray-300 hover:text-grapefruit-600 transition-colors">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

// The whole People block: members list + (for managers) the add panel, wrapped in
// #people-section so add/remove/role POSTs can swap it in place via htmx instead
// of a full-page reload. `invited`/`error` surface the result of the last action.
function PeopleSection({ wedding, members, canManage, vendorTypes, csrfToken, currentUserId, invited, error }: {
  wedding: Wedding
  members: PeopleMemberRow[]
  canManage: boolean
  vendorTypes: VendorType[]
  csrfToken: string
  currentUserId: string
  invited?: string
  error?: string
}) {
  return (
    <div id="people-section" class="mb-6">
      <h3 class="text-sm font-bold text-gray-500 mb-3">{t('weddings.detail.people')}</h3>
      {error && (
        <div class="mb-3 bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl px-4 py-2.5">{error}</div>
      )}
      <div class="bg-white border border-papaya-300/30 rounded-2xl p-4 space-y-3">
        {members.map((m) => (
          <MemberRow m={m} wedding={wedding} canManage={canManage} vendorTypes={vendorTypes} csrfToken={csrfToken} currentUserId={currentUserId} />
        ))}
      </div>
      {canManage && (
        <AddPeoplePanel weddingId={wedding.id} csrfToken={csrfToken} vendorTypes={vendorTypes} invited={invited} scope="people" open={!!invited || !!error} />
      )}
    </div>
  )
}

// True when htmx made the request (so handlers return the section fragment rather
// than redirecting to a full page reload).
function wantsPartial(c: Context<Env>): boolean {
  return c.req.header('HX-Request') === 'true'
}

// Re-load the People section's data and render the #people-section fragment.
async function renderPeopleSection(
  c: Context<Env>,
  weddingId: string,
  opts?: { invited?: string; error?: string }
): Promise<Response> {
  const user = c.get('user')
  const [membership, wedding, allMembers] = await Promise.all([
    getMembership(c.env.DB, weddingId, user.id),
    getWedding(c.env.DB, weddingId),
    getWeddingMembers(c.env.DB, weddingId),
  ])
  if (!membership || !wedding) return c.text('Wedding not found', 404)
  const canManage = !!membership.can_manage
  const members = allMembers // everyone on a wedding sees the full team
  const vendorTypes = canManage ? await listVendorTypes(c.env.DB) : []
  return c.html(
    <PeopleSection
      wedding={wedding}
      members={members}
      canManage={canManage}
      vendorTypes={vendorTypes}
      csrfToken={c.get('csrfToken')}
      currentUserId={user.id}
      invited={opts?.invited}
      error={opts?.error}
    />
  )
}

// Single exit point for the member-mutation handlers: an htmx caller gets the
// re-rendered #people-section; a plain form post gets the usual redirect (error
// codes round-trip through ?error= → peopleErrorMessage).
async function peopleResult(
  c: Context<Env>,
  weddingId: string,
  opts: { errorCode?: string; invited?: boolean }
): Promise<Response> {
  if (wantsPartial(c)) {
    return renderPeopleSection(c, weddingId, {
      invited: opts.invited ? '1' : undefined,
      error: opts.errorCode ? (peopleErrorMessage(opts.errorCode) ?? undefined) : undefined,
    })
  }
  const qs = opts.errorCode ? `?error=${opts.errorCode}` : opts.invited ? '?invited=1' : ''
  return c.redirect(`/app/weddings/${weddingId}${qs}`)
}

// The "Add people to this wedding" panel — invite the couple, autolookup an
// existing vendor, invite a new vendor by email, or add another person. Rendered
// once, inside PeopleSection; its forms hx-swap #people-section in place. (scope
// just namespaces the autocomplete suggestion container id.)
function AddPeoplePanel({
  weddingId,
  csrfToken,
  vendorTypes,
  invited,
  scope,
  open,
}: {
  weddingId: string
  csrfToken: string
  vendorTypes: VendorType[]
  invited?: string
  scope: string
  open?: boolean
}) {
  const sugId = `vendor-suggestions-${scope}`
  return (
    <details class="group mt-2" open={open ?? !!invited}>
      <summary class="text-xs text-gray-400 cursor-pointer hover:text-gray-600 transition-colors select-none flex items-center gap-1.5">
        <svg class="w-3.5 h-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
        {t('weddings.people.addPeople')}
      </summary>
      <div class="mt-3 border border-gray-100 rounded-xl p-4 space-y-4 bg-gray-50/50">
        {invited && <p class="text-sm text-horizon-700 font-medium">{t('weddings.people.invitedSuccess')}</p>}

        {/* Invite one of the people getting married */}
        <form method="post" action={`/app/weddings/${weddingId}/invite`} hx-post={`/app/weddings/${weddingId}/invite`} hx-target="#people-section" hx-swap="outerHTML" hx-disabled-elt="find button" hx-on--after-request="if(event.detail.elt===this&&event.detail.successful)this.reset()" class="flex gap-2 items-end">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <div class="flex-1">
            <label class="block text-xs font-medium text-gray-500 mb-1">{t('weddings.people.inviteGettingMarried')}</label>
            <input type="email" name="email" required placeholder="their@email.com" class="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent bg-white" />
          </div>
          <div>
            <input type="text" name="name" required placeholder={t('weddings.people.theirName')} class="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent bg-white" />
          </div>
          <button type="submit" class="bg-horizon-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-horizon-700 transition-colors whitespace-nowrap">{t('weddings.people.invite')}</button>
        </form>

        {/* Autolookup: find an existing Wedding Computer vendor first */}
        <div class="relative" data-vendor-search>
          <label class="block text-xs font-medium text-gray-500 mb-1">{t('weddings.team.addVendor')}</label>
          <input
            type="text"
            name="q"
            placeholder={t('weddings.team.searchVendors')}
            autocomplete="off"
            hx-get={`/app/weddings/${weddingId}/vendor-search`}
            hx-trigger="input changed delay:200ms"
            hx-target={`#${sugId}`}
            hx-swap="innerHTML"
            hx-include="this"
            hx-on:blur={`setTimeout(()=>{var s=document.getElementById('${sugId}');if(s)s.innerHTML=''},250)`}
            class="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent bg-white"
          />
          <div id={sugId} class="relative" />
        </div>

        {/* Fallback: invite a vendor who isn't on Wedding Computer yet */}
        <form method="post" action={`/app/weddings/${weddingId}/add-vendor`} hx-post={`/app/weddings/${weddingId}/add-vendor`} hx-target="#people-section" hx-swap="outerHTML" hx-disabled-elt="find button" hx-on--after-request="if(event.detail.elt===this&&event.detail.successful)this.reset()" class="flex gap-2 items-end flex-wrap">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <div class="flex-1 min-w-[140px]">
            <label class="block text-xs font-medium text-gray-500 mb-1">{t('weddings.team.inviteByEmail')}</label>
            <input type="email" name="email" required placeholder="vendor@email.com" class="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent bg-white" />
          </div>
          <div class="min-w-[120px]">
            <input type="text" name="name" required placeholder={t('weddings.people.businessName')} class="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent bg-white" />
          </div>
          <div class="min-w-[140px]">
            <select name="vendor_role" class="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent bg-white">
              <option value="">{t('weddings.vendorType.any')}</option>
              {vendorTypes.map((vt) => (
                <option value={vt.slug}>{vt.slug === CELEBRANT_SLUG && celebrantTermsDiffer() ? `${vendorTypeLabel(vt)} / ${t('onboarding.category.officiant')}` : vendorTypeLabel(vt)}</option>
              ))}
            </select>
          </div>
          <div class="min-w-[130px]">
            <input type="text" name="instagram" maxlength={120} placeholder={t('weddings.people.instagramPlaceholder')} title={t('weddings.people.instagramHint')} class="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent bg-white" />
          </div>
          <button type="submit" class="bg-horizon-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-horizon-700 transition-colors whitespace-nowrap">{t('weddings.people.add')}</button>
        </form>

        {/* Add another person (family, coordinator, etc.) */}
        <form method="post" action={`/app/weddings/${weddingId}/add-guest`} hx-post={`/app/weddings/${weddingId}/add-guest`} hx-target="#people-section" hx-swap="outerHTML" hx-disabled-elt="find button" hx-on--after-request="if(event.detail.elt===this&&event.detail.successful)this.reset()" class="flex gap-2 items-end">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <div class="flex-1">
            <label class="block text-xs font-medium text-gray-500 mb-1">
              {t('weddings.people.addSomeoneElse')}
              <span class="font-normal text-gray-400 ml-1">{t('weddings.people.addSomeoneElseHint')}</span>
            </label>
            <input type="email" name="email" required placeholder="person@email.com" class="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent bg-white" />
          </div>
          <div>
            <input type="text" name="name" required placeholder={t('weddings.people.theirName')} class="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent bg-white" />
          </div>
          <button type="submit" class="bg-horizon-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-horizon-700 transition-colors whitespace-nowrap">{t('weddings.people.add')}</button>
        </form>
      </div>
    </details>
  )
}

function WeddingCredits({ credits, weddingTitle }: { credits: CreditEntry[]; weddingTitle: string }) {
  const igText = formatInstagramCredits(credits)
  const mdText = formatWebCredits(credits)
  const htmlText = formatHtmlCredits(credits)

  return (
    <div class="mt-6">
      <h3 class="text-sm font-bold text-gray-500 mb-3">{t('weddings.credits.title')}</h3>
      <div class="bg-white border border-papaya-300/30 rounded-2xl p-4">
        {/* Preview */}
        <div class="space-y-1 mb-4">
          {credits.map((c) => (
            <div class="flex items-center gap-2 text-sm">
              <span class="text-gray-500 font-medium w-28 shrink-0 text-right">{rolesLabel(c.roles)}:</span>
              <span class="text-gray-900">{c.name}</span>
              {c.instagram && (
                <a
                  href={`https://instagram.com/${c.instagram.replace(/^@/, '')}`}
                  target="_blank"
                  rel="noopener"
                  class="text-xs text-horizon-600 hover:underline"
                >
                  @{c.instagram.replace(/^@/, '')}
                </a>
              )}
            </div>
          ))}
        </div>

        {/* Copy buttons */}
        <div class="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
          <button
            type="button"
            onclick={`navigator.clipboard.writeText(${JSON.stringify(igText)});this.textContent=${JSON.stringify(t('weddings.credits.copied'))}`}
            class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            {t('weddings.credits.copyInstagram')}
          </button>
          <button
            type="button"
            onclick={`navigator.clipboard.writeText(${JSON.stringify(mdText)});this.textContent=${JSON.stringify(t('weddings.credits.copied'))}`}
            class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            {t('weddings.credits.copyMarkdown')}
          </button>
          <button
            type="button"
            onclick={`navigator.clipboard.writeText(${JSON.stringify(htmlText)});this.textContent=${JSON.stringify(t('weddings.credits.copied'))}`}
            class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            {t('weddings.credits.copyHtml')}
          </button>
        </div>
      </div>
    </div>
  )
}

function WeddingPlaces({ wedding }: { wedding: Wedding }) {
  const places: { label: string; value: string; time: string | null }[] = []

  if (wedding.getting_ready_location) {
    const label = wedding.getting_ready_1_label
      ? t('weddings.places.gettingReadyLabelled', { label: wedding.getting_ready_1_label })
      : t('weddings.places.gettingReady1')
    places.push({ label, value: wedding.getting_ready_location, time: wedding.getting_ready_time })
  }

  if (wedding.getting_ready_2_location) {
    const label = wedding.getting_ready_2_label
      ? t('weddings.places.gettingReadyLabelled', { label: wedding.getting_ready_2_label })
      : t('weddings.places.gettingReady2')
    places.push({ label, value: wedding.getting_ready_2_location, time: wedding.getting_ready_2_time })
  }

  if (wedding.ceremony_location)
    places.push({ label: t('weddings.places.ceremony'), value: wedding.ceremony_location, time: wedding.time })

  if (wedding.portrait_location)
    places.push({ label: t('weddings.places.portraits'), value: wedding.portrait_location, time: wedding.portrait_time })

  if (wedding.reception_location)
    places.push({ label: t('weddings.places.reception'), value: wedding.reception_location, time: wedding.reception_time })

  if (places.length === 0) return <></>

  return (
    <div class="mt-6">
      <h3 class="text-sm font-bold text-gray-500 mb-3">{t('weddings.places.title')}</h3>
      <div class="bg-white border border-papaya-300/30 rounded-2xl divide-y divide-gray-100">
        {places.map((p) => (
          <div class="px-4 py-3 flex items-start justify-between gap-3">
            <div>
              <p class="text-xs text-gray-400 mb-0.5">
                {p.label}
                {p.time && <span class="ml-1 text-gray-500 font-medium">{formatTime(p.time)}</span>}
              </p>
              <p class="text-sm text-gray-900">{p.value}</p>
            </div>
            <a
              href={`https://maps.google.com/maps?q=${encodeURIComponent(p.value)}`}
              target="_blank"
              rel="noopener"
              class="text-xs text-horizon-600 hover:text-horizon-700 font-medium whitespace-nowrap mt-1"
            >
              {t('weddings.places.map')}
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}


function InvoiceStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    sent: 'bg-papaya-200 text-gray-700',
    partial: 'bg-amber-100 text-amber-700',
    paid: 'bg-horizon-100 text-horizon-700',
    overdue: 'bg-grapefruit-100 text-grapefruit-700',
    cancelled: 'bg-gray-100 text-gray-400',
  }
  return (
    <span class={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${colors[status] ?? colors.draft}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function WeddingInvoices({
  weddingId,
  invoices,
  contactId,
}: {
  weddingId: string
  invoices: InvoiceWithPaymentSummary[]
  contactId: string | null
}) {
  const totalInvoiced = invoices.reduce((sum, i) => sum + i.amount_cents, 0)
  const totalPaid = invoices.reduce((sum, i) => sum + i.paid_cents, 0)
  const outstanding = totalInvoiced - totalPaid

  const newInvoiceUrl = `/app/invoices/new?wedding=${weddingId}${contactId ? `&contact=${contactId}` : ''}`

  return (
    <div class="mt-6">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-bold text-gray-500">{t('weddings.invoices.title')}</h3>
        <a
          href={newInvoiceUrl}
          class="text-xs font-bold text-horizon-600 hover:text-horizon-700"
        >
          {t('weddings.invoices.newInvoice')}
        </a>
      </div>

      {invoices.length === 0 ? (
        <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 text-center">
          <p class="text-sm text-gray-400">{t('weddings.invoices.empty')}</p>
          <a
            href={newInvoiceUrl}
            class="text-sm font-bold text-horizon-600 hover:text-horizon-700 mt-1 inline-block"
          >
            {t('weddings.invoices.createFirst')}
          </a>
        </div>
      ) : (
        <div>
          {/* Payment summary */}
          <div class="grid grid-cols-3 gap-3 mb-3">
            <div class="bg-white border border-papaya-300/30 rounded-xl p-3 text-center">
              <p class="text-xs text-gray-500">{t('weddings.invoices.invoiced')}</p>
              <p class="text-sm font-bold">${(totalInvoiced / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}</p>
            </div>
            <div class="bg-white border border-papaya-300/30 rounded-xl p-3 text-center">
              <p class="text-xs text-gray-500">{t('weddings.invoices.paid')}</p>
              <p class="text-sm font-bold text-horizon-700">${(totalPaid / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}</p>
            </div>
            <div class="bg-white border border-papaya-300/30 rounded-xl p-3 text-center">
              <p class="text-xs text-gray-500">{t('weddings.invoices.outstanding')}</p>
              <p class={`text-sm font-bold ${outstanding > 0 ? 'text-grapefruit-700' : 'text-gray-400'}`}>
                ${(outstanding / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {/* Invoice list */}
          <div class="bg-white border border-papaya-300/30 rounded-2xl divide-y divide-gray-100">
            {invoices.map((inv) => (
              <a
                href={`/app/invoices/${inv.id}`}
                class="p-3 flex items-center justify-between hover:bg-papaya-50 transition-colors block"
              >
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-gray-900 truncate">
                    {inv.invoice_number && <span class="text-gray-400 font-normal mr-1">{inv.invoice_number}</span>}
                    {inv.title}
                  </p>
                  <div class="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                    {inv.contact_name && <span>{inv.contact_name}</span>}
                    {inv.due_date && <span>{t('weddings.invoices.due', { date: formatDate(inv.due_date) })}</span>}
                    {inv.payment_count > 0 && (
                      <span>{t('weddings.invoices.payments', { paid: inv.paid_count, total: inv.payment_count })}</span>
                    )}
                  </div>
                </div>
                <div class="flex items-center gap-2 shrink-0 ml-3">
                  <span class="text-sm font-bold text-gray-900">
                    ${(inv.amount_cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
                  </span>
                  <InvoiceStatusBadge status={inv.status} />
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function fileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z'
  if (mimeType === 'application/pdf') return 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z'
  return 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
}

function WeddingFiles({
  weddingId,
  documents,
  members,
  userId,
  csrfToken,
  uploaded,
  deleted,
}: {
  weddingId: string
  documents: DocumentWithUploader[]
  members: WeddingMemberRow[]
  userId: string
  csrfToken: string
  uploaded: boolean
  deleted: boolean
}) {
  const otherMembers = members.filter((m) => m.user_id !== userId)

  return (
    <div class="mt-6">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-bold text-gray-500">{t('weddings.files.title')}</h3>
        <span class="text-xs text-gray-400">{tp('weddings.files.fileCount', documents.length)}</span>
      </div>

      {uploaded && (
        <p class="text-sm text-horizon-700 font-medium mb-3">{t('weddings.files.uploaded')}</p>
      )}
      {deleted && (
        <p class="text-sm text-horizon-700 font-medium mb-3">{t('weddings.files.deleted')}</p>
      )}

      {/* File list */}
      {documents.length > 0 && (
        <div class="bg-white border border-papaya-300/30 rounded-2xl divide-y divide-gray-100 mb-4">
          {documents.map((doc) => {
            const isOwner = doc.uploaded_by_user_id === userId
            const shares: string[] = doc.shared_with ? (() => {
              try { const arr = JSON.parse(doc.shared_with); return Array.isArray(arr) ? arr : [] }
              catch { return [] }
            })() : []
            const sharedNames = shares
              .map((uid: string) => members.find((m) => m.user_id === uid))
              .filter(Boolean)
              .map((m) => m!.business_name ?? m!.user_name)

            return (
              <div class="p-3 flex items-center gap-3">
                <div class="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                  <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d={fileIcon(doc.mime_type)} />
                  </svg>
                </div>
                <div class="flex-1 min-w-0">
                  <a
                    href={`/files/${doc.id}`}
                    target="_blank"
                    class="text-sm font-medium text-gray-900 hover:text-horizon-700 truncate block"
                  >
                    {doc.filename}
                  </a>
                  <div class="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                    <span>{formatFileSize(doc.size_bytes)}</span>
                    <span>{t('weddings.files.by', { name: doc.uploader_name ?? '' })}</span>
                    {doc.visibility === 'wedding' ? (
                      <span class="text-horizon-600">{t('weddings.files.everyone')}</span>
                    ) : sharedNames.length > 0 ? (
                      <span class="text-amber-600" title={sharedNames.join(', ')}>
                        {t('weddings.files.sharedWith', { count: sharedNames.length })}
                      </span>
                    ) : (
                      <span>{t('weddings.files.private')}</span>
                    )}
                    {doc.description && (
                      <span class="truncate max-w-[120px]" title={doc.description}>{doc.description}</span>
                    )}
                  </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <a
                    href={`/files/${doc.id}/download`}
                    class="text-gray-400 hover:text-gray-600 transition-colors"
                    title={t('weddings.files.download')}
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </a>
                  {isOwner && (
                    <form method="post" action={`/files/${doc.id}/delete`} class="inline">
                      <input type="hidden" name="_csrf" value={csrfToken} />
                      <button
                        type="submit"
                        class="text-gray-400 hover:text-grapefruit-600 transition-colors"
                        title={t('weddings.files.delete')}
                        onclick={`return confirm(${JSON.stringify(t('weddings.files.confirmDelete'))})`}
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </form>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Upload form */}
      <details class="group" open={documents.length === 0 ? true : undefined}>
        <summary class="text-xs text-gray-400 cursor-pointer hover:text-gray-600 transition-colors select-none flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
          {t('weddings.files.upload')}
        </summary>
        <form
          method="post"
          action={`/files/upload/${weddingId}`}
          enctype="multipart/form-data"
          class="mt-3 border border-gray-100 rounded-xl p-4 bg-gray-50/50 space-y-3"
        >
          <input type="hidden" name="_csrf" value={csrfToken} />

          <div>
            <input
              type="file"
              name="file"
              required
              class="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-horizon-600 file:text-white hover:file:bg-horizon-700 file:cursor-pointer"
            />
            <p class="text-xs text-gray-400 mt-1">{t('weddings.files.uploadHint')}</p>
          </div>

          <div>
            <input
              type="text"
              name="description"
              placeholder={t('weddings.files.optionalDescription')}
              class="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            />
          </div>

          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1.5">{t('weddings.files.whoCanSee')}</label>
            <div class="space-y-1.5" id={`vis-${weddingId}`}>
              <label class="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="visibility"
                  value="wedding"
                  checked
                  class="text-horizon-600"
                  onchange={`document.getElementById('share-checkboxes-${weddingId}').classList.add('hidden')`}
                />
                {t('weddings.files.everyoneOnWedding')}
              </label>
              {otherMembers.length > 0 && (
                <label class="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="visibility"
                    value="private"
                    class="text-horizon-600"
                    onchange={`document.getElementById('share-checkboxes-${weddingId}').classList.remove('hidden')`}
                  />
                  {t('weddings.files.onlySpecific')}
                </label>
              )}
            </div>
          </div>

          {otherMembers.length > 0 && (
            <div id={`share-checkboxes-${weddingId}`} class="hidden pl-5 space-y-1">
              {otherMembers.map((m) => (
                <label class="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    name="share_with"
                    value={m.user_id}
                    class="text-horizon-600 rounded"
                  />
                  {m.business_name ?? m.user_name}
                  <span class="text-xs text-gray-400">
                    {m.vendor_role ? m.vendor_role : m.role}
                  </span>
                </label>
              ))}
            </div>
          )}

          <button
            type="submit"
            class="bg-horizon-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-horizon-700 transition-colors"
          >
            {t('weddings.files.uploadButton')}
          </button>
        </form>
      </details>
    </div>
  )
}

function WeddingForm({
  action,
  csrfToken,
  wedding,
  contactId,
  defaults,
  ceremonyTypes,
}: {
  action: string
  csrfToken: string
  wedding?: Wedding
  contactId?: string | null
  defaults?: { title?: string; date?: string | null; location?: string | null }
  ceremonyTypes?: string[]
}) {
  const types = ceremonyTypes && ceremonyTypes.length > 0 ? ceremonyTypes : ['wedding', 'elopement']
  return (
    <form method="post" action={action} class="space-y-4">
      <input type="hidden" name="_csrf" value={csrfToken} />
      {contactId && <input type="hidden" name="contact_id" value={contactId} />}

      <div>
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="title">{t('weddings.form.title')}</label>
        <input
          type="text"
          id="title"
          name="title"
          required
          value={wedding?.title ?? defaults?.title ?? ''}
          placeholder={t('weddings.form.titlePlaceholder')}
          class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
        />
      </div>

      <div>
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="ceremony_type">{t('weddings.form.type')}</label>
        <select
          id="ceremony_type"
          name="ceremony_type"
          class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
        >
          {types.map((t) => (
            <option value={t} selected={t === (wedding?.ceremony_type ?? types[0])}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="date">{t('weddings.form.date')}</label>
        <input
          type="date"
          id="date"
          name="date"
          value={wedding?.date ?? defaults?.date ?? ''}
          class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
        />
      </div>

      <div>
        <PlacesField
          name="location"
          label={t('weddings.form.cityRegion')}
          value={wedding?.location ?? defaults?.location ?? ''}
          placeholder={t('weddings.form.cityRegionPlaceholder')}
          mode="region"
        />
        <p class="text-xs text-gray-400 mt-1">{t('weddings.form.cityRegionHint')}</p>
      </div>

      {/* Wedding emoji — ceremony, reception and run-sheet times now live in the timeline */}
      {wedding && (
        <div class="space-y-4">
          {/* Emoji prefix */}
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">{t('weddings.emoji.label')}</label>
            <div class="relative" data-emoji-field>
              <input type="hidden" name="emoji" value={wedding.emoji ?? ''} />
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  data-emoji-button
                  aria-haspopup="dialog"
                  aria-expanded="false"
                  class="w-12 h-12 rounded-xl bg-white text-2xl leading-none flex items-center justify-center shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] transition-[scale,box-shadow] duration-150 active:scale-[0.96] hover:shadow-[0_0_0_1px_rgba(0,102,230,0.4),0_1px_2px_rgba(0,0,0,0.04)] focus:outline-none focus:ring-2 focus:ring-horizon-600"
                >
                  <span data-emoji-current class={wedding.emoji ? '' : 'opacity-30 grayscale'}>{wedding.emoji ?? '💍'}</span>
                </button>
                <button
                  type="button"
                  data-emoji-clear
                  class={`text-xs text-gray-400 hover:text-grapefruit-600 transition-colors px-2.5 py-2.5 ${wedding.emoji ? '' : 'hidden'}`}
                >
                  {t('weddings.emoji.clear')}
                </button>
              </div>
              <div
                data-emoji-popover
                role="dialog"
                class="absolute left-0 top-full mt-2 z-30 origin-top-left rounded-2xl overflow-hidden bg-white opacity-0 scale-95 pointer-events-none transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_4px_8px_rgba(0,0,0,0.06),0_16px_32px_rgba(0,0,0,0.14)]"
              ></div>
            </div>
            <p class="text-xs text-gray-400 mt-1">{t('weddings.emoji.help')}</p>
            <script dangerouslySetInnerHTML={{ __html: `
(function () {
  var field = document.querySelector('[data-emoji-field]');
  if (!field) return;
  var btn = field.querySelector('[data-emoji-button]');
  var current = field.querySelector('[data-emoji-current]');
  var input = field.querySelector('input[name="emoji"]');
  var pop = field.querySelector('[data-emoji-popover]');
  var clearBtn = field.querySelector('[data-emoji-clear]');
  var loaded = false;
  var open = false;

  function show() {
    pop.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
    btn.setAttribute('aria-expanded', 'true');
    open = true;
  }
  function hide() {
    pop.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
    btn.setAttribute('aria-expanded', 'false');
    open = false;
  }
  function setEmoji(unicode) {
    input.value = unicode;
    current.textContent = unicode || '💍';
    current.classList.toggle('opacity-30', !unicode);
    current.classList.toggle('grayscale', !unicode);
    clearBtn.classList.toggle('hidden', !unicode);
  }

  btn.addEventListener('click', function () {
    if (open) { hide(); return; }
    if (!loaded) {
      loaded = true;
      import('https://cdn.jsdelivr.net/npm/emoji-picker-element@1/index.js').then(function () {
        var picker = document.createElement('emoji-picker');
        picker.style.setProperty('--border-size', '0');
        picker.style.setProperty('--background', '#ffffff');
        picker.style.setProperty('--indicator-color', '#0066E6');
        picker.style.setProperty('--input-border-color', '#e5e7eb');
        picker.style.setProperty('--input-border-radius', '10px');
        picker.style.setProperty('--outline-color', '#0066E6');
        picker.style.setProperty('--emoji-padding', '0.4rem');
        picker.addEventListener('emoji-click', function (e) {
          setEmoji(e.detail.unicode);
          hide();
        });
        pop.appendChild(picker);
        show();
      });
      return;
    }
    show();
  });

  clearBtn.addEventListener('click', function () { setEmoji(''); hide(); });

  document.addEventListener('click', function (e) {
    if (open && !field.contains(e.target)) hide();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) { hide(); btn.focus(); }
  });
})();
            ` }} />
          </div>

        </div>
      )}

      {wedding && (
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1.5" for="status">{t('weddings.form.status')}</label>
          <select
            id="status"
            name="status"
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          >
            {WEDDING_STATUSES.map((s) => (
              <option value={s.value} selected={s.value === wedding.status}>{weddingStatusLabel(s.value)}</option>
            ))}
          </select>
        </div>
      )}

      <button
        type="submit"
        class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
      >
        {wedding ? t('weddings.form.saveChanges') : t('weddings.form.createWedding')}
      </button>
    </form>
  )
}

function PlacesField({
  name,
  label,
  value,
  placeholder,
  timeName,
  timeValue,
  mode,
}: {
  name: string
  label: string
  value: string | null
  placeholder?: string
  timeName?: string
  timeValue?: string | null
  /** 'region' filters to cities/regions only */
  mode?: 'region'
}) {
  const modeParam = mode ? `&mode=${mode}` : ''
  return (
    <div class="relative" data-places>
      <label class="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <div class={timeName ? 'flex gap-2' : ''}>
        <div class="flex-1 relative">
          <input
            type="text"
            name={name}
            value={value ?? ''}
            placeholder={placeholder}
            autocomplete="off"
            hx-get={`/api/places/search?field=${name}${modeParam}`}
            hx-trigger="input changed delay:300ms"
            hx-target={`#suggestions-${name}`}
            hx-swap="innerHTML"
            hx-include="this"
            class="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          />
          <div id={`suggestions-${name}`} />
        </div>
        {timeName && (
          <input
            type="time"
            name={timeName}
            value={timeValue ?? ''}
            class="w-28 shrink-0 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          />
        )}
      </div>
    </div>
  )
}
