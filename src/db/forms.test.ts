import { describe, it, expect } from 'vitest'
import { formSubmissionFields } from './forms'

describe('formSubmissionFields', () => {
  it('maps field ids to their labels from a flat config', () => {
    const config = JSON.stringify({
      fields: [
        { id: 'first_dance', label: 'First dance song' },
        { id: 'dietary', label: 'Dietary requirements' },
      ],
    })
    const data = JSON.stringify({ first_dance: 'At Last', dietary: 'Vegetarian' })
    expect(formSubmissionFields(config, data)).toEqual([
      { label: 'First dance song', value: 'At Last' },
      { label: 'Dietary requirements', value: 'Vegetarian' },
    ])
  })

  it('reads labels from a multi-step config', () => {
    const config = JSON.stringify({
      steps: [
        { fields: [{ id: 'a', label: 'Name' }] },
        { fields: [{ id: 'b', label: 'Date' }] },
      ],
    })
    const data = JSON.stringify({ a: 'Sam', b: '2027-08-08' })
    expect(formSubmissionFields(config, data)).toEqual([
      { label: 'Name', value: 'Sam' },
      { label: 'Date', value: '2027-08-08' },
    ])
  })

  it('falls back to the field id when no label is known', () => {
    expect(formSubmissionFields('{"fields":[]}', '{"mystery":"x"}')).toEqual([
      { label: 'mystery', value: 'x' },
    ])
  })

  it('is resilient to malformed JSON', () => {
    expect(formSubmissionFields('not json', 'also not json')).toEqual([])
    expect(formSubmissionFields('{}', '{}')).toEqual([])
  })

  it('coerces non-string values to strings', () => {
    const data = JSON.stringify({ count: 3, ok: true, empty: null })
    const out = formSubmissionFields('{"fields":[]}', data)
    expect(out).toEqual([
      { label: 'count', value: '3' },
      { label: 'ok', value: 'true' },
      { label: 'empty', value: '' },
    ])
  })
})
