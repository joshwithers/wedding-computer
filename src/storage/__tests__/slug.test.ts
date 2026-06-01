import { describe, it, expect } from 'vitest'
import { slugify, contactFilename, weddingFilename, deduplicateFilename } from '../slug'

describe('slugify', () => {
  it('converts to lowercase', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('strips accents/diacritics', () => {
    expect(slugify('José María')).toBe('jose-maria')
  })

  it('replaces spaces and special chars with hyphens', () => {
    expect(slugify("Sarah O'Brien")).toBe('sarah-obrien')
  })

  it('collapses multiple hyphens', () => {
    expect(slugify('first - - last')).toBe('first-last')
  })

  it('trims leading/trailing hyphens', () => {
    expect(slugify('  hello  ')).toBe('hello')
  })

  it('falls back to "untitled" for empty strings', () => {
    expect(slugify('')).toBe('untitled')
  })

  it('falls back to "untitled" for strings with only special characters', () => {
    const result = slugify('!!!@@@###')
    expect(result).toBe('untitled')
  })

  it('handles unicode names (NFKD decomposition)', () => {
    // ð decomposes to ð (stays as-is in NFKD), so it becomes a hyphen
    expect(slugify('Björk Guðmundsdóttir')).toBe('bjork-gu-mundsdottir')
  })
})

describe('contactFilename', () => {
  it('generates filename from first + last name', () => {
    expect(contactFilename('John', 'Doe', null, null)).toBe('john-doe.md')
  })

  it('includes partner names when present', () => {
    expect(contactFilename('Sarah', 'Smith', 'James', 'Wilson')).toBe(
      'sarah-smith-james-wilson.md'
    )
  })

  it('handles partner with first name only', () => {
    expect(contactFilename('Sarah', 'Smith', 'James', null)).toBe(
      'sarah-smith-james.md'
    )
  })

  it('falls back to "untitled" when names are empty', () => {
    const result = contactFilename('', '', null, null)
    expect(result).toBe('untitled.md')
  })
})

describe('weddingFilename', () => {
  it('generates filename from title and date', () => {
    expect(weddingFilename('Sarah & James', '2026-12-15')).toBe(
      'sarah-james-2026-12-15.md'
    )
  })

  it('handles title without date', () => {
    expect(weddingFilename('A Beautiful Wedding', null)).toBe(
      'a-beautiful-wedding.md'
    )
  })

  it('falls back to "untitled" when title is empty', () => {
    expect(weddingFilename('', null)).toBe('untitled.md')
  })
})

describe('deduplicateFilename', () => {
  it('returns original when no conflicts', () => {
    const existing = new Set<string>()
    expect(deduplicateFilename('john-doe.md', existing)).toBe('john-doe.md')
  })

  it('appends -2 when name exists', () => {
    const existing = new Set(['john-doe.md'])
    expect(deduplicateFilename('john-doe.md', existing)).toBe('john-doe-2.md')
  })

  it('appends -3 when -2 also exists', () => {
    const existing = new Set(['john-doe.md', 'john-doe-2.md'])
    expect(deduplicateFilename('john-doe.md', existing)).toBe('john-doe-3.md')
  })

  it('handles many duplicates', () => {
    const existing = new Set([
      'john-doe.md',
      'john-doe-2.md',
      'john-doe-3.md',
      'john-doe-4.md',
    ])
    expect(deduplicateFilename('john-doe.md', existing)).toBe('john-doe-5.md')
  })
})
