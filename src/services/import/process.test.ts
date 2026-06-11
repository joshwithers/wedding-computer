import { describe, expect, it } from 'vitest'
import { normalizeDate, normalizeTime, normalizeTimestamp, generatePreview } from './process'

describe('normalizeDate', () => {
  it('returns null for empty/undefined', () => {
    expect(normalizeDate(undefined)).toBeNull()
    expect(normalizeDate('')).toBeNull()
    expect(normalizeDate('   ')).toBeNull()
  })

  it('passes through ISO format unchanged', () => {
    expect(normalizeDate('2026-03-15')).toBe('2026-03-15')
    expect(normalizeDate('2025-12-25')).toBe('2025-12-25')
  })

  it('parses AU format dd/mm/yyyy', () => {
    expect(normalizeDate('15/03/2026')).toBe('2026-03-15')
    expect(normalizeDate('01/12/2025')).toBe('2025-12-01')
    expect(normalizeDate('31/01/2026')).toBe('2026-01-31')
  })

  it('parses unambiguous US format mm/dd/yyyy when day > 12', () => {
    expect(normalizeDate('03/25/2026')).toBe('2026-03-25')
  })

  it('assumes AU format for ambiguous dates (both parts <= 12)', () => {
    // 05/03/2026 → dd=05, mm=03 → 2026-03-05
    expect(normalizeDate('05/03/2026')).toBe('2026-03-05')
    // 01/02/2026 → dd=01, mm=02 → 2026-02-01
    expect(normalizeDate('01/02/2026')).toBe('2026-02-01')
  })

  it('handles dd-mm-yyyy format', () => {
    expect(normalizeDate('15-03-2026')).toBe('2026-03-15')
  })

  it('handles dd.mm.yyyy format', () => {
    expect(normalizeDate('15.03.2026')).toBe('2026-03-15')
  })

  it('handles two-digit year dd/mm/yy', () => {
    expect(normalizeDate('15/03/26')).toBe('2026-03-15')
    expect(normalizeDate('25/12/26')).toBe('2026-12-25')
  })

  it('treats two-digit year > 50 as 19xx', () => {
    expect(normalizeDate('15/03/99')).toBe('1999-03-15')
  })

  it('pads single-digit day and month', () => {
    expect(normalizeDate('5/3/2026')).toBe('2026-03-05')
    expect(normalizeDate('1/1/2026')).toBe('2026-01-01')
  })

  it('returns raw string for invalid ranges', () => {
    expect(normalizeDate('32/13/2026')).toBe('32/13/2026')
    expect(normalizeDate('0/0/2026')).toBe('0/0/2026')
  })

  it('handles natural language dates via Date constructor', () => {
    const result = normalizeDate('March 15, 2026')
    // Date constructor uses local timezone — result may be off by a day
    expect(result).toMatch(/^2026-03-1[45]$/)
  })

  it('returns raw string for unparseable text', () => {
    expect(normalizeDate('sometime next year')).toBe('sometime next year')
  })
})

describe('generatePreview', () => {
  const rows = [
    { 'First Name': 'Sarah', 'Last Name': 'Smith', 'Email': 'sarah@e.com', 'Junk': 'xyz' },
    { 'First Name': 'Tom', 'Last Name': 'Jones', 'Email': 'tom@e.com', 'Junk': 'abc' },
    { 'First Name': 'Amy', 'Last Name': 'Lee', 'Email': 'amy@e.com', 'Junk': 'def' },
  ]

  const mapping: Record<string, string> = {
    'First Name': 'first_name',
    'Last Name': 'last_name',
    'Email': 'email',
    'Junk': '_skip',
  }

  it('applies mapping to preview rows', () => {
    const preview = generatePreview(rows, mapping)
    expect(preview).toHaveLength(3)
    expect(preview[0]).toEqual({ first_name: 'Sarah', last_name: 'Smith', email: 'sarah@e.com' })
  })

  it('respects limit parameter', () => {
    const preview = generatePreview(rows, mapping, 2)
    expect(preview).toHaveLength(2)
  })

  it('skips _skip columns', () => {
    const preview = generatePreview(rows, mapping, 1)
    expect(preview[0]).not.toHaveProperty('Junk')
    expect(Object.keys(preview[0])).toEqual(['first_name', 'last_name', 'email'])
  })

  it('concatenates when multiple source columns map to same target', () => {
    const dupMapping: Record<string, string> = {
      'First Name': 'notes',
      'Last Name': 'notes',
    }
    const preview = generatePreview(rows, dupMapping, 1)
    expect(preview[0].notes).toBe('Sarah Smith')
  })

  it('summarises _extra columns into a single preview column', () => {
    const extraMapping: Record<string, string> = {
      'First Name': 'first_name',
      'Last Name': '_extra',
      'Junk': '_extra',
    }
    const preview = generatePreview(rows, extraMapping, 1)
    expect(preview[0].first_name).toBe('Sarah')
    expect(preview[0]._extra).toBe('Last Name: Smith · Junk: xyz')
  })

  it('omits the _extra column when extras are empty', () => {
    const extraMapping: Record<string, string> = {
      'First Name': 'first_name',
      'Missing Column': '_extra',
    }
    const preview = generatePreview(rows, extraMapping, 1)
    expect(preview[0]).not.toHaveProperty('_extra')
  })

  it('skips empty values', () => {
    const sparseRows = [{ 'First Name': 'Sarah', 'Last Name': '', 'Email': 'sarah@e.com' }]
    const preview = generatePreview(sparseRows, mapping, 1)
    expect(preview[0]).toEqual({ first_name: 'Sarah', email: 'sarah@e.com' })
  })
})

describe('normalizeTime', () => {
  it('accepts HH:MM and H:MM', () => {
    expect(normalizeTime('14:30')).toBe('14:30')
    expect(normalizeTime('9:05')).toBe('09:05')
    expect(normalizeTime('14:30:00')).toBe('14:30')
  })

  it('rejects junk and out-of-range values', () => {
    expect(normalizeTime(undefined)).toBeNull()
    expect(normalizeTime('')).toBeNull()
    expect(normalizeTime('3pm')).toBeNull()
    expect(normalizeTime('25:00')).toBeNull()
    expect(normalizeTime('12:75')).toBeNull()
  })
})

describe('normalizeTimestamp', () => {
  it('passes through SQLite datetime format', () => {
    expect(normalizeTimestamp('2024-03-01 10:22:01')).toBe('2024-03-01 10:22:01')
  })

  it('converts ISO timestamps to SQLite form', () => {
    expect(normalizeTimestamp('2024-03-01T10:22:01.123Z')).toBe('2024-03-01 10:22:01')
    expect(normalizeTimestamp('2024-03-01T10:22:01+10:00')).toBe('2024-03-01 10:22:01')
  })

  it('accepts date-only values', () => {
    expect(normalizeTimestamp('2024-03-01')).toBe('2024-03-01')
    expect(normalizeTimestamp('15/03/2024')).toBe('2024-03-15')
  })

  it('returns null for junk', () => {
    expect(normalizeTimestamp(undefined)).toBeNull()
    expect(normalizeTimestamp('')).toBeNull()
    expect(normalizeTimestamp('yesterday-ish')).toBeNull()
  })
})
