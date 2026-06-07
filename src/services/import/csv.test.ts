import { describe, expect, it } from 'vitest'
import { parseCSV, parseJSON, parseTSV, detectDelimiter } from './csv'

describe('parseCSV', () => {
  it('parses simple CSV', () => {
    const result = parseCSV('First Name,Last Name,Email\nSarah,Smith,sarah@example.com\nTom,Jones,tom@example.com')
    expect(result.headers).toEqual(['First Name', 'Last Name', 'Email'])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual({ 'First Name': 'Sarah', 'Last Name': 'Smith', 'Email': 'sarah@example.com' })
  })

  it('handles quoted fields with commas', () => {
    const result = parseCSV('Name,Location\n"Smith, Sarah","Byron Bay, NSW"')
    expect(result.rows[0]).toEqual({ Name: 'Smith, Sarah', Location: 'Byron Bay, NSW' })
  })

  it('handles escaped quotes inside quoted fields', () => {
    const result = parseCSV('Name,Notes\nSarah,"She said ""hello"""\n')
    expect(result.rows[0]).toEqual({ Name: 'Sarah', Notes: 'She said "hello"' })
  })

  it('handles embedded newlines in quoted fields', () => {
    const result = parseCSV('Name,Notes\nSarah,"Line one\nLine two"\nTom,Simple\n')
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual({ Name: 'Sarah', Notes: 'Line one\nLine two' })
    expect(result.rows[1]).toEqual({ Name: 'Tom', Notes: 'Simple' })
  })

  it('handles CRLF line endings', () => {
    const result = parseCSV('Name,Email\r\nSarah,s@e.com\r\nTom,t@e.com\r\n')
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual({ Name: 'Sarah', Email: 's@e.com' })
  })

  it('strips BOM character', () => {
    const result = parseCSV('﻿Name,Email\nSarah,s@e.com')
    expect(result.headers).toEqual(['Name', 'Email'])
    expect(result.rows).toHaveLength(1)
  })

  it('trims whitespace from headers and values', () => {
    const result = parseCSV(' Name , Email \n Sarah , s@e.com ')
    expect(result.headers).toEqual(['Name', 'Email'])
    expect(result.rows[0]).toEqual({ Name: 'Sarah', Email: 's@e.com' })
  })

  it('skips empty rows', () => {
    const result = parseCSV('Name,Email\nSarah,s@e.com\n\nTom,t@e.com\n')
    expect(result.rows).toHaveLength(2)
  })

  it('handles missing trailing values', () => {
    const result = parseCSV('A,B,C\n1,2\n')
    expect(result.rows[0]).toEqual({ A: '1', B: '2', C: '' })
  })

  it('returns empty for empty input', () => {
    const result = parseCSV('')
    expect(result.headers).toEqual([])
    expect(result.rows).toEqual([])
  })

  it('handles header-only CSV', () => {
    const result = parseCSV('Name,Email\n')
    expect(result.headers).toEqual(['Name', 'Email'])
    expect(result.rows).toEqual([])
  })
})

describe('parseJSON', () => {
  it('parses array of flat objects', () => {
    const input = JSON.stringify([
      { first_name: 'Sarah', last_name: 'Smith', email: 'sarah@e.com' },
      { first_name: 'Tom', last_name: 'Jones', email: 'tom@e.com' },
    ])
    const result = parseJSON(input)
    expect(result.headers).toContain('first_name')
    expect(result.headers).toContain('last_name')
    expect(result.headers).toContain('email')
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].first_name).toBe('Sarah')
  })

  it('flattens nested objects', () => {
    const input = JSON.stringify([
      { name: { first: 'Sarah', last: 'Smith' }, email: 'sarah@e.com' },
    ])
    const result = parseJSON(input)
    expect(result.headers).toContain('name.first')
    expect(result.headers).toContain('name.last')
    expect(result.rows[0]['name.first']).toBe('Sarah')
  })

  it('joins arrays into comma-separated strings', () => {
    const input = JSON.stringify([
      { name: 'Sarah', tags: ['wedding', 'vip'] },
    ])
    const result = parseJSON(input)
    expect(result.rows[0].tags).toBe('wedding, vip')
  })

  it('handles single object (not wrapped in array)', () => {
    const input = JSON.stringify({ first_name: 'Sarah', last_name: 'Smith' })
    const result = parseJSON(input)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].first_name).toBe('Sarah')
  })

  it('handles null values as empty strings', () => {
    const input = JSON.stringify([{ name: 'Sarah', phone: null }])
    const result = parseJSON(input)
    expect(result.rows[0].phone).toBe('')
  })

  it('handles objects with different keys', () => {
    const input = JSON.stringify([
      { name: 'Sarah', email: 's@e.com' },
      { name: 'Tom', phone: '0400000000' },
    ])
    const result = parseJSON(input)
    expect(result.headers).toContain('name')
    expect(result.headers).toContain('email')
    expect(result.headers).toContain('phone')
    expect(result.rows[0].phone).toBe('')
    expect(result.rows[1].email).toBe('')
  })
})

describe('parseTSV', () => {
  it('parses tab-delimited data', () => {
    const result = parseTSV('Name\tEmail\nSarah\ts@e.com\nTom\tt@e.com')
    expect(result.headers).toEqual(['Name', 'Email'])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual({ Name: 'Sarah', Email: 's@e.com' })
  })

  it('strips BOM', () => {
    const result = parseTSV('﻿Name\tEmail\nSarah\ts@e.com')
    expect(result.headers).toEqual(['Name', 'Email'])
  })
})

describe('detectDelimiter', () => {
  it('detects commas', () => {
    expect(detectDelimiter('Name,Email,Phone\nSarah,s@e.com,0400')).toBe(',')
  })

  it('detects tabs', () => {
    expect(detectDelimiter('Name\tEmail\tPhone\nSarah\ts@e.com\t0400')).toBe('\t')
  })

  it('detects semicolons', () => {
    expect(detectDelimiter('Name;Email;Phone\nSarah;s@e.com;0400')).toBe(';')
  })

  it('detects pipes', () => {
    expect(detectDelimiter('Name|Email|Phone\nSarah|s@e.com|0400')).toBe('|')
  })

  it('defaults to comma when no clear delimiter', () => {
    expect(detectDelimiter('just a plain line')).toBe(',')
  })
})
