import { describe, it, expect } from 'vitest'
import { buildIcalFeed, buildTimelineFeed, buildVevent, buildTimelineVevent, buildWeddingDayVevent } from './ical'
import type { EnrichedCalendarEvent } from '../types'
import type { UserCalendarRow } from '../db/timeline'
import type { WeddingDayRow } from '../db/weddings'

function booking(over: Partial<EnrichedCalendarEvent> = {}): EnrichedCalendarEvent {
  return {
    id: 'aaaa1111bbbb2222cccc3333',
    title: 'Smith Wedding',
    date: '2026-09-12',
    start_time: '13:00',
    end_time: '21:00',
    all_day: 0,
    type: 'booking',
    notes: null,
    wedding_id: 'wed1',
    created_at: '2026-06-01 00:00:00',
    updated_at: '2026-06-01 00:00:00',
    wedding_title: 'Smith Wedding',
    couple_names: null,
    couple_email: null,
    timeline_item_title: null,
    timeline_item_description: null,
    wedding_location_state: null,
    wedding_location_country: null,
    ...over,
  } as EnrichedCalendarEvent
}

function row(over: Partial<UserCalendarRow> = {}): UserCalendarRow {
  return {
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
    couple_names: null,
    couple_email: null,
    wedding_location: null,
    wedding_location_state: null,
    wedding_location_country: null,
    ...over,
  }
}

function weddingDay(over: Partial<WeddingDayRow> = {}): WeddingDayRow {
  return {
    id: 'eeee7777ffff8888aaaa9999',
    wedding_title: 'Smith Wedding',
    date: '2026-09-12',
    time: '14:00',
    emoji: null,
    ceremony_type: 'wedding',
    ceremony_location: null,
    location: 'Byron Bay',
    location_state: null,
    location_country: null,
    couple_names: null,
    couple_email: null,
    created_at: '2026-06-01 00:00:00',
    updated_at: '2026-06-02 00:00:00',
    ...over,
  }
}

describe('buildVevent (booking events)', () => {
  it('titles a wc: slot event with full couple names + the real timeline item title', () => {
    const lines = buildVevent(
      booking({
        notes: 'wc:ceremony',
        timeline_item_title: 'Exchange of vows',
        contact_first_name: 'Olivia',
        contact_last_name: 'Smith',
        partner_first_name: 'Ethan',
        partner_last_name: 'Jones',
      }),
      'Australia/Sydney'
    )
    expect(lines).toContain('SUMMARY:Olivia Smith & Ethan Jones — Exchange of vows')
  })

  it('falls back to the slot label (not "Ceremony") for the synthetic prep block', () => {
    const lines = buildVevent(booking({ notes: 'wc:ceremony_prep', couple_names: 'Olivia & Ethan' }), 'Australia/Sydney')
    expect(lines).toContain('SUMMARY:Olivia & Ethan — Ceremony prep')
  })

  it('uses couple_names when the vendor owns no contact (added-to wedding)', () => {
    const lines = buildVevent(booking({ notes: 'wc:reception', couple_names: 'Olivia & Ethan' }), 'Australia/Sydney')
    expect(lines).toContain('SUMMARY:Olivia & Ethan — Reception')
  })

  it('keeps a manual (non-wc) event title untouched', () => {
    const lines = buildVevent(booking({ notes: null, title: 'Personal: dentist', type: 'personal' }), 'Australia/Sydney')
    expect(lines).toContain('SUMMARY:Personal: dentist')
  })

  it('emits times in the wedding venue timezone, derived from its state/country', () => {
    const lines = buildVevent(
      booking({ notes: 'wc:ceremony', wedding_location_state: 'Victoria', wedding_location_country: 'Australia' }),
      'Australia/Sydney' // vendor feed tz — should be overridden by the venue
    )
    expect(lines.some((l) => l.startsWith('DTSTART;TZID=Australia/Melbourne:20260912T130000'))).toBe(true)
  })

  it('falls back to the feed timezone when the wedding has no location', () => {
    const lines = buildVevent(booking({ notes: 'wc:ceremony' }), 'Pacific/Auckland')
    expect(lines.some((l) => l.startsWith('DTSTART;TZID=Pacific/Auckland:'))).toBe(true)
  })

  it('description leads with the timeline item note + surfaces the couple for added vendors, and never shows the wc: tag', () => {
    const desc = buildVevent(
      booking({
        notes: 'wc:ceremony',
        timeline_item_description: 'Acoustic guitar during the processional',
        couple_names: 'Olivia & Ethan',
        couple_email: 'olivia@example.com',
      }),
      'Australia/Sydney'
    ).find((l) => l.startsWith('DESCRIPTION:'))!
    expect(desc).toContain('Acoustic guitar during the processional')
    expect(desc).toContain('Olivia & Ethan')
    expect(desc).toContain('olivia@example.com')
    expect(desc).not.toContain('wc:ceremony')
  })
})

describe('buildTimelineVevent (assigned run-sheet items)', () => {
  it('titles "couple — item title" and uses the venue timezone', () => {
    const lines = buildTimelineVevent(
      row({ couple_names: 'Olivia Smith & Ethan Jones', wedding_location_state: 'Queensland', wedding_location_country: 'Australia' }),
      'Australia/Sydney'
    )
    expect(lines).toContain('SUMMARY:Olivia Smith & Ethan Jones — Bump in')
    expect(lines.some((l) => l.startsWith('DTSTART;TZID=Australia/Brisbane:20260912T110000'))).toBe(true)
  })

  it('defaults a null-ended row to a 1h block', () => {
    const lines = buildTimelineVevent(row(), 'Australia/Sydney')
    expect(lines.some((l) => l.startsWith('DTSTART;TZID=Australia/Sydney:20260912T110000'))).toBe(true)
    expect(lines.some((l) => l.startsWith('DTEND;TZID=Australia/Sydney:20260912T120000'))).toBe(true)
  })
})

