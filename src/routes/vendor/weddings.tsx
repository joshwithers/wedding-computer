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
import { getContact, updateContact } from '../../db/contacts'
import { createActivity } from '../../db/activities'
import { requireString, trimOrNull } from '../../lib/validation'
import { formatDate, daysUntil } from '../../lib/date'
import { createEvent } from '../../db/calendar'

const WEDDING_STATUSES = [
  { value: 'planning', label: 'Planning' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const weddings = new Hono<Env>()

weddings.use('/app/*', requireAuth, csrf, requireVendor)

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

  return c.html(
    <AppLayout title="New wedding" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        <WeddingForm
          action="/app/weddings/new"
          csrfToken={c.get('csrfToken')}
          contactId={contactId}
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
    const wedding = await createWedding(c.env.DB, {
      title,
      date: trimOrNull(body.date),
      time: trimOrNull(body.time),
      location: trimOrNull(body.location),
      notes: trimOrNull(body.notes),
      created_by_user_id: user.id,
    })

    await addWeddingMember(c.env.DB, {
      wedding_id: wedding.id,
      user_id: user.id,
      role: 'owner',
      vendor_profile_id: vendor.id,
      vendor_role: vendor.category,
    })

    // Auto-create calendar event if wedding has a date
    const weddingDate = trimOrNull(body.date)
    if (weddingDate) {
      await createEvent(c.env.DB, vendor.id, {
        title,
        date: weddingDate,
        start_time: trimOrNull(body.time),
        type: 'booking',
        wedding_id: wedding.id,
        all_day: !trimOrNull(body.time),
      })
    }

    // Link contact if provided
    const contactId = trimOrNull(body.contact_id)
    if (contactId) {
      await updateContact(c.env.DB, vendor.id, contactId, {
        wedding_id: wedding.id,
        status: 'booked',
      })
      await createActivity(c.env.DB, contactId, 'status_change', `Promoted to wedding: ${title}`)
    }

    return c.redirect(`/app/weddings/${wedding.id}`)
  } catch (e: any) {
    return c.redirect(`/app/weddings/new?error=${encodeURIComponent(e.message)}`)
  }
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

  const members = await getWeddingMembers(c.env.DB, weddingId)
  const days = wedding.date ? daysUntil(wedding.date) : null

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
            {wedding.date && (
              <p class="text-sm text-gray-600 mt-1">
                {formatDate(wedding.date)}
                {days !== null && days > 0 && (
                  <span class="text-gray-400"> — {days} days away</span>
                )}
              </p>
            )}
          </div>
          {membership.role === 'owner' && (
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
                    <div class="text-right">
                      <span class="text-xs text-gray-500">
                        {m.role === 'owner' ? 'Owner' : m.vendor_role ?? m.role}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            {wedding.notes && (
              <div class="bg-white border border-papaya-300/30 rounded-2xl p-4">
                <h3 class="text-sm font-bold text-gray-500 mb-2">Notes</h3>
                <p class="text-sm text-gray-700 whitespace-pre-wrap">{wedding.notes}</p>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div class="space-y-4">
            {wedding.date && (
              <InfoCard label="Date" value={formatDate(wedding.date)} />
            )}
            {wedding.time && <InfoCard label="Time" value={wedding.time} />}
            {wedding.location && <InfoCard label="Location" value={wedding.location} />}
            <InfoCard label="Your role" value={membership.role === 'owner' ? 'Owner' : vendor.category} />
            <InfoCard label="Created" value={formatDate(wedding.created_at)} />
          </div>
        </div>
      </div>
    </AppLayout>
  )
})

// ─── Edit wedding ───
weddings.get('/app/weddings/:id/edit', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || membership.role !== 'owner') return c.text('Not found', 404)

  const wedding = await getWedding(c.env.DB, weddingId)
  if (!wedding) return c.text('Not found', 404)

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
        />
      </div>
    </AppLayout>
  )
})

weddings.post('/app/weddings/:id/edit', async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('id')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || membership.role !== 'owner') return c.text('Not found', 404)

  const body = await c.req.parseBody()
  try {
    const title = requireString(body.title, 'Title')
    await updateWedding(c.env.DB, weddingId, {
      title,
      date: trimOrNull(body.date),
      time: trimOrNull(body.time),
      location: trimOrNull(body.location),
      status: (body.status as Wedding['status']) || undefined,
      notes: trimOrNull(body.notes),
    })
    return c.redirect(`/app/weddings/${weddingId}`)
  } catch (e: any) {
    return c.redirect(`/app/weddings/${weddingId}/edit?error=${encodeURIComponent(e.message)}`)
  }
})

// ─── Promote contact to wedding ───
weddings.get('/app/contacts/:id/promote', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const contact = await getContact(c.env.DB, vendor.id, c.req.param('id'))
  if (!contact) return c.text('Contact not found', 404)

  const defaultTitle = contact.partner_first_name
    ? `${contact.first_name} & ${contact.partner_first_name}`
    : `${contact.first_name} ${contact.last_name}`

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
              <h3 class="font-medium text-gray-900">{w.title}</h3>
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

function WeddingForm({
  action,
  csrfToken,
  wedding,
  contactId,
  defaults,
}: {
  action: string
  csrfToken: string
  wedding?: Wedding
  contactId?: string | null
  defaults?: { title?: string; date?: string | null; location?: string | null }
}) {
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
          <label class="block text-sm font-bold text-gray-700 mb-1.5" for="time">Time</label>
          <input
            type="time"
            id="time"
            name="time"
            value={wedding?.time ?? ''}
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          />
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
