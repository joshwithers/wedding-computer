import { Hono } from 'hono'
import type { Env } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import {
  listWeddingsForVendor,
  getWedding,
  createWedding,
  updateWedding,
  addWeddingMember,
  getWeddingMembers,
  getMembership,
} from '../../db/weddings'
import { getContact, updateContact } from '../../storage/contacts'
import { getStorage } from '../../storage'
import { writeWeddingFile } from '../../storage/weddings'
import { createActivity } from '../../db/activities'
import type { Bindings, VendorProfile } from '../../types'
import { findOrCreateUser, sendCoupleInvite } from '../../services/auth'
import { requireString, trimOrNull, isValidEmail } from '../../lib/validation'
import { formatDate, formatTime, daysUntil, addHoursToTime } from '../../lib/date'
import { createEvent } from '../../db/calendar'
import { track } from '../../services/analytics'

const WEDDING_STATUSES = [
  { value: 'planning', label: 'Planning' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const weddings = new Hono<Env>()

weddings.use('/app/*', requireAuth, csrf, requireVendor)

/** Safe storage getter — returns null if storage unavailable */
function tryGetStorage(env: Bindings, vendor: VendorProfile) {
  try { return getStorage(env, vendor) } catch { return null }
}

/** Push a wedding to storage (GitHub/R2) after a D1 write. Best-effort — never blocks the response. */
async function pushWeddingToStorage(env: Bindings, vendor: VendorProfile, weddingId: string) {
  const storage = tryGetStorage(env, vendor)
  if (!storage) return
  try {
    const wedding = await getWedding(env.DB, weddingId)
    if (!wedding) return
    await writeWeddingFile(storage, env.DB, vendor.id, wedding)
  } catch (err) {
    console.error(`[weddings] Failed to push wedding ${weddingId} to storage:`, err)
  }
}

// ─── Wedding list ───
weddings.get('/app/weddings', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const items = await listWeddingsForVendor(c.env.DB, user.id)

  const upcoming = items.filter((w) => w.status !== 'completed' && w.status !== 'cancelled')
  const past = items.filter((w) => w.status === 'completed' || w.status === 'cancelled')

  return c.html(
    <AppLayout title="Weddings" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-4xl">
        <div class="flex items-center justify-between gap-4 mb-6">
          <p class="text-sm text-gray-500">
            {items.length} wedding{items.length !== 1 ? 's' : ''}
          </p>
          <a
            href="/app/weddings/new"
            class="bg-horizon-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            New wedding
          </a>
        </div>

        {items.length === 0 ? (
          <div class="text-center py-12 bg-white border border-papaya-300/30 rounded-2xl">
            <p class="text-gray-500 text-sm mb-2">No weddings yet</p>
            <p class="text-xs text-gray-400">
              Create one directly, or promote a contact to booked status.
            </p>
          </div>
        ) : (
          <div class="space-y-8">
            {upcoming.length > 0 && (
              <div>
                <h2 class="text-sm font-bold text-gray-500 mb-3">Upcoming</h2>
                <WeddingGrid weddings={upcoming} />
              </div>
            )}
            {past.length > 0 && (
              <div>
                <h2 class="text-sm font-bold text-gray-500 mb-3">Past</h2>
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
weddings.get('/app/weddings/new', (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const contactId = c.req.query('contact')
  const types: string[] = vendor.ceremony_types ? JSON.parse(vendor.ceremony_types) : []

  return c.html(
    <AppLayout title="New wedding" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
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

    // Push wedding file to storage (GitHub/R2) — best-effort, don't block
    pushWeddingToStorage(c.env, vendor, wedding.id).catch(() => {})

    // Link contact and auto-invite couple
    const contactId = trimOrNull(body.contact_id)
    if (contactId) {
      const storage = getStorage(c.env, vendor)
      const contactResult = await getContact(storage, c.env.DB, vendor.id, contactId)
      if (contactResult) {
        const contact = contactResult.contact
        await updateContact(storage, c.env.DB, vendor.id, contactId, {
          wedding_id: wedding.id,
          status: 'booked',
        })
        await createActivity(c.env.DB, contactId, 'status_change', `Promoted to wedding: ${title}`)

        const inviteData = {
          vendorName: vendor.business_name,
          weddingTitle: title,
          weddingDate: trimOrNull(body.date) ? formatDate(String(body.date)) : null,
        }

        if (contact.email) {
          const name = `${contact.first_name} ${contact.last_name}`
          const coupleUser = await findOrCreateUser(c.env.DB, contact.email, name)
          await addWeddingMember(c.env.DB, { wedding_id: wedding.id, user_id: coupleUser.id, role: 'couple' })
          sendCoupleInvite(c.env.DB, c.env.KV, c.env.RESEND_API_KEY, c.env.APP_URL, {
            email: contact.email, coupleName: contact.first_name, ...inviteData,
          }).catch((e) => console.error('[INVITE]', e.message))
        }

        if (contact.partner_email) {
          const partnerName = [contact.partner_first_name, contact.partner_last_name].filter(Boolean).join(' ') || contact.partner_email.split('@')[0]
          const partnerUser = await findOrCreateUser(c.env.DB, contact.partner_email, partnerName)
          await addWeddingMember(c.env.DB, { wedding_id: wedding.id, user_id: partnerUser.id, role: 'couple' })
          sendCoupleInvite(c.env.DB, c.env.KV, c.env.RESEND_API_KEY, c.env.APP_URL, {
            email: contact.partner_email, coupleName: contact.partner_first_name ?? partnerName, ...inviteData,
          }).catch((e) => console.error('[INVITE]', e.message))
        }
      }
    }

    return c.redirect(`/app/weddings/${wedding.id}`)
  } catch (e: any) {
    return c.redirect(`/app/weddings/new?error=${encodeURIComponent(e.message)}`)
  }
})

// ─── Invite couple (the people getting married) ───
weddings.post('/app/weddings/:id/invite', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || !membership.can_manage) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  const email = String(body.email).trim().toLowerCase()
  const name = String(body.name).trim()

  if (!isValidEmail(email) || !name) {
    return c.redirect(`/app/weddings/${weddingId}?error=Valid+email+and+name+required`)
  }

  const coupleUser = await findOrCreateUser(c.env.DB, email, name)
  await addWeddingMember(c.env.DB, {
    wedding_id: weddingId,
    user_id: coupleUser.id,
    role: 'couple',
    can_manage: true,
  })

  const wedding = await getWedding(c.env.DB, weddingId)
  sendCoupleInvite(c.env.DB, c.env.KV, c.env.RESEND_API_KEY, c.env.APP_URL, {
    email,
    coupleName: name.split(' ')[0],
    vendorName: vendor.business_name,
    weddingTitle: wedding?.title ?? 'Your wedding',
    weddingDate: wedding?.date ? formatDate(wedding.date) : null,
  }).catch((e) => console.error('[INVITE]', e.message))

  track(c.env.DB, vendor.id, 'couple_invited', { weddingId })

  return c.redirect(`/app/weddings/${weddingId}?invited=1`)
})

// ─── Add guest / other person to wedding ───
weddings.post('/app/weddings/:id/add-guest', async (c) => {
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
    return c.redirect(`/app/weddings/${weddingId}?error=Valid+email+and+name+required`)
  }

  const guestUser = await findOrCreateUser(c.env.DB, email, name)
  await addWeddingMember(c.env.DB, {
    wedding_id: weddingId,
    user_id: guestUser.id,
    role: 'guest',
    can_manage: canManageGuest,
  })

  // Send them the same invite email so they can access the wedding
  const wedding = await getWedding(c.env.DB, weddingId)
  sendCoupleInvite(c.env.DB, c.env.KV, c.env.RESEND_API_KEY, c.env.APP_URL, {
    email,
    coupleName: name.split(' ')[0],
    vendorName: vendor.business_name,
    weddingTitle: wedding?.title ?? 'Your wedding',
    weddingDate: wedding?.date ? formatDate(wedding.date) : null,
  }).catch((e) => console.error('[INVITE]', e.message))

  return c.redirect(`/app/weddings/${weddingId}?invited=1`)
})

// ─── Add vendor to wedding ───
weddings.post('/app/weddings/:id/add-vendor', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || !membership.can_manage) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  const email = String(body.email).trim().toLowerCase()
  const name = String(body.name).trim()
  const vendorRole = String(body.vendor_role || '').trim() || null
  const canManage = body.can_manage === '1' || body.can_manage === 'on'
  const isFinancialParty = body.is_financial_party === '1' || body.is_financial_party === 'on'

  if (!isValidEmail(email) || !name) {
    return c.redirect(`/app/weddings/${weddingId}?error=Valid+email+and+name+required`)
  }

  // Find or create the vendor user
  const vendorUser = await findOrCreateUser(c.env.DB, email, name)

  // Check if they have a vendor profile
  const { getVendorByUserId } = await import('../../db/vendors')
  const vendorProfile = await getVendorByUserId(c.env.DB, vendorUser.id)

  await addWeddingMember(c.env.DB, {
    wedding_id: weddingId,
    user_id: vendorUser.id,
    role: 'vendor',
    vendor_profile_id: vendorProfile?.id ?? null,
    vendor_role: vendorRole ?? vendorProfile?.category ?? null,
    can_manage: canManage,
    is_financial_party: isFinancialParty,
  })

  // Notify the vendor they've been added
  try {
    await c.env.EMAIL_QUEUE.send({
      type: 'notify_vendor_added_to_wedding',
      payload: JSON.stringify({
        weddingId,
        vendorEmail: email,
        vendorName: name,
        addedBy: vendor.business_name,
      }),
    })
  } catch { /* best-effort */ }

  track(c.env.DB, vendor.id, 'vendor_added', { weddingId, metadata: { vendorEmail: email } })

  return c.redirect(`/app/weddings/${weddingId}?invited=1`)
})

// ─── Wedding detail ───
weddings.get('/app/weddings/:id', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.text('Wedding not found', 404)

  const wedding = await getWedding(c.env.DB, weddingId)
  if (!wedding) return c.text('Wedding not found', 404)

  const allMembers = await getWeddingMembers(c.env.DB, weddingId)
  const days = wedding.date ? daysUntil(wedding.date) : null
  const hasCoupleOrGuest = allMembers.some((m) => m.role === 'couple' || m.role === 'guest')
  const invited = c.req.query('invited')

  const canManage = !!membership.can_manage
  const members = canManage || wedding.vendor_visibility === 'visible'
    ? allMembers
    : allMembers.filter((m) => m.user_id === user.id || m.role === 'couple' || m.role === 'guest')

  return c.html(
    <AppLayout
      title={wedding.title}
      user={user}
      vendor={vendor}
      csrfToken={c.get('csrfToken')}
    >
      <div class="max-w-3xl">
        <div class="flex items-start justify-between mb-6">
          <div>
            <p class="text-sm text-gray-500 mb-1">
              <a href="/app/weddings" class="hover:text-gray-900">Weddings</a> /
            </p>
            <h2 class="text-xl font-bold">{wedding.title}</h2>
            {wedding.ceremony_type && wedding.ceremony_type !== 'wedding' && (
              <span class="inline-block mt-1 px-2.5 py-0.5 bg-papaya-200 text-gray-700 text-xs font-medium rounded-full">
                {wedding.ceremony_type.charAt(0).toUpperCase() + wedding.ceremony_type.slice(1)}
              </span>
            )}
            {wedding.date && (
              <p class="text-sm text-gray-600 mt-1">
                {formatDate(wedding.date)}
                {days !== null && days > 0 && (
                  <span class="text-gray-400"> — {days} days away</span>
                )}
              </p>
            )}
          </div>
          {canManage && (
            <a
              href={`/app/weddings/${wedding.id}/edit`}
              class="border border-gray-200 px-3 py-1.5 rounded-xl text-sm hover:bg-papaya-50"
            >
              Edit
            </a>
          )}
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
          <div class="lg:col-span-2 space-y-6">
            {/* Status */}
            <div class="bg-white border border-papaya-300/30 rounded-2xl p-4">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-xs text-gray-500">Status</p>
                  <p class="font-medium">{wedding.status.charAt(0).toUpperCase() + wedding.status.slice(1)}</p>
                </div>
                <WeddingStatusBadge status={wedding.status} />
              </div>
            </div>

            {/* Members */}
            <div class="bg-white border border-papaya-300/30 rounded-2xl p-4">
              <h3 class="text-sm font-bold text-gray-500 mb-3">People</h3>
              <div class="space-y-3">
                {members.map((m) => (
                  <div class="flex items-center justify-between text-sm">
                    <div>
                      <p class="font-medium text-gray-900">
                        {m.business_name ?? m.user_name}
                      </p>
                      <p class="text-xs text-gray-500">{m.user_email}</p>
                    </div>
                    <div class="text-right flex items-center gap-1.5">
                      <span class="text-xs text-gray-500">
                        {m.vendor_role ? m.vendor_role.charAt(0).toUpperCase() + m.vendor_role.slice(1) : m.role.charAt(0).toUpperCase() + m.role.slice(1)}
                      </span>
                      {!!m.can_manage && (
                        <span class="text-[10px] text-horizon-600 font-bold bg-horizon-50 px-1.5 py-0.5 rounded">Manager</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {canManage && (
                <div class="mt-4 pt-4 border-t border-gray-100 space-y-4">
                  {invited && (
                    <p class="text-sm text-horizon-700 font-medium">Invited successfully</p>
                  )}

                  {/* Invite one of the people getting married */}
                  <form
                    method="post"
                    action={`/app/weddings/${wedding.id}/invite`}
                    class="flex gap-2 items-end"
                  >
                    <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                    <div class="flex-1">
                      <label class="block text-xs font-bold text-gray-700 mb-1">
                        Invite someone getting married
                      </label>
                      <input
                        type="email"
                        name="email"
                        required
                        placeholder="their@email.com"
                        class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        name="name"
                        required
                        placeholder="Their name"
                        class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                      />
                    </div>
                    <button
                      type="submit"
                      class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors whitespace-nowrap"
                    >
                      Invite
                    </button>
                  </form>

                  {/* Add vendor */}
                  <form
                    method="post"
                    action={`/app/weddings/${wedding.id}/add-vendor`}
                    class="flex gap-2 items-end flex-wrap"
                  >
                    <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                    <div class="flex-1 min-w-[140px]">
                      <label class="block text-xs font-bold text-gray-700 mb-1">Add a vendor</label>
                      <input
                        type="email"
                        name="email"
                        required
                        placeholder="vendor@email.com"
                        class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                      />
                    </div>
                    <div class="min-w-[120px]">
                      <input
                        type="text"
                        name="name"
                        required
                        placeholder="Business name"
                        class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                      />
                    </div>
                    <div class="min-w-[100px]">
                      <input
                        type="text"
                        name="vendor_role"
                        placeholder="e.g. photographer"
                        class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                      />
                    </div>
                    <button
                      type="submit"
                      class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors whitespace-nowrap"
                    >
                      Add
                    </button>
                  </form>

                  {/* Add other person (family, coordinator, etc.) */}
                  <form
                    method="post"
                    action={`/app/weddings/${wedding.id}/add-guest`}
                    class="flex gap-2 items-end"
                  >
                    <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                    <div class="flex-1">
                      <label class="block text-xs font-bold text-gray-700 mb-1">
                        Add someone else
                        <span class="font-normal text-gray-400 ml-1">(family, coordinator, etc.)</span>
                      </label>
                      <input
                        type="email"
                        name="email"
                        required
                        placeholder="person@email.com"
                        class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        name="name"
                        required
                        placeholder="Their name"
                        class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                      />
                    </div>
                    <button
                      type="submit"
                      class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors whitespace-nowrap"
                    >
                      Add
                    </button>
                  </form>
                </div>
              )}
            </div>

          </div>

          {/* Sidebar */}
          <div class="space-y-4">
            {wedding.date && (
              <InfoCard label="Date" value={formatDate(wedding.date)} />
            )}
            {wedding.time && (
              <InfoCard
                label="Time"
                value={
                  formatTime(wedding.time) +
                  (wedding.duration_hours
                    ? ` (${wedding.duration_hours % 1 === 0 ? wedding.duration_hours + 'h' : Math.floor(wedding.duration_hours) + 'h 30m'})`
                    : '')
                }
              />
            )}
            {wedding.location && <InfoCard label="Location" value={wedding.location} />}
            <InfoCard label="Your role" value={`${vendor.category.charAt(0).toUpperCase() + vendor.category.slice(1)}${membership.can_manage ? ' (manager)' : ''}`} />
            <InfoCard label="Created" value={formatDate(wedding.created_at)} />
          </div>
        </div>

        {/* Notes — full-width auto-saving markdown editor */}
        <WeddingNotes
          weddingId={wedding.id}
          notes={wedding.notes ?? ''}
          canManage={canManage}
          csrfToken={c.get('csrfToken')}
        />
      </div>
    </AppLayout>
  )
})

// ─── Auto-save notes (JSON API for the live editor) ───
weddings.post('/app/weddings/:id/notes', async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || !membership.can_manage) return c.json({ error: 'forbidden' }, 403)

  const body = await c.req.json<{ notes: string }>()
  const notes = typeof body.notes === 'string' ? body.notes : ''

  await updateWedding(c.env.DB, weddingId, { notes: notes || null })

  return c.json({ saved: true, at: new Date().toISOString() })
})

// ─── Sync notes to git storage (called after period of inactivity) ───
weddings.post('/app/weddings/:id/notes/sync', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || !membership.can_manage) return c.json({ error: 'forbidden' }, 403)

  try {
    await pushWeddingToStorage(c.env, vendor, weddingId)
    return c.json({ synced: true, at: new Date().toISOString() })
  } catch (err) {
    console.error('[notes/sync]', err)
    return c.json({ synced: false, error: 'sync failed' })
  }
})

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

  return c.html(
    <AppLayout title={`Edit ${wedding.title}`} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        <p class="text-sm text-gray-500 mb-4">
          <a href={`/app/weddings/${wedding.id}`} class="hover:text-gray-900">{wedding.title}</a> / Edit
        </p>
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
    const durationRaw = trimOrNull(body.duration_hours)
    const durationHours = durationRaw ? parseFloat(durationRaw) : null
    const startTime = trimOrNull(body.time)

    await updateWedding(c.env.DB, weddingId, {
      title,
      date: trimOrNull(body.date),
      time: startTime,
      duration_hours: durationHours && !isNaN(durationHours) ? durationHours : null,
      location: trimOrNull(body.location),
      status: newStatus,
      ceremony_type: trimOrNull(body.ceremony_type),
      notes: trimOrNull(body.notes),
    })

    // Update the linked calendar event's times if one exists
    const vendor = c.get('vendor')!
    try {
      const weddingDate = trimOrNull(body.date)
      if (weddingDate) {
        const endTime = startTime && durationHours ? addHoursToTime(startTime, durationHours) : null
        const { updateEvent } = await import('../../db/calendar')
        // Find the booking event for this wedding
        const eventRow = await c.env.DB
          .prepare("SELECT id FROM calendar_events WHERE wedding_id = ? AND vendor_id = ? AND type = 'booking' LIMIT 1")
          .bind(weddingId, vendor.id)
          .first<{ id: string }>()
        if (eventRow) {
          await updateEvent(c.env.DB, vendor.id, eventRow.id, {
            title,
            date: weddingDate,
            start_time: startTime,
            end_time: endTime,
            all_day: startTime ? 0 : 1,
          })
        }
      }
    } catch (calErr) {
      console.error('[weddings] Failed to update calendar event:', calErr)
    }

    // Push updated wedding to storage (GitHub/R2)
    pushWeddingToStorage(c.env, vendor, weddingId).catch(() => {})

    if (newStatus === 'confirmed' && oldWedding?.status !== 'confirmed') {
      track(c.env.DB, c.get('vendor')!.id, 'booking_confirmed', { weddingId })
      await c.env.EMAIL_QUEUE.send({
        type: 'notify_booking_confirmed',
        payload: JSON.stringify({ weddingId }),
      })
    }

    return c.redirect(`/app/weddings/${weddingId}`)
  } catch (e: any) {
    return c.redirect(`/app/weddings/${weddingId}/edit?error=${encodeURIComponent(e.message)}`)
  }
})

// ─── Promote contact to wedding ───
weddings.get('/app/contacts/:id/promote', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const storage = getStorage(c.env, vendor)
  const contactResult = await getContact(storage, c.env.DB, vendor.id, c.req.param('id'))
  if (!contactResult) return c.text('Contact not found', 404)
  const contact = contactResult.contact

  const defaultTitle = contact.partner_first_name
    ? `${contact.first_name} & ${contact.partner_first_name}`
    : `${contact.first_name} ${contact.last_name}`

  const types: string[] = vendor.ceremony_types ? JSON.parse(vendor.ceremony_types) : []

  return c.html(
    <AppLayout title="Create wedding" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        <p class="text-sm text-gray-500 mb-4">
          Creating wedding from contact:{' '}
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

export default weddings

// ─── Components ───

import type { Wedding } from '../../types'
import type { WeddingWithRole } from '../../db/weddings'

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
                <h3 class="font-medium text-gray-900">{w.title}</h3>
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
              <p class="text-xs text-gray-400 mt-2">{days} days away</p>
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
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div class="bg-white border border-papaya-300/30 rounded-2xl px-4 py-3">
      <p class="text-xs text-gray-500 mb-0.5">{label}</p>
      <p class="text-sm text-gray-900">{value}</p>
    </div>
  )
}

function WeddingNotes({
  weddingId,
  notes,
  canManage,
  csrfToken,
}: {
  weddingId: string
  notes: string
  canManage: boolean
  csrfToken: string
}) {
  // Escape notes for safe embedding in JS
  const escaped = JSON.stringify(notes)

  return (
    <div class="mt-6" id="wedding-notes-section">
      <div class="bg-white border border-papaya-300/30 rounded-2xl overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3 border-b border-papaya-300/30">
          <h3 class="text-sm font-bold text-gray-500">Notes</h3>
          <div class="flex items-center gap-3">
            <span id="notes-status" class="text-xs text-gray-400 transition-opacity"></span>
            {canManage && (
              <div class="flex border border-gray-200 rounded-lg overflow-hidden text-xs">
                <button
                  type="button"
                  id="btn-edit"
                  class="px-3 py-1 font-bold bg-horizon-50 text-horizon-700"
                  onclick="notesEditor.showEdit()"
                >
                  Edit
                </button>
                <button
                  type="button"
                  id="btn-preview"
                  class="px-3 py-1 font-bold text-gray-400 hover:text-gray-600"
                  onclick="notesEditor.showPreview()"
                >
                  Preview
                </button>
              </div>
            )}
          </div>
        </div>

        {canManage ? (
          <>
            <div id="notes-edit-pane">
              <textarea
                id="notes-textarea"
                class="w-full px-5 py-4 text-sm text-gray-800 font-mono leading-relaxed resize-y focus:outline-none min-h-[320px] bg-transparent"
                placeholder="Write notes about this wedding... Markdown is supported."
                spellcheck={true}
              >{notes}</textarea>
            </div>
            <div id="notes-preview-pane" class="hidden">
              <div
                id="notes-preview"
                class="px-5 py-4 md-preview text-sm max-w-none text-gray-800 min-h-[320px]"
              >
                {notes ? (
                  <p class="text-gray-400 italic">Loading preview...</p>
                ) : (
                  <p class="text-gray-400 italic">No notes yet</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <div
            id="notes-preview"
            class="px-5 py-4 md-preview text-sm max-w-none text-gray-800 min-h-[120px]"
          >
            {notes ? (
              <p class="text-gray-400 italic">Loading...</p>
            ) : (
              <p class="text-gray-400 italic">No notes yet</p>
            )}
          </div>
        )}
      </div>

      {/* Markdown styles + renderer + auto-save logic */}
      <style dangerouslySetInnerHTML={{ __html: `
        .md-preview h1 { font-size: 1.5em; font-weight: 700; margin: 1em 0 0.5em; }
        .md-preview h2 { font-size: 1.25em; font-weight: 700; margin: 1em 0 0.5em; }
        .md-preview h3 { font-size: 1.1em; font-weight: 700; margin: 0.75em 0 0.4em; }
        .md-preview p { margin: 0.5em 0; }
        .md-preview ul, .md-preview ol { margin: 0.5em 0; padding-left: 1.5em; }
        .md-preview ul { list-style: disc; }
        .md-preview ol { list-style: decimal; }
        .md-preview li { margin: 0.25em 0; }
        .md-preview a { color: #0066E6; text-decoration: underline; }
        .md-preview strong { font-weight: 700; }
        .md-preview em { font-style: italic; }
        .md-preview code { background: #f3f4f6; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
        .md-preview pre { background: #f3f4f6; padding: 0.75em 1em; border-radius: 8px; overflow-x: auto; margin: 0.75em 0; }
        .md-preview pre code { background: none; padding: 0; }
        .md-preview blockquote { border-left: 3px solid #d1d5db; padding-left: 1em; color: #6b7280; margin: 0.75em 0; }
        .md-preview hr { border: none; border-top: 1px solid #e5e7eb; margin: 1em 0; }
        .md-preview table { border-collapse: collapse; width: 100%; margin: 0.75em 0; }
        .md-preview th, .md-preview td { border: 1px solid #e5e7eb; padding: 0.4em 0.75em; text-align: left; }
        .md-preview th { background: #f9fafb; font-weight: 600; }
        .md-preview input[type="checkbox"] { margin-right: 0.4em; }
      ` }} />
      <script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"></script>
      {canManage ? (
        <script dangerouslySetInnerHTML={{ __html: `
(function() {
  var weddingId = "${weddingId}";
  var csrf = "${csrfToken}";
  var textarea = document.getElementById("notes-textarea");
  var preview = document.getElementById("notes-preview");
  var status = document.getElementById("notes-status");
  var editPane = document.getElementById("notes-edit-pane");
  var previewPane = document.getElementById("notes-preview-pane");
  var btnEdit = document.getElementById("btn-edit");
  var btnPreview = document.getElementById("btn-preview");

  var saveTimer = null;
  var syncTimer = null;
  var lastSaved = ${escaped};
  var saving = false;

  function setStatus(text, color) {
    status.textContent = text;
    status.style.color = color || "#9ca3af";
  }

  function renderPreview() {
    if (typeof marked !== "undefined" && marked.parse) {
      var val = textarea ? textarea.value : ${escaped};
      preview.innerHTML = val ? marked.parse(val) : '<p class="text-gray-400 italic">No notes yet</p>';
    }
  }

  // Save notes to D1
  function save() {
    var val = textarea.value;
    if (val === lastSaved) return;
    saving = true;
    setStatus("Saving...", "#6b7280");

    fetch("/app/weddings/" + weddingId + "/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ notes: val })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      saving = false;
      if (data.saved) {
        lastSaved = val;
        setStatus("Saved", "#16a34a");
        // Schedule git sync after 10s of inactivity
        clearTimeout(syncTimer);
        syncTimer = setTimeout(syncToGit, 10000);
      } else {
        setStatus("Save failed", "#dc2626");
      }
    })
    .catch(function() {
      saving = false;
      setStatus("Save failed — retrying...", "#dc2626");
      // Retry once after 3s
      setTimeout(function() { save(); }, 3000);
    });
  }

  // Push to git storage
  function syncToGit() {
    setStatus("Syncing...", "#6b7280");
    fetch("/app/weddings/" + weddingId + "/notes/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.synced) {
        setStatus("Saved & synced", "#16a34a");
        setTimeout(function() {
          if (status.textContent === "Saved & synced") setStatus("");
        }, 4000);
      } else {
        setStatus("Saved", "#16a34a");
      }
    })
    .catch(function() {
      setStatus("Saved (sync pending)", "#ca8a04");
    });
  }

  // Debounced save on input
  textarea.addEventListener("input", function() {
    clearTimeout(saveTimer);
    clearTimeout(syncTimer);
    setStatus("Editing...", "#9ca3af");
    saveTimer = setTimeout(save, 1500);
  });

  // Save on blur (switching tabs, etc.)
  textarea.addEventListener("blur", function() {
    if (textarea.value !== lastSaved) {
      clearTimeout(saveTimer);
      save();
    }
  });

  // Save before leaving page
  window.addEventListener("beforeunload", function(e) {
    if (textarea.value !== lastSaved) {
      save();
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // Tab/preview toggle
  window.notesEditor = {
    showEdit: function() {
      editPane.classList.remove("hidden");
      previewPane.classList.add("hidden");
      btnEdit.className = "px-3 py-1 font-bold bg-horizon-50 text-horizon-700";
      btnPreview.className = "px-3 py-1 font-bold text-gray-400 hover:text-gray-600";
      textarea.focus();
    },
    showPreview: function() {
      renderPreview();
      previewPane.classList.remove("hidden");
      editPane.classList.add("hidden");
      btnPreview.className = "px-3 py-1 font-bold bg-horizon-50 text-horizon-700";
      btnEdit.className = "px-3 py-1 font-bold text-gray-400 hover:text-gray-600";
    }
  };

  // Initial render check — render preview on load in case they switch tabs
  if (typeof marked !== "undefined") renderPreview();
  else window.addEventListener("load", renderPreview);
})();
` }} />
      ) : (
        <script dangerouslySetInnerHTML={{ __html: `
(function() {
  function render() {
    var el = document.getElementById("notes-preview");
    if (!el) return;
    var src = ${escaped};
    if (typeof marked !== "undefined" && marked.parse) {
      el.innerHTML = src ? marked.parse(src) : '<p class="text-gray-400 italic">No notes yet</p>';
    }
  }
  if (typeof marked !== "undefined") render();
  else window.addEventListener("load", render);
})();
` }} />
      )}
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
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="title">Title</label>
        <input
          type="text"
          id="title"
          name="title"
          required
          value={wedding?.title ?? defaults?.title ?? ''}
          placeholder="e.g. Sarah & James"
          class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
        />
      </div>

      <div>
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="ceremony_type">Type</label>
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

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1.5" for="date">Date</label>
          <input
            type="date"
            id="date"
            name="date"
            value={wedding?.date ?? defaults?.date ?? ''}
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          />
        </div>
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1.5" for="time">Start time</label>
          <input
            type="time"
            id="time"
            name="time"
            value={wedding?.time ?? ''}
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          />
        </div>
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1.5" for="duration_hours">Duration (hours)</label>
          <select
            id="duration_hours"
            name="duration_hours"
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          >
            <option value="">—</option>
            {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10, 12].map((h) => (
              <option value={String(h)} selected={wedding?.duration_hours === h}>
                {h === 0.5 ? '30 min' : h % 1 === 0 ? `${h}h` : `${Math.floor(h)}h 30m`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="location">Location</label>
        <input
          type="text"
          id="location"
          name="location"
          value={wedding?.location ?? defaults?.location ?? ''}
          class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
        />
      </div>

      {wedding && (
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1.5" for="status">Status</label>
          <select
            id="status"
            name="status"
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          >
            {WEDDING_STATUSES.map((s) => (
              <option value={s.value} selected={s.value === wedding.status}>{s.label}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="notes">Notes</label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
        >{wedding?.notes ?? ''}</textarea>
      </div>

      <button
        type="submit"
        class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
      >
        {wedding ? 'Save changes' : 'Create wedding'}
      </button>
    </form>
  )
}
