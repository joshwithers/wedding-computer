import { describe, it, expect } from 'vitest'
import { diffSummary, diffRows, parsePayload } from './timeline-approval'
import type { TimelineChangeRequest } from '../types'

describe('diffSummary', () => {
  it('lists only changed fields with before → after', () => {
    const before = { start_time: '15:00', title: 'Ceremony', location: null }
    const after = { start_time: '15:30', title: 'Ceremony', location: 'Chapel' }
    const s = diffSummary(before, after)
    expect(s).toContain('Start: 15:00 → 15:30')
    expect(s).toContain('Location: — → Chapel')
    expect(s).not.toContain('What') // title unchanged
  })

  it('is empty when nothing changed', () => {
    expect(diffSummary({ title: 'X' }, { title: 'X' })).toBe('')
  })
})

describe('diffRows / parsePayload', () => {
  it('parses payload and returns changed rows for the diff card', () => {
    const req = {
      payload: JSON.stringify({ before: { title: 'A', start_time: '10:00' }, after: { title: 'B', start_time: '10:00' } }),
    } as TimelineChangeRequest
    const rows = diffRows(parsePayload(req))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ label: 'What', before: 'A', after: 'B' })
  })

  it('tolerates malformed payload', () => {
    expect(parsePayload({ payload: 'not json' } as TimelineChangeRequest)).toEqual({})
  })
})
