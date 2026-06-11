import { Hono } from 'hono'
import type { Env } from '../../types'
import type { CalendarEvent } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import {
  listEventsByMonth,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  getOverridesForMonth,
  setOverride,
  deleteOverride,
  deleteBlockedEventByDate,
} from '../../db/calendar'
import type { AvailabilityOverride } from '../../db/calendar'
import { requireString, trimOrNull } from '../../lib/validation'
import {
  monthLabel,
  prevMonth,
  nextMonth,
  daysInMonth,
  firstDayOffset,
  toDateString,
  todayString,
  formatDate,
  formatTime,
  DAYS_OF_WEEK,
} from '../../lib/date'

const EVENT_TYPES = [
  { value: 'booking', label: 'Booking' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'personal', label: 'Personal' },
  { value: 'other', label: 'Other' },
]

const calendar = new Hono<Env>()

calendar.use('/app/*', requireAuth, csrf, requireVendor)

// ─── Monthly calendar view ───

calendar.get('/app/calendar', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const now = new Date()
  const year = parseInt(c.req.query('year') ?? String(now.getFullYear()))
  const month = parseInt(c.req.query('month') ?? String(now.getMonth() + 1))

  const events = await listEventsByMonth(c.env.DB, vendor.id, year, month)
  const overrides = await getOverridesForMonth(c.env.DB, vendor.id, year, month)
  const defaultDays = parseDefaultDays(vendor.availability_default)

  const calendarHtml = (
    <CalendarGrid
      year={year}
      month={month}
      events={events}
      overrides={overrides}
      defaultDays={defaultDays}
    />
  )

  if (c.req.header('HX-Request')) {
    return c.html(calendarHtml)
  }

  return c.html(
    <AppLayout title="Calendar" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-5xl">
        <div class="flex items-center justify-between gap-4 mb-6">
          <p class="text-sm text-gray-500">
            Manage your bookings and availability
          </p>
          <div class="flex gap-2">
            <a
              href="/app/calendar/availability"
              class="border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
            >
              Availability
            </a>
            <a
              href={`/app/calendar/new?date=${todayString()}`}
              class="bg-horizon-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              New event
            </a>
          </div>
        </div>

        <div id="calendar-container">
          {calendarHtml}
        </div>

        <div class="mt-8 bg-white border border-papaya-300/30 rounded-2xl p-5">
          <h3 class="text-sm font-bold text-gray-900 mb-1">Calendar feed</h3>
          <p class="text-xs text-gray-500 mb-4">
            Subscribe from Google Calendar, Apple Calendar, or Outlook to see your bookings everywhere.
            {vendor.ical_token
              ? ' Your feed URL uses your sync token — it was shown once when generated, and you can regenerate it in Settings.'
              : ' Generate a sync token in Settings to get your feed URL.'}
          </p>
          <a
            href="/app/settings#device-sync"
            class="inline-block border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
          >
            Manage device sync in Settings
          </a>
        </div>
      </div>
    </AppLayout>
  )
})

// Sync-token management lives in settings (/app/settings/generate-sync-token):
// it Pro-gates, stores only the sha256 hash, and reveals the raw token once.

// ─── Day detail (events for a specific date) ───

