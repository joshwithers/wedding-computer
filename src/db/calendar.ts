import type { CalendarEvent, EnrichedCalendarEvent } from '../types'
import { SQL_CALENDAR_EVENT_NOT_CANCELLED } from './weddings'
import { addHoursToTime } from '../lib/date'

const ENRICHED_SELECT = `
  SELECT
    ce.*,
    w.title as wedding_title,
    w.date as wedding_date,
    w.time as wedding_time,
    w.location as wedding_location,
    w.ceremony_type,
    w.ceremony_location,
    w.reception_location,
    w.reception_time,
    w.getting_ready_location,
    w.getting_ready_time,
    w.getting_ready_1_label,
    w.getting_ready_2_location,
    w.getting_ready_2_label,
    w.getting_ready_2_time,
    w.portrait_location,
    w.portrait_time,
    w.dress_code,
    w.guest_count,
    w.duration_hours,
    w.notes as wedding_notes,
    w.timeline_notes,
    co.first_name as contact_first_name,
    co.last_name as contact_last_name,
    co.email as contact_email,
    co.phone as contact_phone,
    co.partner_first_name,
    co.partner_last_name,
    co.partner_email,
    co.partner_phone,
    w.location_state as wedding_location_state,
    w.location_country as wedding_location_country,
    ti.title as timeline_item_title,
    ti.description as timeline_item_description,
    (SELECT GROUP_CONCAT(cu.name, ' & ') FROM wedding_members cwm JOIN users cu ON cu.id = cwm.user_id
       WHERE cwm.wedding_id = ce.wedding_id AND cwm.role = 'couple' AND cwm.status = 'active') as couple_names,
    (SELECT cu.email FROM wedding_members cwm JOIN users cu ON cu.id = cwm.user_id
       WHERE cwm.wedding_id = ce.wedding_id AND cwm.role = 'couple' AND cwm.status = 'active'
       ORDER BY cwm.created_at LIMIT 1) as couple_email
  FROM calendar_events ce
  LEFT JOIN weddings w ON ce.wedding_id = w.id
  -- The real run-sheet item behind a wc:<slot> event, matched by slot. The
  -- synthetic 'wc:ceremony_prep' has no slot row, so it stays NULL (keeps its
  -- own label). timeline_items.slot is unique per (wedding_id, slot).
  LEFT JOIN timeline_items ti ON ce.notes LIKE 'wc:%'
    AND ti.wedding_id = ce.wedding_id
    AND ti.slot = substr(ce.notes, 4)
  LEFT JOIN contacts co ON ce.wedding_id IS NOT NULL AND co.id = (
    SELECT id FROM contacts
    WHERE wedding_id = ce.wedding_id AND vendor_id = ce.vendor_id
    ORDER BY CASE WHEN status = 'booked' THEN 0 ELSE 1 END, created_at DESC
    LIMIT 1
  )`

