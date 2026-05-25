import { Hono } from 'hono'
import type { FC, PropsWithChildren } from 'hono/jsx'
import type { Env, User, Wedding, InvoicePayment, Email, CoupleVendor } from '../types'
import { COUPLE_VENDOR_CATEGORIES } from '../types'
import { SharedHead } from '../views/head'
import { Logo } from '../views/logo'
import { requireAuth } from '../middleware/auth'
import { csrf } from '../middleware/csrf'
import { getWedding, getWeddingMembers, getMembership, updateWedding } from '../db/weddings'
import { updateUser } from '../db/users'
import { listCoupleVendors, getCoupleVendor, getCoupleVendorByProfileId, createCoupleVendor, updateCoupleVendor, deleteCoupleVendor, syncPlatformVendors } from '../db/couple-vendors'
import { formatDate, formatDateTime, daysUntil } from '../lib/date'

type WeddingInvoice = {
  id: string
  vendor_id: string
  title: string
  description: string | null
  amount_cents: number
  status: string
  due_date: string | null
  line_items: string | null
  notes: string | null
  public_token: string | null
  vendor_name: string
}

type UpcomingPayment = InvoicePayment & {
  invoice_title: string
  vendor_name: string
}

type CoupleEmail = Email & {
  vendor_name: string
}

const couple = new Hono<Env>()

couple.use('/wedding/*', requireAuth, csrf)

// ─── Wedding dashboard ───

