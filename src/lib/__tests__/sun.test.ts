import { describe, it, expect } from 'vitest'
import { sunTimes, resolveLocationTimezone, daylightStrip } from '../sun'

// Parse "5:23 pm" / "5:23 am" → minutes since midnight.
function toMinutes(s: string | null): number {
  if (!s) throw new Error('null time')
  const m = s.toLowerCase().match(/(\d+):(\d+)\s*(am|pm)/)
  if (!m) throw new Error(`unparseable: ${s}`)
  let h = Number(m[1]) % 12
  if (m[3] === 'pm') h += 12
  return h * 60 + Number(m[2])
}

describe('sunTimes', () => {
  // Reference values cross-checked with timeanddate.com for Sydney.
  it('Sydney summer solstice (DST) — sunset ~8:05pm, sunrise ~5:40am', () => {
    const strip = daylightStrip({
      lat: -33.8688, lng: 151.2093, dateStr: '2025-12-21',
      country: 'Australia', state: 'New South Wales',
      fallbackTimezone: 'UTC', locale: 'en-AU',
    })!
    expect(strip.timezone).toBe('Australia/Sydney')
    expect(toMinutes(strip.sunrise)).toBeGreaterThan(5 * 60 + 30)
    expect(toMinutes(strip.sunrise)).toBeLessThan(5 * 60 + 55)
    expect(toMinutes(strip.sunset)).toBeGreaterThan(19 * 60 + 50)
    expect(toMinutes(strip.sunset)).toBeLessThan(20 * 60 + 20)
    // Golden hour starts before sunset.
    expect(toMinutes(strip.goldenHourStart)).toBeLessThan(toMinutes(strip.sunset))
  })

  it('Sydney winter solstice — sunset ~4:54pm, sunrise ~7:00am', () => {
    const strip = daylightStrip({
      lat: -33.8688, lng: 151.2093, dateStr: '2025-06-21',
      country: 'Australia', state: 'New South Wales',
      fallbackTimezone: 'UTC', locale: 'en-AU',
    })!
    expect(toMinutes(strip.sunrise)).toBeGreaterThan(6 * 60 + 50)
    expect(toMinutes(strip.sunrise)).toBeLessThan(7 * 60 + 10)
    expect(toMinutes(strip.sunset)).toBeGreaterThan(16 * 60 + 45)
    expect(toMinutes(strip.sunset)).toBeLessThan(17 * 60 + 5)
  })

  it('returns Date instants in UTC for a known day', () => {
    const s = sunTimes(new Date(Date.UTC(2025, 11, 21, 12)), -33.8688, 151.2093)
    expect(s.sunset).toBeInstanceOf(Date)
    expect(s.sunrise).toBeInstanceOf(Date)
  })
})

describe('resolveLocationTimezone', () => {
  it('maps Australian states to the right zone incl. DST behaviour', () => {
    expect(resolveLocationTimezone('Australia', 'Queensland', 'UTC')).toBe('Australia/Brisbane')
    expect(resolveLocationTimezone('Australia', 'Western Australia', 'UTC')).toBe('Australia/Perth')
    expect(resolveLocationTimezone('Australia', 'Victoria', 'UTC')).toBe('Australia/Melbourne')
    expect(resolveLocationTimezone('Australia', 'New South Wales', 'UTC')).toBe('Australia/Sydney')
  })
  it('uses common-country zones', () => {
    expect(resolveLocationTimezone('New Zealand', null, 'UTC')).toBe('Pacific/Auckland')
  })
  it('falls back when unknown', () => {
    expect(resolveLocationTimezone('United States', 'California', 'Australia/Sydney')).toBe('Australia/Sydney')
  })
})

describe('daylightStrip', () => {
  it('returns null without coordinates or date', () => {
    expect(daylightStrip({ lat: null, lng: 151, dateStr: '2025-12-21', fallbackTimezone: 'UTC', locale: 'en-AU' })).toBeNull()
    expect(daylightStrip({ lat: -33, lng: 151, dateStr: null, fallbackTimezone: 'UTC', locale: 'en-AU' })).toBeNull()
  })
})
