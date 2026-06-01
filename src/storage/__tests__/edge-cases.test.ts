/**
 * Edge case tests — probing for bugs in the storage layer.
 *
 * These test unusual inputs, boundary conditions, and
 * interactions between modules that might break.
 */

import { describe, it, expect, vi } from 'vitest'
import { contactToMarkdown, markdownToContact } from '../contacts'
import { weddingToMarkdown, markdownToWedding } from '../weddings'
import { parseMarkdown, serializeMarkdown, ParseError } from '../markdown'
import { slugify, contactFilename, deduplicateFilename } from '../slug'
import type { Contact, Wedding } from '../../types'

// ─── Markdown edge cases ───

describe('markdown edge cases', () => {
  it('handles YAML values that look like dates', () => {
    // YAML auto-parses "2026-12-15" as a Date object in some parsers
    const raw = `---
id: test
wedding_date: 2026-12-15
created_at: 2025-06-01T00:00:00.000Z
updated_at: 2025-06-01T00:00:00.000Z
---`
    const doc = parseMarkdown(raw)
    // The yaml package should handle this — verify the type
    const dateVal = doc.frontmatter.wedding_date
    // Could be string or Date depending on yaml config
    expect(dateVal).toBeDefined()
  })

  it('handles YAML values that look like booleans', () => {
    // "yes", "no", "true", "false" are booleans in YAML 1.1
    const raw = `---
id: test
notes_field: "yes"
---`
    const doc = parseMarkdown(raw)
    // With yaml 2.x and our config, quoted "yes" should stay as string
    expect(doc.frontmatter.notes_field).toBe('yes')
  })

  it('handles very long notes (body text)', () => {
    const longNotes = 'x'.repeat(100000)
    const doc = {
      frontmatter: { id: 'test', name: 'Test' },
      body: longNotes,
    }
    const serialized = serializeMarkdown(doc)
    const parsed = parseMarkdown(serialized)
    expect(parsed.body).toBe(longNotes)
  })

  it('handles frontmatter with colons in values', () => {
    const doc = {
      frontmatter: {
        id: 'test',
        location: 'Ceremony: 3pm at The Grand Ballroom',
      },
      body: '',
    }
    const serialized = serializeMarkdown(doc)
    const parsed = parseMarkdown(serialized)
    expect(parsed.frontmatter.location).toBe('Ceremony: 3pm at The Grand Ballroom')
  })

  it('handles frontmatter with hash/pound signs', () => {
    const doc = {
      frontmatter: {
        id: 'test',
        tags_note: '#wedding #vip',
      },
      body: '',
    }
    const serialized = serializeMarkdown(doc)
    const parsed = parseMarkdown(serialized)
    expect(parsed.frontmatter.tags_note).toBe('#wedding #vip')
  })

  it('handles body with YAML-like content', () => {
    // Body containing --- should NOT be treated as frontmatter
    const doc = {
      frontmatter: { id: 'test' },
      body: 'Some notes.\n\n---\n\nMore content after a horizontal rule.',
    }
    const serialized = serializeMarkdown(doc)
    const parsed = parseMarkdown(serialized)
    expect(parsed.frontmatter.id).toBe('test')
    expect(parsed.body).toContain('More content after a horizontal rule.')
  })

  it('handles emoji in frontmatter', () => {
    const doc = {
      frontmatter: { id: 'test', source: '💍 Instagram' },
      body: '',
    }
    const serialized = serializeMarkdown(doc)
    const parsed = parseMarkdown(serialized)
    expect(parsed.frontmatter.source).toBe('💍 Instagram')
  })

  it('handles newlines in frontmatter values', () => {
    const doc = {
      frontmatter: {
        id: 'test',
        location: 'The Grand Ballroom\nLevel 3\nSydney CBD',
      },
      body: '',
    }
    const serialized = serializeMarkdown(doc)
    const parsed = parseMarkdown(serialized)
    expect(parsed.frontmatter.location).toBe('The Grand Ballroom\nLevel 3\nSydney CBD')
  })
})

