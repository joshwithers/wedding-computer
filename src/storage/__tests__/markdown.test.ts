import { describe, it, expect } from 'vitest'
import { parseMarkdown, serializeMarkdown, ParseError } from '../markdown'

describe('parseMarkdown', () => {
  it('parses valid frontmatter and body', () => {
    const raw = `---
id: abc123
name: John Doe
status: new
---

Some notes about this contact.`

    const result = parseMarkdown(raw)
    expect(result.frontmatter.id).toBe('abc123')
    expect(result.frontmatter.name).toBe('John Doe')
    expect(result.frontmatter.status).toBe('new')
    expect(result.body).toBe('Some notes about this contact.')
  })

  it('handles frontmatter-only files (no body)', () => {
    const raw = `---
id: abc123
name: Test
---`

    const result = parseMarkdown(raw)
    expect(result.frontmatter.id).toBe('abc123')
    expect(result.body).toBe('')
  })

  it('handles files with no frontmatter (body only)', () => {
    const raw = 'Just some plain text, no frontmatter.'
    const result = parseMarkdown(raw)
    expect(result.frontmatter).toEqual({})
    expect(result.body).toBe('Just some plain text, no frontmatter.')
  })

  it('handles empty files', () => {
    const result = parseMarkdown('')
    expect(result.frontmatter).toEqual({})
    expect(result.body).toBe('')
  })

  it('handles Windows line endings (\\r\\n)', () => {
    const raw = '---\r\nid: abc\r\nname: Test\r\n---\r\n\r\nNotes here.'
    const result = parseMarkdown(raw)
    expect(result.frontmatter.id).toBe('abc')
    expect(result.body).toBe('Notes here.')
  })

  it('handles null values in YAML', () => {
    const raw = `---
id: abc
email:
phone: null
---`

    const result = parseMarkdown(raw)
    expect(result.frontmatter.id).toBe('abc')
    expect(result.frontmatter.email).toBeNull()
    expect(result.frontmatter.phone).toBeNull()
  })

  it('handles arrays in YAML', () => {
    const raw = `---
id: abc
tags:
  - wedding
  - vip
---`

    const result = parseMarkdown(raw)
    expect(result.frontmatter.tags).toEqual(['wedding', 'vip'])
  })

  it('handles nested objects in YAML', () => {
    const raw = `---
id: abc
form_data:
  venue: The Grand Ballroom
  guests: 150
---`

    const result = parseMarkdown(raw)
    const formData = result.frontmatter.form_data as Record<string, unknown>
    expect(formData.venue).toBe('The Grand Ballroom')
    expect(formData.guests).toBe(150)
  })

  it('throws ParseError for malformed frontmatter (unclosed)', () => {
    const raw = `---
id: abc
name: Test`

    expect(() => parseMarkdown(raw)).toThrow(ParseError)
  })

  it('throws ParseError for invalid YAML', () => {
    const raw = `---
id: abc
  bad indent: [
---`

    expect(() => parseMarkdown(raw)).toThrow(ParseError)
  })

  it('throws ParseError when frontmatter is a scalar', () => {
    const raw = `---
just a string
---`

    expect(() => parseMarkdown(raw)).toThrow(ParseError)
  })

  it('throws ParseError when frontmatter is a list', () => {
    const raw = `---
- item1
- item2
---`

    expect(() => parseMarkdown(raw)).toThrow(ParseError)
  })

  it('preserves multi-line body text', () => {
    const raw = `---
id: abc
---

Line 1.

Line 2.

Line 3.`

    const result = parseMarkdown(raw)
    expect(result.body).toBe('Line 1.\n\nLine 2.\n\nLine 3.')
  })

  it('ParseError includes raw content', () => {
    const raw = `---
id: abc
  broken:
---`

    try {
      parseMarkdown(raw)
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError)
      expect((err as ParseError).rawContent).toBe(raw)
    }
  })
})

describe('serializeMarkdown', () => {
  it('serializes frontmatter and body', () => {
    const doc = {
      frontmatter: { id: 'abc', name: 'Test', status: 'new' },
      body: 'Some notes.',
    }
    const result = serializeMarkdown(doc)
    expect(result).toContain('---')
    expect(result).toContain('id: abc')
    expect(result).toContain('name: Test')
    expect(result).toContain('Some notes.')
  })

  it('strips undefined values from frontmatter', () => {
    const doc = {
      frontmatter: { id: 'abc', name: 'Test', email: undefined as unknown as string },
      body: '',
    }
    const result = serializeMarkdown(doc)
    expect(result).toContain('id: abc')
    expect(result).not.toContain('email')
  })

  it('handles empty body', () => {
    const doc = {
      frontmatter: { id: 'abc' },
      body: '',
    }
    const result = serializeMarkdown(doc)
    expect(result).toContain('id: abc')
    // Should not have extra blank lines after ---
    const lines = result.trim().split('\n')
    expect(lines[lines.length - 1]).toBe('---')
  })

  it('handles null values (serialized as empty string)', () => {
    const doc = {
      frontmatter: { id: 'abc', email: null },
      body: '',
    }
    const result = serializeMarkdown(doc)
    expect(result).toContain('id: abc')
    // yaml package serializes null → empty with our nullStr: '' option
    expect(result).toContain('email:')
  })

  it('ends with a trailing newline', () => {
    const doc = {
      frontmatter: { id: 'abc' },
      body: 'Notes.',
    }
    const result = serializeMarkdown(doc)
    expect(result.endsWith('\n')).toBe(true)
  })
})

describe('roundtrip: parse → serialize → parse', () => {
  it('preserves all frontmatter fields through a roundtrip', () => {
    const original = {
      frontmatter: {
        id: 'abc123def456',
        first_name: 'Sarah',
        last_name: "O'Brien",
        email: 'sarah@example.com',
        phone: '+61 400 123 456',
        status: 'quoted',
        tags: ['vip', 'referral'],
        wedding_date: '2026-12-15',
      },
      body: 'Met at the bridal expo.\n\nFollow up next week.',
    }

    const serialized = serializeMarkdown(original)
    const parsed = parseMarkdown(serialized)

    expect(parsed.frontmatter.id).toBe(original.frontmatter.id)
    expect(parsed.frontmatter.first_name).toBe(original.frontmatter.first_name)
    expect(parsed.frontmatter.last_name).toBe(original.frontmatter.last_name)
    expect(parsed.frontmatter.email).toBe(original.frontmatter.email)
    expect(parsed.frontmatter.status).toBe(original.frontmatter.status)
    expect(parsed.frontmatter.tags).toEqual(original.frontmatter.tags)
    expect(parsed.body).toBe(original.body)
  })

  it('handles special characters in names', () => {
    const original = {
      frontmatter: {
        id: 'test',
        name: 'José María García-López',
        notes: 'Colon: value, quote: "test"',
      },
      body: '',
    }

    const serialized = serializeMarkdown(original)
    const parsed = parseMarkdown(serialized)

    expect(parsed.frontmatter.name).toBe(original.frontmatter.name)
    expect(parsed.frontmatter.notes).toBe(original.frontmatter.notes)
  })
})
