import { Hono } from 'hono'
import type { Env, Contact } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import {
  listContacts,
  getContact,
  createContact,
  updateContact,
  updateContactStatus,
  deleteContact,
  countContactsByStatus,
} from '../../db/contacts'
import { listActivities, createActivity } from '../../db/activities'
import { requireString, trimOrNull, sanitize } from '../../lib/validation'
import { formatDate } from '../../lib/date'
import { draftEmail } from '../../services/ai'
import { sendEmailMessage } from '../../services/email'
import { auditLog } from '../../middleware/audit'
import { track } from '../../services/analytics'

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

const contacts = new Hono<Env>()

contacts.use('/app/*', requireAuth, csrf, requireVendor)

// ─── Contact list ───
contacts.get('/app/contacts', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const status = c.req.query('status') ?? undefined
  const search = c.req.query('search') ?? undefined
  const items = await listContacts(c.env.DB, vendor.id, { status, search })
  const counts = await countContactsByStatus(c.env.DB, vendor.id)
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
    const contact = await createContact(c.env.DB, vendor.id, {
      first_name: firstName,
      last_name: lastName,
      email: trimOrNull(body.email),
      phone: trimOrNull(body.phone),
      partner_first_name: trimOrNull(body.partner_first_name),
      partner_last_name: trimOrNull(body.partner_last_name),
      partner_email: trimOrNull(body.partner_email),
      partner_phone: trimOrNull(body.partner_phone),
      source: trimOrNull(body.source),
      wedding_date: trimOrNull(body.wedding_date),
      wedding_location: trimOrNull(body.wedding_location),
      notes: trimOrNull(body.notes),
    })
    await createActivity(c.env.DB, contact.id, 'note', 'Contact created')
    track(c.env.DB, vendor.id, 'contact_created', { contactId: contact.id })
    return c.redirect(`/app/contacts/${contact.id}`)
  } catch (e: any) {
    return c.redirect(`/app/contacts/new?error=${encodeURIComponent(e.message)}`)
  }
})