calendar.get('/app/calendar/day/:date', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const date = c.req.param('date')

  const events = await listEventsByMonth(
    c.env.DB,
    vendor.id,
    parseInt(date.slice(0, 4)),
    parseInt(date.slice(5, 7))
  )
  const dayEvents = events.filter((e) => e.date === date)

  return c.html(
    <AppLayout title={formatDate(date)} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        <p class="text-sm text-gray-500 mb-1">
          <a href="/app/calendar" class="hover:text-gray-900">Calendar</a> /
        </p>
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-xl font-bold">{formatDate(date)}</h2>
          <a
            href={`/app/calendar/new?date=${date}`}
            class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            Add event
          </a>
        </div>

        {dayEvents.length === 0 ? (
          <div class="text-center py-12 bg-white border border-papaya-300/30 rounded-2xl">
            <p class="text-gray-500 text-sm">No events on this date</p>
          </div>
        ) : (
          <div class="space-y-3">
            {dayEvents.map((event) => (
              <a
                href={`/app/calendar/${event.id}`}
                class="block bg-white border border-papaya-300/30 rounded-2xl p-4 hover:border-horizon-600/30 transition-colors"
              >
                <div class="flex items-start justify-between">
                  <div>
                    <h3 class="font-medium text-gray-900">{event.title}</h3>
                    {!event.all_day && event.start_time && (
                      <p class="text-sm text-gray-500 mt-0.5">
                        {formatTime(event.start_time)}
                        {event.end_time && ` – ${formatTime(event.end_time)}`}
                      </p>
                    )}
                    {event.all_day === 1 && (
                      <p class="text-sm text-gray-400 mt-0.5">All day</p>
                    )}
                  </div>
                  <EventTypeBadge type={event.type} />
                </div>
                {event.notes && (
                  <p class="text-sm text-gray-500 mt-2 line-clamp-2">{event.notes}</p>
                )}
              </a>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
})

// ─── New event ───

calendar.get('/app/calendar/new', (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const date = c.req.query('date') ?? todayString()

  return c.html(
    <AppLayout title="New event" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        <p class="text-sm text-gray-500 mb-4">
          <a href="/app/calendar" class="hover:text-gray-900">Calendar</a> /
        </p>
        <EventForm
          action="/app/calendar/new"
          csrfToken={c.get('csrfToken')}
          defaults={{ date }}
        />
      </div>
    </AppLayout>
  )
})

calendar.post('/app/calendar/new', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()

  try {
    const title = requireString(body.title, 'Title')
    const date = requireString(body.date, 'Date')
    const allDay = body.all_day === 'on'

    const event = await createEvent(c.env.DB, vendor.id, {
      title,
      date,
      start_time: allDay ? null : trimOrNull(body.start_time),
      end_time: allDay ? null : trimOrNull(body.end_time),
      all_day: allDay,
      type: (body.type as string) || 'booking',
      notes: trimOrNull(body.notes),
    })

    return c.redirect(`/app/calendar/day/${date}`)
  } catch (e: any) {
    return c.redirect(`/app/calendar/new?date=${body.date ?? ''}&error=${encodeURIComponent(e.message)}`)
  }
})

// ─── Availability settings ───

calendar.get('/app/calendar/availability', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const defaultDays = parseDefaultDays(vendor.availability_default)
  const saved = c.req.query('saved')

  return c.html(
    <AppLayout title="Availability" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        <p class="text-sm text-gray-500 mb-4">
          <a href="/app/calendar" class="hover:text-gray-900">Calendar</a> /
        </p>

        {saved && (
          <div class="bg-horizon-50 border border-horizon-600/20 text-horizon-700 text-sm font-bold rounded-xl p-3 mb-6">
            Availability saved.
          </div>
        )}

        <h2 class="text-xl font-bold mb-2">Default availability</h2>
        <p class="text-sm text-gray-500 mb-6">
          Set which days of the week you're generally available. You can override specific dates from the calendar.
        </p>

        <form method="post" action="/app/calendar/availability" class="space-y-6">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />

          <div class="bg-white border border-papaya-300/30 rounded-2xl p-5">
            <div class="space-y-3">
              {DAYS_OF_WEEK.map((day, idx) => (
                <label class="flex items-center justify-between cursor-pointer py-1">
                  <span class="text-sm font-medium text-gray-700">{fullDayName(day)}</span>
                  <input
                    type="checkbox"
                    name={`day_${idx}`}
                    checked={defaultDays[idx]}
                    class="accent-grapefruit-700 w-5 h-5"
                    value="on"
                  />
                </label>
              ))}
            </div>
          </div>

          <button
            type="submit"
            class="w-full bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            Save availability
          </button>
        </form>
      </div>
    </AppLayout>
  )
})

calendar.post('/app/calendar/availability', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()

  const days: boolean[] = []
  for (let i = 0; i < 7; i++) {
    days.push(body[`day_${i}`] === 'on')
  }

  const { updateVendor } = await import('../../db/vendors')
  await updateVendor(c.env.DB, vendor.id, {
    availability_default: JSON.stringify(days),
  } as any)

  return c.redirect('/app/calendar/availability?saved=1')
})

// ─── Quick block/unblock date ───

calendar.post('/app/calendar/block/:date', async (c) => {
  const vendor = c.get('vendor')!
  const date = c.req.param('date')

  await setOverride(c.env.DB, vendor.id, date, false, 'Blocked')
  await createEvent(c.env.DB, vendor.id, {
    title: 'Blocked',
    date,
    type: 'blocked',
    all_day: true,
  })

  const [y, m] = date.split('-').map(Number)
  return c.redirect(`/app/calendar?year=${y}&month=${m}`)
})

calendar.post('/app/calendar/unblock/:date', async (c) => {
  const vendor = c.get('vendor')!
  const date = c.req.param('date')

  await deleteOverride(c.env.DB, vendor.id, date)
  await deleteBlockedEventByDate(c.env.DB, vendor.id, date)

  const [y, m] = date.split('-').map(Number)
  return c.redirect(`/app/calendar?year=${y}&month=${m}`)
})

// ─── Event detail ───

calendar.get('/app/calendar/:id', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const event = await getEvent(c.env.DB, vendor.id, c.req.param('id'))
  if (!event) return c.text('Event not found', 404)

  return c.html(
    <AppLayout title={event.title} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        <p class="text-sm text-gray-500 mb-1">
          <a href="/app/calendar" class="hover:text-gray-900">Calendar</a> /{' '}
          <a href={`/app/calendar/day/${event.date}`} class="hover:text-gray-900">{formatDate(event.date)}</a> /
        </p>

        <div class="flex items-start justify-between mb-6">
          <div>
            <h2 class="text-xl font-bold">{event.title}</h2>
            <p class="text-sm text-gray-600 mt-1">{formatDate(event.date)}</p>
          </div>
          <div class="flex gap-2">
            <a
              href={`/app/calendar/${event.id}/edit`}
              class="border border-gray-200 px-3 py-1.5 rounded-xl text-sm hover:bg-papaya-50"
            >
              Edit
            </a>
            <form method="post" action={`/app/calendar/${event.id}/delete`}>
              <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
              <button
                type="submit"
                class="border border-gray-200 px-3 py-1.5 rounded-xl text-sm text-grapefruit-700 hover:bg-grapefruit-50"
                onclick="return confirm('Delete this event?')"
              >
                Delete
              </button>
            </form>
          </div>
        </div>

        <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <p class="text-xs text-gray-500">Type</p>
              <EventTypeBadge type={event.type} />
            </div>
            <div>
              <p class="text-xs text-gray-500">Time</p>
              <p class="text-sm font-medium">
                {event.all_day === 1
                  ? 'All day'
                  : event.start_time
                    ? `${formatTime(event.start_time)}${event.end_time ? ` – ${formatTime(event.end_time)}` : ''}`
                    : '—'}
              </p>
            </div>
          </div>
          {event.notes && (
            <div>
              <p class="text-xs text-gray-500 mb-1">Notes</p>
              <p class="text-sm text-gray-700 whitespace-pre-wrap">{event.notes}</p>
            </div>
          )}
          {event.wedding_id && (
            <div>
              <p class="text-xs text-gray-500 mb-1">Linked wedding</p>
              <a href={`/app/weddings/${event.wedding_id}`} class="text-sm text-horizon-700 hover:underline">
                View wedding →
              </a>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
})

// ─── Edit event ───

calendar.get('/app/calendar/:id/edit', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const event = await getEvent(c.env.DB, vendor.id, c.req.param('id'))
  if (!event) return c.text('Event not found', 404)

  return c.html(
    <AppLayout title={`Edit ${event.title}`} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        <p class="text-sm text-gray-500 mb-4">
          <a href="/app/calendar" class="hover:text-gray-900">Calendar</a> /{' '}
          <a href={`/app/calendar/${event.id}`} class="hover:text-gray-900">{event.title}</a> / Edit
        </p>
        <EventForm
          action={`/app/calendar/${event.id}/edit`}
          csrfToken={c.get('csrfToken')}
          event={event}
        />
      </div>
    </AppLayout>
  )
})

calendar.post('/app/calendar/:id/edit', async (c) => {
  const vendor = c.get('vendor')!
  const eventId = c.req.param('id')
  const body = await c.req.parseBody()

  try {
    const title = requireString(body.title, 'Title')
    const date = requireString(body.date, 'Date')
    const allDay = body.all_day === 'on'

    await updateEvent(c.env.DB, vendor.id, eventId, {
      title,
      date,
      start_time: allDay ? null : trimOrNull(body.start_time),
      end_time: allDay ? null : trimOrNull(body.end_time),
      all_day: allDay ? 1 : 0,
      type: (body.type as CalendarEvent['type']) || 'booking',
      notes: trimOrNull(body.notes),
    })

    return c.redirect(`/app/calendar/${eventId}`)
  } catch (e: any) {
    return c.redirect(`/app/calendar/${eventId}/edit?error=${encodeURIComponent(e.message)}`)
  }
})

// ─── Delete event ───

calendar.post('/app/calendar/:id/delete', async (c) => {
  const vendor = c.get('vendor')!
  const event = await getEvent(c.env.DB, vendor.id, c.req.param('id'))
  if (!event) return c.text('Not found', 404)

  await deleteEvent(c.env.DB, vendor.id, event.id)
  return c.redirect('/app/calendar')
})

export default calendar

// ─── Helpers ───

function parseDefaultDays(json: string | null): boolean[] {
  if (!json) return [true, true, true, true, true, true, true]
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed) && parsed.length === 7) return parsed
    return [true, true, true, true, true, true, true]
  } catch {
    return [true, true, true, true, true, true, true]
  }
}

