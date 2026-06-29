import { describe, it, expect } from 'vitest'
import { updateSubscription } from './subscriptions'

// Recording fake D1: captures every prepared statement + its bound args so we
// can assert whether the Pro-loss branding reset fired.
function recordingDb() {
  const calls: { sql: string; binds: unknown[] }[] = []
  const db = {
    prepare(sql: string) {
      const entry = { sql, binds: [] as unknown[] }
      return {
        bind(...args: unknown[]) {
          entry.binds = args
          return { run: async () => { calls.push(entry); return { success: true } } }
        },
      }
    },
  }
  return { db: db as unknown as D1Database, calls }
}

const resetRan = (calls: { sql: string; binds: unknown[] }[]) =>
  calls.some((c) => /UPDATE vendor_profiles SET hide_branding = 0/.test(c.sql))

describe('updateSubscription — Pro-loss re-shows branding', () => {
  it('resets hide_branding when status drops to cancelled', async () => {
    const { db, calls } = recordingDb()
    await updateSubscription(db, 'v1', { status: 'cancelled', cancel_at_period_end: 0 })
    expect(resetRan(calls)).toBe(true)
    const reset = calls.find((c) => /hide_branding = 0/.test(c.sql))!
    expect(reset.binds).toEqual(['v1'])
  })

  it('resets hide_branding when status drops to past_due', async () => {
    const { db, calls } = recordingDb()
    await updateSubscription(db, 'v1', { status: 'past_due' })
    expect(resetRan(calls)).toBe(true)
  })

  it('does NOT reset when status stays active or trialing', async () => {
    for (const status of ['active', 'trialing'] as const) {
      const { db, calls } = recordingDb()
      await updateSubscription(db, 'v1', { status, current_period_end: '2027-01-01' })
      expect(resetRan(calls)).toBe(false)
    }
  })

  it('does NOT reset on a bare cancel_at_period_end toggle (in-app cancel keeps Pro)', async () => {
    const { db, calls } = recordingDb()
    await updateSubscription(db, 'v1', { cancel_at_period_end: 1 })
    expect(resetRan(calls)).toBe(false)
  })
})
