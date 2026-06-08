import { describe, it, expect } from 'vitest'
import { processJsonSubmission, processSubmission } from './enquiry'
import { defaultFormConfig } from '../lib/form-schema'

describe('processJsonSubmission — JSON API / agent intake', () => {
  it('accepts a minimal valid payload', () => {
    const { contactData, formData } = processJsonSubmission({
      first_name: 'Sam',
      last_name: 'Rivera',
      email: 'Sam@Example.com',
    })
    expect(contactData.first_name).toBe('Sam')
    expect(contactData.email).toBe('sam@example.com') // lowercased
    expect(formData).toEqual({})
  })

  it('maps optional + custom fields', () => {
    const { contactData, formData } = processJsonSubmission({
      first_name: 'Sam',
      last_name: 'Rivera',
      email: 'sam@example.com',
      wedding_date: '2027-03-14',
      wedding_location: 'Byron Bay',
      message: 'Beach elopement',
      fields: { 'How did you hear about us?': 'Instagram' },
    })
    expect(contactData.wedding_date).toBe('2027-03-14')
    expect(contactData.wedding_location).toBe('Byron Bay')
    expect(contactData.notes).toBe('Beach elopement') // message → notes
    expect(formData['How did you hear about us?']).toBe('Instagram')
  })

  it('requires first_name, last_name, email', () => {
    expect(() => processJsonSubmission({ last_name: 'R', email: 'a@b.com' })).toThrow(/first_name/)
    expect(() => processJsonSubmission({ first_name: 'S', email: 'a@b.com' })).toThrow(/last_name/)
    expect(() => processJsonSubmission({ first_name: 'S', last_name: 'R' })).toThrow(/email/)
  })

  it('rejects an invalid email', () => {
    expect(() => processJsonSubmission({ first_name: 'S', last_name: 'R', email: 'not-an-email' })).toThrow(/valid email/)
  })

  it('rejects non-string field values', () => {
    expect(() => processJsonSubmission({ first_name: 123 as any, last_name: 'R', email: 'a@b.com' })).toThrow(/must be a string/)
  })

  it('rejects an over-long value', () => {
    expect(() =>
      processJsonSubmission({ first_name: 'S', last_name: 'R', email: 'a@b.com', notes: 'x'.repeat(2001) })
    ).toThrow(/too long/)
  })

  it('rejects a non-object `fields`', () => {
    expect(() =>
      processJsonSubmission({ first_name: 'S', last_name: 'R', email: 'a@b.com', fields: 'nope' })
    ).toThrow(/must be an object/)
  })
})

describe('processSubmission — form-encoded intake (via FormConfig mapping)', () => {
  const config = defaultFormConfig()

  it('maps posted field ids through the config', () => {
    const { contactData } = processSubmission(config, {
      first_name: 'Mia',
      last_name: 'Johnson',
      email: 'MIA@example.com',
      wedding_date: '2026-09-05',
    })
    expect(contactData.first_name).toBe('Mia')
    expect(contactData.email).toBe('mia@example.com')
    expect(contactData.wedding_date).toBe('2026-09-05')
  })

  it('throws when a required field is missing', () => {
    expect(() => processSubmission(config, { first_name: 'Mia', email: 'mia@example.com' })).toThrow()
  })

  it('puts unmapped fields into formData by label', () => {
    const { formData } = processSubmission(config, {
      first_name: 'Mia',
      last_name: 'Johnson',
      email: 'mia@example.com',
      ceremony_type: 'Elopement',
    })
    expect(formData['Ceremony type']).toBe('Elopement')
  })
})
