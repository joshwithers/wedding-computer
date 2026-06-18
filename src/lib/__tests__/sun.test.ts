import { describe, it, expect } from 'vitest'
import { sunTimes, resolveLocationTimezone, daylightStrip, resolveLatLng } from '../sun'

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
  it('returns null without a date, or when nothing in the location resolves', () => {
    expect(daylightStrip({ lat: -33, lng: 151, dateStr: null, fallbackTimezone: 'UTC', locale: 'en-AU' })).toBeNull()
    // No coords AND no place text → nothing to place.
    expect(daylightStrip({ lat: null, lng: null, dateStr: '2025-12-21', fallbackTimezone: 'UTC', locale: 'en-AU' })).toBeNull()
    // Coords absent and the country is large/multi-zone → we don't guess.
    expect(daylightStrip({ dateStr: '2025-12-21', location: 'Springfield, USA', country: 'United States', fallbackTimezone: 'UTC', locale: 'en-AU' })).toBeNull()
  })

  it('falls back to region coordinates from the location text (approx)', () => {
    const strip = daylightStrip({
      lat: null, lng: null, dateStr: '2025-12-21',
      location: 'Some Vineyard, Gold Coast QLD, Australia',
      fallbackTimezone: 'Australia/Sydney', locale: 'en-AU',
    })!
    expect(strip.approx).toBe(true)
    // Gold Coast is QLD (no DST) → Brisbane zone, not the viewer's Sydney.
    expect(strip.timezone).toBe('Australia/Brisbane')
    expect(strip.sunrise).toBeTruthy()
    expect(strip.sunset).toBeTruthy()
  })
})

describe('resolveLatLng', () => {
  it('prefers precise geocoded coordinates (approx=false) over the gazetteer', () => {
    const r = resolveLatLng({ lat: -33.8688, lng: 151.2093, location: 'Gold Coast QLD', country: 'Australia', state: 'New South Wales', fallbackTimezone: 'UTC' })!
    expect(r.approx).toBe(false)
    expect(r.lat).toBe(-33.8688)
    expect(r.timezone).toBe('Australia/Sydney') // from parsed state
  })

  it('matches a city before its state (more precise)', () => {
    const r = resolveLatLng({ location: 'Byron Bay NSW, Australia', fallbackTimezone: 'UTC' })!
    expect(r.approx).toBe(true)
    expect(r.lat).toBeCloseTo(-28.64, 1)
    expect(r.timezone).toBe('Australia/Sydney')
  })

  it('falls back to the state capital when only a state is known', () => {
    const r = resolveLatLng({ location: 'Tiny Town WA, Australia', fallbackTimezone: 'UTC' })!
    expect(r.timezone).toBe('Australia/Perth')
    expect(r.lng).toBeCloseTo(115.86, 1) // Perth
  })

  it('uses the parsed state field when location text is bare', () => {
    const r = resolveLatLng({ state: 'Tasmania', country: 'Australia', fallbackTimezone: 'UTC' })!
    expect(r.timezone).toBe('Australia/Hobart')
  })

  it('handles single-zone overseas countries', () => {
    const r = resolveLatLng({ location: 'A barn in the countryside, New Zealand', fallbackTimezone: 'UTC' })!
    expect(r.timezone).toBe('Pacific/Auckland')
  })

  it('does not guess coordinates for large multi-zone countries', () => {
    expect(resolveLatLng({ location: 'Austin, Texas', country: 'United States', fallbackTimezone: 'UTC' })).toBeNull()
  })

  it("does not match a state abbreviation hiding inside another word", () => {
    // "sa" must not match inside "Pasadena"; with no other signal → null.
    expect(resolveLatLng({ location: 'Pasadena Gardens', fallbackTimezone: 'UTC' })).toBeNull()
  })
})
