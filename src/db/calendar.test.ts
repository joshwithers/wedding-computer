import { describe, it, expect } from 'vitest'
import { syncWeddingBookingEvent } from './calendar'
import { MockD1Database } from '../storage/__tests__/mock-d1'

const WED = 'wwwwwwwwwwwwwwwwwwwwwwww'
const VENDOR = 'vvvvvvvvvvvvvvvvvvvvvvvv'
const VENDOR2 = 'vvvvvvvvvvvvvvvvvvvvvv22'

function bookings(db: MockD1Database) {
  return db.getTable('calendar_events').filter((e) => e.type === 'booking' && e.wedding_id === WED)
}

function member(vendorProfileId: string) {
  return { wedding_id: WED, role: 'vendor', status: 'active', vendor_profile_id: vendorProfileId }
}

describe('syncWeddingBookingEvent', () => {
  it('creates a booking row for an active vendor member when a date is first set (undated → dated)', async () => {
    const db = new MockD1Database()
    db.seed('calendar_events', [])
    db.seed('wedding_members', [member(VENDOR)])
    await syncWeddingBookingEvent(db as any, WED, { date: '2026-11-21', title: 'Jordan & Riley', startTime: null, durationHours: null })
    const rows = bookings(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe('2026-11-21')
    expect(rows[0].vendor_id).toBe(VENDOR)
    expect(rows[0].all_day).toBe(1) // no ceremony time → all-day
  })

  it('ensures EVERY active vendor member has a row, not just one (multi-vendor wedding)', async () => {
    const db = new MockD1Database()
    // VENDOR already has a row; VENDOR2 is on the wedding but has none yet.
    db.seed('calendar_events', [
      { id: 'ev1', vendor_id: VENDOR, wedding_id: WED, type: 'booking', date: '2026-11-21', all_day: 1 },
    ])
    db.seed('wedding_members', [member(VENDOR), member(VENDOR2)])
    await syncWeddingBookingEvent(db as any, WED, { date: '2026-12-05', title: 'Jordan & Riley', startTime: null, durationHours: null })
    const rows = bookings(db)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.date === '2026-12-05')).toBe(true) // existing moved + new created, both on the new date
    expect(new Set(rows.map((r) => r.vendor_id))).toEqual(new Set([VENDOR, VENDOR2]))
  })

  it('moves an existing row without creating a duplicate for the same vendor', async () => {
    const db = new MockD1Database()
    db.seed('calendar_events', [
      { id: 'ev1', vendor_id: VENDOR, wedding_id: WED, type: 'booking', date: '2026-11-21', all_day: 1 },
    ])
    db.seed('wedding_members', [member(VENDOR)])
    await syncWeddingBookingEvent(db as any, WED, { date: '2026-12-05', title: 'Jordan & Riley', startTime: null, durationHours: null })
    const rows = bookings(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe('2026-12-05')
  })

  it('deletes the booking row(s) when the date is cleared (dated → undated)', async () => {
    const db = new MockD1Database()
    db.seed('calendar_events', [
      { id: 'ev1', vendor_id: VENDOR, wedding_id: WED, type: 'booking', date: '2026-12-05', all_day: 1 },
      { id: 'ev2', vendor_id: VENDOR2, wedding_id: WED, type: 'booking', date: '2026-12-05', all_day: 1 },
    ])
    db.seed('wedding_members', [member(VENDOR), member(VENDOR2)])
    await syncWeddingBookingEvent(db as any, WED, { date: null, title: 'Jordan & Riley', startTime: null, durationHours: null })
    expect(bookings(db)).toHaveLength(0)
  })

  it('derives an end time and a timed (non all-day) row from a ceremony time + duration', async () => {
    const db = new MockD1Database()
    db.seed('calendar_events', [])
    db.seed('wedding_members', [member(VENDOR)])
    await syncWeddingBookingEvent(db as any, WED, { date: '2026-11-21', title: 'Jordan & Riley', startTime: '14:00', durationHours: 3 })
    const rows = bookings(db)
    expect(rows[0].all_day).toBe(0)
    expect(rows[0].start_time).toBe('14:00')
    expect(rows[0].end_time).toBe('17:00')
  })
})