couple.get('/wedding/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.redirect('/login')

  const wedding = await getWedding(c.env.DB, weddingId)
  if (!wedding) return c.redirect('/login')

  // Sync platform vendors into couple_vendors
  await syncPlatformVendors(c.env.DB, weddingId)

  // Couple's vendor list (canonical source)
  const coupleVendors = await listCoupleVendors(c.env.DB, weddingId)

  // Get platform vendor profile IDs for invoice/email queries
  const platformVendorIds = coupleVendors
    .map((v) => v.vendor_profile_id)
    .filter((id): id is string => id !== null)

  // Invoices for this wedding
  let invoices: WeddingInvoice[] = []
  if (platformVendorIds.length > 0) {
    invoices = await c.env.DB
      .prepare(
        `SELECT i.id, i.vendor_id, i.title, i.description, i.amount_cents, i.status, i.due_date,
                i.line_items, i.notes, i.public_token, vp.business_name AS vendor_name
         FROM invoices i
         JOIN vendor_profiles vp ON vp.id = i.vendor_id
         WHERE i.wedding_id = ? AND i.status != 'draft'
         ORDER BY i.created_at DESC`
      )
      .bind(weddingId)
      .all<WeddingInvoice>()
      .then((r) => r.results)
  }

  // All payments for wedding invoices
  const invoiceIds = invoices.map((i) => i.id)
  let payments: UpcomingPayment[] = []
  if (invoiceIds.length > 0) {
    const ph = invoiceIds.map(() => '?').join(',')
    payments = await c.env.DB
      .prepare(
        `SELECT ip.*, i.title AS invoice_title, vp.business_name AS vendor_name
         FROM invoice_payments ip
         JOIN invoices i ON i.id = ip.invoice_id
         JOIN vendor_profiles vp ON vp.id = i.vendor_id
         WHERE ip.invoice_id IN (${ph})
         ORDER BY ip.due_date ASC`
      )
      .bind(...invoiceIds)
      .all<UpcomingPayment>()
      .then((r) => r.results)
  }

  // Emails for the couple user across platform vendors
  let emails: CoupleEmail[] = []
  if (platformVendorIds.length > 0) {
    const ph = platformVendorIds.map(() => '?').join(',')
    emails = await c.env.DB
      .prepare(
        `SELECT e.*, vp.business_name AS vendor_name
         FROM emails e
         JOIN vendor_profiles vp ON vp.id = e.vendor_id
         WHERE e.contact_id IN (
           SELECT c.id FROM contacts c
           WHERE c.vendor_id IN (${ph})
           AND (LOWER(c.email) = LOWER(?) OR LOWER(c.partner_email) = LOWER(?))
         )
         AND e.is_system = 0
         ORDER BY e.created_at DESC
         LIMIT 10`
      )
      .bind(...platformVendorIds, user.email, user.email)
      .all<CoupleEmail>()
      .then((r) => r.results)
  }

  const days = wedding.date ? daysUntil(wedding.date) : null

  // Budget calculations
  const expectedTotal = coupleVendors.reduce((sum, v) => sum + (v.expected_price_cents ?? 0), 0)
  const invoicedTotal = invoices.reduce((sum, i) => sum + i.amount_cents, 0)
  const paidTotal = payments.filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amount_cents, 0)
  const budgetTotal = Math.max(expectedTotal, invoicedTotal)
  const upcomingPayments = payments.filter((p) => p.status === 'pending')
  const bookedCount = coupleVendors.filter((v) => v.status === 'booked').length
  const vendorsWithoutEstimate = coupleVendors.filter((v) => !v.expected_price_cents && !v.vendor_profile_id).length

  // Members for collaboration toggle
  const members = await getWeddingMembers(c.env.DB, weddingId)
  const platformVendorCount = members.filter((m) => m.role === 'owner' || m.role === 'vendor').length

  return c.html(
    <CoupleLayout title={wedding.title} user={user} wedding={wedding} csrfToken={c.get('csrfToken')}>
      <div class="max-w-3xl mx-auto space-y-6">
        {/* Hero */}
        <div class="text-center">
          <h1 class="text-2xl sm:text-3xl font-bold">{wedding.title}</h1>
          {wedding.ceremony_type && wedding.ceremony_type !== 'wedding' && (
            <span class="inline-block mt-1 px-3 py-0.5 bg-papaya-200 text-gray-700 text-xs font-medium rounded-full">
              {wedding.ceremony_type.charAt(0).toUpperCase() + wedding.ceremony_type.slice(1)}
            </span>
          )}
          {wedding.date && (
            <p class="text-gray-600 mt-1">
              {formatDate(wedding.date)}
              {wedding.time && ` at ${wedding.time}`}
              {days !== null && days > 0 && (
                <span class="text-grapefruit-700 font-bold"> — {days} days to go</span>
              )}
              {days !== null && days === 0 && (
                <span class="text-grapefruit-700 font-bold"> — Today!</span>
              )}
            </p>
          )}
          {wedding.location && (
            <p class="text-sm text-gray-500 mt-1">{wedding.location}</p>
          )}
        </div>

        {/* Budget overview */}
        {(budgetTotal > 0 || coupleVendors.length > 0) && (
          <div class="bg-white border border-papaya-300/30 rounded-2xl p-5">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-sm font-bold text-gray-500">Budget</h2>
              <p class="text-xs text-gray-400">
                {bookedCount} of {coupleVendors.length} vendor{coupleVendors.length !== 1 ? 's' : ''} booked
              </p>
            </div>
            {budgetTotal > 0 ? (
              <>
                <div class="grid grid-cols-3 gap-4 text-center mb-4">
                  <div>
                    <p class="text-xs text-gray-500 mb-0.5">Expected</p>
                    <p class="text-lg font-bold">${(expectedTotal / 100).toLocaleString('en-AU')}</p>
                  </div>
                  <div>
                    <p class="text-xs text-gray-500 mb-0.5">Invoiced</p>
                    <p class="text-lg font-bold">${(invoicedTotal / 100).toLocaleString('en-AU')}</p>
                  </div>
                  <div>
                    <p class="text-xs text-gray-500 mb-0.5">Paid</p>
                    <p class="text-lg font-bold text-horizon-700">${(paidTotal / 100).toLocaleString('en-AU')}</p>
                  </div>
                </div>
                {invoicedTotal > 0 && (
                  <div class="w-full bg-gray-100 rounded-full h-2">
                    <div
                      class="bg-horizon-600 h-2 rounded-full transition-all"
                      style={`width: ${Math.min(100, Math.round((paidTotal / invoicedTotal) * 100))}%`}
                    ></div>
                  </div>
                )}
              </>
            ) : (
              <p class="text-sm text-gray-400 text-center">Add vendors and set expected prices to track your budget</p>
            )}
          </div>
        )}

        {/* Vendors */}
        <section>
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-sm font-bold text-gray-500">Your vendors</h2>
            <a
              href={`/wedding/${weddingId}/vendors/add`}
              class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-horizon-700 transition-colors"
            >
              + Add vendor
            </a>
          </div>
          {coupleVendors.length === 0 ? (
            <div class="bg-white border border-papaya-300/30 rounded-2xl p-8 text-center">
              <p class="text-sm text-gray-400 mb-3">Start planning by adding your vendors</p>
              <a
                href={`/wedding/${weddingId}/vendors/add`}
                class="inline-block bg-horizon-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
              >
                Add your first vendor
              </a>
            </div>
          ) : (
            <div class="grid gap-3 sm:grid-cols-2">
              {coupleVendors.map((v) => {
                const isLinked = !!v.vendor_profile_id
                const vendorInvoices = isLinked ? invoices.filter((i) => i.vendor_id === v.vendor_profile_id) : []
                const vendorInvoiced = vendorInvoices.reduce((sum, i) => sum + i.amount_cents, 0)
                const vendorPaid = payments
                  .filter((p) => p.status === 'paid' && vendorInvoices.some((i) => i.id === p.invoice_id))
                  .reduce((sum, p) => sum + p.amount_cents, 0)
                const cat = v.category ? v.category.charAt(0).toUpperCase() + v.category.slice(1) : 'Vendor'
                const price = vendorInvoiced || v.expected_price_cents
                const href = isLinked
                  ? `/wedding/${weddingId}/vendor/${v.vendor_profile_id}`
                  : `/wedding/${weddingId}/vendors/${v.id}`

                return (
                  <a
                    href={href}
                    class="bg-white border border-papaya-300/30 rounded-2xl p-4 hover:border-grapefruit-300 transition-colors block"
                  >
                    <div class="flex items-start justify-between mb-1">
                      <div class="min-w-0 flex-1">
                        <p class="font-bold text-gray-900 truncate">{v.name}</p>
                        <p class="text-xs text-gray-500">{cat}</p>
                      </div>
                      <VendorStatusBadge status={v.status} />
                    </div>
                    <div class="flex items-end justify-between mt-3">
                      <div class="flex items-center gap-2">
                        {isLinked && (
                          <span class="text-[10px] text-horizon-600 font-bold bg-horizon-50 px-1.5 py-0.5 rounded">On platform</span>
                        )}
                        {v.notes && (
                          <span class="text-[10px] text-gray-400">Has notes</span>
                        )}
                      </div>
                      {price ? (
                        <div class="text-right">
                          <p class="text-sm font-bold">${((price) / 100).toLocaleString('en-AU')}</p>
                          {vendorInvoiced > 0 && vendorPaid > 0 && vendorPaid < vendorInvoiced && (
                            <p class="text-xs text-horizon-700">${(vendorPaid / 100).toLocaleString('en-AU')} paid</p>
                          )}
                          {vendorInvoiced > 0 && vendorPaid >= vendorInvoiced && (
                            <p class="text-xs text-horizon-700">Paid</p>
                          )}
                        </div>
                      ) : (
                        <p class="text-xs text-gray-300">No price set</p>
                      )}
                    </div>
                  </a>
                )
              })}
            </div>
          )}
        </section>

        {/* Upcoming payments */}
        {upcomingPayments.length > 0 && (
          <section>
            <h2 class="text-sm font-bold text-gray-500 mb-3">Upcoming payments</h2>
            <div class="bg-white border border-papaya-300/30 rounded-2xl divide-y divide-gray-100">
              {upcomingPayments.slice(0, 5).map((p) => (
                <div class="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-gray-900">{p.label}</p>
                    <p class="text-xs text-gray-500">
                      {p.vendor_name}
                      {p.due_date && ` · Due ${formatDate(p.due_date)}`}
                    </p>
                  </div>
                  <p class="text-sm font-bold">${(p.amount_cents / 100).toLocaleString('en-AU')}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recent messages */}
        {emails.length > 0 && (
          <section>
            <h2 class="text-sm font-bold text-gray-500 mb-3">Recent messages</h2>
            <div class="bg-white border border-papaya-300/30 rounded-2xl divide-y divide-gray-100">
              {emails.map((e) => {
                const isFromVendor = e.direction === 'outbound'
                const preview = e.body_text ? e.body_text.slice(0, 120) : ''
                return (
                  <div class="px-5 py-3">
                    <div class="flex items-center justify-between mb-1">
                      <p class="text-sm font-medium text-gray-900">
                        {isFromVendor ? (e.from_name ?? e.vendor_name) : `You → ${e.vendor_name}`}
                      </p>
                      <p class="text-xs text-gray-400">{formatDate(e.created_at)}</p>
                    </div>
                    <p class="text-sm font-medium text-gray-700">{e.subject}</p>
                    {preview && (
                      <p class="text-xs text-gray-500 mt-0.5 line-clamp-2">{preview}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Wedding details */}
        <section>
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-sm font-bold text-gray-500">Details</h2>
            {membership.role === 'couple' && (
              <a
                href={`/wedding/${weddingId}/edit`}
                class="text-sm font-bold text-horizon-600 hover:text-horizon-700"
              >
                Edit details
              </a>
            )}
          </div>
          <div class="bg-white border border-papaya-300/30 rounded-2xl p-5">
            <div class="grid grid-cols-2 gap-4 text-sm">
              {wedding.date && (
                <div>
                  <p class="text-xs text-gray-500">Ceremony date</p>
                  <p class="font-medium">{formatDate(wedding.date)}</p>
                </div>
              )}
              {wedding.time && (
                <div>
                  <p class="text-xs text-gray-500">Ceremony time</p>
                  <p class="font-medium">{wedding.time}</p>
                </div>
              )}
              {wedding.location && (
                <div>
                  <p class="text-xs text-gray-500">Ceremony location</p>
                  <p class="font-medium">{wedding.location}</p>
                </div>
              )}
              {wedding.reception_location && (
                <div>
                  <p class="text-xs text-gray-500">Reception location</p>
                  <p class="font-medium">{wedding.reception_location}</p>
                </div>
              )}
              {wedding.reception_time && (
                <div>
                  <p class="text-xs text-gray-500">Reception time</p>
                  <p class="font-medium">{wedding.reception_time}</p>
                </div>
              )}
              {wedding.getting_ready_location && (
                <div>
                  <p class="text-xs text-gray-500">Getting ready</p>
                  <p class="font-medium">{wedding.getting_ready_location}</p>
                </div>
              )}
              {wedding.dress_code && (
                <div>
                  <p class="text-xs text-gray-500">Dress code</p>
                  <p class="font-medium">{wedding.dress_code}</p>
                </div>
              )}
              {wedding.guest_count && (
                <div>
                  <p class="text-xs text-gray-500">Guest count</p>
                  <p class="font-medium">{wedding.guest_count}</p>
                </div>
              )}
              <div>
                <p class="text-xs text-gray-500">Status</p>
                <p class="font-medium">{wedding.status.charAt(0).toUpperCase() + wedding.status.slice(1)}</p>
              </div>
            </div>
            {wedding.timeline_notes && (
              <div class="mt-4 pt-4 border-t border-gray-100">
                <p class="text-xs text-gray-500 mb-1">Timeline notes</p>
                <p class="text-sm text-gray-700 whitespace-pre-wrap">{wedding.timeline_notes}</p>
              </div>
            )}
          </div>
        </section>

        {wedding.notes && (
          <section>
            <h2 class="text-sm font-bold text-gray-500 mb-3">Notes from your vendor</h2>
            <div class="bg-white border border-papaya-300/30 rounded-2xl p-5">
              <p class="text-sm text-gray-700 whitespace-pre-wrap">{wedding.notes}</p>
            </div>
          </section>
        )}

        {/* Vendor collaboration */}
        {platformVendorCount > 1 && (
          <section>
            <h2 class="text-sm font-bold text-gray-500 mb-3">Vendor collaboration</h2>
            <div class="bg-white border border-papaya-300/30 rounded-2xl p-5">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-bold text-gray-900">Allow vendors to see each other</p>
                  <p class="text-xs text-gray-500 mt-1">
                    When enabled, your vendors can see who else is working on your {wedding.ceremony_type ?? 'wedding'}.
                    This helps them coordinate. Only you can change this setting.
                  </p>
                </div>
                <form method="post" action={`/wedding/${weddingId}/visibility`}>
                  <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                  <input type="hidden" name="visibility" value={wedding.vendor_visibility === 'visible' ? 'private' : 'visible'} />
                  <button
                    type="submit"
                    class={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      wedding.vendor_visibility === 'visible' ? 'bg-horizon-600' : 'bg-gray-200'
                    }`}
                    role="switch"
                    aria-checked={wedding.vendor_visibility === 'visible' ? 'true' : 'false'}
                  >
                    <span
                      class={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        wedding.vendor_visibility === 'visible' ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </form>
              </div>
            </div>
          </section>
        )}
      </div>
    </CoupleLayout>
  )
})

// ─── Add vendor ───

couple.get('/wedding/:id/vendors/add', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.redirect('/login')

  const wedding = await getWedding(c.env.DB, weddingId)
  if (!wedding) return c.redirect('/login')

  return c.html(
    <CoupleLayout title="Add vendor" user={user} wedding={wedding} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl mx-auto space-y-6">
        <a href={`/wedding/${weddingId}`} class="text-sm text-gray-500 hover:text-gray-700">
          ← Back to wedding
        </a>

        <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 sm:p-8">
          <h1 class="text-xl font-bold mb-1">Add a vendor</h1>
          <p class="text-sm text-gray-500 mb-6">Track any vendor — even if they're not on Wedding Computer yet.</p>

          <CoupleVendorForm
            action={`/wedding/${weddingId}/vendors/add`}
            csrfToken={c.get('csrfToken')}
            submitLabel="Add vendor"
          />
        </div>
      </div>
    </CoupleLayout>
  )
})

couple.post('/wedding/:id/vendors/add', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || membership.role !== 'couple') return c.text('Forbidden', 403)

  const body = await c.req.parseBody()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return c.redirect(`/wedding/${weddingId}/vendors/add`)

  const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim().toLowerCase() : null
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null
  const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null
  const website = typeof body.website === 'string' && body.website.trim() ? body.website.trim() : null
  const instagram = typeof body.instagram === 'string' && body.instagram.trim() ? body.instagram.trim() : null
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
  const priceStr = typeof body.expected_price === 'string' ? body.expected_price.trim() : ''
  const expected_price_cents = priceStr ? Math.round(parseFloat(priceStr) * 100) : null
  const status = typeof body.status === 'string' && ['considering', 'contacted', 'booked'].includes(body.status) ? body.status : 'considering'

  await createCoupleVendor(c.env.DB, weddingId, {
    name, category, email, phone, website, instagram, notes, expected_price_cents, status,
  })

  return c.redirect(`/wedding/${weddingId}`)
})

// ─── Manual vendor detail & edit ───

couple.get('/wedding/:id/vendors/:coupleVendorId', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const weddingId = c.req.param('id')
  const coupleVendorId = c.req.param('coupleVendorId')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.redirect('/login')

  const wedding = await getWedding(c.env.DB, weddingId)
  if (!wedding) return c.redirect(`/wedding/${weddingId}`)

  const vendor = await getCoupleVendor(c.env.DB, weddingId, coupleVendorId)
  if (!vendor) return c.redirect(`/wedding/${weddingId}`)

  // If this is actually a linked platform vendor, redirect to the platform detail page
  if (vendor.vendor_profile_id) {
    return c.redirect(`/wedding/${weddingId}/vendor/${vendor.vendor_profile_id}`)
  }

  const cat = vendor.category ? vendor.category.charAt(0).toUpperCase() + vendor.category.slice(1) : null

  return c.html(
    <CoupleLayout title={vendor.name} user={user} wedding={wedding} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl mx-auto space-y-6">
        <a href={`/wedding/${weddingId}`} class="text-sm text-gray-500 hover:text-gray-700">
          ← Back to wedding
        </a>

        <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 sm:p-8">
          <div class="flex items-start justify-between mb-6">
            <div>
              {cat && <p class="text-xs text-gray-400 uppercase tracking-wide">{cat}</p>}
              <h1 class="text-xl font-bold mt-0.5">{vendor.name}</h1>
            </div>
            <VendorStatusBadge status={vendor.status} />
          </div>

          <CoupleVendorForm
            action={`/wedding/${weddingId}/vendors/${vendor.id}`}
            csrfToken={c.get('csrfToken')}
            vendor={vendor}
            submitLabel="Save changes"
          />
        </div>

        {/* Delete */}
        {membership.role === 'couple' && (
          <div class="bg-white border border-gray-200 rounded-2xl p-5">
            <form
              method="post"
              action={`/wedding/${weddingId}/vendors/${vendor.id}/delete`}
              onsubmit="return confirm('Remove this vendor from your plan?')"
            >
              <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
              <button type="submit" class="text-sm font-bold text-gray-400 hover:text-grapefruit-700 transition-colors">
                Remove from plan
              </button>
            </form>
          </div>
        )}
      </div>
    </CoupleLayout>
  )
})

couple.post('/wedding/:id/vendors/:coupleVendorId', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const weddingId = c.req.param('id')
  const coupleVendorId = c.req.param('coupleVendorId')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || membership.role !== 'couple') return c.text('Forbidden', 403)

  const body = await c.req.parseBody()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return c.redirect(`/wedding/${weddingId}/vendors/${coupleVendorId}`)

  const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim().toLowerCase() : null
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null
  const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null
  const website = typeof body.website === 'string' && body.website.trim() ? body.website.trim() : null
  const instagram = typeof body.instagram === 'string' && body.instagram.trim() ? body.instagram.trim() : null
  const notes = typeof body.notes === 'string' ? body.notes.trim() : null
  const priceStr = typeof body.expected_price === 'string' ? body.expected_price.trim() : ''
  const expected_price_cents = priceStr ? Math.round(parseFloat(priceStr) * 100) : null
  const status = typeof body.status === 'string' && ['considering', 'contacted', 'booked'].includes(body.status) ? body.status as CoupleVendor['status'] : undefined

  await updateCoupleVendor(c.env.DB, weddingId, coupleVendorId, {
    name, category, email, phone, website, instagram, notes, expected_price_cents, status,
  })

  return c.redirect(`/wedding/${weddingId}/vendors/${coupleVendorId}`)
})

couple.post('/wedding/:id/vendors/:coupleVendorId/delete', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const weddingId = c.req.param('id')
  const coupleVendorId = c.req.param('coupleVendorId')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || membership.role !== 'couple') return c.text('Forbidden', 403)

  await deleteCoupleVendor(c.env.DB, weddingId, coupleVendorId)

  return c.redirect(`/wedding/${weddingId}`)
})

// ─── Vendor visibility toggle ───

couple.post('/wedding/:id/visibility', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || membership.role !== 'couple') return c.text('Forbidden', 403)

  const body = await c.req.parseBody()
  const visibility = body.visibility === 'visible' ? 'visible' : 'private'

  await updateWedding(c.env.DB, weddingId, { vendor_visibility: visibility })

  await c.env.EMAIL_QUEUE.send({
    type: 'notify_visibility_changed',
    payload: JSON.stringify({ weddingId, isNowVisible: visibility === 'visible' }),
  })

  return c.redirect(`/wedding/${weddingId}`)
})

// ─── Wedding details edit ───

couple.get('/wedding/:id/edit', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || membership.role !== 'couple') return c.redirect(`/wedding/${weddingId}`)

  const wedding = await getWedding(c.env.DB, weddingId)
  if (!wedding) return c.redirect('/login')

  // Get all couple members for the contact details section
  const members = await getWeddingMembers(c.env.DB, weddingId)
  const coupleMembers = members.filter((m) => m.role === 'couple')

  // Get full user info for each couple member
  const coupleUsers: { id: string; name: string; email: string; phone: string | null }[] = []
  for (const member of coupleMembers) {
    const u = await c.env.DB
      .prepare('SELECT id, name, email, phone FROM users WHERE id = ?')
      .bind(member.user_id)
      .first<{ id: string; name: string; email: string; phone: string | null }>()
    if (u) coupleUsers.push(u)
  }

  const inputClass = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent'

  return c.html(
    <CoupleLayout title="Edit wedding details" user={user} wedding={wedding} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl mx-auto space-y-6">
        <a href={`/wedding/${weddingId}`} class="text-sm text-gray-500 hover:text-gray-700">
          ← Back to wedding
        </a>

        <form method="post" action={`/wedding/${weddingId}/edit`} class="space-y-6">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />

          {/* Wedding name */}
          <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 sm:p-8">
            <h2 class="text-base font-bold mb-4">Wedding details</h2>
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="title">Wedding name</label>
                <input type="text" id="title" name="title" required value={wedding.title} class={inputClass} placeholder="e.g. Sarah & James" />
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-bold text-gray-700 mb-1.5" for="date">Date</label>
                  <input type="date" id="date" name="date" value={wedding.date ?? ''} class={inputClass} />
                </div>
                <div>
                  <label class="block text-sm font-bold text-gray-700 mb-1.5" for="ceremony_type">Ceremony type</label>
                  <select id="ceremony_type" name="ceremony_type" class={`${inputClass} bg-white`}>
                    {['wedding', 'elopement', 'vow renewal', 'commitment', 'other'].map((t) => (
                      <option value={t} selected={wedding.ceremony_type === t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-bold text-gray-700 mb-1.5" for="dress_code">Dress code</label>
                  <input type="text" id="dress_code" name="dress_code" value={wedding.dress_code ?? ''} class={inputClass} placeholder="e.g. Black tie, Casual" />
                </div>
                <div>
                  <label class="block text-sm font-bold text-gray-700 mb-1.5" for="guest_count">Guest count</label>
                  <input type="number" id="guest_count" name="guest_count" min="0" value={wedding.guest_count ?? ''} class={inputClass} placeholder="0" />
                </div>
              </div>
            </div>
          </div>

          {/* Ceremony */}
          <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 sm:p-8">
            <h2 class="text-base font-bold mb-4">Ceremony</h2>
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="time">Time</label>
                <input type="time" id="time" name="time" value={wedding.time ?? ''} class={inputClass} />
              </div>
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="location">Location</label>
                <input type="text" id="location" name="location" value={wedding.location ?? ''} class={inputClass} placeholder="Ceremony venue or address" />
              </div>
            </div>
          </div>

          {/* Reception */}
          <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 sm:p-8">
            <h2 class="text-base font-bold mb-4">Reception</h2>
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="reception_time">Time</label>
                <input type="time" id="reception_time" name="reception_time" value={wedding.reception_time ?? ''} class={inputClass} />
              </div>
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="reception_location">Location</label>
                <input type="text" id="reception_location" name="reception_location" value={wedding.reception_location ?? ''} class={inputClass} placeholder="Reception venue or address" />
              </div>
            </div>
          </div>

          {/* Getting ready */}
          <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 sm:p-8">
            <h2 class="text-base font-bold mb-4">Getting ready</h2>
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="getting_ready_time">Time</label>
                <input type="time" id="getting_ready_time" name="getting_ready_time" value={wedding.getting_ready_time ?? ''} class={inputClass} />
              </div>
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="getting_ready_location">Location</label>
                <input type="text" id="getting_ready_location" name="getting_ready_location" value={wedding.getting_ready_location ?? ''} class={inputClass} placeholder="Where you'll be getting ready" />
              </div>
            </div>
          </div>

          {/* Timeline notes */}
          <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 sm:p-8">
            <h2 class="text-base font-bold mb-4">Timeline notes</h2>
            <textarea
              id="timeline_notes"
              name="timeline_notes"
              rows={4}
              class={inputClass}
              placeholder="Any additional details about the day's schedule..."
            >{wedding.timeline_notes ?? ''}</textarea>
          </div>

          {/* Your contact details */}
          <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 sm:p-8">
            <h2 class="text-base font-bold mb-1">Your contact details</h2>
            <p class="text-sm text-gray-500 mb-4">These are shared with your vendors.</p>
            {coupleUsers.map((cu, i) => (
              <div class={i > 0 ? 'mt-6 pt-6 border-t border-gray-100' : ''}>
                <p class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">
                  {i === 0 ? 'Partner 1' : `Partner ${i + 1}`}
                </p>
                <input type="hidden" name={`couple_user_id_${i}`} value={cu.id} />
                <div class="space-y-4">
                  <div>
                    <label class="block text-sm font-bold text-gray-700 mb-1.5" for={`couple_name_${i}`}>Name</label>
                    <input type="text" id={`couple_name_${i}`} name={`couple_name_${i}`} value={cu.name} class={inputClass} />
                  </div>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label class="block text-sm font-bold text-gray-700 mb-1.5" for={`couple_email_${i}`}>Email</label>
                      <input type="email" id={`couple_email_${i}`} name={`couple_email_${i}`} value={cu.email} class={inputClass} disabled />
                      <p class="text-xs text-gray-400 mt-1">Email cannot be changed</p>
                    </div>
                    <div>
                      <label class="block text-sm font-bold text-gray-700 mb-1.5" for={`couple_phone_${i}`}>Phone</label>
                      <input type="tel" id={`couple_phone_${i}`} name={`couple_phone_${i}`} value={cu.phone ?? ''} class={inputClass} placeholder="04XX XXX XXX" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            type="submit"
            class="w-full bg-horizon-600 text-white py-3 px-4 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            Save details
          </button>
        </form>
      </div>
    </CoupleLayout>
  )
})

couple.post('/wedding/:id/edit', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || membership.role !== 'couple') return c.text('Forbidden', 403)

  const body = await c.req.parseBody()

  // Update wedding details
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return c.redirect(`/wedding/${weddingId}/edit`)

  const str = (key: string) => {
    const v = body[key]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }
  const guestCountRaw = str('guest_count')
  const guest_count = guestCountRaw ? parseInt(guestCountRaw, 10) || null : null

  await updateWedding(c.env.DB, weddingId, {
    title,
    date: str('date'),
    time: str('time'),
    location: str('location'),
    ceremony_type: str('ceremony_type'),
    reception_location: str('reception_location'),
    reception_time: str('reception_time'),
    getting_ready_location: str('getting_ready_location'),
    getting_ready_time: str('getting_ready_time'),
    timeline_notes: str('timeline_notes'),
    dress_code: str('dress_code'),
    guest_count,
  })

  // Update couple contact details
  for (let i = 0; i < 10; i++) {
    const userId = body[`couple_user_id_${i}`]
    if (typeof userId !== 'string' || !userId) break

    const name = typeof body[`couple_name_${i}`] === 'string' ? body[`couple_name_${i}`] as string : undefined
    const phone = typeof body[`couple_phone_${i}`] === 'string' ? (body[`couple_phone_${i}`] as string).trim() || null : undefined

    if (name || phone !== undefined) {
      await updateUser(c.env.DB, userId, {
        ...(name ? { name: name.trim() } : {}),
        ...(phone !== undefined ? { phone } : {}),
      })
    }
  }

  // Notify vendors
  await c.env.EMAIL_QUEUE.send({
    type: 'notify_wedding_details_updated',
    payload: JSON.stringify({ weddingId, coupleName: user.name }),
  })

  return c.redirect(`/wedding/${weddingId}`)
})

// ─── Remove vendor (safety feature) ───

couple.post('/wedding/:id/vendor/:vendorProfileId/remove', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const weddingId = c.req.param('id')
  const vendorProfileId = c.req.param('vendorProfileId')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || membership.role !== 'couple') return c.text('Forbidden', 403)

  const body = await c.req.parseBody()
  if (body.confirm !== 'yes') return c.redirect(`/wedding/${weddingId}/vendor/${vendorProfileId}`)

  // Set vendor's wedding_member status to 'removed'
  await c.env.DB
    .prepare(
      `UPDATE wedding_members SET status = 'removed'
       WHERE wedding_id = ? AND vendor_profile_id = ? AND status = 'active'`
    )
    .bind(weddingId, vendorProfileId)
    .run()

  // Mark couple_vendor as removed too
  const coupleVendor = await getCoupleVendorByProfileId(c.env.DB, weddingId, vendorProfileId)
  if (coupleVendor) {
    await updateCoupleVendor(c.env.DB, weddingId, coupleVendor.id, { status: 'removed' })
  }

  // Find and update matching contact to 'lost'
  const contact = await c.env.DB
    .prepare(
      `SELECT c.id, c.vendor_id FROM contacts c
       WHERE c.vendor_id = ? AND c.wedding_id = ?
       LIMIT 1`
    )
    .bind(vendorProfileId, weddingId)
    .first<{ id: string; vendor_id: string }>()

  if (contact) {
    await c.env.DB
      .prepare(
        `UPDATE contacts SET status = 'lost', updated_at = datetime('now')
         WHERE id = ? AND vendor_id = ?`
      )
      .bind(contact.id, contact.vendor_id)
      .run()

    await c.env.DB
      .prepare(
        `INSERT INTO contact_activities (contact_id, type, summary)
         VALUES (?, 'status_change', 'Couple removed vendor from wedding')`
      )
      .bind(contact.id)
      .run()
  }

  // Notify admin only — vendor is NOT notified
  await c.env.EMAIL_QUEUE.send({
    type: 'notify_vendor_removed',
    payload: JSON.stringify({
      weddingId,
      vendorProfileId,
      coupleUserId: user.id,
    }),
  })

  return c.redirect(`/wedding/${weddingId}`)
})

// ─── Platform vendor detail ───

couple.get('/wedding/:id/vendor/:vendorProfileId', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const weddingId = c.req.param('id')
  const vendorProfileId = c.req.param('vendorProfileId')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.redirect('/login')

  const wedding = await getWedding(c.env.DB, weddingId)
  if (!wedding) return c.redirect(`/wedding/${weddingId}`)

  // Vendor info
  const vendorMember = await c.env.DB
    .prepare(
      `SELECT wm.vendor_role, u.name AS user_name, u.email AS user_email,
              vp.id AS vendor_profile_id, vp.business_name, vp.category, vp.phone, vp.website, vp.instagram, vp.bio
       FROM wedding_members wm
       JOIN users u ON u.id = wm.user_id
       JOIN vendor_profiles vp ON vp.id = wm.vendor_profile_id
       WHERE wm.wedding_id = ? AND wm.vendor_profile_id = ? AND wm.status = 'active'
       LIMIT 1`
    )
    .bind(weddingId, vendorProfileId)
    .first<{
      vendor_role: string | null
      user_name: string
      user_email: string
      vendor_profile_id: string
      business_name: string
      category: string
      phone: string | null
      website: string | null
      instagram: string | null
      bio: string | null
    }>()

  if (!vendorMember) return c.redirect(`/wedding/${weddingId}`)

  // Couple's notes and expected price for this vendor
  const coupleVendor = await getCoupleVendorByProfileId(c.env.DB, weddingId, vendorProfileId)

  // Invoices from this vendor
  const invoices = await c.env.DB
    .prepare(
      `SELECT id, title, description, amount_cents, status, due_date, line_items, notes, public_token
       FROM invoices
       WHERE wedding_id = ? AND vendor_id = ? AND status != 'draft'
       ORDER BY created_at DESC`
    )
    .bind(weddingId, vendorProfileId)
    .all<{
      id: string; title: string; description: string | null; amount_cents: number
      status: string; due_date: string | null; line_items: string | null
      notes: string | null; public_token: string | null
    }>()
    .then((r) => r.results)

  // Payments
  const invoiceIds = invoices.map((i) => i.id)
  let payments: InvoicePayment[] = []
  if (invoiceIds.length > 0) {
    const ph = invoiceIds.map(() => '?').join(',')
    payments = await c.env.DB
      .prepare(
        `SELECT * FROM invoice_payments WHERE invoice_id IN (${ph}) ORDER BY due_date ASC`
      )
      .bind(...invoiceIds)
      .all<InvoicePayment>()
      .then((r) => r.results)
  }

  // Emails
  const emails = await c.env.DB
    .prepare(
      `SELECT e.*
       FROM emails e
       WHERE e.vendor_id = ?
       AND e.contact_id IN (
         SELECT c.id FROM contacts c
         WHERE c.vendor_id = ?
         AND (LOWER(c.email) = LOWER(?) OR LOWER(c.partner_email) = LOWER(?))
       )
       AND e.is_system = 0
       ORDER BY e.created_at DESC
       LIMIT 30`
    )
    .bind(vendorProfileId, vendorProfileId, user.email, user.email)
    .all<Email>()
    .then((r) => r.results)

  const cat = vendorMember.category.charAt(0).toUpperCase() + vendorMember.category.slice(1)
  const totalCost = invoices.reduce((sum, i) => sum + i.amount_cents, 0)
  const totalPaid = payments.filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amount_cents, 0)

  return c.html(
    <CoupleLayout title={vendorMember.business_name} user={user} wedding={wedding} csrfToken={c.get('csrfToken')}>
      <div class="max-w-3xl mx-auto space-y-6">
        {/* Back link */}
        <a href={`/wedding/${weddingId}`} class="text-sm text-gray-500 hover:text-gray-700">
          ← Back to wedding
        </a>

        {/* Vendor header */}
        <div class="bg-white border border-papaya-300/30 rounded-2xl p-5">
          <div class="flex items-start justify-between">
            <div>
              <p class="text-xs text-gray-400 uppercase tracking-wide">{cat}</p>
              <h1 class="text-xl font-bold mt-0.5">{vendorMember.business_name}</h1>
              {vendorMember.bio && (
                <p class="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{vendorMember.bio}</p>
              )}
            </div>
            {totalCost > 0 && (
              <div class="text-right shrink-0 ml-4">
                <p class="text-lg font-bold">${(totalCost / 100).toLocaleString('en-AU')}</p>
                {totalPaid > 0 && (
                  <p class="text-xs text-horizon-700">${(totalPaid / 100).toLocaleString('en-AU')} paid</p>
                )}
              </div>
            )}
          </div>

          {/* Contact info */}
          <div class="flex flex-wrap gap-4 mt-4 pt-4 border-t border-gray-100 text-sm">
            <a href={`mailto:${vendorMember.user_email}`} class="text-horizon-600 font-medium hover:text-horizon-700">
              {vendorMember.user_email}
            </a>
            {vendorMember.phone && (
              <a href={`tel:${vendorMember.phone}`} class="text-horizon-600 font-medium hover:text-horizon-700">
                {vendorMember.phone}
              </a>
            )}
            {vendorMember.website && (
              <a href={vendorMember.website} target="_blank" class="text-horizon-600 font-medium hover:text-horizon-700">
                Website
              </a>
            )}
            {vendorMember.instagram && (
              <a href={`https://instagram.com/${vendorMember.instagram.replace('@', '')}`} target="_blank" class="text-horizon-600 font-medium hover:text-horizon-700">
                @{vendorMember.instagram.replace('@', '')}
              </a>
            )}
          </div>
        </div>

        {/* Your notes & budget for this vendor */}
        {coupleVendor && membership.role === 'couple' && (
          <section>
            <h2 class="text-sm font-bold text-gray-500 mb-3">Your notes</h2>
            <div class="bg-white border border-papaya-300/30 rounded-2xl p-5">
              <form method="post" action={`/wedding/${weddingId}/vendor/${vendorProfileId}/notes`}>
                <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                <div class="space-y-4">
                  <div>
                    <label class="block text-xs font-bold text-gray-500 mb-1.5" for="notes">Notes</label>
                    <textarea
                      id="notes"
                      name="notes"
                      rows={3}
                      class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                      placeholder="Your private notes about this vendor..."
                    >{coupleVendor.notes ?? ''}</textarea>
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-gray-500 mb-1.5" for="expected_price">Expected price ($)</label>
                    <input
                      type="number"
                      id="expected_price"
                      name="expected_price"
                      step="0.01"
                      min="0"
                      value={coupleVendor.expected_price_cents ? (coupleVendor.expected_price_cents / 100).toFixed(2) : ''}
                      class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                      placeholder="0.00"
                    />
                  </div>
                  <button
                    type="submit"
                    class="bg-horizon-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
                  >
                    Save notes
                  </button>
                </div>
              </form>
            </div>
          </section>
        )}

        {/* Invoices & payments */}
        {invoices.length > 0 && (
          <section>
            <h2 class="text-sm font-bold text-gray-500 mb-3">Invoices & payments</h2>
            <div class="space-y-4">
              {invoices.map((inv) => {
                const invPayments = payments.filter((p) => p.invoice_id === inv.id)
                const lineItems: { description: string; amount_cents: number; quantity: number }[] =
                  inv.line_items ? JSON.parse(inv.line_items) : []

                return (
                  <div class="bg-white border border-papaya-300/30 rounded-2xl p-5">
                    <div class="flex items-start justify-between mb-3">
                      <div>
                        <h3 class="font-bold text-gray-900">{inv.title}</h3>
                        {inv.description && (
                          <p class="text-sm text-gray-600 mt-0.5">{inv.description}</p>
                        )}
                      </div>
                      <StatusBadge status={inv.status} />
                    </div>

                    {lineItems.length > 0 && (
                      <div class="border border-gray-100 rounded-xl overflow-hidden mb-3">
                        <table class="w-full text-sm">
                          <tbody class="divide-y divide-gray-100">
                            {lineItems.map((li) => (
                              <tr>
                                <td class="px-4 py-2">
                                  {li.description}
                                  {li.quantity > 1 && <span class="text-gray-400"> x{li.quantity}</span>}
                                </td>
                                <td class="px-4 py-2 text-right font-medium">
                                  ${((li.amount_cents * li.quantity) / 100).toLocaleString('en-AU')}
                                </td>
                              </tr>
                            ))}
                            <tr class="bg-gray-50 font-bold">
                              <td class="px-4 py-2">Total</td>
                              <td class="px-4 py-2 text-right">${(inv.amount_cents / 100).toLocaleString('en-AU')}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {invPayments.length > 0 && (
                      <div class="space-y-2">
                        {invPayments.map((p) => (
                          <div class="flex items-center justify-between text-sm px-3 py-2 bg-gray-50 rounded-lg">
                            <div>
                              <p class="font-medium text-gray-900">{p.label}</p>
                              {p.due_date && <p class="text-xs text-gray-500">Due {formatDate(p.due_date)}</p>}
                            </div>
                            <div class="text-right">
                              <p class="font-bold">${(p.amount_cents / 100).toLocaleString('en-AU')}</p>
                              <p class={`text-xs font-bold ${p.status === 'paid' ? 'text-horizon-700' : 'text-gray-400'}`}>
                                {p.status === 'paid' ? 'Paid' : 'Pending'}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {inv.notes && (
                      <div class="mt-3 pt-3 border-t border-gray-100">
                        <p class="text-xs text-gray-500 font-bold mb-1">Notes</p>
                        <p class="text-sm text-gray-600 whitespace-pre-wrap">{inv.notes}</p>
                      </div>
                    )}

                    {inv.public_token && (
                      <div class="mt-3 pt-3 border-t border-gray-100">
                        <a
                          href={`/book/${inv.public_token}`}
                          class="text-sm text-horizon-600 font-bold hover:text-horizon-700"
                        >
                          View booking page →
                        </a>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Emails */}
        {emails.length > 0 && (
          <section>
            <h2 class="text-sm font-bold text-gray-500 mb-3">Messages</h2>
            <div class="bg-white border border-papaya-300/30 rounded-2xl divide-y divide-gray-100">
              {emails.map((e) => {
                const isFromVendor = e.direction === 'outbound'
                const preview = e.body_text ? e.body_text.slice(0, 200) : ''
                return (
                  <div class="px-5 py-4">
                    <div class="flex items-center justify-between mb-1">
                      <p class="text-sm font-bold text-gray-900">
                        {isFromVendor
                          ? (e.from_name ?? vendorMember.business_name)
                          : 'You'}
                      </p>
                      <p class="text-xs text-gray-400">{formatDateTime(e.created_at)}</p>
                    </div>
                    <p class="text-sm font-medium text-gray-700">{e.subject}</p>
                    {preview && (
                      <p class="text-sm text-gray-500 mt-1 whitespace-pre-wrap">{preview}{e.body_text && e.body_text.length > 200 ? '…' : ''}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Safety: remove vendor */}
        {membership.role === 'couple' && (
          <section>
            <h2 class="text-sm font-bold text-gray-500 mb-3">Safety</h2>
            <div class="bg-white border border-grapefruit-200 rounded-2xl p-5">
              <h3 class="text-sm font-bold text-grapefruit-700 mb-1">Remove this vendor</h3>
              <p class="text-xs text-gray-500 leading-relaxed mb-4">
                If you no longer want this vendor on your {wedding.ceremony_type ?? 'wedding'}, you can remove them.
                They will lose access to your details and will not be able to message you.
                The vendor will not be notified — our team will be alerted to ensure your safety.
                This action cannot be undone.
              </p>
              <form
                method="post"
                action={`/wedding/${weddingId}/vendor/${vendorProfileId}/remove`}
                onsubmit="return confirm('Are you sure you want to remove this vendor? This cannot be undone.')"
              >
                <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                <input type="hidden" name="confirm" value="yes" />
                <button
                  type="submit"
                  class="text-sm font-bold text-grapefruit-700 border border-grapefruit-300 rounded-xl px-4 py-2 hover:bg-grapefruit-50 transition-colors"
                >
                  Remove {vendorMember.business_name}
                </button>
              </form>
            </div>
          </section>
        )}
      </div>
    </CoupleLayout>
  )
})

// ─── Update notes for platform vendor ───

couple.post('/wedding/:id/vendor/:vendorProfileId/notes', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const weddingId = c.req.param('id')
  const vendorProfileId = c.req.param('vendorProfileId')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || membership.role !== 'couple') return c.text('Forbidden', 403)

  const body = await c.req.parseBody()
  const notes = typeof body.notes === 'string' ? body.notes.trim() : null
  const priceStr = typeof body.expected_price === 'string' ? body.expected_price.trim() : ''
  const expected_price_cents = priceStr ? Math.round(parseFloat(priceStr) * 100) : null

  const coupleVendor = await getCoupleVendorByProfileId(c.env.DB, weddingId, vendorProfileId)
  if (coupleVendor) {
    await updateCoupleVendor(c.env.DB, weddingId, coupleVendor.id, {
      notes: notes || null,
      expected_price_cents,
    })
  }

  return c.redirect(`/wedding/${weddingId}/vendor/${vendorProfileId}`)
})

export default couple

// ─── Components ───

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    paid: 'bg-horizon-100 text-horizon-700',
    partial: 'bg-papaya-200 text-gray-700',
    sent: 'bg-gray-100 text-gray-600',
    overdue: 'bg-grapefruit-100 text-grapefruit-700',
    cancelled: 'bg-gray-100 text-gray-400',
  }
  return (
    <span class={`text-xs font-bold px-2.5 py-1 rounded-full ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function VendorStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    considering: 'bg-gray-100 text-gray-600',
    contacted: 'bg-horizon-50 text-horizon-700',
    booked: 'bg-green-50 text-green-700',
  }
  return (
    <span class={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function CoupleVendorForm({ action, csrfToken, vendor, submitLabel }: {
  action: string
  csrfToken: string
  vendor?: CoupleVendor
  submitLabel: string
}) {
  return (
    <form method="post" action={action} class="space-y-4">
      <input type="hidden" name="_csrf" value={csrfToken} />

      <div>
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="name">Business name *</label>
        <input
          type="text"
          id="name"
          name="name"
          required
          value={vendor?.name ?? ''}
          class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          placeholder="e.g. Bay Blooms Florist"
        />
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1.5" for="category">Category</label>
          <select
            id="category"
            name="category"
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent bg-white"
          >
            <option value="">Select...</option>
            {COUPLE_VENDOR_CATEGORIES.map((cat) => (
              <option value={cat} selected={vendor?.category === cat}>
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1.5" for="status">Status</label>
          <select
            id="status"
            name="status"
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent bg-white"
          >
            <option value="considering" selected={!vendor || vendor.status === 'considering'}>Considering</option>
            <option value="contacted" selected={vendor?.status === 'contacted'}>Contacted</option>
            <option value="booked" selected={vendor?.status === 'booked'}>Booked</option>
          </select>
        </div>
      </div>

      <div>
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="expected_price">Expected price ($)</label>
        <input
          type="number"
          id="expected_price"
          name="expected_price"
          step="0.01"
          min="0"
          value={vendor?.expected_price_cents ? (vendor.expected_price_cents / 100).toFixed(2) : ''}
          class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          placeholder="0.00"
        />
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1.5" for="email">Email</label>
          <input
            type="email"
            id="email"
            name="email"
            value={vendor?.email ?? ''}
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            placeholder="vendor@example.com"
          />
        </div>
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1.5" for="phone">Phone</label>
          <input
            type="tel"
            id="phone"
            name="phone"
            value={vendor?.phone ?? ''}
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            placeholder="04XX XXX XXX"
          />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1.5" for="website">Website</label>
          <input
            type="url"
            id="website"
            name="website"
            value={vendor?.website ?? ''}
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            placeholder="https://..."
          />
        </div>
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1.5" for="instagram">Instagram</label>
          <input
            type="text"
            id="instagram"
            name="instagram"
            value={vendor?.instagram ?? ''}
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            placeholder="@handle"
          />
        </div>
      </div>

      <div>
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="notes">Notes</label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          placeholder="Your notes about this vendor..."
        >{vendor?.notes ?? ''}</textarea>
      </div>

      <button
        type="submit"
        class="w-full bg-horizon-600 text-white py-3 px-4 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
      >
        {submitLabel}
      </button>
    </form>
  )
}

// ─── Layout ───

type LayoutProps = PropsWithChildren<{
  title?: string
  user: User
  wedding: Wedding
  csrfToken: string
}>

const CoupleLayout: FC<LayoutProps> = ({ title, user, wedding, csrfToken, children }) => (
  <html lang="en">
    <head>
      <SharedHead title={title} />
      <meta name="csrf-token" content={csrfToken} />
    </head>
    <body class="bg-papaya-50 text-gray-900 antialiased font-sans">
      <header class="bg-grapefruit-700 px-4 sm:px-8 py-4">
        <div class="max-w-3xl mx-auto flex items-center justify-between">
          <a href={`/wedding/${wedding.id}`} class="flex items-center gap-2 text-lg font-bold tracking-tight text-papaya">
            <Logo class="w-6 h-6" />
            Wedding Computer
          </a>
          <div class="flex items-center gap-3">
            <span class="text-sm font-medium text-papaya-200">{user.name}</span>
            <form method="post" action="/logout" class="flex items-center m-0">
              <input type="hidden" name="_csrf" value={csrfToken} />
              <button type="submit" class="text-sm font-medium text-papaya-200 hover:text-white transition-colors p-0 bg-transparent border-0 cursor-pointer">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main class="px-4 py-6 sm:px-8 sm:py-8">{children}</main>
    </body>
  </html>
)
