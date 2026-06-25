import type { CalendarEvent, EnrichedCalendarEvent } from '../types'
import { SQL_CALENDAR_EVENT_NOT_CANCELLED } from './weddings'

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
       WHERE ce.id = ? AND ce.vendor_id = ?`
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
