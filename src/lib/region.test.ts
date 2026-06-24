import { describe, it, expect } from 'vitest'
import { resolveRegion, slugify } from './region'

describe('slugify', () => {
  it('normalises to a stable, accent-free slug', () => {
    expect(slugify('New South Wales')).toBe('new-south-wales')
    expect(slugify('United States')).toBe('united-states')
    expect(slugify('Île-de-France')).toBe('ile-de-france')
    expect(slugify('  Trailing/punct!  ')).toBe('trailing-punct')
  })
})

describe('resolveRegion', () => {
  it('slugifies the country name and tags the state', () => {
    const r = resolveRegion({ country: 'Australia', state: 'New South Wales', lat: -33.87 })
    expect(r.countryCode).toBe('australia')
    expect(r.countryName).toBe('Australia')
    expect(r.subdivisionCode).toBe('new-south-wales')
    expect(r.subdivisionLabel).toBe('New South Wales')
    expect(r.hemisphere).toBe('south')
  })

  it('merges UK constituents into one country room', () => {
    expect(resolveRegion({ country: 'England' }).countryCode).toBe('united-kingdom')
    expect(resolveRegion({ country: 'Scotland' }).countryName).toBe('United Kingdom')
    expect(resolveRegion({ country: 'England' }).hemisphere).toBe('north')
  })

  it('falls back to the locale country when no place is given', () => {
    const r = resolveRegion({ locale: 'en-GB' })
    expect(r.countryName).toBe('United Kingdom')
    expect(r.countryCode).toBe('united-kingdom')
  })

  it('lets latitude decide hemisphere for equator-straddling countries', () => {
    expect(resolveRegion({ country: 'Brazil', lat: -23.5 }).hemisphere).toBe('south')
    expect(resolveRegion({ country: 'Ecuador', lat: 0.2 }).hemisphere).toBe('north')
  })

  it('is empty and southern-default when nothing is known', () => {
    const r = resolveRegion({})
    expect(r.countryCode).toBe('')
    expect(r.subdivisionCode).toBeNull()
    expect(r.hemisphere).toBe('south')
  })
})
