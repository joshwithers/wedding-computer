import { describe, it, expect } from 'vitest'
import { buildFunnel, median, formatDuration, buildInsights } from './analytics-derive'

describe('buildFunnel', () => {
  it('is monotonically non-increasing (booked never exceeds quoted)', () => {
    // The old bug: grouping by current status let Booked (3) beat Quoted (1).
    const funnel = buildFunnel({ new: 3, contacted: 1, quoted: 1, booked: 3 })
    const counts = funnel.map((s) => s.count)
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1])
    }
  })

  it('counts contacts reaching at least each stage', () => {
    const funnel = buildFunnel({ new: 2, contacted: 1, meeting: 0, quoted: 1, booked: 3 })
    const byStatus = Object.fromEntries(funnel.map((s) => [s.status, s.count]))
    // total = 7; booked-or-beyond = 3; quoted+ = 4; meeting+ = 4; contacted+ = 5
    expect(byStatus.new).toBe(7)
    expect(byStatus.contacted).toBe(5)
    expect(byStatus.meeting).toBe(4)
    expect(byStatus.quoted).toBe(4)
    expect(byStatus.booked).toBe(3)
  })

  it('completed counts as booked; lost/archived only as new', () => {
    const funnel = buildFunnel({ new: 1, completed: 2, lost: 3, archived: 1 })
    const byStatus = Object.fromEntries(funnel.map((s) => [s.status, s.count]))
    expect(byStatus.new).toBe(7) // everyone entered the pipeline
    expect(byStatus.booked).toBe(2) // only the completed reached booking
  })

  it('computes drop-off between stages', () => {
    const funnel = buildFunnel({ contacted: 100, booked: 0 })
    // new=100, contacted=100 (0% drop), then everything below 0 vs 100 = 100%
    expect(funnel[1].dropOffPct).toBe(0)
    expect(funnel[2].dropOffPct).toBe(100)
  })
})

describe('median', () => {
  it('odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
  it('empty → null', () => {
    expect(median([])).toBeNull()
  })
})

describe('formatDuration', () => {
  it('scales minutes / hours / days', () => {
    expect(formatDuration(0.5)).toEqual({ code: 'minutes', value: 30 })
    expect(formatDuration(3)).toEqual({ code: 'hours', value: 3 })
    expect(formatDuration(72)).toEqual({ code: 'days', value: 3 })
  })
})

describe('buildInsights', () => {
  const base = {
    enquiries30d: 10,
    enquiriesPrev30d: 10,
    bookings30d: 3,
    bookingRate: 30,
    industryBookingRate: 30,
    medianResponseHours: null,
    busiestUpcomingMonth: null,
  }

  it('flags slow response with raw hours', () => {
    const out = buildInsights({ ...base, medianResponseHours: 48 })
    const slow = out.find((i) => i.code === 'response_slow')
    expect(slow?.params.hours).toBe(48)
    expect(slow?.tone).toBe('warn')
  })

  it('praises fast response', () => {
    const out = buildInsights({ ...base, medianResponseHours: 2 })
    expect(out.some((i) => i.code === 'response_fast' && i.tone === 'good')).toBe(true)
  })

  it('compares booking rate to industry', () => {
    expect(buildInsights({ ...base, bookingRate: 15, industryBookingRate: 30 }).some((i) => i.code === 'rate_below')).toBe(true)
    expect(buildInsights({ ...base, bookingRate: 45, industryBookingRate: 30 }).some((i) => i.code === 'rate_above')).toBe(true)
  })

  it('warns when no enquiries at all', () => {
    expect(buildInsights({ ...base, enquiries30d: 0, enquiriesPrev30d: 0 }).some((i) => i.code === 'no_enquiries')).toBe(true)
  })
})