describe('buildIcalFeed timeline union', () => {
  it('wraps both bookings and timeline rows with distinct UIDs', () => {
    const ical = buildIcalFeed([booking()], 'Acme Flowers', 'Australia/Sydney', [row()])
    expect(ical.match(/BEGIN:VCALENDAR/g)).toHaveLength(1)
    expect(ical.match(/END:VCALENDAR/g)).toHaveLength(1)
    expect(ical).toContain(`UID:${booking().id}@weddingcomputer.com`)
    expect(ical).toContain(`UID:ts-${row().id}@weddingcomputer.com`)
    expect(ical).toContain('SUMMARY:Smith Wedding — Bump in')
  })

  it('is identical to bookings-only when no timeline rows are passed', () => {
    const withEmpty = buildIcalFeed([booking()], 'Acme Flowers', 'Australia/Sydney', [])
    const without = buildIcalFeed([booking()], 'Acme Flowers', 'Australia/Sydney')
    expect(withEmpty).toBe(without)
    expect(without).not.toContain('ts-')
  })

  it('excludes legacy wc:* booking events but keeps manual events + timeline rows', () => {
    const ical = buildIcalFeed(
      [booking({ id: 'wc1', notes: 'wc:ceremony', title: 'Smith — Ceremony' }), booking({ id: 'manual1', notes: 'Bring spare lens', title: 'Personal block', type: 'personal' })],
      'Acme',
      'Australia/Sydney',
      [row({ title: 'Bump in' })]
    )
    expect(ical).not.toContain('UID:wc1@')          // legacy slot event dropped
    expect(ical).toContain('UID:manual1@')          // manual event kept
    expect(ical).toContain('SUMMARY:Smith Wedding — Bump in') // assigned run-sheet item rendered
  })

  it('produces a valid (empty) calendar when only wc:* events exist and nothing is assigned', () => {
    const ical = buildIcalFeed([booking({ notes: 'wc:ceremony' })], 'Acme', 'Australia/Sydney', [])
    expect(ical.match(/BEGIN:VCALENDAR/g)).toHaveLength(1)
    expect(ical.match(/END:VCALENDAR/g)).toHaveLength(1)
    expect(ical).not.toContain('BEGIN:VEVENT')
  })
})

describe('buildWeddingDayVevent (all-day wedding marker)', () => {
  it('emits an all-day VALUE=DATE event spanning one day with a wd- UID — never timed', () => {
    const lines = buildWeddingDayVevent(weddingDay({ couple_names: 'Olivia & Ethan' }), 'Australia/Sydney')
    expect(lines).toContain('UID:wd-eeee7777ffff8888aaaa9999@weddingcomputer.com')
    expect(lines).toContain('DTSTART;VALUE=DATE:20260912')
    expect(lines).toContain('DTEND;VALUE=DATE:20260913')
    expect(lines.some((l) => l.startsWith('DTSTART;TZID='))).toBe(false)
    // A non-blocking banner so it doesn't double-count busy time with the run sheet.
    expect(lines).toContain('TRANSP:TRANSPARENT')
  })

  it('titles with the couple names + default ring emoji, falling back to the wedding title + its own emoji', () => {
    expect(buildWeddingDayVevent(weddingDay({ couple_names: 'Olivia & Ethan' }), 'Australia/Sydney'))
      .toContain('SUMMARY:💍 Olivia & Ethan — Wedding day')
    expect(buildWeddingDayVevent(weddingDay({ couple_names: null, emoji: '🌸' }), 'Australia/Sydney'))
      .toContain('SUMMARY:🌸 Smith Wedding — Wedding day')
  })

  it('surfaces the couple, email and ceremony time in the description', () => {
    const desc = buildWeddingDayVevent(
      weddingDay({ couple_names: 'Olivia & Ethan', couple_email: 'olivia@example.com', time: '14:30' }),
      'Australia/Sydney'
    ).find((l) => l.startsWith('DESCRIPTION:'))!
    expect(desc).toContain('Olivia & Ethan')
    expect(desc).toContain('olivia@example.com')
    expect(desc).toContain('14:30')
  })
})

describe('feed wedding-day union', () => {
  it('buildIcalFeed appends the all-day marker alongside bookings + timeline rows', () => {
    const ical = buildIcalFeed([booking()], 'Acme Flowers', 'Australia/Sydney', [row()], [weddingDay()])
    expect(ical).toContain('UID:wd-eeee7777ffff8888aaaa9999@weddingcomputer.com')
    expect(ical).toContain('DTSTART;VALUE=DATE:20260912')
    expect(ical.match(/BEGIN:VCALENDAR/g)).toHaveLength(1)
  })

  it('buildTimelineFeed (personal/couple feed) includes wedding-day markers', () => {
    const ical = buildTimelineFeed([row()], 'Olivia — wedding day', 'Australia/Sydney', [weddingDay()])
    expect(ical).toContain('UID:wd-eeee7777ffff8888aaaa9999@weddingcomputer.com')
    expect(ical).toContain('SUMMARY:💍 Smith Wedding — Wedding day')
  })

  it('is identical to the no-wedding-days form when none are passed', () => {
    const withEmpty = buildIcalFeed([booking()], 'Acme', 'Australia/Sydney', [row()], [])
    const without = buildIcalFeed([booking()], 'Acme', 'Australia/Sydney', [row()])
    expect(withEmpty).toBe(without)
    expect(without).not.toContain('wd-')
  })
})
