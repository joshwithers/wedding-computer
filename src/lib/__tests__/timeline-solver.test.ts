import { describe, it, expect } from 'vitest'
import {
  solveTimeline,
  overlappingPairs,
  hhmmToMin,
  minToHhmm,
  type SolverItem,
} from '../timeline-solver'

function item(p: Partial<SolverItem> & { id: string }): SolverItem {
  return {
    id: p.id,
    start_time: p.start_time ?? null,
    end_time: p.end_time ?? null,
    duration_minutes: p.duration_minutes ?? null,
    anchor_type: p.anchor_type ?? null,
    anchor_ref: p.anchor_ref ?? null,
    anchor_offset_minutes: p.anchor_offset_minutes ?? 0,
    pinned: p.pinned ?? false,
    actual_start: p.actual_start ?? null,
    sort_order: p.sort_order ?? 0,
  }
}

describe('hhmm helpers', () => {
  it('round-trips', () => {
    expect(hhmmToMin('16:00')).toBe(960)
    expect(hhmmToMin('09:05')).toBe(545)
    expect(hhmmToMin('bad')).toBeNull()
    expect(minToHhmm(960)).toBe('16:00')
    expect(minToHhmm(545)).toBe('09:05')
    expect(minToHhmm(1500)).toBe('01:00') // wraps past midnight
  })
})

describe('solveTimeline', () => {
  it('resolves an absolute item', () => {
    const s = solveTimeline([item({ id: 'a', start_time: '16:00', duration_minutes: 60 })])
    expect(s.get('a')!.startMin).toBe(960)
    expect(s.get('a')!.endMin).toBe(1020)
    expect(s.get('a')!.source).toBe('absolute')
  })

  it('chains "after" off the parent end + offset', () => {
    const items = [
      item({ id: 'a', start_time: '10:00', duration_minutes: 60 }), // 10:00–11:00
      item({ id: 'b', anchor_type: 'after', anchor_ref: 'a', anchor_offset_minutes: 15, duration_minutes: 30 }),
    ]
    const s = solveTimeline(items)
    expect(minToHhmm(s.get('b')!.startMin)).toBe('11:15')
    expect(minToHhmm(s.get('b')!.endMin)).toBe('11:45')
    expect(s.get('b')!.source).toBe('after')
  })

  it('"before" starts `offset` before the reference start; duration gives the end', () => {
    const items = [
      item({ id: 'ceremony', start_time: '16:00', pinned: true }),
      item({ id: 'firstlook', anchor_type: 'before', anchor_ref: 'ceremony', anchor_offset_minutes: 30, duration_minutes: 20 }),
    ]
    const s = solveTimeline(items)
    expect(minToHhmm(s.get('firstlook')!.startMin)).toBe('15:30') // 16:00 − 30
    expect(minToHhmm(s.get('firstlook')!.endMin)).toBe('15:50') // + 20 min duration
  })

  it('"before" with no duration is a point in time (start == end)', () => {
    const items = [
      item({ id: 'ceremony', start_time: '16:00' }),
      item({ id: 'cue', anchor_type: 'before', anchor_ref: 'ceremony', anchor_offset_minutes: 10 }),
    ]
    const s = solveTimeline(items)
    expect(minToHhmm(s.get('cue')!.startMin)).toBe('15:50')
    expect(s.get('cue')!.durationMin).toBeNull()
  })

  it('anchors to a sun event with an offset', () => {
    const items = [
      item({ id: 'portraits', anchor_type: 'sun', anchor_ref: 'sunset', anchor_offset_minutes: -75, duration_minutes: 30 }),
    ]
    const s = solveTimeline(items, { sunset: 18 * 60 }) // sunset 18:00
    expect(minToHhmm(s.get('portraits')!.startMin)).toBe('16:45')
    expect(s.get('portraits')!.source).toBe('sun')
  })

  it('resolves multi-hop chains', () => {
    const items = [
      item({ id: 'a', start_time: '09:00', duration_minutes: 30 }),
      item({ id: 'b', anchor_type: 'after', anchor_ref: 'a', duration_minutes: 30 }),
      item({ id: 'c', anchor_type: 'after', anchor_ref: 'b', anchor_offset_minutes: 10, duration_minutes: 15 }),
    ]
    const s = solveTimeline(items)
    expect(minToHhmm(s.get('b')!.startMin)).toBe('09:30')
    expect(minToHhmm(s.get('c')!.startMin)).toBe('10:10') // b ends 10:00 + 10
  })

  it('flags cycles without hanging', () => {
    const items = [
      item({ id: 'a', anchor_type: 'after', anchor_ref: 'b', start_time: '10:00' }),
      item({ id: 'b', anchor_type: 'after', anchor_ref: 'a', start_time: '11:00' }),
    ]
    const s = solveTimeline(items)
    const conflicts = [...s.values()].flatMap((v) => v.conflicts)
    expect(conflicts).toContain('cycle')
  })

  it('flags a missing reference and falls back to its own time', () => {
    const s = solveTimeline([item({ id: 'a', anchor_type: 'after', anchor_ref: 'ghost', start_time: '12:00' })])
    expect(s.get('a')!.conflicts).toContain('missing-ref')
    expect(minToHhmm(s.get('a')!.startMin)).toBe('12:00')
  })

  it('flags a missing sun event', () => {
    const s = solveTimeline([item({ id: 'a', anchor_type: 'sun', anchor_ref: 'sunset' })], {})
    expect(s.get('a')!.conflicts).toContain('missing-sun')
  })

  it('live mode: actual_start overrides and cascades downstream', () => {
    const items = [
      item({ id: 'a', start_time: '10:00', duration_minutes: 60, actual_start: '10:30' }),
      item({ id: 'b', anchor_type: 'after', anchor_ref: 'a', duration_minutes: 30 }),
    ]
    const planned = solveTimeline(items)
    expect(minToHhmm(planned.get('b')!.startMin)).toBe('11:00')

    const live = solveTimeline(items, {}, { useActual: true })
    expect(minToHhmm(live.get('a')!.startMin)).toBe('10:30')
    expect(live.get('a')!.source).toBe('actual')
    expect(minToHhmm(live.get('b')!.startMin)).toBe('11:30') // cascaded the 30-min slip
  })
})

describe('overlappingPairs', () => {
  it('detects two items that double-book', () => {
    const items = [
      item({ id: 'a', start_time: '16:00', duration_minutes: 60 }), // 16:00–17:00
      item({ id: 'b', start_time: '16:30', duration_minutes: 60 }), // 16:30–17:30 overlaps
      item({ id: 'c', start_time: '18:00', duration_minutes: 30 }), // clear
    ]
    const pairs = overlappingPairs(solveTimeline(items))
    expect(pairs).toContainEqual(['a', 'b'])
    expect(pairs.find((p) => p.includes('c'))).toBeUndefined()
  })
})
