import { Hono } from 'hono'
import type { Env, VendorProfile, CalendarEvent } from '../../types'
import { MarketingLayout } from '../../views/layouts/marketing'
import {
  monthLabel,
  prevMonth,
  nextMonth,
  daysInMonth,
  firstDayOffset,
  toDateString,
  todayString,
  DAYS_OF_WEEK,
} from '../../lib/date'

type AvailabilityOverride = {
  date: string
  available: number
}

const availability = new Hono<Env>()

availability.get('/v/:vendorId/availability', async (c) => {
  const vendorId = c.req.param('vendorId')
  const vendor = await c.env.DB
    .prepare('SELECT * FROM vendor_profiles WHERE id = ?')
    .bind(vendorId)
    .first<VendorProfile>()

  if (!vendor || vendor.availability_sharing !== 'public') {
    return c.html(
      <MarketingLayout title="Not Found">
        <div class="max-w-xl mx-auto px-4 py-16 text-center">
          <h1 class="text-2xl font-bold mb-2">Not found</h1>
          <p class="text-gray-500 text-sm">This vendor has not shared their availability publicly.</p>
        </div>
      </MarketingLayout>,
      404,
    )
  }

  // Parse month from query or use current
  const monthParam = c.req.query('month')
  let year: number
  let month: number

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number)
    year = y
    month = m
  } else {
    const now = new Date()
    year = now.getFullYear()
    month = now.getMonth() + 1
  }

  const firstDay = toDateString(year, month, 1)
  const lastDay = toDateString(year, month, daysInMonth(year, month))

  // Fetch calendar events and availability overrides for the month
  const [eventsResult, overridesResult] = await Promise.all([
    c.env.DB
      .prepare('SELECT * FROM calendar_events WHERE vendor_id = ? AND date >= ? AND date <= ?')
      .bind(vendorId, firstDay, lastDay)
      .all<CalendarEvent>(),
    c.env.DB
      .prepare('SELECT * FROM availability_overrides WHERE vendor_id = ? AND date >= ? AND date <= ?')
      .bind(vendorId, firstDay, lastDay)
      .all<AvailabilityOverride>(),
  ])

  const events = eventsResult.results
  const overrides = overridesResult.results

  // Build date status map
  const bookedDates = new Set<string>()
  for (const ev of events) {
    if (ev.type === 'booking' || ev.type === 'blocked') {
      bookedDates.add(ev.date)
    }
  }

  const overrideMap = new Map<string, boolean>()
  for (const ov of overrides) {
    overrideMap.set(ov.date, ov.available === 1)
  }

  // Parse default availability (JSON of weekday booleans)
  let defaultAvailability: Record<string, boolean> = {}
  if (vendor.availability_default) {
    try {
      defaultAvailability = JSON.parse(vendor.availability_default)
    } catch { /* ignore */ }
  }

  const today = todayString()
  const prev = prevMonth(year, month)
  const next = nextMonth(year, month)
  const totalDays = daysInMonth(year, month)
  const offset = firstDayOffset(year, month)
  const category = vendor.category.charAt(0).toUpperCase() + vendor.category.slice(1)

  function dateStatus(day: number): 'available' | 'booked' | 'past' | 'unavailable' {
    const dateStr = toDateString(year, month, day)

    // Past dates
    if (dateStr < today) return 'past'

    // Explicit override
    if (overrideMap.has(dateStr)) {
      return overrideMap.get(dateStr) ? 'available' : 'unavailable'
    }

    // Booked or blocked
    if (bookedDates.has(dateStr)) return 'booked'

    // Check default weekly availability
    const dayOfWeek = new Date(year, month - 1, day).getDay()
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const dayName = dayNames[dayOfWeek]
    if (Object.keys(defaultAvailability).length > 0) {
      return defaultAvailability[dayName] ? 'available' : 'unavailable'
    }

    // Default: available
    return 'available'
  }

  const statusColors: Record<string, string> = {
    available: 'bg-green-100 text-green-800 hover:bg-green-200',
    booked: 'bg-red-100 text-red-400',
    past: 'bg-gray-50 text-gray-300',
    unavailable: 'bg-gray-100 text-gray-400',
  }

  return c.html(
    <MarketingLayout title={`${vendor.business_name} — Availability`}>
      <div class="max-w-xl mx-auto px-4 py-8 sm:py-12">
        {/* Vendor header */}
        <div class="text-center mb-8">
          <p class="text-xs text-gray-400 uppercase tracking-wide mb-1">{category}</p>
          <h1 class="text-2xl font-bold">{vendor.business_name}</h1>
          {vendor.location && (
            <p class="text-sm text-gray-500 mt-1">{vendor.location}</p>
          )}
        </div>

        {/* Calendar */}
        <div class="bg-white rounded-2xl shadow-lg shadow-gray-900/5 p-5 sm:p-6">
          {/* Month navigation */}
          <div class="flex items-center justify-between mb-4">
            <a
              href={`/v/${vendorId}/availability?month=${prev.year}-${String(prev.month).padStart(2, '0')}`}
              class="text-sm font-medium text-horizon-600 hover:text-horizon-700 transition-colors px-2 py-1"
            >
              &larr; Prev
            </a>
            <h2 class="text-lg font-bold">{monthLabel(year, month)}</h2>
            <a
              href={`/v/${vendorId}/availability?month=${next.year}-${String(next.month).padStart(2, '0')}`}
              class="text-sm font-medium text-horizon-600 hover:text-horizon-700 transition-colors px-2 py-1"
            >
              Next &rarr;
            </a>
          </div>

          {/* Day headers */}
          <div class="grid grid-cols-7 gap-1 mb-1">
            {DAYS_OF_WEEK.map((d) => (
              <div class="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
            ))}
          </div>

          {/* Date grid */}
          <div class="grid grid-cols-7 gap-1">
            {/* Empty cells for offset */}
            {Array.from({ length: offset }).map((_, i) => (
              <div key={`empty-${i}`} class="aspect-square" />
            ))}

            {/* Date cells */}
            {Array.from({ length: totalDays }).map((_, i) => {
              const day = i + 1
              const status = dateStatus(day)
              const isToday = toDateString(year, month, day) === today

              return (
                <div
                  class={`aspect-square flex items-center justify-center rounded-lg text-sm font-medium ${statusColors[status]} ${isToday ? 'ring-2 ring-horizon-600' : ''}`}
                >
                  {day}
                </div>
              )
            })}
          </div>

          {/* Legend */}
          <div class="flex items-center gap-4 mt-5 pt-4 border-t border-gray-100 flex-wrap">
            <div class="flex items-center gap-1.5">
              <span class="w-3 h-3 rounded bg-green-100 border border-green-200" />
              <span class="text-xs text-gray-500">Available</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="w-3 h-3 rounded bg-red-100 border border-red-200" />
              <span class="text-xs text-gray-500">Booked</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="w-3 h-3 rounded bg-gray-100 border border-gray-200" />
              <span class="text-xs text-gray-500">Unavailable</span>
            </div>
          </div>
        </div>

        {/* Enquiry link */}
        <div class="text-center mt-6">
          <a
            href={`/enquire/${vendorId}`}
            class="inline-block bg-horizon-600 text-white py-2.5 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            Make an enquiry
          </a>
        </div>
      </div>
    </MarketingLayout>,
  )
})

export default availability
