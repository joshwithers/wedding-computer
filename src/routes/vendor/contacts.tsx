import { Hono, type Context } from 'hono'
import type { Env, Contact, Bindings, VendorProfile } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import {
  listContacts,
  getContact,
  getContactCached,
  createContact,
  updateContact,
  updateContactStatus,
  deleteContact,
  countContactsByStatus,
} from '../../storage/contacts'
import { getStorageWithSecrets } from '../../storage'
import type { StorageBackend } from '../../storage/types'
import { needsMigration, repairContacts } from '../../storage/migrate'
import { listActivities, createActivity } from '../../db/activities'
import { resolveDemandView, type DemandView, type DemandHistoryContext } from '../../db/busyness'
import { geocodeContactLocation } from '../../services/geocode'
import type { BusynessScore } from '../../types'
import { isProVendor } from '../../db/subscriptions'
import { describeDemand, formatVsAverage, MONTH_NAMES, SEASON_LABELS, ordinal } from '../../lib/busyness'
import { requireString, trimOrNull, sanitize } from '../../lib/validation'
import { ENQUIRY_SOURCES, normalizeSource, sourceLabel } from '../../lib/sources'
import { formatDate } from '../../lib/date'
import { t } from '../../i18n'
import { socialUrl, socialDisplay } from '../../lib/social'
import { CopyButton } from '../../views/icons'
import { draftEmail } from '../../services/ai'
import { sendEmailMessage } from '../../services/email'
import { auditLog } from '../../middleware/audit'
import { track } from '../../services/analytics'
import { resolveSecret } from '../../services/secrets'
import { LOST_REASONS, isLostReason } from '../../services/wedding-lifecycle'
import { safeErrorMessage } from '../../lib/redaction'

const STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'booked', label: 'Booked' },
  { value: 'completed', label: 'Completed' },
  { value: 'lost', label: 'Lost' },
  { value: 'archived', label: 'Archived' },
]

const CONTACT_MIGRATION_CLEAR_TTL = 60 * 60 * 6

function contactMigrationClearKey(vendorId: string): string {
  return `contacts:migration-clear:${vendorId}`
}

function markContactsMigrationClear(c: Context<Env>, vendorId: string) {
  c.executionCtx.waitUntil(
    c.env.KV
      .put(contactMigrationClearKey(vendorId), '1', { expirationTtl: CONTACT_MIGRATION_CLEAR_TTL })
      .catch((err) => console.error('[contacts] failed to cache migration-clear flag:', err))
  )
}

async function ensureContactsIndexed(
  c: Context<Env>,
  vendor: VendorProfile,
  storage?: StorageBackend | null
): Promise<StorageBackend | null> {
  if ((await c.env.KV.get(contactMigrationClearKey(vendor.id))) === '1') return storage ?? null
  if (!(await needsMigration(c.env.DB, vendor.id))) {
    markContactsMigrationClear(c, vendor.id)
    return storage ?? null
  }

  const resolvedStorage = storage ?? await tryGetStorage(c.env, vendor)
  if (!resolvedStorage) {
    console.error('[contacts] R2 unavailable, skipping lazy migration')
    return null
  }

  const migrationResult = await repairContacts(resolvedStorage, c.env.DB, vendor.id)
  console.log(
    `[migrate] Vendor ${vendor.id}: migrated ${migrationResult.migrated}, rewritten ${migrationResult.rewritten}, skipped ${migrationResult.skipped}, errors ${migrationResult.errors}`
  )
  if (migrationResult.errors === 0) markContactsMigrationClear(c, vendor.id)
  return resolvedStorage
}

function lostReasonForm(contactId: string) {
  return (
    <form
      class="mt-3 bg-grapefruit-50 border border-grapefruit-200 rounded-xl p-4 space-y-3"
      hx-post={`/app/contacts/${contactId}/status`}
      hx-target="#status-buttons"
      hx-swap="outerHTML"
    >
      <input type="hidden" name="status" value="lost" />
      <div>
        <label class="block text-xs font-bold text-gray-700 mb-1.5">{t('contacts.lost.reason')}</label>
        <select name="lost_reason" class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-grapefruit-500">
          <option value="">{t('contacts.lost.reasonPrompt')}</option>
          {LOST_REASONS.map((r) => (
            <option value={r}>{t(`lifecycle.lost.${r}` as any)}</option>
          ))}
        </select>
      </div>
      <textarea
        name="lost_note"
        placeholder={t('contacts.lost.notePlaceholder')}
        rows={2}
        class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-grapefruit-500"
      />
      <div class="flex items-center gap-3">
        <button type="submit" class="bg-grapefruit-600 text-white rounded-xl px-3 py-1.5 text-sm font-bold hover:bg-grapefruit-700 transition-colors">
          {t('contacts.lost.confirm')}
        </button>
        <button
          type="button"
          class="text-sm text-gray-500 hover:text-gray-700"
          onclick="document.getElementById('lost-reason-form').innerHTML=''"
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}

function statusButtons(contactId: string, activeStatus: string) {
  return (
    <div id="status-buttons">
      <div class="flex flex-wrap gap-2">
        {STATUSES.map((s) => {
          const isActive = activeStatus === s.value
          const cls = `px-3 py-1 rounded-full text-xs font-medium border ${
            isActive
              ? 'bg-horizon-600 text-white border-horizon-600'
              : 'bg-white text-gray-600 border-gray-200 hover:bg-papaya-50'
          }`
          if (s.value === 'lost') {
            return (
              <button
                hx-get={`/app/contacts/${contactId}/status/lost-form`}
                hx-target="#lost-reason-form"
                hx-swap="innerHTML"
                class={cls}
              >
                {s.label}
              </button>
            )
          }
          return (
            <button
              hx-post={`/app/contacts/${contactId}/status`}
              hx-vals={JSON.stringify({ status: s.value })}
              hx-target="#status-buttons"
              hx-swap="outerHTML"
              class={cls}
            >
              {s.label}
            </button>
          )
        })}
      </div>
      <div id="lost-reason-form" />
    </div>
  )
}

// ─── Storage fallback helpers ───

/**
 * Try to get the storage backend for a vendor.
 * Returns null instead of throwing if R2 is unavailable.
 */
async function tryGetStorage(env: Bindings, vendor: VendorProfile): Promise<StorageBackend | null> {
  try {
    return await getStorageWithSecrets(env, vendor)
  } catch {
    return null
  }
}

/**
 * Fallback: list contacts from the old D1 `contacts` table
 * when the file_index table is empty or missing.
 */
async function listContactsFallback(
  db: D1Database,
  vendorId: string,
  filters?: { status?: string; search?: string }
): Promise<Contact[]> {
  let query = 'SELECT * FROM contacts WHERE vendor_id = ?'
  const params: unknown[] = [vendorId]
  if (filters?.status) {
    query += ' AND status = ?'
    params.push(filters.status)
  }
  if (filters?.search) {
    query += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)'
    const term = `%${filters.search}%`
    params.push(term, term, term)
  }
  query += ' ORDER BY created_at DESC LIMIT 500'
  return db.prepare(query).bind(...params).all<Contact>().then((r) => r.results)
}

