import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseCSV, parseJSON } from './csv'
import { autoMapColumns, normalizeStatus } from './presets'
import { normalizeDate, generatePreview } from './process'

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8')
}

describe('Dubsado CSV import', () => {
  const csv = fixture('dubsado-export.csv')
  const parsed = parseCSV(csv)

  it('parses all rows', () => {
    expect(parsed.rows).toHaveLength(5)
  })

  it('has expected headers', () => {
    expect(parsed.headers).toContain('First Name')
    expect(parsed.headers).toContain('Last Name')
    expect(parsed.headers).toContain('Email')
    expect(parsed.headers).toContain('Event Date')
  })

  it('auto-maps columns correctly', () => {
    const mapping = autoMapColumns(parsed.headers, 'dubsado')
    expect(mapping['First Name']).toBe('first_name')
    expect(mapping['Email']).toBe('email')
    expect(mapping['Event Date']).toBe('wedding_date')
    expect(mapping['Tags']).toBe('_skip')
  })

  it('generates correct preview', () => {
    const mapping = autoMapColumns(parsed.headers, 'dubsado')
    const preview = generatePreview(parsed.rows, mapping, 2)
    expect(preview[0].first_name).toBe('Sarah')
    expect(preview[0].last_name).toBe('Smith')
    expect(preview[0].email).toBe('sarah@example.com')
  })

  it('handles quoted fields with commas (location)', () => {
    expect(parsed.rows[0]['Event Location']).toBe('Byron Bay, NSW')
  })

  it('normalizes statuses from Dubsado', () => {
    const mapping = autoMapColumns(parsed.headers, 'dubsado')
    const preview = generatePreview(parsed.rows, mapping)
    expect(normalizeStatus(preview[0].status)).toBe('booked')
    expect(normalizeStatus(preview[1].status)).toBe('new')
    expect(normalizeStatus(preview[2].status)).toBe('quoted')
    expect(normalizeStatus(preview[3].status)).toBe('booked')
    expect(normalizeStatus(preview[4].status)).toBe('new')
  })
})

describe('Studio Ninja client CSV import', () => {
  const csv = fixture('studio-ninja-export.csv')
  const parsed = parseCSV(csv)

  it('parses all rows', () => {
    expect(parsed.rows).toHaveLength(4)
  })

  it('has the documented 19 columns', () => {
    expect(parsed.headers).toContain('First Name')
    expect(parsed.headers).toContain('Phone')
    expect(parsed.headers).toContain('Email')
    expect(parsed.headers).toContain('Suburb/Town')
    expect(parsed.headers).toContain('Client Notes')
    expect(parsed.headers).toContain('Company Name')
    expect(parsed.headers).toContain('Date Added')
  })

  it('auto-maps Studio Ninja columns', () => {
    const mapping = autoMapColumns(parsed.headers, 'studio_ninja')
    expect(mapping['First Name']).toBe('first_name')
    expect(mapping['Phone']).toBe('phone')
    expect(mapping['Email']).toBe('email')
    expect(mapping['Suburb/Town']).toBe('wedding_location')
    expect(mapping['Client Notes']).toBe('notes')
    expect(mapping['Company Name']).toBe('_skip')
    expect(mapping['Date Added']).toBe('_skip')
    expect(mapping['Total number of open Leads']).toBe('_skip')
  })

  it('generates correct preview', () => {
    const mapping = autoMapColumns(parsed.headers, 'studio_ninja')
    const preview = generatePreview(parsed.rows, mapping, 1)
    expect(preview[0].first_name).toBe('Grace Martin')
    expect(preview[0].email).toBe('grace.m@example.com')
    expect(preview[0].wedding_location).toBe('Byron Bay')
    expect(preview[0].notes).toBe('8-hour package booked')
  })
})

describe('HoneyBook CSV import', () => {
  const csv = fixture('honeybook-export.csv')
  const parsed = parseCSV(csv)

  it('parses all rows', () => {
    expect(parsed.rows).toHaveLength(4)
  })

  it('auto-maps HoneyBook columns', () => {
    const mapping = autoMapColumns(parsed.headers, 'honeybook')
    expect(mapping['Client First Name']).toBe('first_name')
    expect(mapping['Client Last Name']).toBe('last_name')
    expect(mapping['Client Email']).toBe('email')
    expect(mapping['Project Date']).toBe('wedding_date')
    expect(mapping['Pipeline Status']).toBe('status')
  })

  it('handles quoted notes with commas', () => {
    expect(parsed.rows[0]['Notes']).toBe('Elopement, small ceremony')
  })
})