// ─── Contact detail ───
contacts.get('/app/contacts/:id', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const contact = await getContact(c.env.DB, vendor.id, c.req.param('id'))
  if (!contact) return c.text('Contact not found', 404)
  const activities = await listActivities(c.env.DB, contact.id)
  const bookingFormRows = await c.env.DB
    .prepare('SELECT title, booking_form_data FROM invoices WHERE vendor_id = ? AND contact_id = ? AND booking_form_data IS NOT NULL')
    .bind(vendor.id, contact.id)
    .all<{ title: string; booking_form_data: string }>()
    .then((r) => r.results)

  return c.html(
    <AppLayout title={`${contact.first_name} ${contact.last_name}`} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-3xl">
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
              <a
                href={`/app/contacts/${contact.id}/email`}
                class="border border-horizon-600 text-horizon-600 px-3 py-1.5 rounded-xl text-sm font-bold hover:bg-horizon-50 transition-colors"
              >
                Draft email
              </a>
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
              <div class="flex flex-wrap gap-2" id="status-buttons">
                {STATUSES.map((s) => (
                  <button
                    hx-post={`/app/contacts/${contact.id}/status`}
                    hx-vals={JSON.stringify({ status: s.value })}
                    hx-target="#status-buttons"
                    hx-swap="outerHTML"
                    class={`px-3 py-1 rounded-full text-xs font-medium border ${
                      contact.status === s.value
                        ? 'bg-horizon-600 text-white border-horizon-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-papaya-50'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
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
            <DetailCard label="Email" value={contact.email} href={contact.email ? `mailto:${contact.email}` : undefined} />
            <DetailCard label="Phone" value={contact.phone} href={contact.phone ? `tel:${contact.phone}` : undefined} />
            {contact.partner_email && <DetailCard label="Partner email" value={contact.partner_email} href={`mailto:${contact.partner_email}`} />}
            {contact.partner_phone && <DetailCard label="Partner phone" value={contact.partner_phone} href={`tel:${contact.partner_phone}`} />}
            <DetailCard label="Wedding date" value={contact.wedding_date ? formatDate(contact.wedding_date) : null} />
            <DetailCard label="Wedding location" value={contact.wedding_location} />
            <DetailCard label="Source" value={contact.source} />
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
})

// ─── Edit contact ───
contacts.get('/app/contacts/:id/edit', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const contact = await getContact(c.env.DB, vendor.id, c.req.param('id'))
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
})

contacts.post('/app/contacts/:id/edit', async (c) => {
  const vendor = c.get('vendor')!
  const contactId = c.req.param('id')
  const body = await c.req.parseBody()
  try {
    const firstName = requireString(body.first_name, 'First name')
    const lastName = requireString(body.last_name, 'Last name')
    await updateContact(c.env.DB, vendor.id, contactId, {
      first_name: firstName,
      last_name: lastName,
      email: trimOrNull(body.email),
      phone: trimOrNull(body.phone),
      partner_first_name: trimOrNull(body.partner_first_name),
      partner_last_name: trimOrNull(body.partner_last_name),
      partner_email: trimOrNull(body.partner_email),
      partner_phone: trimOrNull(body.partner_phone),
      source: trimOrNull(body.source),
      wedding_date: trimOrNull(body.wedding_date),
      wedding_location: trimOrNull(body.wedding_location),
      notes: trimOrNull(body.notes),
    })
    return c.redirect(`/app/contacts/${contactId}`)
  } catch (e: any) {
    return c.redirect(`/app/contacts/${contactId}/edit?error=${encodeURIComponent(e.message)}`)
  }
})

// ─── Status update (htmx) ───
contacts.post('/app/contacts/:id/status', async (c) => {
  const vendor = c.get('vendor')!
  const contactId = c.req.param('id')
  const body = await c.req.parseBody()
  const status = body.status as string
  const oldContact = await getContact(c.env.DB, vendor.id, contactId)
  if (!oldContact) return c.text('Not found', 404)

  await updateContactStatus(c.env.DB, vendor.id, contactId, status)
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

  const contact = await getContact(c.env.DB, vendor.id, contactId)
  return c.html(
    <div class="flex flex-wrap gap-2" id="status-buttons">
      {STATUSES.map((s) => (
        <button
          hx-post={`/app/contacts/${contactId}/status`}
          hx-vals={JSON.stringify({ status: s.value })}
          hx-target="#status-buttons"
          hx-swap="outerHTML"
          class={`px-3 py-1 rounded-full text-xs font-medium border ${
            contact!.status === s.value
              ? 'bg-horizon-600 text-white border-horizon-600'
              : 'bg-white text-gray-600 border-gray-200 hover:bg-papaya-50'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
})

// ─── Add note (htmx) ───
contacts.post('/app/contacts/:id/notes', async (c) => {
  const vendor = c.get('vendor')!
  const contactId = c.req.param('id')
  const contact = await getContact(c.env.DB, vendor.id, contactId)
  if (!contact) return c.text('Not found', 404)

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
})

// ─── Delete contact ───
contacts.post('/app/contacts/:id/delete', async (c) => {
  const vendor = c.get('vendor')!
  await auditLog(c, 'contact_deleted', 'contact', c.req.param('id')).catch(() => {})
  await deleteContact(c.env.DB, vendor.id, c.req.param('id'))
  return c.redirect('/app/contacts')
})

// ─── AI Email Draft ───

contacts.get('/app/contacts/:id/email', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const contact = await getContact(c.env.DB, vendor.id, c.req.param('id'))
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
})

contacts.post('/app/contacts/:id/email/draft', async (c) => {
  const vendor = c.get('vendor')!
  const contact = await getContact(c.env.DB, vendor.id, c.req.param('id'))
  if (!contact || !contact.email) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  const purpose = String(body.purpose || 'Follow up on their enquiry')

  try {
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
      vendor.anthropic_api_key,
    )

    return c.redirect(
      `/app/contacts/${contact.id}/email?draft=${encodeURIComponent(draft)}`
    )
  } catch (e: any) {
    return c.redirect(
      `/app/contacts/${contact.id}/email?error=${encodeURIComponent(e.message)}`
    )
  }
})

contacts.post('/app/contacts/:id/email/send', async (c) => {
  const vendor = c.get('vendor')!
  const user = c.get('user')
  const contact = await getContact(c.env.DB, vendor.id, c.req.param('id'))
  if (!contact || !contact.email) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  const subject = String(body.subject)
  const emailBody = String(body.body)

  try {
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
      to: contact.email,
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
    return c.redirect(
      `/app/contacts/${contact.id}/email?error=${encodeURIComponent(e.message)}`
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
}: {
  label: string
  value: string | null | undefined
  href?: string
}) {
  if (!value) return null
  return (
    <div class="bg-white border border-papaya-300/30 rounded-2xl px-4 py-3">
      <p class="text-xs text-gray-500 mb-0.5">{label}</p>
      {href ? (
        <a href={href} class="text-sm text-gray-900 hover:underline">{value}</a>
      ) : (
        <p class="text-sm text-gray-900">{value}</p>
      )}
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
        <h3 class="text-sm font-bold text-gray-900 mb-3">Wedding</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Date" name="wedding_date" value={contact?.wedding_date} type="date" />
          <FormField label="Location" name="wedding_location" value={contact?.wedding_location} />
        </div>
      </section>

      <section>
        <h3 class="text-sm font-bold text-gray-900 mb-3">Other</h3>
        <div class="space-y-4">
          <FormField label="Source" name="source" value={contact?.source} placeholder="e.g. Instagram, referral, website" />
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
}: {
  label: string
  name: string
  value?: string | null
  type?: string
  required?: boolean
  placeholder?: string
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
        class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
      />
    </div>
  )
}
