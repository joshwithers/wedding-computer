import { describe, it, expect } from 'vitest'
import { describeDemand } from './busyness'

describe('describeDemand — score → tier interpretation', () => {
  it('returns "unknown" for null/undefined/NaN', () => {
    expect(describeDemand(null).tier).toBe('unknown')
    expect(describeDemand(undefined).tier).toBe('unknown')
    expect(describeDemand(Number.NaN).tier).toBe('unknown')
    expect(describeDemand(null).label).toBe('Not enough data yet')
  })

  it('buckets a very high score (>= 2.0)', () => {
    expect(describeDemand(2.0).tier).toBe('high')
    expect(describeDemand(3.7).tier).toBe('high')
    expect(describeDemand(2.0).label).toBe('Very high demand')
  })

  it('buckets above-average (1.0 <= score < 2.0)', () => {
    expect(describeDemand(1.0).tier).toBe('above')
    expect(describeDemand(1.9).tier).toBe('above')
    expect(describeDemand(1.0).label).toBe('Above-average demand')
  })

  it('buckets below-average (0.5 <= score < 1.0)', () => {
    expect(describeDemand(0.5).tier).toBe('below')
    expect(describeDemand(0.99).tier).toBe('below')
  })

  it('buckets a quiet date (score < 0.5, including 0)', () => {
    expect(describeDemand(0).tier).toBe('quiet')
    expect(describeDemand(0.49).tier).toBe('quiet')
    expect(describeDemand(0).label).toBe('Quiet date')
  })

  it('always returns Tailwind classes for the dot and text', () => {
    for (const s of [null, 0, 0.5, 1, 2] as const) {
      const d = describeDemand(s)
      expect(d.dotClass).toMatch(/^bg-/)
      expect(d.textClass).toMatch(/^text-/)
    }
  })
})
