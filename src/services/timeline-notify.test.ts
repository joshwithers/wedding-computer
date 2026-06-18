import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db/weddings', () => ({ getWedding: vi.fn(async () => ({ id: 'w1', title: 'Sam & Alex' })) }))
vi.mock('./notifications', () => ({ deliver: vi.fn(async () => true) }))
vi.mock('./email', () => ({ timelineUpdatedEmail: vi.fn(() => '<html>') }))

import { flushTimelineNotifications, markTimelineDirty } from './timeline-notify'
import { deliver } from './notifications'

function makeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    async list({ prefix, limit }: { prefix: string; limit?: number }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit ?? 1000).map((name) => ({ name }))
      return { keys, list_complete: true }
    },
    async get(k: string) { return store.has(k) ? store.get(k)! : null },
    async put(k: string, v: string) { store.set(k, v) },
    async delete(k: string) { store.delete(k) },
  }
}

// Fake D1 whose recipient query returns two vendors.
const fakeDb = {
  prepare: () => ({
    bind: () => ({
      all: async () => ({
        results: [
          { id: 'u1', email: 'a@x.com', name: 'A', notification_prefs: '{}' },
          { id: 'u2', email: 'b@x.com', name: 'B', notification_prefs: '{}' },
        ],
      }),
    }),
  }),
}

function env(kv: ReturnType<typeof makeKv>) {
  return { DB: fakeDb, KV: kv, RESEND_API_KEY: 'x', APP_URL: 'https://wedding.computer', SESSION_SECRET: 's' } as any
}

const minsAgo = (m: number) => Date.now() - m * 60 * 1000

beforeEach(() => vi.clearAllMocks())

describe('markTimelineDirty', () => {
  it('writes a dirty record for the wedding', async () => {
    const kv = makeKv()
    await markTimelineDirty(kv as any, 'w1', 'editor1')
    const rec = JSON.parse(kv.store.get('tldirty:w1')!)
    expect(rec.editorUserId).toBe('editor1')
    expect(typeof rec.lastChangeAt).toBe('number')
  })
})

describe('flushTimelineNotifications', () => {
  it('does not notify while edits are still settling (<15 min)', async () => {
    const kv = makeKv({ 'tldirty:w1': JSON.stringify({ lastChangeAt: minsAgo(5), editorUserId: 'e' }) })
    const sent = await flushTimelineNotifications(env(kv))
    expect(sent).toBe(0)
    expect(deliver).not.toHaveBeenCalled()
    expect(kv.store.has('tldirty:w1')).toBe(true) // kept for next sweep
  })

  it('notifies the run-sheet team once edits have settled, then clears the marker', async () => {
    const kv = makeKv({ 'tldirty:w1': JSON.stringify({ lastChangeAt: minsAgo(20), editorUserId: 'e' }) })
    const sent = await flushTimelineNotifications(env(kv))
    expect(sent).toBe(2) // two recipients
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(deliver).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ key: 'wedding_updates' }))
    expect(kv.store.has('tldirty:w1')).toBe(false) // cleared (no newer edit)
  })

  it('keeps the marker if a newer edit landed during the sweep (compare-and-delete)', async () => {
    const kv = makeKv({ 'tldirty:w1': JSON.stringify({ lastChangeAt: minsAgo(20), editorUserId: 'e' }) })
    // Simulate a fresh edit arriving while we email: deliver overwrites the marker.
    ;(deliver as any).mockImplementation(async () => {
      kv.store.set('tldirty:w1', JSON.stringify({ lastChangeAt: Date.now(), editorUserId: 'e2' }))
      return true
    })
    await flushTimelineNotifications(env(kv))
    expect(kv.store.has('tldirty:w1')).toBe(true) // not deleted — newer edit pending
  })
})