function fullDayName(abbr: string): string {
  const map: Record<string, string> = {
    Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday',
    Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
  }
  return map[abbr] ?? abbr
}

// ─── Components ───

function CalendarGrid({
  year,
  month,
  events,
  overrides,
  defaultDays,
}: {
  year: number
  month: number
  events: CalendarEvent[]
  overrides: AvailabilityOverride[]
  defaultDays: boolean[]
}) {
  const prev = prevMonth(year, month)
  const next = nextMonth(year, month)
  const days = daysInMonth(year, month)
  const offset = firstDayOffset(year, month)
  const today = todayString()

  const eventsByDate: Record<string, CalendarEvent[]> = {}
  for (const e of events) {
    if (!eventsByDate[e.date]) eventsByDate[e.date] = []
    eventsByDate[e.date].push(e)
  }

  const overridesByDate: Record<string, AvailabilityOverride> = {}
  for (const o of overrides) {
    overridesByDate[o.date] = o
  }

  return (
    <div class="bg-white border border-papaya-300/30 rounded-2xl overflow-hidden">
      {/* Month navigation */}
      <div class="flex items-center justify-between px-5 py-4 border-b border-papaya-300/30">
        <button
          hx-get={`/app/calendar?year=${prev.year}&month=${prev.month}`}
          hx-target="#calendar-container"
          hx-swap="innerHTML"
          class="p-2 text-gray-400 hover:text-gray-700 rounded-xl hover:bg-papaya-50 transition-colors"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 class="text-lg font-bold">{monthLabel(year, month)}</h2>
        <button
          hx-get={`/app/calendar?year=${next.year}&month=${next.month}`}
          hx-target="#calendar-container"
          hx-swap="innerHTML"
          class="p-2 text-gray-400 hover:text-gray-700 rounded-xl hover:bg-papaya-50 transition-colors"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day headers */}
      <div class="grid grid-cols-7 border-b border-papaya-300/30">
        {DAYS_OF_WEEK.map((day) => (
          <div class="text-center text-xs font-bold text-gray-400 py-2">{day}</div>
        ))}
      </div>

      {/* Day cells */}
      <div class="grid grid-cols-7">
        {/* Empty cells before first day */}
        {Array.from({ length: offset }).map(() => (
          <div class="min-h-[5rem] border-b border-r border-papaya-300/10 bg-gray-50/50"></div>
        ))}

        {Array.from({ length: days }).map((_, i) => {
          const day = i + 1
          const dateStr = toDateString(year, month, day)
          const isToday = dateStr === today
          const dayEvents = eventsByDate[dateStr] ?? []
          const override = overridesByDate[dateStr]
          const dayOfWeek = (offset + i) % 7
          const isDefaultAvailable = defaultDays[dayOfWeek]
          const isBlocked = override ? !override.available : !isDefaultAvailable
          const hasBooking = dayEvents.some((e) => e.type === 'booking')

          return (
            <a
              href={`/app/calendar/day/${dateStr}`}
              class={`min-h-[5rem] border-b border-r border-papaya-300/10 p-1.5 transition-colors hover:bg-papaya-50
                ${isBlocked && !hasBooking ? 'bg-gray-50' : ''}
                ${isToday ? 'ring-2 ring-inset ring-horizon-600' : ''}`}
            >
              <div class="flex items-center justify-between mb-1">
                <span class={`text-sm font-medium leading-none
                  ${isToday ? 'text-horizon-700 font-bold' : 'text-gray-700'}
                  ${isBlocked && !hasBooking ? 'text-gray-400' : ''}`}>
                  {day}
                </span>
                {isBlocked && !hasBooking && (
                  <span class="text-[10px] text-gray-400">off</span>
                )}
              </div>

              <div class="space-y-0.5">
                {dayEvents.slice(0, 3).map((e) => (
                  <div class={`text-[11px] leading-tight px-1 py-0.5 rounded truncate
                    ${e.type === 'booking' ? 'bg-grapefruit-100 text-grapefruit-700' : ''}
                    ${e.type === 'blocked' ? 'bg-gray-200 text-gray-500' : ''}
                    ${e.type === 'personal' ? 'bg-horizon-100 text-horizon-700' : ''}
                    ${e.type === 'other' ? 'bg-papaya-200 text-gray-600' : ''}`}>
                    {e.title}
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <div class="text-[10px] text-gray-400 px-1">+{dayEvents.length - 3} more</div>
                )}
              </div>
            </a>
          )
        })}
      </div>
    </div>
  )
}