// ─── Contact serialization edge cases ───

describe('contact serialization edge cases', () => {
  function makeContact(overrides: Partial<Contact> = {}): Contact {
    return {
      id: 'c1',
      vendor_id: 'v1',
      first_name: 'Test',
      last_name: 'User',
      email: null,
      phone: null,
      partner_first_name: null,
      partner_last_name: null,
      partner_email: null,
      partner_phone: null,
      source: null,
      status: 'new',
      wedding_id: null,
      wedding_date: null,
      wedding_location: null,
      notes: null,
      tags: null,
      form_data: null,
      last_contacted_at: null,
      created_at: '2025-06-01T00:00:00.000Z',
      updated_at: '2025-06-01T00:00:00.000Z',
      ...overrides,
    }
  }

  it('preserves all null optional fields through roundtrip', () => {
    const contact = makeContact()
    const doc = contactToMarkdown(contact)
    const md = serializeMarkdown(doc)
    const parsed = parseMarkdown(md)
    const restored = markdownToContact(parsed, 'v1')

    expect(restored.email).toBeNull()
    expect(restored.phone).toBeNull()
    expect(restored.partner_first_name).toBeNull()
    expect(restored.source).toBeNull()
    expect(restored.wedding_id).toBeNull()
    expect(restored.notes).toBeNull()
    expect(restored.tags).toBeNull()
  })

  it('handles names with apostrophes', () => {
    const contact = makeContact({ first_name: "Sarah", last_name: "O'Brien" })
    const doc = contactToMarkdown(contact)
    const md = serializeMarkdown(doc)
    const parsed = parseMarkdown(md)
    const restored = markdownToContact(parsed, 'v1')
    expect(restored.last_name).toBe("O'Brien")
  })

  it('handles empty string names', () => {
    const contact = makeContact({ first_name: '', last_name: '' })
    const doc = contactToMarkdown(contact)
    const md = serializeMarkdown(doc)
    const parsed = parseMarkdown(md)
    const restored = markdownToContact(parsed, 'v1')
    expect(restored.first_name).toBe('')
    expect(restored.last_name).toBe('')
  })

  it('handles phone numbers with + prefix', () => {
    const contact = makeContact({ phone: '+61 400 123 456' })
    const doc = contactToMarkdown(contact)
    const md = serializeMarkdown(doc)
    const parsed = parseMarkdown(md)
    const restored = markdownToContact(parsed, 'v1')
    expect(restored.phone).toBe('+61 400 123 456')
  })

  it('handles phone numbers that YAML parses as numbers', () => {
    // This simulates a user hand-editing a file in Obsidian
    // and writing phone: 0400123456 (unquoted)
    // YAML parses this as the integer 400123456
    const raw = `---
id: test-yaml-phone
first_name: Sarah
last_name: Smith
phone: 0400123456
status: new
created_at: 2025-06-01
updated_at: 2025-06-01
---`
    const doc = parseMarkdown(raw)
    // YAML will have parsed phone as number 400123456
    expect(typeof doc.frontmatter.phone).toBe('number')

    // markdownToContact should coerce it back to a string
    const contact = markdownToContact(doc, 'v1')
    expect(typeof contact.phone).toBe('string')
    expect(contact.phone).toBe('400123456')
  })

  it('handles email-like strings correctly', () => {
    const contact = makeContact({ email: 'test@example.com' })
    const doc = contactToMarkdown(contact)
    const md = serializeMarkdown(doc)
    const parsed = parseMarkdown(md)
    const restored = markdownToContact(parsed, 'v1')
    expect(restored.email).toBe('test@example.com')
  })

  it('handles tags with special characters', () => {
    const contact = makeContact({ tags: '["VIP","2026 wedding","beach & garden"]' })
    const doc = contactToMarkdown(contact)
    const md = serializeMarkdown(doc)
    const parsed = parseMarkdown(md)
    const restored = markdownToContact(parsed, 'v1')
    const tags = JSON.parse(restored.tags!)
    expect(tags).toEqual(['VIP', '2026 wedding', 'beach & garden'])
  })

  it('handles complex form_data JSON', () => {
    const formData = {
      venue: 'The Grand Ballroom',
      guest_count: 150,
      dietary: ['vegetarian', 'gluten-free'],
      notes: 'Outdoor ceremony with reception indoors',
    }
    const contact = makeContact({ form_data: JSON.stringify(formData) })
    const doc = contactToMarkdown(contact)
    const md = serializeMarkdown(doc)
    const parsed = parseMarkdown(md)
    const restored = markdownToContact(parsed, 'v1')
    const restoredFormData = JSON.parse(restored.form_data!)
    expect(restoredFormData.venue).toBe('The Grand Ballroom')
    expect(restoredFormData.guest_count).toBe(150)
    expect(restoredFormData.dietary).toEqual(['vegetarian', 'gluten-free'])
  })

  it('handles all status values', () => {
    const statuses: Contact['status'][] = [
      'new', 'contacted', 'meeting', 'quoted',
      'booked', 'completed', 'lost', 'archived',
    ]

    for (const status of statuses) {
      const contact = makeContact({ status })
      const doc = contactToMarkdown(contact)
      const md = serializeMarkdown(doc)
      const parsed = parseMarkdown(md)
      const restored = markdownToContact(parsed, 'v1')
      expect(restored.status).toBe(status)
    }
  })
})

