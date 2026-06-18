import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/crypto', () => ({ generateToken: vi.fn(async () => 'tok') }))
vi.mock('./email', () => ({
  sendEmailMessage: vi.fn(async () => 'email-id'),
  vendorInviteReminderEmail: vi.fn(() => '<html>'),
}))
vi.mock('../db/users', () => ({ getUserByEmail: vi.fn(async () => null) }))
vi.mock('../db/vendors', () => ({ getVendorByUserId: vi.fn(async () => null) }))
vi.mock('../db/analytics', () => ({ trackEvent: vi.fn(async () => undefined) }))

import { sendPendingVendorInviteReminders } from './invite-followups'
import { sendEmailMessage, vendorInviteReminderEmail } from './email'
import { getUserByEmail } from '../db/users'
import { getVendorByUserId as getVp } from '../db/vendors'
import { trackEvent } from '../db/analytics'

// Minimal in-memory KV that supports the list/get/put/delete the cron uses.
function makeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    async list({ prefix, limit }: { prefix: string; limit?: number }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit ?? 1000).map((name) => ({ name }))
      return { keys, list_complete: true }
    },
    async get(k: string) {
      return store.has(k) ? store.get(k)! : null
    },
    async put(k: string, v: string) {
      store.set(k, v)
    },
    async delete(k: string) {
      store.delete(k)
    },
  }
}

function record(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    weddingId: 'w1',
    weddingTitle: 'Sam & Alex',
    weddingDate: null,
    inviterName: 'Married by Josh',
    inviterVendorId: 'vendor-1',
    vendorRole: 'photographer',
    invitedAt: new Date().toISOString(),
    remindersSent: 0,
    ...overrides,
  })
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString()

function env(kv: ReturnType<typeof makeKv>) {
  return { DB: {} as any, KV: kv as any, RESEND_API_KEY: 'x', APP_URL: 'https://wedding.computer' } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUserByEmail as any).mockResolvedValue(null)
  ;(getVp as any).mockResolvedValue(null)
})

describe('sendPendingVendorInviteReminders', () => {
  it('sends the first reminder once an invite is 3+ days old', async () => {
    const kv = makeKv({ 'vinvite:a@x.com': record({ invitedAt: daysAgo(4), remindersSent: 0 }) })
    const sent = await sendPendingVendorInviteReminders(env(kv))
    expect(sent).toBe(1)
    expect(sendEmailMessage).toHaveBeenCalledTimes(1)
    expect(vendorInviteReminderEmail).toHaveBeenCalledWith(expect.objectContaining({ finalReminder: false }))
    expect(JSON.parse(kv.store.get('vinvite:a@x.com')!).remindersSent).toBe(1)
  })

  it('does not remind an invite younger than 3 days', async () => {
    const kv = makeKv({ 'vinvite:a@x.com': record({ invitedAt: daysAgo(1), remindersSent: 0 }) })
    const sent = await sendPendingVendorInviteReminders(env(kv))
    expect(sent).toBe(0)
    expect(sendEmailMessage).not.toHaveBeenCalled()
  })

  it('sends a final reminder at day 7 (after the first)', async () => {
    const kv = makeKv({ 'vinvite:a@x.com': record({ invitedAt: daysAgo(8), remindersSent: 1 }) })
    const sent = await sendPendingVendorInviteReminders(env(kv))
    expect(sent).toBe(1)
    expect(vendorInviteReminderEmail).toHaveBeenCalledWith(expect.objectContaining({ finalReminder: true }))
    expect(JSON.parse(kv.store.get('vinvite:a@x.com')!).remindersSent).toBe(2)
  })

  it('retires an invite after two reminders without emailing again', async () => {
    const kv = makeKv({ 'vinvite:a@x.com': record({ invitedAt: daysAgo(10), remindersSent: 2 }) })
    const sent = await sendPendingVendorInviteReminders(env(kv))
    expect(sent).toBe(0)
    expect(sendEmailMessage).not.toHaveBeenCalled()
    expect(kv.store.has('vinvite:a@x.com')).toBe(false)
  })

  it('marks activated + clears the record once the invitee has a vendor profile', async () => {
    ;(getUserByEmail as any).mockResolvedValue({ id: 'u1' })
    ;(getVp as any).mockResolvedValue({ id: 'vp1' })
    const kv = makeKv({ 'vinvite:a@x.com': record({ invitedAt: daysAgo(4), remindersSent: 0 }) })
    const sent = await sendPendingVendorInviteReminders(env(kv))
    expect(sent).toBe(0)
    expect(sendEmailMessage).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event_type: 'vendor_invite_activated', vendor_id: 'vendor-1' }))
    expect(kv.store.has('vinvite:a@x.com')).toBe(false)
  })
})
