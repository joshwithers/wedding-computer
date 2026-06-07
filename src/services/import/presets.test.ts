import { describe, expect, it } from 'vitest'
import { autoMapColumns, normalizeStatus, IMPORT_PRESETS } from './presets'

describe('autoMapColumns', () => {
  it('maps Dubsado headers with preset', () => {
    const headers = ['First Name', 'Last Name', 'Email', 'Phone Number', 'Event Date', 'Status', 'Tags']
    const result = autoMapColumns(headers, 'dubsado')
    expect(result['First Name']).toBe('first_name')
    expect(result['Last Name']).toBe('last_name')
    expect(result['Email']).toBe('email')
    expect(result['Phone Number']).toBe('phone')
    expect(result['Event Date']).toBe('wedding_date')
    expect(result['Status']).toBe('status')
    expect(result['Tags']).toBe('_skip')
  })

  it('maps Studio Ninja client export headers with preset', () => {
    const headers = ['First Name', 'Phone', 'Email', 'Company Name', 'Suburb/Town', 'Client Notes', 'Date Added']
    const result = autoMapColumns(headers, 'studio_ninja')
    expect(result['First Name']).toBe('first_name')
    expect(result['Phone']).toBe('phone')
    expect(result['Email']).toBe('email')
    expect(result['Company Name']).toBe('_skip')
    expect(result['Suburb/Town']).toBe('wedding_location')
    expect(result['Client Notes']).toBe('notes')
    expect(result['Date Added']).toBe('_skip')
  })

  it('maps HoneyBook headers with preset', () => {
    const headers = ['Client First Name', 'Client Last Name', 'Client Email', 'Project Date', 'Pipeline Status']
    const result = autoMapColumns(headers, 'honeybook')
    expect(result['Client First Name']).toBe('first_name')
    expect(result['Client Last Name']).toBe('last_name')
    expect(result['Client Email']).toBe('email')
    expect(result['Project Date']).toBe('wedding_date')
    expect(result['Pipeline Status']).toBe('status')
  })

  it('maps VSCO Workspace headers with preset', () => {
    const headers = ['First', 'Last', 'Email', 'Client Emails', 'Phone', 'Event Date', 'Referral']
    const result = autoMapColumns(headers, 'vsco_workspace')
    expect(result['First']).toBe('first_name')
    expect(result['Last']).toBe('last_name')
    expect(result['Client Emails']).toBe('email')
    expect(result['Referral']).toBe('source')
  })

  it('maps Tardis snake_case headers with preset', () => {
    const headers = ['first_name', 'last_name', 'email', 'partner_first_name', 'wedding_date']
    const result = autoMapColumns(headers, 'tardis')
    expect(result['first_name']).toBe('first_name')
    expect(result['partner_first_name']).toBe('partner_first_name')
    expect(result['wedding_date']).toBe('wedding_date')
  })

  it('falls back to fuzzy matching when no preset', () => {
    const headers = ['First Name', 'Last Name', 'Email Address', 'Mobile', 'Wedding Date', 'Venue']
    const result = autoMapColumns(headers)
    expect(result['First Name']).toBe('first_name')
    expect(result['Last Name']).toBe('last_name')
    expect(result['Email Address']).toBe('email')
    expect(result['Mobile']).toBe('phone')
    expect(result['Wedding Date']).toBe('wedding_date')
    expect(result['Venue']).toBe('wedding_location')
  })

  it('fuzzy-matches common variations', () => {
    const headers = ['fname', 'surname', 'cell', 'spouse', 'How You Found Us']
    const result = autoMapColumns(headers)
    expect(result['fname']).toBe('first_name')
    expect(result['surname']).toBe('last_name')
    expect(result['cell']).toBe('phone')
    expect(result['spouse']).toBe('partner_first_name')
    expect(result['How You Found Us']).toBe('source')
  })

  it('skips unrecognized headers', () => {
    const headers = ['First Name', 'Completely Random Column', 'Some Weird Thing']
    const result = autoMapColumns(headers)
    expect(result['First Name']).toBe('first_name')
    expect(result['Completely Random Column']).toBe('_skip')
    expect(result['Some Weird Thing']).toBe('_skip')
  })

  it('fuzzy-matches case insensitively with stripped punctuation', () => {
    const headers = ['FIRST NAME', 'email-address', 'Phone_Number']
    const result = autoMapColumns(headers)
    expect(result['FIRST NAME']).toBe('first_name')
    expect(result['email-address']).toBe('email')
    expect(result['Phone_Number']).toBe('phone')
  })
})

