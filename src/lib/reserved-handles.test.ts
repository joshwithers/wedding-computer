import { describe, it, expect } from 'vitest'
import { isReservedHandle, normalizeHandle, RESERVED_HANDLES } from './reserved-handles'

describe('normalizeHandle', () => {
  it('lowercases + strips to the handle charset', () => {
    expect(normalizeHandle('  Admin ')).toBe('admin')
    expect(normalizeHandle('Married By Josh!')).toBe('marriedbyjosh')
    expect(normalizeHandle('no-reply')).toBe('no-reply')
  })
})

describe('isReservedHandle', () => {
  it('blocks role/system handles', () => {
    for (const h of ['admin', 'support', 'hello', 'info', 'billing', 'postmaster', 'no-reply']) {
      expect(isReservedHandle(h)).toBe(true)
    }
  })
  it('blocks our brand handles (Josh / EC / Brittany), case-insensitively', () => {
    for (const h of ['josh', 'Joshua', 'marriedbyjosh', 'JoshWithers', 'celebrant', 'brittany', 'britt', 'ec', 'elopementcollective', 'withers']) {
      expect(isReservedHandle(h)).toBe(true)
    }
  })
  it('blocks generic wedding terms', () => {
    for (const h of ['wedding', 'weddings', 'elopement', 'love', 'bride', 'groom']) {
      expect(isReservedHandle(h)).toBe(true)
    }
  })
  it('allows a legitimate, longer/specific handle (exact match only — no over-blocking)', () => {
    for (const h of ['joshsmithphoto', 'bloomandco', 'sarahsflowers', 'ericweds']) {
      expect(isReservedHandle(h)).toBe(false)
    }
  })
  it('treats empty / null as not reserved', () => {
    expect(isReservedHandle('')).toBe(false)
    expect(isReservedHandle(null)).toBe(false)
    expect(isReservedHandle(undefined)).toBe(false)
  })
  it('every entry is already normalised (charset-safe)', () => {
    for (const h of RESERVED_HANDLES) expect(normalizeHandle(h)).toBe(h)
  })
})
