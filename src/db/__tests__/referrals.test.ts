import { describe, it, expect } from 'vitest'
import { capGrant, FREE_MONTHS_CAP } from '../referrals'

describe('capGrant — free-month cap math (shared 9-month cap)', () => {
  it('adds the full amount when under the cap', () => {
    expect(capGrant(0, 1)).toEqual({ applied: 1, balance: 1, clamped: false })
    expect(capGrant(2, 3)).toEqual({ applied: 3, balance: 5, clamped: false })
  })

  it('caps the total at FREE_MONTHS_CAP (9)', () => {
    expect(capGrant(7, 5)).toEqual({ applied: 2, balance: FREE_MONTHS_CAP, clamped: true })
    expect(capGrant(0, 12)).toEqual({ applied: 9, balance: 9, clamped: true })
  })

  it('applies nothing when already at the cap', () => {
    expect(capGrant(9, 1)).toEqual({ applied: 0, balance: 9, clamped: true })
    expect(capGrant(9, 3)).toEqual({ applied: 0, balance: 9, clamped: true })
  })

  it('reaching the cap exactly is not flagged as clamped', () => {
    expect(capGrant(8, 1)).toEqual({ applied: 1, balance: 9, clamped: false })
  })

  it('treats zero / negative / fractional requests safely', () => {
    expect(capGrant(3, 0)).toEqual({ applied: 0, balance: 3, clamped: false })
    expect(capGrant(3, -2)).toEqual({ applied: 0, balance: 3, clamped: false })
    expect(capGrant(3, 1.9)).toEqual({ applied: 1, balance: 4, clamped: false })
  })

  it('a single referral reward (+1) is the common case', () => {
    // referrer at 4 earns one more
    expect(capGrant(4, 1)).toEqual({ applied: 1, balance: 5, clamped: false })
    // referrer already maxed keeps 9, reward effectively lost
    expect(capGrant(9, 1).applied).toBe(0)
  })
})