describe('normalizeStatus', () => {
  it('passes through valid statuses', () => {
    expect(normalizeStatus('new')).toBe('new')
    expect(normalizeStatus('contacted')).toBe('contacted')
    expect(normalizeStatus('meeting')).toBe('meeting')
    expect(normalizeStatus('quoted')).toBe('quoted')
    expect(normalizeStatus('booked')).toBe('booked')
    expect(normalizeStatus('completed')).toBe('completed')
    expect(normalizeStatus('lost')).toBe('lost')
    expect(normalizeStatus('archived')).toBe('archived')
  })

  it('normalizes case', () => {
    expect(normalizeStatus('NEW')).toBe('new')
    expect(normalizeStatus('Booked')).toBe('booked')
    expect(normalizeStatus(' Quoted ')).toBe('quoted')
  })

  it('maps lead/inquiry synonyms to new', () => {
    expect(normalizeStatus('lead')).toBe('new')
    expect(normalizeStatus('inquiry')).toBe('new')
    expect(normalizeStatus('enquiry')).toBe('new')
    expect(normalizeStatus('prospect')).toBe('new')
    expect(normalizeStatus('pending')).toBe('new')
  })

  it('maps follow-up synonyms to contacted', () => {
    expect(normalizeStatus('follow up')).toBe('contacted')
    expect(normalizeStatus('responded')).toBe('contacted')
    expect(normalizeStatus('replied')).toBe('contacted')
  })

  it('maps consultation to meeting', () => {
    expect(normalizeStatus('consultation')).toBe('meeting')
    expect(normalizeStatus('in progress')).toBe('meeting')
  })

  it('maps proposal/quote synonyms to quoted', () => {
    expect(normalizeStatus('proposal')).toBe('quoted')
    expect(normalizeStatus('proposal sent')).toBe('quoted')
    expect(normalizeStatus('quote')).toBe('quoted')
    expect(normalizeStatus('quote sent')).toBe('quoted')
  })

  it('maps confirmed/hired/won to booked', () => {
    expect(normalizeStatus('confirmed')).toBe('booked')
    expect(normalizeStatus('hired')).toBe('booked')
    expect(normalizeStatus('active')).toBe('booked')
    expect(normalizeStatus('won')).toBe('booked')
  })

  it('maps done/finished/delivered to completed', () => {
    expect(normalizeStatus('closed')).toBe('completed')
    expect(normalizeStatus('done')).toBe('completed')
    expect(normalizeStatus('finished')).toBe('completed')
    expect(normalizeStatus('delivered')).toBe('completed')
  })

  it('maps declined/cancelled to lost', () => {
    expect(normalizeStatus('declined')).toBe('lost')
    expect(normalizeStatus('rejected')).toBe('lost')
    expect(normalizeStatus('not booked')).toBe('lost')
    expect(normalizeStatus('cancelled')).toBe('lost')
    expect(normalizeStatus('canceled')).toBe('lost')
  })

  it('maps inactive/old to archived', () => {
    expect(normalizeStatus('inactive')).toBe('archived')
    expect(normalizeStatus('old')).toBe('archived')
  })

  it('defaults unknown statuses to new', () => {
    expect(normalizeStatus('something weird')).toBe('new')
    expect(normalizeStatus('')).toBe('new')
  })
})

describe('IMPORT_PRESETS', () => {
  it('has all expected presets', () => {
    expect(Object.keys(IMPORT_PRESETS)).toEqual(
      expect.arrayContaining(['dubsado', 'studio_ninja', 'honeybook', 'vsco_workspace', 'tardis'])
    )
  })

  it('each preset has required fields', () => {
    for (const [key, preset] of Object.entries(IMPORT_PRESETS)) {
      expect(preset.name, `${key}.name`).toBeTruthy()
      expect(preset.description, `${key}.description`).toBeTruthy()
      expect(preset.defaultMapping, `${key}.defaultMapping`).toBeTruthy()
      expect(preset.notes, `${key}.notes`).toBeTruthy()
    }
  })

  it('each preset maps to valid target fields or _skip', () => {
    const validTargets = new Set([
      'first_name', 'last_name', 'email', 'phone',
      'partner_first_name', 'partner_last_name', 'partner_email', 'partner_phone',
      'wedding_date', 'wedding_location', 'source', 'status', 'notes', '_skip',
    ])
    for (const [key, preset] of Object.entries(IMPORT_PRESETS)) {
      for (const [col, target] of Object.entries(preset.defaultMapping)) {
        expect(validTargets.has(target), `${key}: "${col}" → "${target}" should be a valid target`).toBe(true)
      }
    }
  })
})
