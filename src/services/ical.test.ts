import { describe, it, expect } from 'vitest'
import { buildIcalFeed, buildTimelineVevent } from './ical'
import type { EnrichedCalendarEvent } from '../types'
import type { UserCalendarRow } from '../db/timeline'

const booking: EnrichedCalendarEvent = {
  id: 'aaaa1111bbbb2222cccc3333',
  title: 'Smith Wedding',
  date: '2026-09-12',
  start_time: '13:00',
  end_time: '21:00',
  all_day: 0,
  type: 'booking',
  created_at: '2026-06-01 00:00:00',
  updated_at: '2026-06-01 00:00:00',
} as EnrichedCalendarEvent

const bumpRow: UserCalendarRow = {
  id: 'dddd4444eeee5555ffff6666',
  title: 'Bump in',
  wedding_title: 'Smith Wedding',
  wedding_date: '2026-09-12',
  start_time: '11:00',
  end_time: null,
  location: 'Garden Pavilion',
  description: null,
  created_at: '2026-06-01 00:00:00',
  updated_at: '2026-06-02 00:00:00',
}

describe('buildIcalFeed timeline union', () => {
  it('emits one calendar wrapping both bookings and timeline rows', () => {
    const ical = buildIcalFeed([booking], 'Acme Flowers', 'Australia/Sydney', [bumpRow])
    expect(ical.match(/BEGIN:VCALENDAR/g)).toHaveLength(1)
    expect(ical.match(/END:VCALENDAR/g)).toHaveLength(1)
    // Booking + timeline rows carry distinct, non-colliding UIDs.
    expect(ical).toContain(`UID:${booking.id}@weddingcomputer.com`)
    expect(ical).toContain(`UID:ts-${bumpRow.id}@weddingcomputer.com`)
    expect(ical).toContain('SUMMARY:Bump in · Smith Wedding')
  })

  it('is identical to bookings-only when no timeline rows are passed', () => {
    const withEmpty = buildIcalFeed([booking], 'Acme Flowers', 'Australia/Sydney', [])
    const without = buildIcalFeed([booking], 'Acme Flowers', 'Australia/Sydney')
    expect(withEmpty).toBe(without)
    expect(without).not.toContain('ts-')
  })

  it('defaults a null-ended timeline row to a 1h block', () => {
    const lines = buildTimelineVevent(bumpRow, 'Australia/Sydney')
    expect(lines.some((l) => l.startsWith('DTSTART;TZID=Australia/Sydney:20260912T110000'))).toBe(true)
    expect(lines.some((l) => l.startsWith('DTEND;TZID=Australia/Sydney:20260912T120000'))).toBe(true)
  })
})
