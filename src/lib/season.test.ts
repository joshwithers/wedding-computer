import { describe, it, expect } from 'vitest'
import { seasonForMonth, cohortForWedding } from './season'
import type { ResolvedRegion } from './region'

const south: ResolvedRegion = {
  countryCode: 'australia', countryName: 'Australia',
  subdivisionCode: null, subdivisionLabel: null, hemisphere: 'south',
}
const north: ResolvedRegion = {
  countryCode: 'united-states', countryName: 'United States',
  subdivisionCode: null, subdivisionLabel: null, hemisphere: 'north',
}

describe('seasonForMonth — hemisphere aware', () => {
  it('southern hemisphere (AU-first, matches lib/busyness seasonOf)', () => {
    expect(seasonForMonth(1, 'south')).toBe('summer') // Jan
    expect(seasonForMonth(4, 'south')).toBe('autumn') // Apr
    expect(seasonForMonth(7, 'south')).toBe('winter') // Jul
    expect(seasonForMonth(10, 'south')).toBe('spring') // Oct
    expect(seasonForMonth(12, 'south')).toBe('summer') // Dec
  })
  it('northern hemisphere is the southern wheel shifted six months', () => {
    expect(seasonForMonth(1, 'north')).toBe('winter') // Jan
    expect(seasonForMonth(4, 'north')).toBe('spring') // Apr
    expect(seasonForMonth(7, 'north')).toBe('summer') // Jul
    expect(seasonForMonth(10, 'north')).toBe('autumn') // Oct
    expect(seasonForMonth(12, 'north')).toBe('winter') // Dec
  })
})

describe('cohortForWedding', () => {
  it('builds a year-season-country key, hemisphere-correct', () => {
    expect(cohortForWedding('2027-04-18', south)).toEqual({
      year: 2027, season: 'autumn', cohortKey: '2027-autumn-australia',
    })
    // Same calendar date, northern country → opposite season.
    expect(cohortForWedding('2027-04-18', north)).toEqual({
      year: 2027, season: 'spring', cohortKey: '2027-spring-united-states',
    })
  })
  it('returns null when undated, malformed, or country unknown', () => {
    expect(cohortForWedding(null, south)).toBeNull()
    expect(cohortForWedding('not-a-date', south)).toBeNull()
    expect(cohortForWedding('2027-04-18', { ...south, countryCode: '' })).toBeNull()
  })
})