export async function listEventsByMonth(
  db: D1Database,
  vendorId: string,
  year: number,
  month: number
): Promise<CalendarEvent[]> {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`

  return db
    .prepare(
      `SELECT * FROM calendar_events
       WHERE vendor_id = ? AND date >= ? AND date < ?
         AND ${SQL_CALENDAR_EVENT_NOT_CANCELLED('calendar_events')}
       ORDER BY date, start_time`
    )
    .bind(vendorId, start, end)
    .all<CalendarEvent>()
    .then((r) => r.results)
}

export async function listEventsByRange(
  db: D1Database,
  vendorId: string,
  startDate: string,
  endDate: string
): Promise<CalendarEvent[]> {
  return db
    .prepare(
      `SELECT * FROM calendar_events
       WHERE vendor_id = ? AND date >= ? AND date <= ?
         AND ${SQL_CALENDAR_EVENT_NOT_CANCELLED('calendar_events')}
       ORDER BY date, start_time`
    )
    .bind(vendorId, startDate, endDate)
    .all<CalendarEvent>()
    .then((r) => r.results)
}

export async function getEvent(
  db: D1Database,
  vendorId: string,
  eventId: string
): Promise<CalendarEvent | null> {
  return db
    .prepare('SELECT * FROM calendar_events WHERE id = ? AND vendor_id = ?')
    .bind(eventId, vendorId)
    .first<CalendarEvent>()
}

export async function createEvent(
  db: D1Database,
  vendorId: string,
  data: {
    title: string
    date: string
    start_time?: string | null
    end_time?: string | null
    all_day?: boolean
    type?: string
    wedding_id?: string | null
    notes?: string | null
  }
): Promise<CalendarEvent> {
  // Validate date is YYYY-MM-DD format to prevent corrupted dates
  const dateStr = data.date.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date format: expected YYYY-MM-DD, got "${dateStr}"`)
  }
  const [y] = dateStr.split('-').map(Number)
  if (y < 1900 || y > 2200) {
    throw new Error(`Invalid year in date: ${y}`)
  }

  const result = await db
    .prepare(
      `INSERT INTO calendar_events (vendor_id, title, date, start_time, end_time, all_day, type, wedding_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      vendorId,
      data.title,
      dateStr,
      data.start_time ?? null,
      data.end_time ?? null,
      data.all_day !== false ? 1 : 0,
      data.type ?? 'booking',
      data.wedding_id ?? null,
      data.notes ?? null
    )
    .first<CalendarEvent>()
  return result!
}

/**
 * Keep a wedding's `type='booking'` calendar_event rows in step with the
 * wedding's own date. These rows drive the in-app calendar grid and the public
 * availability "booked" flag — and since a date can now be set long after a
 * wedding is created (undated bookings), changed, or cleared, the rows must
 * follow:
 *
 *   - date cleared   → delete the wedding's booking rows (frees availability)
 *   - date set/moved → move every existing booking row to the new date, AND
 *                      ensure EVERY active vendor member has one
 *
 * Booking rows are vendor-scoped (each vendor's own availability). One row is
 * ensured per active vendor member — so when a date lands on an undated wedding,
 * EVERY vendor booked on it is marked busy that day, not just whoever set it.
 */
export async function syncWeddingBookingEvent(
  db: D1Database,
  weddingId: string,
  opts: { date: string | null; title: string; startTime: string | null; durationHours: number | null }
): Promise<void> {
  if (!opts.date) {
    await db
      .prepare("DELETE FROM calendar_events WHERE wedding_id = ? AND type = 'booking'")
      .bind(weddingId)
      .run()
    return
  }
  const endTime =
    opts.startTime && opts.durationHours ? addHoursToTime(opts.startTime, opts.durationHours) : null
  const allDay = opts.startTime ? 0 : 1
  // Move every existing booking row for this wedding onto the current date/time.
  await db
    .prepare(
      `UPDATE calendar_events SET date = ?, start_time = ?, end_time = ?, all_day = ?, updated_at = datetime('now')
       WHERE wedding_id = ? AND type = 'booking'`
    )
    .bind(opts.date, opts.startTime, endTime, allDay, weddingId)
    .run()
  // Ensure every active vendor member has a booking row (the undated→dated case,
  // where the wedding never got rows at creation, plus any vendor added while it
  // was undated).
  const members = await db
    .prepare(
      "SELECT DISTINCT vendor_profile_id FROM wedding_members WHERE wedding_id = ? AND role = 'vendor' AND status = 'active' AND vendor_profile_id IS NOT NULL"
    )
    .bind(weddingId)
    .all<{ vendor_profile_id: string }>()
  if (members.results.length === 0) return
  const existing = await db
    .prepare("SELECT DISTINCT vendor_id FROM calendar_events WHERE wedding_id = ? AND type = 'booking'")
    .bind(weddingId)
    .all<{ vendor_id: string }>()
  const have = new Set(existing.results.map((r) => r.vendor_id))
  for (const m of members.results) {
    if (have.has(m.vendor_profile_id)) continue
    await createEvent(db, m.vendor_profile_id, {
      title: opts.title,
      date: opts.date,
      start_time: opts.startTime,
      end_time: endTime,
      all_day: !opts.startTime,
      type: 'booking',
      wedding_id: weddingId,
    })
  }
}

export async function updateEvent(
  db: D1Database,
  vendorId: string,
  eventId: string,
  data: Partial<Pick<CalendarEvent, 'title' | 'date' | 'start_time' | 'end_time' | 'all_day' | 'type' | 'notes'>>
): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`)
      values.push(val)
    }
  }
  if (sets.length === 0) return
  sets.push("updated_at = datetime('now')")
  values.push(eventId, vendorId)
  await db
    .prepare(`UPDATE calendar_events SET ${sets.join(', ')} WHERE id = ? AND vendor_id = ?`)
    .bind(...values)
    .run()
}

export async function deleteEvent(
  db: D1Database,
  vendorId: string,
  eventId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM calendar_events WHERE id = ? AND vendor_id = ?')
    .bind(eventId, vendorId)
    .run()
}

// ─── Enriched queries (with wedding + contact details) ───

// The subscribed feed (iCal/CalDAV) represents each wedding with the single
// all-day "wedding day" marker (the wedding-day rows in db/weddings.ts), so the
// legacy per-wedding booking row is filtered out of these enriched queries to
// avoid a duplicate all-day entry. Only the feed + CalDAV use these queries.
// Manual bookings (no wedding_id) and the in-app calendar grid (which reads
// listEventsByMonth, not these) are unaffected, so availability is preserved.
const SQL_FEED_NOT_WEDDING_BOOKING = "NOT (ce.type = 'booking' AND ce.wedding_id IS NOT NULL)"

