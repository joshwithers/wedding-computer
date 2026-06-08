import { describe, it, expect } from 'vitest'
import { parseRunSheetItems } from './ai'

const ITEM = '{"time":"14:00","end_time":"14:30","title":"Ceremony","description":"Vows","location":"Garden","category":"ceremony"}'

describe('parseRunSheetItems — tolerant LLM output parsing', () => {
  it('parses a clean JSON array', () => {
    const r = parseRunSheetItems(`[${ITEM}]`)
    expect(r).toHaveLength(1)
    expect(r[0].title).toBe('Ceremony')
    expect(r[0].category).toBe('ceremony')
  })

  it('strips ```json code fences', () => {
    const r = parseRunSheetItems('```json\n[' + ITEM + ']\n```')
    expect(r).toHaveLength(1)
  })

  it('ignores prose surrounding the array', () => {
    const r = parseRunSheetItems(`Sure! Here is your run sheet:\n[${ITEM}]\nLet me know if you want changes.`)
    expect(r).toHaveLength(1)
  })

  it('extracts the array from a wrapping object', () => {
    const r = parseRunSheetItems(`{"items": [${ITEM}]}`)
    expect(r).toHaveLength(1)
  })

  it('returns [] for malformed JSON', () => {
    expect(parseRunSheetItems('[ {time: 14:00, ')).toEqual([])
  })

  it('returns [] when there is no array', () => {
    expect(parseRunSheetItems('I cannot help with that.')).toEqual([])
    expect(parseRunSheetItems('')).toEqual([])
  })

  it('drops entries without a title or time and defaults missing fields', () => {
    const r = parseRunSheetItems('[{"foo":"bar"},{"title":"Setup"}]')
    expect(r).toHaveLength(1)
    expect(r[0].title).toBe('Setup')
    expect(r[0].category).toBe('other') // default
    expect(r[0].time).toBe('')
  })
})
