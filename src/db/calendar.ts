import type { CalendarEvent } from '../types'

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
  const result = await db
    .prepare(
      `INSERT INTO calendar_events (vendor_id, title, date, start_time, end_time, all_day, type, wedding_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      vendorId,
      data.title,
      data.date,
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