/**
 * Fallback: count contacts by status from the old D1 `contacts` table.
 */
async function countContactsFallback(
  db: D1Database,
  vendorId: string
): Promise<Record<string, number>> {
  const rows = await db
    .prepare(
      'SELECT status, COUNT(*) as count FROM contacts WHERE vendor_id = ? GROUP BY status'
    )
    .bind(vendorId)
    .all<{ status: string; count: number }>()
  const counts: Record<string, number> = {}
  for (const row of rows.results) counts[row.status] = row.count
  return counts
}

/**
 * Fallback: get a single contact from the old D1 `contacts` table.
 */
async function getContactFallback(
  db: D1Database,
  vendorId: string,
  contactId: string
): Promise<Contact | null> {
  return db
    .prepare('SELECT * FROM contacts WHERE id = ? AND vendor_id = ?')
    .bind(contactId, vendorId)
    .first<Contact>()
}

const contacts = new Hono<Env>()

contacts.use('/app/*', requireAuth, csrf, requireVendor)

// ─── Contact list ───
contacts.get('/app/contacts', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!

  try {
    // Lazy migration is retained for any straggler vendors, but a KV guard keeps
    // clean vendors from paying the migration check on every contacts request.
    try {
      await ensureContactsIndexed(c, vendor)
    } catch (err) {
      console.error(`[migrate] Lazy migration failed for vendor ${vendor.id}:`, err)
    }

    const status = c.req.query('status') ?? undefined
    const search = c.req.query('search') ?? undefined

    // Try file_index queries first, fall back to old contacts table
    let items: Contact[]
    let counts: Record<string, number>
    try {
      ;[items, counts] = await Promise.all([
        listContacts(c.env.DB, vendor.id, { status, search }),
        countContactsByStatus(c.env.DB, vendor.id),
      ])
    } catch (err) {
      console.error('[contacts] file_index query failed, using D1 fallback:', err)
      ;[items, counts] = await Promise.all([
        listContactsFallback(c.env.DB, vendor.id, { status, search }),
        countContactsFallback(c.env.DB, vendor.id),
      ])
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0)

    if (c.req.header('hx-request')) {
      return c.html(<ContactTable contacts={items} csrfToken={c.get('csrfToken')} />)
    }

    return c.html(
      <AppLayout title="Contacts" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
        <div class="max-w-5xl">
          {/* Header */}
          <div class="flex items-center justify-between gap-4 mb-6">
            <div>
              <p class="text-sm text-gray-500">{total} contact{total !== 1 ? 's' : ''}</p>
            </div>
            <a
              href="/app/contacts/new"
              class="bg-horizon-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Add contact
            </a>
          </div>

          {/* Search */}
          <div class="mb-4">
            <form method="get" action="/app/contacts" class="flex gap-2">
              {status && <input type="hidden" name="status" value={status} />}
              <input
                type="text"
                name="search"
                value={search ?? ''}
                placeholder="Search contacts..."
                class="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
              <button type="submit" class="bg-papaya-200 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-papaya-300 transition-colors">
                Search
              </button>
              {search && (
                <a href={`/app/contacts${status ? `?status=${status}` : ''}`} class="px-4 py-2 text-sm text-gray-600 hover:text-horizon-700">
                  Clear
                </a>
              )}
            </form>
          </div>

          {/* Status tabs */}
          <div class="flex gap-1 mb-4 border-b border-papaya-300/30 overflow-x-auto">
            <StatusTab href="/app/contacts" label="All" count={total} active={!status} search={search} />
            {STATUSES.map((s) => (
              <StatusTab
                href={`/app/contacts?status=${s.value}${search ? `&search=${search}` : ''}`}
                label={s.label}
                count={counts[s.value] ?? 0}
                active={status === s.value}
                search={search}
              />
            ))}
          </div>

          {/* Table */}
          <div id="contacts-table">
            <ContactTable contacts={items} csrfToken={c.get('csrfToken')} />
          </div>
        </div>
      </AppLayout>
    )
  } catch (err) {
    console.error('[contacts] Unhandled error in contact list:', err)
    return c.html(
      <AppLayout title="Contacts" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
        <div class="max-w-5xl">
          <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-4">
            <p class="font-bold mb-1">Something went wrong loading contacts</p>
            <p>Please try refreshing the page. If the problem persists, contact support.</p>
          </div>
        </div>
      </AppLayout>,
      500
    )
  }
})

// ─── New contact form ───
contacts.get('/app/contacts/new', (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  return c.html(
    <AppLayout title="New contact" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        <ContactForm action="/app/contacts/new" csrfToken={c.get('csrfToken')} />
      </div>
    </AppLayout>
  )
})

contacts.post('/app/contacts/new', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()
  try {
    const firstName = requireString(body.first_name, 'First name')
    const lastName = requireString(body.last_name, 'Last name')

    const contactData = {
      first_name: firstName,
      last_name: lastName,
      email: trimOrNull(body.email),
      phone: trimOrNull(body.phone),
      partner_first_name: trimOrNull(body.partner_first_name),
      partner_last_name: trimOrNull(body.partner_last_name),
      partner_email: trimOrNull(body.partner_email),
      partner_phone: trimOrNull(body.partner_phone),
      address: trimOrNull(body.address),
      instagram: trimOrNull(body.instagram),
      facebook: trimOrNull(body.facebook),
      tiktok: trimOrNull(body.tiktok),
      website: trimOrNull(body.website),
      source: trimOrNull(body.source),
      wedding_date: trimOrNull(body.wedding_date),
      wedding_location: trimOrNull(body.wedding_location),
      notes: trimOrNull(body.notes),
    }

    const storage = await getStorageWithSecrets(c.env, vendor)
    const contact = await createContact(storage, c.env.DB, vendor.id, contactData)

    await createActivity(c.env.DB, contact.id, 'note', 'Contact created')
    track(c.env.DB, vendor.id, 'contact_created', { contactId: contact.id })
    c.executionCtx.waitUntil(
      geocodeContactLocation(c.env, contact.id).catch((err) => console.error('[contacts] geocode failed:', err))
    )
    return c.redirect(`/app/contacts/${contact.id}`)
  } catch (e: any) {
    console.error('[contacts] Error creating contact:', e)
    return c.redirect(`/app/contacts/new?error=${encodeURIComponent(safeErrorMessage(e))}`)
  }
})