export async function listEnrichedEventsByRange(
  db: D1Database,
  vendorId: string,
  startDate: string,
  endDate: string
): Promise<EnrichedCalendarEvent[]> {
  return db
    .prepare(
      `${ENRICHED_SELECT}
       WHERE ce.vendor_id = ? AND ce.date >= ? AND ce.date <= ?
         AND ${SQL_FEED_NOT_WEDDING_BOOKING}
       ORDER BY ce.date, ce.start_time`
    )
    .bind(vendorId, startDate, endDate)
    .all<EnrichedCalendarEvent>()
    .then((r) => r.results)
}

export async function listAllEnrichedEvents(
  db: D1Database,
  vendorId: string,
  whereExtra?: string
): Promise<EnrichedCalendarEvent[]> {
  return db
    .prepare(
      `${ENRICHED_SELECT}
       WHERE ce.vendor_id = ?${whereExtra ? ` AND ${whereExtra}` : ''}
         AND ${SQL_FEED_NOT_WEDDING_BOOKING}
       ORDER BY ce.date, ce.start_time`
    )
    .bind(vendorId)
    .all<EnrichedCalendarEvent>()
    .then((r) => r.results)
}

export async function listEnrichedEventsByIds(
  db: D1Database,
  vendorId: string,
  ids: string[]
): Promise<EnrichedCalendarEvent[]> {
  if (ids.length === 0) return []
  const results: EnrichedCalendarEvent[] = []
  for (let i = 0; i < ids.length; i += 99) {
    const batch = ids.slice(i, i + 99)
    const placeholders = batch.map(() => '?').join(',')
    const rows = await db
      .prepare(
        `${ENRICHED_SELECT}
         WHERE ce.vendor_id = ? AND ce.id IN (${placeholders})
           AND ${SQL_FEED_NOT_WEDDING_BOOKING}
         ORDER BY ce.date, ce.start_time`
      )
      .bind(vendorId, ...batch)
      .all<EnrichedCalendarEvent>()
    results.push(...rows.results)
  }
  return results
}

export async function getEnrichedEvent(
  db: D1Database,
  vendorId: string,
  eventId: string
): Promise<EnrichedCalendarEvent | null> {
  return db
    .prepare(
      `${ENRICHED_SELECT}
       WHERE ce.id = ? AND ce.vendor_id = ?
         AND ${SQL_FEED_NOT_WEDDING_BOOKING}`
    )
    .bind(eventId, vendorId)
    .first<EnrichedCalendarEvent>()
}

// ─── Availability ───

export type AvailabilityOverride = {
  id: string
  vendor_id: string
  date: string
  available: number
  reason: string | null
  created_at: string
}

export async function getOverridesForMonth(
  db: D1Database,
  vendorId: string,
  year: number,
  month: number
): Promise<AvailabilityOverride[]> {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`

  return db
    .prepare(
      `SELECT * FROM availability_overrides
       WHERE vendor_id = ? AND date >= ? AND date < ?
       ORDER BY date`
    )
    .bind(vendorId, start, end)
    .all<AvailabilityOverride>()
    .then((r) => r.results)
}

export async function setOverride(
  db: D1Database,
  vendorId: string,
  date: string,
  available: boolean,
  reason?: string | null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO availability_overrides (vendor_id, date, available, reason)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(vendor_id, date) DO UPDATE SET
         available = excluded.available, reason = excluded.reason`
    )
    .bind(vendorId, date, available ? 1 : 0, reason ?? null)
    .run()
}

export async function deleteOverride(
  db: D1Database,
  vendorId: string,
  date: string
): Promise<void> {
  await db
    .prepare('DELETE FROM availability_overrides WHERE vendor_id = ? AND date = ?')
    .bind(vendorId, date)
    .run()
}

export async function deleteBlockedEventByDate(
  db: D1Database,
  vendorId: string,
  date: string
): Promise<void> {
  await db
    .prepare("DELETE FROM calendar_events WHERE vendor_id = ? AND date = ? AND type = 'blocked'")
    .bind(vendorId, date)
    .run()
}

export async function getBookedDates(
  db: D1Database,
  vendorId: string,
  startDate: string,
  endDate: string
): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT date FROM calendar_events
       WHERE vendor_id = ? AND date >= ? AND date <= ? AND type = 'booking'
       ORDER BY date`
    )
    .bind(vendorId, startDate, endDate)
    .all<{ date: string }>()
  return rows.results.map((r) => r.date)
}
