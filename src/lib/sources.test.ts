import { describe, it, expect } from 'vitest'
import { normalizeSource, sourceLabel, aggregateSources, ENQUIRY_SOURCES } from './sources'

describe('normalizeSource', () => {
  it('folds case and whitespace variants to one canonical value', () => {
    expect(normalizeSource('Website')).toBe('website')
    expect(normalizeSource('website')).toBe('website')
    expect(normalizeSource('  WEBSITE ')).toBe('website')
  })

  it('maps common aliases', () => {
    expect(normalizeSource('IG')).toBe('instagram')
    expect(normalizeSource('insta')).toBe('instagram')
    expect(normalizeSource('word of mouth')).toBe('word_of_mouth')
    expect(normalizeSource('Google Maps')).toBe('google_business')
    expect(normalizeSource('bridal expo')).toBe('wedding_fair')
    expect(normalizeSource('zapier')).toBe('api')
  })

  it('empty / nullish → other', () => {
    expect(normalizeSource('')).toBe('other')
    expect(normalizeSource(null)).toBe('other')
    expect(normalizeSource(undefined)).toBe('other')
  })

  it('passes through unknown-but-clean values consistently', () => {
    expect(normalizeSource('Wedding Blog')).toBe('wedding_blog')
    expect(normalizeSource('wedding-blog')).toBe('wedding_blog')
  })
})

describe('sourceLabel', () => {
  it('uses canonical labels', () => {
    expect(sourceLabel('instagram')).toBe('Instagram')
    expect(sourceLabel('word_of_mouth')).toBe('Word of mouth')
  })
  it('title-cases unknown values', () => {
    expect(sourceLabel('wedding_blog')).toBe('Wedding blog')
  })
})

describe('aggregateSources', () => {
  it('merges case/alias duplicates that SQL left separate', () => {
    const rows = [
      { source: 'website', count: 2 },
      { source: 'Website', count: 3 },
      { source: 'IG', count: 1 },
      { source: 'instagram', count: 4 },
    ]
    const out = aggregateSources(rows)
    // website 5, instagram 5 — merged, sorted desc, no duplicate "Website"
    expect(out).toHaveLength(2)
    const byLabel = Object.fromEntries(out.map((s) => [s.label, s.count]))
    expect(byLabel['Website']).toBe(5)
    expect(byLabel['Instagram']).toBe(5)
  })

  it('handles nulls as Other', () => {
    const out = aggregateSources([{ source: null, count: 2 }])
    expect(out[0]).toMatchObject({ value: 'other', label: 'Other', count: 2 })
  })
})

describe('ENQUIRY_SOURCES', () => {
  it('has unique canonical values', () => {
    const values = ENQUIRY_SOURCES.map((s) => s.value)
    expect(new Set(values).size).toBe(values.length)
  })
})