function EventForm({
  action,
  csrfToken,
  event,
  defaults,
}: {
  action: string
  csrfToken: string
  event?: CalendarEvent
  defaults?: { date?: string }
}) {
  const isAllDay = event ? event.all_day === 1 : true

  return (
    <form method="post" action={action} class="space-y-4">
      <input type="hidden" name="_csrf" value={csrfToken} />

      <div>
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="title">Title</label>
        <input
          type="text"
          id="title"
          name="title"
          required
          value={event?.title ?? ''}
          placeholder="e.g. Sarah & James Wedding"
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
            required
            value={event?.date ?? defaults?.date ?? ''}
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          />
        </div>
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1.5" for="type">Type</label>
          <select
            id="type"
            name="type"
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          >
            {EVENT_TYPES.map((t) => (
              <option value={t.value} selected={t.value === event?.type}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      <label class="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          name="all_day"
          checked={isAllDay}
          class="accent-grapefruit-700 w-4 h-4"
          value="on"
          onclick="document.getElementById('time-fields').classList.toggle('hidden', this.checked)"
        />
        <span class="text-sm font-medium text-gray-700">All day</span>
      </label>

      <div id="time-fields" class={isAllDay ? 'hidden' : ''}>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-bold text-gray-700 mb-1.5" for="start_time">Start</label>
            <input
              type="time"
              id="start_time"
              name="start_time"
              value={event?.start_time ?? ''}
              class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            />
          </div>
          <div>
            <label class="block text-sm font-bold text-gray-700 mb-1.5" for="end_time">End</label>
            <input
              type="time"
              id="end_time"
              name="end_time"
              value={event?.end_time ?? ''}
              class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      <div>
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="notes">Notes</label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
        >{event?.notes ?? ''}</textarea>
      </div>

      <button
        type="submit"
        class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
      >
        {event ? 'Save changes' : 'Create event'}
      </button>
    </form>
  )
}

function EventTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    booking: 'bg-grapefruit-100 text-grapefruit-700',
    blocked: 'bg-gray-200 text-gray-600',
    personal: 'bg-horizon-100 text-horizon-700',
    other: 'bg-papaya-200 text-gray-600',
  }
  return (
    <span class={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[type] ?? 'bg-gray-100 text-gray-600'}`}>
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </span>
  )
}
