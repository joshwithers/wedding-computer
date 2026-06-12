import { describe, expect, it } from 'vitest'
import { vendorCategories, hasCategory, isManagerVendor, categoriesLabel } from './categories'

describe('vendorCategories', () => {
  it('parses the categories JSON array', () => {
    expect(vendorCategories({ category: 'photographer', categories: '["photographer","videographer"]' }))
      .toEqual(['photographer', 'videographer'])
  })

  it('falls back to the primary category when categories is null', () => {
    expect(vendorCategories({ category: 'celebrant', categories: null })).toEqual(['celebrant'])
  })

  it('falls back on malformed JSON', () => {
    expect(vendorCategories({ category: 'florist', categories: 'not-json' })).toEqual(['florist'])
    expect(vendorCategories({ category: 'florist', categories: '[]' })).toEqual(['florist'])
  })
})

describe('hasCategory', () => {
  it('matches any of the vendor types', () => {
    const vendor = { category: 'planner', categories: '["planner","celebrant"]' }
    expect(hasCategory(vendor, 'celebrant')).toBe(true)
    expect(hasCategory(vendor, 'photographer')).toBe(false)
  })
})

describe('isManagerVendor', () => {
  it('is true for planners and venues, in any position', () => {
    expect(isManagerVendor({ category: 'planner', categories: null })).toBe(true)
    expect(isManagerVendor({ category: 'photographer', categories: '["photographer","venue"]' })).toBe(true)
  })

  it('is false for everyone else', () => {
    expect(isManagerVendor({ category: 'celebrant', categories: '["celebrant","photographer"]' })).toBe(false)
  })
})

describe('categoriesLabel', () => {
  it('joins capitalised types', () => {
    expect(categoriesLabel({ category: 'photographer', categories: '["photographer","videographer"]' }))
      .toBe('Photographer · Videographer')
  })
})