// ─── Wedding serialization edge cases ───

describe('wedding serialization edge cases', () => {
  function makeWedding(overrides: Partial<Wedding> = {}): Wedding {
    return {
      id: 'w1',
      title: 'Test Wedding',
      date: null,
      time: null,
      location: null,
      location_lat: null,
      location_lng: null,
      status: 'planning',
      ceremony_type: null,
      vendor_visibility: 'private',
      reception_location: null,
      reception_time: null,
      getting_ready_location: null,
      getting_ready_time: null,
      dress_code: null,
      guest_count: null,
      timeline_notes: null,
      notes: null,
      created_by_user_id: 'u1',
      created_at: '2025-06-01T00:00:00.000Z',
      updated_at: '2025-06-01T00:00:00.000Z',
      ...overrides,
    }
  }

  it('handles all status values', () => {
    const statuses: Wedding['status'][] = ['planning', 'confirmed', 'completed', 'cancelled']
    for (const status of statuses) {
      const wedding = makeWedding({ status })
      const doc = weddingToMarkdown(wedding)
      const md = serializeMarkdown(doc)
      const parsed = parseMarkdown(md)
      const restored = markdownToWedding(parsed)
      expect(restored.status).toBe(status)
    }
  })

  it('handles floating-point lat/lng precision', () => {
    const wedding = makeWedding({
      location_lat: -33.868820123456,
      location_lng: 151.209295654321,
    })
    const doc = weddingToMarkdown(wedding)
    const md = serializeMarkdown(doc)
    const parsed = parseMarkdown(md)
    const restored = markdownToWedding(parsed)
    expect(restored.location_lat).toBeCloseTo(-33.868820123456, 6)
    expect(restored.location_lng).toBeCloseTo(151.209295654321, 6)
  })

  it('handles guest_count of 0', () => {
    const wedding = makeWedding({ guest_count: 0 })
    const doc = weddingToMarkdown(wedding)
    const md = serializeMarkdown(doc)
    const parsed = parseMarkdown(md)
    const restored = markdownToWedding(parsed)
    expect(restored.guest_count).toBe(0)
  })

  it('handles vendor_visibility values', () => {
    for (const vis of ['private', 'visible'] as Wedding['vendor_visibility'][]) {
      const wedding = makeWedding({ vendor_visibility: vis })
      const doc = weddingToMarkdown(wedding)
      const md = serializeMarkdown(doc)
      const parsed = parseMarkdown(md)
      const restored = markdownToWedding(parsed)
      expect(restored.vendor_visibility).toBe(vis)
    }
  })
})

