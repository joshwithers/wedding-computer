import { describe, it, expect } from 'vitest'
import { syncWeddingBookingEvent } from './calendar'
import { MockD1Database } from '../storage/__tests__/mock-d1'

const WED = 'wwwwwwwwwwwwwwwwwwwwwwww'
const VENDOR = 'vvvvvvvvvvvvvvvvvvvvvvvv'

function bookings(db: MockD1Database) {
  return db.getTable('calendar_events').filter((e) => e.type === 'booking' && e.wedding_id === WED)
}

describe('syncWeddingBookingEvent', () => {
  it('creates a booking row for the acting vendor when a date is first set (undated → dated)', async () => {
    const db = new MockD1Database()
    db.seed('calendar_events', [])
    await syncWeddingBookingEvent(
      db as any,
      WED,
      { date: '2026-11-21', title: 'Jordan & Riley', startTime: null, durationHours: null },
      VENDOR
    )
    const rows = bookings(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe('2026-11-21')
    expect(rows[0].vendor_id).toBe(VENDOR)
    expect(rows[0].all_day).toBe(1) // no ceremony time → all-day
  })

  it('moves the existing booking row when the date changes (no duplicate created)', async () => {
    const db = new MockD1Database()
    db.seed('calendar_events', [
      { id: 'ev1', vendor_id: VENDOR, wedding_id: WED, type: 'booking', date: '2026-11-21', all_day: 1, start_time: null, end_time: null },
    ])
    await syncWeddingBookingEvent(
      db as any,
      WED,
      { date: '2026-12-05', title: 'Jordan & Riley', startTime: null, durationHours: null },
      VENDOR
    )
    const rows = bookings(db)
    expect(rows).toHaveLength(1) // updated in place, not duplicated
    expect(rows[0].date).toBe('2026-12-05')
  })

  it('deletes the booking row(s) when the date is cleared (dated → undated)', async () => {
    const db = new MockD1Database()
    db.seed('calendar_events', [
      { id: 'ev1', vendor_id: VENDOR, wedding_id: WED, type: 'booking', date: '2026-12-05', all_day: 1 },
    ])
    await syncWeddingBookingEvent(
      db as any,
      WED,
      { date: null, title: 'Jordan & Riley', startTime: null, durationHours: null }
    )
    expect(bookings(db)).toHaveLength(0)
  })

  it('without ensureVendorId, resyncs existing rows but creates nothing (couple/approval path)', async () => {
    const db = new MockD1Database()
    db.seed('calendar_events', [
      { id: 'ev1', vendor_id: VENDOR, wedding_id: WED, type: 'booking', date: '2026-11-21', all_day: 1 },
    ])
    await syncWeddingBookingEvent(
      db as any,
      WED,
      { date: '2026-12-05', title: 'Jordan & Riley', startTime: null, durationHours: null }
    )
    const rows = bookings(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe('2026-12-05')
  })

  it('derives an end time and a timed (non all-day) row from a ceremony time + duration', async () => {
    const db = new MockD1Database()
    db.seed('calendar_events', [])
    await syncWeddingBookingEvent(
      db as any,
      WED,
      { date: '2026-11-21', title: 'Jordan & Riley', startTime: '14:00', durationHours: 3 },
      VENDOR
    )
    const rows = bookings(db)
    expect(rows[0].all_day).toBe(0)
    expect(rows[0].start_time).toBe('14:00')
    expect(rows[0].end_time).toBe('17:00')
  })
})
