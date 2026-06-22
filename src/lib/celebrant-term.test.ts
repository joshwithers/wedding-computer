import { describe, it, expect } from 'vitest'
import { celebrantTermOf, celebrantTermLabel, normalizeCelebrantTerm, displayRoles } from './celebrant-term'

describe('celebrantTermOf / celebrantTermLabel', () => {
  it('defaults to celebrant', () => {
    expect(celebrantTermOf(null)).toBe('celebrant')
    expect(celebrantTermOf({ celebrant_term: null })).toBe('celebrant')
    expect(celebrantTermLabel({ celebrant_term: null })).toBe('Celebrant')
  })
  it('honours the officiant preference', () => {
    expect(celebrantTermOf({ celebrant_term: 'officiant' })).toBe('officiant')
    expect(celebrantTermLabel({ celebrant_term: 'officiant' })).toBe('Officiant')
  })
})

describe('normalizeCelebrantTerm', () => {
  it('only accepts officiant, else null', () => {
    expect(normalizeCelebrantTerm('officiant')).toBe('officiant')
    expect(normalizeCelebrantTerm('Officiant')).toBe('officiant')
    expect(normalizeCelebrantTerm('')).toBe(null)
    expect(normalizeCelebrantTerm('celebrant')).toBe(null)
    expect(normalizeCelebrantTerm(undefined)).toBe(null)
  })
})

describe('displayRoles', () => {
  it('swaps celebrant→officiant for display only when the term is officiant', () => {
    expect(displayRoles(['photographer', 'celebrant'], 'officiant')).toEqual(['photographer', 'officiant'])
  })
  it('leaves roles untouched when the term is default', () => {
    expect(displayRoles(['celebrant'], null)).toEqual(['celebrant'])
    expect(displayRoles(['celebrant'], 'celebrant')).toEqual(['celebrant'])
  })
})