describe('VSCO Workspace CSV import', () => {
  const csv = fixture('vsco-workspace-export.csv')
  const parsed = parseCSV(csv)

  it('parses all rows', () => {
    expect(parsed.rows).toHaveLength(4)
  })

  it('auto-maps VSCO Workspace columns', () => {
    const mapping = autoMapColumns(parsed.headers, 'vsco_workspace')
    expect(mapping['First']).toBe('first_name')
    expect(mapping['Last']).toBe('last_name')
    expect(mapping['Referral']).toBe('source')
    expect(mapping['Event Date']).toBe('wedding_date')
  })

  it('normalizes VSCO Workspace statuses', () => {
    const mapping = autoMapColumns(parsed.headers, 'vsco_workspace')
    const preview = generatePreview(parsed.rows, mapping)
    expect(normalizeStatus(preview[0].status)).toBe('booked')
    expect(normalizeStatus(preview[1].status)).toBe('new')
    expect(normalizeStatus(preview[2].status)).toBe('quoted')
    expect(normalizeStatus(preview[3].status)).toBe('completed')
  })
})

describe('Tardis JSON import', () => {
  const json = fixture('tardis-export.json')
  const parsed = parseJSON(json)

  it('parses all records', () => {
    expect(parsed.rows).toHaveLength(3)
  })

  it('has snake_case headers', () => {
    expect(parsed.headers).toContain('first_name')
    expect(parsed.headers).toContain('last_name')
    expect(parsed.headers).toContain('partner_first_name')
    expect(parsed.headers).toContain('wedding_date')
  })

  it('auto-maps with tardis preset', () => {
    const mapping = autoMapColumns(parsed.headers, 'tardis')
    expect(mapping['first_name']).toBe('first_name')
    expect(mapping['partner_email']).toBe('partner_email')
    expect(mapping['wedding_date']).toBe('wedding_date')
  })

  it('handles null values as empty strings', () => {
    expect(parsed.rows[1].partner_email).toBe('')
    expect(parsed.rows[2].wedding_date).toBe('')
  })

  it('preserves ISO dates', () => {
    const mapping = autoMapColumns(parsed.headers, 'tardis')
    const preview = generatePreview(parsed.rows, mapping)
    expect(normalizeDate(preview[0].wedding_date)).toBe('2026-06-20')
  })
})

describe('Edge cases CSV import', () => {
  const csv = fixture('edge-cases.csv')
  const parsed = parseCSV(csv)

  it('parses rows (including problematic ones)', () => {
    expect(parsed.rows.length).toBeGreaterThanOrEqual(8)
  })

  it('handles escaped quotes in fields', () => {
    expect(parsed.rows[0]['Notes']).toBe('She said "I love it"')
  })

  it('handles apostrophes in quoted last name', () => {
    expect(parsed.rows[3]['Last Name']).toBe("O'Brien")
  })

  it('handles nickname with quotes in first name', () => {
    const mia = parsed.rows.find(r => r['Email'] === 'mia@example.com')
    expect(mia?.['First Name']).toBe('Mia "Mimi"')
  })

  it('handles quoted location with comma', () => {
    expect(parsed.rows[0]['Wedding Location']).toBe('Byron Bay, NSW')
  })

  it('normalizes various date formats', () => {
    expect(normalizeDate('15/03/2026')).toBe('2026-03-15')
    expect(normalizeDate('03/25/2026')).toBe('2026-03-25')
    expect(normalizeDate('5/3/2026')).toBe('2026-03-05')
    expect(normalizeDate('01/01/27')).toBe('2027-01-01')
    expect(normalizeDate('15.03.2026')).toBe('2026-03-15')
    expect(normalizeDate('sometime in spring')).toBe('sometime in spring')
  })

  it('maps diverse statuses to valid values', () => {
    expect(normalizeStatus('booked')).toBe('booked')
    expect(normalizeStatus('lead')).toBe('new')
    expect(normalizeStatus('prospect')).toBe('new')
    expect(normalizeStatus('won')).toBe('booked')
  })
})
