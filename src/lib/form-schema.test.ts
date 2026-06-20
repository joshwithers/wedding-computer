import { describe, it, expect } from 'vitest'
import {
  sanitizeBuilderFields,
  validateBuilderFields,
  configHasFileField,
  BUILDER_FIELD_TYPES,
  type FormConfig,
} from './form-schema'

describe('sanitizeBuilderFields', () => {
  it('whitelists props, defaults width, and keeps known types', () => {
    const out = sanitizeBuilderFields([
      { id: 'a', type: 'text', label: 'Name', evil: 'x', required: true },
    ])
    expect(out).toEqual([{ id: 'a', type: 'text', label: 'Name', required: true, width: 'full' }])
  })

  it('drops fields with no label and entries that are not objects', () => {
    expect(sanitizeBuilderFields([{ type: 'text', label: '  ' }, 'nope', null, 42])).toEqual([])
  })

  it('coerces an unknown type to text', () => {
    const out = sanitizeBuilderFields([{ id: 'a', type: 'wat', label: 'Q' }])
    expect(out[0].type).toBe('text')
  })

  it('parses options from a newline string or an array', () => {
    const fromStr = sanitizeBuilderFields([{ id: 'a', type: 'select', label: 'Pick', options: 'One\n Two \n\nThree' }])
    expect(fromStr[0].options).toEqual(['One', 'Two', 'Three'])
    const fromArr = sanitizeBuilderFields([{ id: 'b', type: 'multiselect', label: 'Pick', options: ['X', { value: 'Y' }] }])
    expect(fromArr[0].options).toEqual(['X', 'Y'])
  })

  it('clamps rating + scale settings into range', () => {
    const rating = sanitizeBuilderFields([{ id: 'r', type: 'rating', label: 'Stars', max: 99 }])
    expect(rating[0].max).toBe(10)
    const scale = sanitizeBuilderFields([{ id: 's', type: 'scale', label: 'Scale', min: 5, max: 'x' }])
    expect(scale[0].min).toBe(1) // min clamped to [0,1]
    expect(scale[0].max).toBe(10) // default
  })

  it('regenerates missing or duplicate ids', () => {
    const out = sanitizeBuilderFields([
      { type: 'text', label: 'A' },
      { id: 'dup', type: 'text', label: 'B' },
      { id: 'dup', type: 'text', label: 'C' },
    ])
    const ids = out.map((f) => f.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toMatch(/^f_/)
  })

  it('regenerates ids with unsafe characters (no HTML injection via id)', () => {
    const out = sanitizeBuilderFields([
      { id: '"><img src=x onerror=alert(1)>', type: 'text', label: 'A' },
      { id: 'ok_id-1', type: 'text', label: 'B' },
    ])
    expect(out[0].id).toMatch(/^f_[a-z0-9]+$/)
    expect(out[1].id).toBe('ok_id-1')
    expect(out.every((f) => /^[A-Za-z0-9_-]+$/.test(f.id))).toBe(true)
  })

  it('only keeps valid contact mappings', () => {
    const out = sanitizeBuilderFields([
      { id: 'a', type: 'email', label: 'Email', mapTo: 'email' },
      { id: 'b', type: 'text', label: 'X', mapTo: 'not_real' },
    ])
    expect(out[0].mapTo).toBe('email')
    expect(out[1].mapTo).toBeUndefined()
  })
})

describe('validateBuilderFields', () => {
  it('requires at least one field', () => {
    expect(validateBuilderFields([])).toMatch(/at least one/i)
  })
  it('requires options on choice fields', () => {
    const err = validateBuilderFields(sanitizeBuilderFields([{ id: 'a', type: 'radio', label: 'Pick' }]))
    expect(err).toMatch(/option/i)
  })
  it('passes a well-formed set', () => {
    const fields = sanitizeBuilderFields([
      { id: 'a', type: 'text', label: 'Name' },
      { id: 'b', type: 'file', label: 'Upload' },
      { id: 'c', type: 'select', label: 'Pick', options: 'One\nTwo' },
    ])
    expect(validateBuilderFields(fields)).toBeNull()
  })
})

describe('configHasFileField', () => {
  const base: FormConfig = { version: 1, title: 'T', submitLabel: 'Go', fields: [], actions: { notifyVendor: true, confirmationEmail: { enabled: false, mode: 'ai' } } }
  it('detects file fields in a flat config', () => {
    expect(configHasFileField({ ...base, fields: [{ id: 'a', type: 'text', label: 'X' }] })).toBe(false)
    expect(configHasFileField({ ...base, fields: [{ id: 'f', type: 'file', label: 'Upload' }] })).toBe(true)
  })
  it('detects file fields inside steps', () => {
    expect(configHasFileField({ ...base, steps: [{ id: 's', title: 'S', fields: [{ id: 'f', type: 'file', label: 'Upload' }] }] })).toBe(true)
  })
})

describe('BUILDER_FIELD_TYPES', () => {
  it('includes the new field types with icons + groups', () => {
    const byValue = new Map(BUILDER_FIELD_TYPES.map((t) => [t.value, t]))
    for (const v of ['file', 'url', 'time', 'rating', 'scale', 'multiselect']) {
      expect(byValue.has(v as any)).toBe(true)
      expect(byValue.get(v as any)!.icon.length).toBeGreaterThan(0)
      expect(byValue.get(v as any)!.group.length).toBeGreaterThan(0)
    }
  })
})