// ─── Contact detail ───
contacts.get('/app/contacts/:id', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!

  try {
    let contact: Contact | null = null

    // Fast path: the D1 index holds the full contact — no storage round-trip.
    const cached = await getContactCached(c.env.DB, vendor.id, c.req.param('id'))
    if (cached) contact = cached.contact

    // Storage-backed read (authoritative) only when the cache can't serve it.
    if (!contact) {
      const storage = await tryGetStorage(c.env, vendor)
      if (storage) {
        try {
          const result = await getContact(storage, c.env.DB, vendor.id, c.req.param('id'))
          if (result) contact = result.contact
        } catch (err) {
          console.error('[contacts] getContact from storage failed:', err)
        }
      }
    }

    // Fallback to old D1 contacts table
    if (!contact) {
      contact = await getContactFallback(c.env.DB, vendor.id, c.req.param('id'))
    }

    if (!contact) return c.text('Contact not found', 404)

    // Date demand for the contact's wedding date (only meaningful for an
    // upcoming date): relative score plus year-on-year history for the
    // matching weekend, month, and season, at the most location-specific
    // level with data. The card's pills re-fetch at other levels.
    const today = new Date().toISOString().slice(0, 10)
    const demandViewPromise: Promise<DemandView | null> =
      contact.wedding_date && contact.wedding_date >= today
        ? resolveDemandView(c.env.DB, contact.wedding_date, vendor).catch((err) => {
            console.error('[contacts] demand lookup failed:', err)
            return null
          })
        : Promise.resolve(null)
    const [activities, bookingFormRows, isPro, demandView] = await Promise.all([
      listActivities(c.env.DB, contact.id),
      c.env.DB
        .prepare(
          'SELECT title, booking_form_data FROM invoices WHERE vendor_id = ? AND contact_id = ? AND booking_form_data IS NOT NULL'
        )
        .bind(vendor.id, contact.id)
        .all<{ title: string; booking_form_data: string }>()
        .then((r) => r.results),
      isProVendor(c.env.DB, vendor.id),
      demandViewPromise,
    ])

    const error = c.req.query('error')

    return c.html(
      <AppLayout title={`${contact.first_name} ${contact.last_name}`} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
        <div class="max-w-3xl">
          {error && (
            <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-3 mb-6">
              {decodeURIComponent(error)}
            </div>
          )}
          {/* Header */}
          <div class="flex items-start justify-between mb-6">
            <div>
              <p class="text-sm text-gray-500 mb-1">
                <a href="/app/contacts" class="hover:text-horizon-700">Contacts</a> /
              </p>
              <h2 class="text-xl font-bold">{contact.first_name} {contact.last_name}</h2>
              {contact.partner_first_name && (
                <p class="text-sm text-gray-600">
                  &amp; {contact.partner_first_name} {contact.partner_last_name}
                </p>
              )}
            </div>
            <div class="flex gap-2 flex-wrap">
              {!contact.wedding_id && (
                <a
                  href={`/app/contacts/${contact.id}/promote`}
                  class="bg-horizon-600 text-white px-3 py-1.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
                >
                  Create wedding
                </a>
              )}
              {contact.email && (
                isPro ? (
                  <a
                    href={`/app/contacts/${contact.id}/email`}
                    class="border border-horizon-600 text-horizon-600 px-3 py-1.5 rounded-xl text-sm font-bold hover:bg-horizon-50 transition-colors"
                  >
                    Draft email
                  </a>
                ) : (
                  <a
                    href="/app/subscription"
                    title="AI email drafting is a Pro feature"
                    class="border border-gray-200 text-gray-500 px-3 py-1.5 rounded-xl text-sm font-bold hover:bg-papaya-50 transition-colors"
                  >
                    Draft email{' '}
                    <span class="ml-1 align-middle inline-block bg-horizon-100 text-horizon-700 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded">Pro</span>
                  </a>
                )
              )}
              <a
                href={`/app/contacts/${contact.id}/edit`}
                class="border border-gray-200 px-3 py-1.5 rounded-xl text-sm hover:bg-papaya-50"
              >
                Edit
              </a>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
            {/* Main info */}
            <div class="lg:col-span-2 space-y-6">
              {/* Status */}
              <div class="bg-white border border-papaya-300/30 rounded-2xl p-4">
                <h3 class="text-sm font-bold text-gray-500 mb-3">Status</h3>
                {statusButtons(contact.id, contact.status)}
              </div>

              {/* Activity log */}
              <div class="bg-white border border-papaya-300/30 rounded-2xl p-4">
                <h3 class="text-sm font-bold text-gray-500 mb-3">Activity</h3>
                {/* Add note form */}
                <form
                  hx-post={`/app/contacts/${contact.id}/notes`}
                  hx-target="#activity-list"
                  hx-swap="afterbegin"
                  hx-on--after-request="this.reset()"
                  class="mb-4"
                >
                  <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                  <div class="flex gap-2">
                    <input
                      type="text"
                      name="note"
                      placeholder="Add a note..."
                      required
                      class="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                    />
                    <button
                      type="submit"
                      class="bg-horizon-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </form>
                <div id="activity-list" class="space-y-3">
                  {activities.length === 0 ? (
                    <p class="text-sm text-gray-400">No activity yet</p>
                  ) : (
                    activities.map((a) => (
                      <div class="flex items-start gap-3 text-sm">
                        <div class="w-2 h-2 mt-1.5 rounded-full bg-gray-300 flex-shrink-0" />
                        <div class="flex-1">
                          <p class="text-gray-700">{a.summary}</p>
                          <p class="text-xs text-gray-400 mt-0.5">{formatDate(a.created_at)}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div class="space-y-4">
              <DetailCard label="Email" value={contact.email} href={contact.email ? `mailto:${contact.email}` : undefined} copy={contact.email} />
              <DetailCard label="Phone" value={contact.phone} href={contact.phone ? `tel:${contact.phone}` : undefined} copy={contact.phone} />
              {contact.partner_email && <DetailCard label="Partner email" value={contact.partner_email} href={`mailto:${contact.partner_email}`} copy={contact.partner_email} />}
              {contact.partner_phone && <DetailCard label="Partner phone" value={contact.partner_phone} href={`tel:${contact.partner_phone}`} copy={contact.partner_phone} />}
              <DetailCard label="Address" value={contact.address} />
              <DetailCard label="Instagram" value={contact.instagram ? socialDisplay(contact.instagram) : null} href={socialUrl('instagram', contact.instagram)} />
              <DetailCard label="Facebook" value={contact.facebook ? socialDisplay(contact.facebook) : null} href={socialUrl('facebook', contact.facebook)} />
              <DetailCard label="TikTok" value={contact.tiktok ? socialDisplay(contact.tiktok) : null} href={socialUrl('tiktok', contact.tiktok)} />
              <DetailCard label="Website" value={contact.website} href={socialUrl('website', contact.website)} />
              <DetailCard label="Wedding date" value={contact.wedding_date ? formatDate(contact.wedding_date) : null} />
              {contact.wedding_date && contact.wedding_date >= today && demandView && (
                <DemandCard contactId={contact.id} view={demandView} />
              )}
              <DetailCard label="Wedding location" value={contact.wedding_location} />
              <DetailCard label="Source" value={contact.source ? sourceLabel(normalizeSource(contact.source)) : null} />
              <DetailCard label="Added" value={formatDate(contact.created_at)} />
              <FormDataSection label="Enquiry form" data={contact.form_data} />
              {bookingFormRows.map((row) => (
                <FormDataSection label={`Booking form — ${row.title}`} data={row.booking_form_data} />
              ))}
            </div>
          </div>
        </div>
      </AppLayout>
    )
  } catch (err) {
    console.error('[contacts] Unhandled error in contact detail:', err)
    return c.html(
      <AppLayout title="Contact" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
        <div class="max-w-3xl">
          <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-4">
            <p class="font-bold mb-1">Something went wrong loading this contact</p>
            <p>Please try refreshing the page. If the problem persists, contact support.</p>
          </div>
        </div>
      </AppLayout>,
      500
    )
  }
})

// ─── Edit contact ───
contacts.get('/app/contacts/:id/edit', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!

  try {
    let contact: Contact | null = null

    // Fast path: serve the edit form from the D1 index (no storage round-trip).
    const cached = await getContactCached(c.env.DB, vendor.id, c.req.param('id'))
    if (cached) contact = cached.contact

    if (!contact) {
      const storage = await tryGetStorage(c.env, vendor)
      if (storage) {
        try {
          const result = await getContact(storage, c.env.DB, vendor.id, c.req.param('id'))
          if (result) contact = result.contact
        } catch (err) {
          console.error('[contacts] getContact from storage failed for edit:', err)
        }
      }
    }

    if (!contact) {
      contact = await getContactFallback(c.env.DB, vendor.id, c.req.param('id'))
    }

    if (!contact) return c.text('Contact not found', 404)

    return c.html(
      <AppLayout title={`Edit ${contact.first_name}`} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
        <div class="max-w-xl">
          <p class="text-sm text-gray-500 mb-4">
            <a href={`/app/contacts/${contact.id}`} class="hover:text-horizon-700">
              {contact.first_name} {contact.last_name}
            </a> / Edit
          </p>
          <ContactForm
            action={`/app/contacts/${contact.id}/edit`}
            csrfToken={c.get('csrfToken')}
            contact={contact}
          />
          <form method="post" action={`/app/contacts/${contact.id}/delete`} class="mt-8 pt-6 border-t border-papaya-300/30">
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <button
              type="submit"
              onclick="return confirm('Delete this contact? This cannot be undone.')"
              class="text-sm text-grapefruit-700 hover:text-grapefruit-600"
            >
              Delete contact
            </button>
          </form>
        </div>
      </AppLayout>
    )
  } catch (err) {
    console.error('[contacts] Unhandled error in contact edit page:', err)
    return c.redirect(`/app/contacts/${c.req.param('id')}?error=${encodeURIComponent('Failed to load edit form')}`)
  }
})

contacts.post('/app/contacts/:id/edit', async (c) => {
  const vendor = c.get('vendor')!
  const contactId = c.req.param('id')
  const body = await c.req.parseBody()
  try {
    const firstName = requireString(body.first_name, 'First name')
    const lastName = requireString(body.last_name, 'Last name')

    const updateData = {
      first_name: firstName,
      last_name: lastName,
      email: trimOrNull(body.email),
      phone: trimOrNull(body.phone),
      partner_first_name: trimOrNull(body.partner_first_name),
      partner_last_name: trimOrNull(body.partner_last_name),
      partner_email: trimOrNull(body.partner_email),
      partner_phone: trimOrNull(body.partner_phone),
      address: trimOrNull(body.address),
      instagram: trimOrNull(body.instagram),
      facebook: trimOrNull(body.facebook),
      tiktok: trimOrNull(body.tiktok),
      website: trimOrNull(body.website),
      source: trimOrNull(body.source),
      wedding_date: trimOrNull(body.wedding_date),
      wedding_location: trimOrNull(body.wedding_location),
      notes: trimOrNull(body.notes),
    }

    const storage = await getStorageWithSecrets(c.env, vendor)
    await ensureContactsIndexed(c, vendor, storage)
    await updateContact(storage, c.env.DB, vendor.id, contactId, updateData)

    c.executionCtx.waitUntil(
      geocodeContactLocation(c.env, contactId).catch((err) => console.error('[contacts] geocode failed:', err))
    )
    return c.redirect(`/app/contacts/${contactId}`)
  } catch (e: any) {
    console.error('[contacts] Error updating contact:', e)
    return c.redirect(`/app/contacts/${contactId}/edit?error=${encodeURIComponent(safeErrorMessage(e))}`)
  }
})

// ─── Status update (htmx) ───
// htmx partial: the Date demand card re-rendered at a requested locality
// level (city/state/country/global pills).
contacts.get('/app/contacts/:id/demand', async (c) => {
  const vendor = c.get('vendor')
  if (!vendor) return c.text('Not found', 404)
  const contactId = c.req.param('id')

  let contact: Contact | null = null
  const cached = await getContactCached(c.env.DB, vendor.id, contactId)
  if (cached) contact = cached.contact
  const storage = contact ? null : await tryGetStorage(c.env, vendor)
  if (!contact && storage) {
    try {
      const result = await getContact(storage, c.env.DB, vendor.id, contactId)
      if (result) contact = result.contact
    } catch (err) {
      console.error('[contacts] getContact for demand card failed:', err)
    }
  }
  if (!contact) contact = await getContactFallback(c.env.DB, vendor.id, contactId)
  if (!contact?.wedding_date) return c.text('Not found', 404)

  const requested = c.req.query('level')
  const level = (['city', 'state', 'country', 'global'] as const).find((l) => l === requested) as
    | BusynessScore['level']
    | undefined

  const view = await resolveDemandView(c.env.DB, contact.wedding_date, vendor, level)
  return c.html(<DemandCard contactId={contactId} view={view} />)
})

contacts.get('/app/contacts/:id/status/lost-form', async (c) => {
  const vendor = c.get('vendor')!
  const contactId = c.req.param('id')
  return c.html(lostReasonForm(contactId))
})

contacts.post('/app/contacts/:id/status', async (c) => {
  const vendor = c.get('vendor')!
  const contactId = c.req.param('id')

  try {
    const body = await c.req.parseBody()
    const status = body.status as string

    // Load the contact to get the old status for the activity log
    let oldContact: Contact | null = null
    const cached = await getContactCached(c.env.DB, vendor.id, contactId)
    if (cached) oldContact = cached.contact
    const storage = await tryGetStorage(c.env, vendor)
    if (!oldContact && storage) {
      try {
        const result = await getContact(storage, c.env.DB, vendor.id, contactId)
        if (result) oldContact = result.contact
      } catch (err) {
        console.error('[contacts] getContact for status update failed:', err)
      }
    }
    if (!oldContact) {
      oldContact = await getContactFallback(c.env.DB, vendor.id, contactId)
    }
    if (!oldContact) return c.text('Not found', 404)

    const lostReason = status === 'lost' ? (body.lost_reason as string | undefined) ?? null : undefined
    const lostNote = status === 'lost' ? (body.lost_note as string | undefined) ?? null : undefined
    const lostOpts = lostReason !== undefined ? {
      lost_reason: lostReason && isLostReason(lostReason) ? lostReason : null,
      lost_note: lostNote || null,
    } : undefined

    // No-op: clicking the already-active status must not log an activity
    // or re-fire booking_confirmed (which would inflate analytics).
    // Exception: allow re-submitting 'lost' to update the reason.
    if (oldContact.status === status && status !== 'lost') {
      return c.html(statusButtons(contactId, status))
    }

    // Update status
    if (!storage) return c.text('Failed to update status', 500)
    await ensureContactsIndexed(c, vendor, storage)
    await updateContactStatus(storage, c.env.DB, vendor.id, contactId, status, lostOpts)

    await createActivity(
      c.env.DB,
      contactId,
      'status_change',
      `Status changed from ${oldContact.status} to ${status}`
    )
    track(c.env.DB, vendor.id, 'status_change', {
      contactId,
      metadata: { from: oldContact.status, to: status },
    })
    if (status === 'booked') {
      track(c.env.DB, vendor.id, 'booking_confirmed', { contactId })
    }

    // Render from the status we just wrote — re-reading through storage can
    // return a stale GitHub read-after-write and paint the old chip.
    return c.html(statusButtons(contactId, status))
  } catch (err) {
    console.error('[contacts] Unhandled error in status update:', err)
    return c.text('Failed to update status', 500)
  }
})

// ─── Add note (htmx) ───
contacts.post('/app/contacts/:id/notes', async (c) => {
  const vendor = c.get('vendor')!
  const contactId = c.req.param('id')

  try {
    // Verify the contact exists (try storage, fall back to D1)
    let contactExists = false
    const storage = await tryGetStorage(c.env, vendor)
    if (storage) {
      try {
        const result = await getContact(storage, c.env.DB, vendor.id, contactId)
        if (result) contactExists = true
      } catch (err) {
        console.error('[contacts] getContact for notes failed:', err)
      }
    }
    if (!contactExists) {
      const row = await getContactFallback(c.env.DB, vendor.id, contactId)
      contactExists = !!row
    }
    if (!contactExists) return c.text('Not found', 404)

    const body = await c.req.parseBody()
    const note = typeof body.note === 'string' ? body.note.trim() : ''
    if (!note) return c.text('Note is required', 400)

    await createActivity(c.env.DB, contactId, 'note', note)

    return c.html(
      <div class="flex items-start gap-3 text-sm">
        <div class="w-2 h-2 mt-1.5 rounded-full bg-gray-300 flex-shrink-0" />
        <div class="flex-1">
          <p class="text-gray-700">{note}</p>
          <p class="text-xs text-gray-400 mt-0.5">just now</p>
        </div>
      </div>
    )
  } catch (err) {
    console.error('[contacts] Unhandled error adding note:', err)
    return c.text('Failed to add note', 500)
  }
})

// ─── Delete contact ───
contacts.post('/app/contacts/:id/delete', async (c) => {
  const vendor = c.get('vendor')!
  const contactId = c.req.param('id')

  try {
    await auditLog(c, 'contact_deleted', 'contact', contactId).catch(() => {})

    const storage = await getStorageWithSecrets(c.env, vendor)
    await ensureContactsIndexed(c, vendor, storage)
    await deleteContact(storage, c.env.DB, vendor.id, contactId)

    return c.redirect('/app/contacts')
  } catch (err) {
    console.error('[contacts] Unhandled error deleting contact:', err)
    return c.redirect(`/app/contacts/${contactId}?error=${encodeURIComponent('Failed to delete contact')}`)
  }
})

// ─── AI Email Draft ───

contacts.get('/app/contacts/:id/email', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!

  // AI email drafting is a Pro feature.
  if (!(await isProVendor(c.env.DB, vendor.id))) {
    return c.redirect(`/app/contacts/${c.req.param('id')}?error=` + encodeURIComponent('AI email drafting requires a Pro subscription'))
  }

  try {
    let contact: Contact | null = null

    const storage = await tryGetStorage(c.env, vendor)
    if (storage) {
      try {
        const result = await getContact(storage, c.env.DB, vendor.id, c.req.param('id'))
        if (result) contact = result.contact
      } catch (err) {
        console.error('[contacts] getContact for email page failed:', err)
      }
    }

    if (!contact) {
      contact = await getContactFallback(c.env.DB, vendor.id, c.req.param('id'))
    }

    if (!contact) return c.text('Contact not found', 404)
    if (!contact.email) return c.redirect(`/app/contacts/${contact.id}`)

    const purpose = c.req.query('purpose') ?? 'Follow up on their enquiry'
    const draft = c.req.query('draft')
    const sent = c.req.query('sent')
    const error = c.req.query('error')

    return c.html(
      <AppLayout title={`Email ${contact.first_name}`} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
        <div class="max-w-2xl">
          <p class="text-sm text-gray-500 mb-4">
            <a href={`/app/contacts/${contact.id}`} class="hover:text-gray-900">
              {contact.first_name} {contact.last_name}
            </a>{' '}
            / Email
          </p>

          {sent && (
            <div class="bg-horizon-50 border border-horizon-600/20 text-horizon-700 text-sm font-bold rounded-xl p-3 mb-4">
              Email sent to {contact.email}
            </div>
          )}

          {error && (
            <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-3 mb-4">
              {decodeURIComponent(error)}
            </div>
          )}

          {/* Step 1: Choose purpose and generate draft */}
          {!draft && (
            <form method="post" action={`/app/contacts/${contact.id}/email/draft`} class="space-y-4">
              <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
              <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
                <h3 class="text-sm font-bold">What's this email about?</h3>
                <div>
                  <select name="purpose"
                    class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600">
                    <option value="Follow up on their enquiry" selected={purpose === 'Follow up on their enquiry'}>Follow up on enquiry</option>
                    <option value="Send a quote for my services" selected={purpose === 'Send a quote for my services'}>Send a quote</option>
                    <option value="Confirm their booking" selected={purpose === 'Confirm their booking'}>Confirm booking</option>
                    <option value="Check in with a progress update" selected={purpose === 'Check in with a progress update'}>Progress update</option>
                    <option value="Send a reminder about upcoming payment" selected={purpose === 'Send a reminder about upcoming payment'}>Payment reminder</option>
                    <option value="Thank them after the wedding" selected={purpose === 'Thank them after the wedding'}>Post-wedding thank you</option>
                  </select>
                </div>
                <button type="submit"
                  class="w-full bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
                  Generate draft
                </button>
              </div>
            </form>
          )}

          {/* Step 2: Preview and send */}
          {draft && (
            <form method="post" action={`/app/contacts/${contact.id}/email/send`} class="space-y-4">
              <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
              <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
                <h3 class="text-sm font-bold">Preview and edit</h3>
                <p class="text-xs text-gray-500">To: {contact.email}</p>
                <div>
                  <label class="block text-xs font-bold text-gray-700 mb-1">Subject</label>
                  <input type="text" name="subject" required
                    value={`Your enquiry with ${vendor.business_name}`}
                    class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
                </div>
                <div>
                  <label class="block text-xs font-bold text-gray-700 mb-1">Message</label>
                  <textarea name="body" rows={10} required
                    class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600">{decodeURIComponent(draft)}</textarea>
                </div>
              </div>
              <div class="flex gap-2">
                <button type="submit"
                  class="flex-1 bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
                  Send email
                </button>
                <a href={`/app/contacts/${contact.id}/email`}
                  class="border border-gray-200 py-3 px-6 rounded-xl text-sm hover:bg-papaya-50 transition-colors text-center">
                  Start over
                </a>
              </div>
            </form>
          )}
        </div>
      </AppLayout>
    )
  } catch (err) {
    console.error('[contacts] Unhandled error in email page:', err)
    return c.redirect(`/app/contacts/${c.req.param('id')}?error=${encodeURIComponent('Failed to load email page')}`)
  }
})

contacts.post('/app/contacts/:id/email/draft', async (c) => {
  const vendor = c.get('vendor')!
  const contactId = c.req.param('id')

  // AI email drafting is a Pro feature.
  if (!(await isProVendor(c.env.DB, vendor.id))) {
    return c.redirect(`/app/contacts/${contactId}?error=` + encodeURIComponent('AI email drafting requires a Pro subscription'))
  }

  try {
    let contact: Contact | null = null

    const storage = await tryGetStorage(c.env, vendor)
    if (storage) {
      try {
        const result = await getContact(storage, c.env.DB, vendor.id, contactId)
        if (result) contact = result.contact
      } catch (err) {
        console.error('[contacts] getContact for email draft failed:', err)
      }
    }

    if (!contact) {
      contact = await getContactFallback(c.env.DB, vendor.id, contactId)
    }

    if (!contact || !contact.email) return c.text('Not found', 404)

    const body = await c.req.parseBody()
    const purpose = String(body.purpose || 'Follow up on their enquiry')

    const anthropicKey = await resolveSecret(c.env.KV, vendor.anthropic_api_key)
    const draft = await draftEmail(
      c.env.AI,
      {
        vendorName: vendor.business_name,
        vendorCategory: vendor.category,
        contactName: `${contact.first_name} ${contact.last_name}`,
        contactEmail: contact.email,
        weddingDate: contact.wedding_date,
        weddingLocation: contact.wedding_location,
        status: contact.status,
        notes: contact.notes,
        purpose,
      },
      anthropicKey,
    )

    if (!draft.trim()) {
      return c.redirect(
        `/app/contacts/${contact.id}/email?error=${encodeURIComponent('The AI returned an empty draft. Please try again.')}`
      )
    }

    return c.redirect(
      `/app/contacts/${contact.id}/email?draft=${encodeURIComponent(draft)}`
    )
  } catch (e: any) {
    console.error('[contacts] Error generating email draft:', e)
    return c.redirect(
      `/app/contacts/${contactId}/email?error=${encodeURIComponent(safeErrorMessage(e))}`
    )
  }
})

contacts.post('/app/contacts/:id/email/send', async (c) => {
  const vendor = c.get('vendor')!
  const user = c.get('user')
  const contactId = c.req.param('id')

  // AI email drafting is a Pro feature.
  if (!(await isProVendor(c.env.DB, vendor.id))) {
    return c.redirect(`/app/contacts/${contactId}?error=` + encodeURIComponent('AI email drafting requires a Pro subscription'))
  }

  try {
    let contact: Contact | null = null

    const storage = await tryGetStorage(c.env, vendor)
    if (storage) {
      try {
        const result = await getContact(storage, c.env.DB, vendor.id, contactId)
        if (result) contact = result.contact
      } catch (err) {
        console.error('[contacts] getContact for email send failed:', err)
      }
    }

    if (!contact) {
      contact = await getContactFallback(c.env.DB, vendor.id, contactId)
    }

    if (!contact || !contact.email) return c.text('Not found', 404)

    const body = await c.req.parseBody()
    const subject = String(body.subject)
    const emailBody = String(body.body)

    const html = `<div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px;">
      ${emailBody
        .split('\n')
        .map((line: string) => (line.trim() ? `<p>${sanitize(line)}</p>` : ''))
        .join('')}
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #888; font-size: 13px;">
        ${sanitize(vendor.business_name)}<br/>
        ${vendor.phone ? sanitize(vendor.phone) + '<br/>' : ''}
        ${vendor.website ? sanitize(vendor.website) : ''}
      </p>
    </div>`

    await sendEmailMessage({
      db: c.env.DB,
      resendApiKey: c.env.RESEND_API_KEY,
      vendorId: vendor.id,
      contactId: contact.id,
      to: contact.email!,
      toName: `${contact.first_name} ${contact.last_name}`,
      subject,
      html,
      from: vendor.email_handle ? `${vendor.email_handle}@wedding.computer` : undefined,
      fromName: vendor.business_name,
      replyTo: vendor.email_handle ? `${vendor.email_handle}@wedding.computer` : user.email,
    })

    await createActivity(c.env.DB, contact.id, 'email_sent', `Sent: ${subject}`)
    await auditLog(c, 'email_sent', 'contact', contact.id, { to: contact.email }).catch(() => {})

    return c.redirect(`/app/contacts/${contact.id}/email?sent=1`)
  } catch (e: any) {
    console.error('[contacts] Error sending email:', e)
    return c.redirect(
      `/app/contacts/${contactId}/email?error=${encodeURIComponent(safeErrorMessage(e))}`
    )
  }
})

export default contacts

// ─── Components ───

function StatusTab({
  href,
  label,
  count,
  active,
  search,
}: {
  href: string
  label: string
  count: number
  active: boolean
  search?: string
}) {
  return (
    <a
      href={href}
      class={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${
        active
          ? 'border-horizon-600 text-horizon-700'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {label}
      {count > 0 && (
        <span class="ml-1.5 text-xs text-gray-400">{count}</span>
      )}
    </a>
  )
}

function ContactTable({ contacts, csrfToken }: { contacts: Contact[]; csrfToken: string }) {
  if (contacts.length === 0) {
    return (
      <div class="text-center py-12">
        <p class="text-gray-500 text-sm">No contacts yet</p>
        <a href="/app/contacts/new" class="text-sm text-horizon-700 font-bold hover:underline mt-2 inline-block">
          Add your first contact
        </a>
      </div>
    )
  }
  return (
    <div class="bg-white border border-papaya-300/30 rounded-2xl overflow-hidden">
      <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-papaya-50 border-b border-papaya-300/30">
          <tr>
            <th class="text-left px-4 py-3 font-medium text-gray-600">Name</th>
            <th class="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Email</th>
            <th class="text-left px-4 py-3 font-medium text-gray-600">Wedding date</th>
            <th class="text-left px-4 py-3 font-medium text-gray-600">Status</th>
            <th class="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Added</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          {contacts.map((contact) => (
            <tr class="hover:bg-papaya-50">
              <td class="px-4 py-3">
                <a href={`/app/contacts/${contact.id}`} class="font-bold text-gray-900 hover:underline">
                  {contact.first_name} {contact.last_name}
                </a>
                {contact.partner_first_name && (
                  <span class="text-gray-500"> &amp; {contact.partner_first_name}</span>
                )}
              </td>
              <td class="px-4 py-3 text-gray-600 hidden sm:table-cell">{contact.email ?? '—'}</td>
              <td class="px-4 py-3 text-gray-600">
                {contact.wedding_date ? formatDate(contact.wedding_date) : '—'}
              </td>
              <td class="px-4 py-3">
                <StatusBadge status={contact.status} />
              </td>
              <td class="px-4 py-3 text-gray-500 hidden sm:table-cell">{formatDate(contact.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    new: 'bg-horizon-50 text-horizon-700',
    contacted: 'bg-yellow-50 text-yellow-700',
    meeting: 'bg-purple-50 text-purple-700',
    quoted: 'bg-orange-50 text-orange-700',
    booked: 'bg-green-50 text-green-700',
    completed: 'bg-papaya-200 text-gray-700',
    lost: 'bg-grapefruit-50 text-grapefruit-700',
    archived: 'bg-gray-100 text-gray-500',
  }
  return (
    <span class={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function DetailCard({
  label,
  value,
  href,
  copy,
}: {
  label: string
  value: string | null | undefined
  href?: string
  copy?: string | null
}) {
  if (!value) return null
  return (
    <div class="bg-white border border-papaya-300/30 rounded-2xl px-4 py-3">
      <p class="text-xs text-gray-500 mb-0.5">{label}</p>
      <div class="flex items-center justify-between gap-2">
        {href ? (
          <a href={href} class="text-sm text-gray-900 hover:underline">{value}</a>
        ) : (
          <p class="text-sm text-gray-900">{value}</p>
        )}
        {copy && (
          <CopyButton value={copy} title="Copy" class="shrink-0 text-gray-400 hover:text-horizon-700" />
        )}
      </div>
    </div>
  )
}

function DemandCard({ contactId, view }: { contactId: string; view: DemandView }) {
  const d = describeDemand(view.score)
  const scope = view.level === 'global' ? 'across the platform' : `in ${view.levelValue}`

  return (
    <div class="bg-white border border-papaya-300/30 rounded-2xl px-4 py-3" id="demand-card">
      <div class="flex items-center justify-between mb-1.5">
        <p class="text-xs text-gray-500">Date demand</p>
        <a href="/app/analytics" class="text-xs text-gray-400 hover:text-horizon-700">Details</a>
      </div>
      <div class="flex items-center gap-2">
        <span class={`w-2.5 h-2.5 rounded-full shrink-0 ${d.dotClass}`} />
        <span class={`text-sm font-bold ${d.textClass}`}>{d.label}</span>
      </div>
      {view.score !== null ? (
        <p class="text-xs text-gray-400 mt-1.5">
          This date is {formatVsAverage(view.score, 'date')} {scope}
        </p>
      ) : (
        <p class="text-xs text-gray-400 mt-1.5">
          How sought-after this date is for enquiries and bookings {scope}. Updates daily.
        </p>
      )}
      {view.history && <DemandHistory history={view.history} />}
      {view.availableLevels.length > 1 && (
        <div class="mt-2.5 pt-2.5 border-t border-gray-100 flex flex-wrap gap-1.5">
          {view.availableLevels.map((o) => (
            <button
              hx-get={`/app/contacts/${contactId}/demand?level=${o.level}`}
              hx-target="#demand-card"
              hx-swap="outerHTML"
              class={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                o.level === view.level
                  ? 'bg-horizon-600 text-white border-horizon-600'
                  : 'bg-white text-gray-500 border-gray-200 hover:bg-papaya-50'
              }`}
            >
              {o.level === 'global' ? 'Global' : o.levelValue}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Year-on-year history for the recurring windows this date falls into — "3rd
// weekend of September", the month, the season. The underlying data is a
// cross-vendor aggregate, so each year shows only how that window compared to
// the average window of the same kind (never absolute volumes).
function DemandHistory({ history }: { history: DemandHistoryContext }) {
  const blocks: Array<{ label: string; noun: string; years: typeof history.month.years }> = []

  if (history.weekend && history.weekend.years.length > 0) {
    blocks.push({
      label: `${ordinal(history.weekend.index)} weekend of ${MONTH_NAMES[history.weekend.month - 1]}`,
      noun: 'weekend',
      years: history.weekend.years,
    })
  }
  if (history.month.years.length > 0) {
    blocks.push({ label: MONTH_NAMES[history.month.month - 1], noun: 'month', years: history.month.years })
  }
  if (history.season.years.length > 0) {
    blocks.push({
      label: SEASON_LABELS[history.season.season] ?? history.season.season,
      noun: 'season',
      years: history.season.years,
    })
  }
  if (blocks.length === 0) return null

  return (
    <div class="mt-2.5 pt-2.5 border-t border-gray-100 space-y-2">
      <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Past years</p>
      {blocks.map((b) => (
        <div>
          <p class="text-xs font-medium text-gray-600">{b.label}</p>
          {b.years.map((y) => (
            <p class="text-xs text-gray-400">
              {y.year}: {formatVsAverage(y.ratio, b.noun)}
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}

function FormDataSection({ label, data }: { label: string; data: string | null }) {
  if (!data) return null
  let parsed: Record<string, string>
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  const entries = Object.entries(parsed)
  if (entries.length === 0) return null

  return (
    <div class="bg-white border border-papaya-300/30 rounded-2xl px-4 py-3">
      <p class="text-xs text-gray-500 font-bold mb-2">{label}</p>
      <div class="space-y-1.5">
        {entries.map(([key, val]) => (
          <div>
            <p class="text-xs text-gray-400">{key}</p>
            <p class="text-sm text-gray-900">{val}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ContactForm({
  action,
  csrfToken,
  contact,
}: {
  action: string
  csrfToken: string
  contact?: Contact
}) {
  return (
    <form method="post" action={action} class="space-y-6">
      <input type="hidden" name="_csrf" value={csrfToken} />

      <section>
        <h3 class="text-sm font-bold text-gray-900 mb-3">Contact details</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="First name" name="first_name" value={contact?.first_name} required />
          <FormField label="Last name" name="last_name" value={contact?.last_name} required />
          <FormField label="Email" name="email" value={contact?.email} type="email" />
          <FormField label="Phone" name="phone" value={contact?.phone} type="tel" />
        </div>
      </section>

      <section>
        <h3 class="text-sm font-bold text-gray-900 mb-3">Partner details</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="First name" name="partner_first_name" value={contact?.partner_first_name} />
          <FormField label="Last name" name="partner_last_name" value={contact?.partner_last_name} />
          <FormField label="Email" name="partner_email" value={contact?.partner_email} type="email" />
          <FormField label="Phone" name="partner_phone" value={contact?.partner_phone} type="tel" />
        </div>
      </section>

      <section>
        <h3 class="text-sm font-bold text-gray-900 mb-3">Address &amp; social</h3>
        <div class="space-y-4">
          <FormField label="Address" name="address" value={contact?.address} placeholder="Street, city, state, postcode" />
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Instagram" name="instagram" value={contact?.instagram} placeholder="@handle or profile URL" />
            <FormField label="Facebook" name="facebook" value={contact?.facebook} placeholder="Profile URL" />
            <FormField label="TikTok" name="tiktok" value={contact?.tiktok} placeholder="@handle or profile URL" />
            <FormField label="Website" name="website" value={contact?.website} type="url" placeholder="https://" />
          </div>
        </div>
      </section>

      <section>
        <h3 class="text-sm font-bold text-gray-900 mb-3">Wedding</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Date" name="wedding_date" value={contact?.wedding_date} type="date" />
          {/* Google Places autocomplete (regions) so wedding locations are
              canonical — the saved text is geocoded into structured
              city/state/country for the demand data. */}
          <div class="relative" data-places>
            <label class="block text-sm font-bold text-gray-700 mb-1.5" for="wedding_location">Location</label>
            <input
              type="text"
              id="wedding_location"
              name="wedding_location"
              value={contact?.wedding_location ?? ''}
              autocomplete="off"
              hx-get="/api/places/search?field=wedding_location&mode=region"
              hx-trigger="input changed delay:300ms"
              hx-target="#suggestions-wedding_location"
              hx-swap="innerHTML"
              hx-include="this"
              class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            />
            <div id="suggestions-wedding_location" />
          </div>
        </div>
      </section>

      <section>
        <h3 class="text-sm font-bold text-gray-900 mb-3">Other</h3>
        <div class="space-y-4">
          <FormField label="Source" name="source" value={contact?.source} placeholder="e.g. Instagram, referral, website" list="source-options" />
          <datalist id="source-options">
            {ENQUIRY_SOURCES.map((s) => (
              <option value={s.label} />
            ))}
          </datalist>
          <div>
            <label class="block text-sm font-bold text-gray-700 mb-1.5" for="notes">Notes</label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            >{contact?.notes ?? ''}</textarea>
          </div>
        </div>
      </section>

      <button
        type="submit"
        class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
      >
        {contact ? 'Save changes' : 'Create contact'}
      </button>
    </form>
  )
}

function FormField({
  label,
  name,
  value,
  type = 'text',
  required = false,
  placeholder,
  list,
}: {
  label: string
  name: string
  value?: string | null
  type?: string
  required?: boolean
  placeholder?: string
  list?: string
}) {
  return (
    <div>
      <label class="block text-sm font-bold text-gray-700 mb-1.5" for={name}>{label}</label>
      <input
        type={type}
        id={name}
        name={name}
        value={value ?? ''}
        required={required}
        placeholder={placeholder}
        list={list}
        class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
      />
    </div>
  )
}
