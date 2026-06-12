import { describe, expect, it } from 'vitest'
import { slugify, contactFilename, weddingFilename, weddingFolderName, deduplicateFilename } from './slug'

describe('slugify', () => {
  it('produces clean kebab-case', () => {
    expect(slugify("John O'Brien")).toBe('john-obrien')
    expect(slugify('Sarah & James Smith-Jones')).toBe('sarah-james-smith-jones')
  })

  it('transliterates accents', () => {
    expect(slugify('Ñoño')).toBe('nono')
    expect(slugify('Zoë & René')).toBe('zoe-rene')
  })

  // File paths stay emoji-free by design — wedding emoji live on the entity,
  // never in vault file names (Obsidian sidebar, git logs, R2 keys).
  it('strips emoji', () => {
    expect(slugify('💍 Sarah & James')).toBe('sarah-james')
    expect(slugify('⛪️ Smith-Jones 🎉')).toBe('smith-jones')
  })

  it('falls back to untitled for all-emoji input', () => {
    expect(slugify('🌸🌸🌸')).toBe('untitled')
    expect(slugify('')).toBe('untitled')
  })
})

describe('weddingFilename / weddingFolderName', () => {
  it('keeps emoji out of wedding file paths', () => {
    expect(weddingFilename('💍 Sarah & James', '2026-12-15')).toBe('sarah-james-2026-12-15.md')
    expect(weddingFolderName('⛪️ Smith-Jones 🎉', '2026-07-12')).toBe('2026-07-12-smith-jones')
  })
})

describe('contactFilename', () => {
  it('merges couples sharing a last name', () => {
    expect(contactFilename('John', 'Doe', 'Jane', 'Doe')).toBe('john-jane-doe.md')
  })

  it('keeps emoji out of contact file paths', () => {
    expect(contactFilename('Sarah 🌸', 'Smith')).toBe('sarah-smith.md')
  })
})

describe('deduplicateFilename', () => {
  it('appends a counter on collision', () => {
    expect(deduplicateFilename('john-doe.md', new Set(['john-doe.md']))).toBe('john-doe-2.md')
  })
})
