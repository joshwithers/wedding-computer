import { describe, it, expect } from 'vitest'
import { describeDemand, seasonOf, weekendBucketOf, ordinal, formatVsAverage } from './busyness'

describe('describeDemand — score → tier interpretation', () => {
  it('reports missing data as neutral "normal", not an error state', () => {
    expect(describeDemand(null).tier).toBe('normal')
    expect(describeDemand(undefined).tier).toBe('normal')
    expect(describeDemand(Number.NaN).tier).toBe('normal')
    expect(describeDemand(null).label).toBe('Normal demand')
  })

  it('buckets a very high score (>= 2.0)', () => {
    expect(describeDemand(2.0).tier).toBe('high')
    expect(describeDemand(3.7).tier).toBe('high')
    expect(describeDemand(2.0).label).toBe('Very high demand')
  })

  it('buckets above-average (1.0 <= score < 2.0)', () => {
    expect(describeDemand(1.0).tier).toBe('above')
    expect(describeDemand(1.9).tier).toBe('above')
    expect(describeDemand(1.0).label).toBe('Above-average demand')
  })

  it('buckets below-average (0.5 <= score < 1.0)', () => {
    expect(describeDemand(0.5).tier).toBe('below')
    expect(describeDemand(0.99).tier).toBe('below')
  })

  it('buckets a quiet date (score < 0.5, including 0)', () => {
    expect(describeDemand(0).tier).toBe('quiet')
    expect(describeDemand(0.49).tier).toBe('quiet')
    expect(describeDemand(0).label).toBe('Quiet date')
  })

  it('always returns Tailwind classes for the dot and text', () => {
    for (const s of [null, 0, 0.5, 1, 2] as const) {
      const d = describeDemand(s)
      expect(d.dotClass).toMatch(/^bg-/)
      expect(d.textClass).toMatch(/^text-/)
    }
  })
})

describe('seasonOf — southern-hemisphere seasons', () => {
  it('maps every month to its season', () => {
    expect(seasonOf(12)).toBe('summer')
    expect(seasonOf(1)).toBe('summer')
    expect(seasonOf(2)).toBe('summer')
    expect(seasonOf(3)).toBe('autumn')
    expect(seasonOf(5)).toBe('autumn')
    expect(seasonOf(6)).toBe('winter')
    expect(seasonOf(8)).toBe('winter')
    expect(seasonOf(9)).toBe('spring')
    expect(seasonOf(11)).toBe('spring')
  })
})

describe('weekendBucketOf — Nth weekend of the month, Saturday-anchored', () => {
  it('puts Fri, Sat, and Sun of the same weekend in the same bucket', () => {
    // Sat 19 Sep 2026 is the 3rd Saturday of September
    expect(weekendBucketOf('2026-09-19')).toEqual({ year: 2026, month: 9, index: 3 })
    expect(weekendBucketOf('2026-09-18')).toEqual({ year: 2026, month: 9, index: 3 }) // Friday
    expect(weekendBucketOf('2026-09-20')).toEqual({ year: 2026, month: 9, index: 3 }) // Sunday
  })

  it('returns null for weekday dates', () => {
    expect(weekendBucketOf('2026-09-15')).toBeNull() // Tuesday
    expect(weekendBucketOf('2026-09-17')).toBeNull() // Thursday
  })

  it('anchors month-boundary Fri/Sun to their Saturday', () => {
    // Sun 1 Mar 2026 belongs to the weekend of Sat 28 Feb 2026 (4th Saturday)
    expect(weekendBucketOf('2026-03-01')).toEqual({ year: 2026, month: 2, index: 4 })
    // Fri 30 Jan 2026 belongs to Sat 31 Jan 2026 — a 5th weekend
    expect(weekendBucketOf('2026-01-30')).toEqual({ year: 2026, month: 1, index: 5 })
  })

  it('handles year boundaries via the anchor Saturday', () => {
    // Fri 31 Dec 2027 → Sat 1 Jan 2028, the 1st weekend of January 2028
    expect(weekendBucketOf('2027-12-31')).toEqual({ year: 2028, month: 1, index: 1 })
  })

  it('rejects malformed dates', () => {
    expect(weekendBucketOf('')).toBeNull()
    expect(weekendBucketOf('20260919')).toBeNull()
  })
})

describe('ordinal', () => {
  it('formats weekend indices', () => {
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(4)).toBe('4th')
    expect(ordinal(5)).toBe('5th')
  })
})

describe('formatVsAverage — relative phrasing, never absolute counts', () => {
  it('treats ±10% and missing data as in line with average', () => {
    expect(formatVsAverage(1.0, 'month')).toBe('in line with the average month')
    expect(formatVsAverage(1.1, 'month')).toBe('in line with the average month')
    expect(formatVsAverage(0.9, 'month')).toBe('in line with the average month')
    expect(formatVsAverage(null, 'month')).toBe('in line with the average month')
    expect(formatVsAverage(Number.NaN, 'date')).toBe('in line with the average date')
  })

  it('uses signed percentages below 2×', () => {
    expect(formatVsAverage(1.45, 'month')).toBe('+45% vs the average month')
    expect(formatVsAverage(0.7, 'weekend')).toBe('−30% vs the average weekend')
    expect(formatVsAverage(1.99, 'season')).toBe('+99% vs the average season')
  })

  it('switches to a multiplier at 2× and above', () => {
    expect(formatVsAverage(2.0, 'month')).toBe('2× the average month')
    expect(formatVsAverage(3.25, 'date')).toBe('3.3× the average date')
  })

  it('goes qualitative at 5× so sparse data does not read as fake precision', () => {
    expect(formatVsAverage(5, 'weekend')).toBe('well above the average weekend')
    expect(formatVsAverage(52, 'weekend')).toBe('well above the average weekend')
  })
})