// ─── Slug edge cases ───

describe('slug edge cases', () => {
  it('handles names with multiple apostrophes', () => {
    expect(slugify("D'Angelo O'Brien")).toBe('dangelo-obrien')
  })

  it('handles ampersand in wedding titles', () => {
    expect(slugify('Sarah & James')).toBe('sarah-james')
  })

  it('handles very long names (truncation?)', () => {
    const longName = 'a'.repeat(200)
    const result = slugify(longName)
    // Should not crash, even if very long
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(200)
  })

  it('deduplicateFilename handles extremely many conflicts', () => {
    const existing = new Set<string>()
    existing.add('john-doe.md')
    for (let i = 2; i <= 100; i++) {
      existing.add(`john-doe-${i}.md`)
    }
    const result = deduplicateFilename('john-doe.md', existing)
    expect(result).toBe('john-doe-101.md')
  })

  it('contactFilename handles same-surname couple', () => {
    // "Sarah Smith & James Smith" should become "sarah-james-smith.md"
    // (partner first name inserted before shared last name)
    const result = contactFilename('Sarah', 'Smith', 'James', 'Smith')
    expect(result).toBe('sarah-james-smith.md')
  })
})

// ─── Human-edited file scenarios ───

describe('human-edited file compatibility', () => {
  it('parses a file someone might create in Obsidian', () => {
    const raw = `---
id: abc123def456789012345678
first_name: Sarah
last_name: Smith
email: sarah@email.com
phone: "0400 123 456"
status: new
wedding_date: 2026-12-15
tags:
  - vip
  - referral
created_at: 2025-06-01
updated_at: 2025-06-01
---

Met at the Bridal Expo in March 2025.

- Interested in elopement ceremony
- Budget: $3,000 - $5,000
- Preferred dates: Dec 2026 or Jan 2027

## Follow-up notes

Called on March 15, very enthusiastic.
`

    const doc = parseMarkdown(raw)
    const contact = markdownToContact(doc, 'vendor-001')

    expect(contact.id).toBe('abc123def456789012345678')
    expect(contact.first_name).toBe('Sarah')
    expect(contact.email).toBe('sarah@email.com')
    expect(contact.phone).toBe('0400 123 456')
    expect(contact.tags).toBe('["vip","referral"]')
    expect(contact.notes).toContain('Budget: $3,000 - $5,000')
    expect(contact.notes).toContain('## Follow-up notes')
  })

  it('parses a minimal hand-written contact file', () => {
    const raw = `---
id: quick-note-001
first_name: Jane
last_name: Doe
status: new
created_at: 2025-06-01
updated_at: 2025-06-01
---

Quick lead from Instagram DM.`

    const doc = parseMarkdown(raw)
    const contact = markdownToContact(doc, 'v1')

    expect(contact.first_name).toBe('Jane')
    expect(contact.notes).toBe('Quick lead from Instagram DM.')
    // Missing optional fields should be null
    expect(contact.email).toBeNull()
    expect(contact.phone).toBeNull()
    expect(contact.partner_first_name).toBeNull()
  })

  it('handles a file with extra unknown frontmatter fields', () => {
    // Users might add custom fields — they should be ignored, not crash
    const raw = `---
id: test-001
first_name: Sarah
last_name: Smith
status: new
custom_field: some value
another_custom: true
created_at: 2025-06-01
updated_at: 2025-06-01
---`

    const doc = parseMarkdown(raw)
    const contact = markdownToContact(doc, 'v1')
    expect(contact.first_name).toBe('Sarah')
    // Custom fields are harmlessly ignored
  })
})
