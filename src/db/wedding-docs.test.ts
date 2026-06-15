import { describe, it, expect } from 'vitest'
import { contentToken, saveDoc, appendToDoc } from './wedding-docs'

describe('contentToken', () => {
  it('is deterministic for the same content', () => {
    expect(contentToken('hello world')).toBe(contentToken('hello world'))
  })

  it('changes when the content changes', () => {
    expect(contentToken('hello world')).not.toBe(contentToken('hello worle'))
    expect(contentToken('a')).not.toBe(contentToken('aa'))
  })

  it('is stable for empty content', () => {
    expect(contentToken('')).toBe(contentToken(''))
  })
})

/**
 * Minimal D1 stub: SELECTs return the seeded current content; writes are
 * recorded. Enough to exercise saveDoc's optimistic-concurrency decision and
 * write routing without a full SQL engine.
 */
function stubDb(current: string) {
  const writes: { sql: string; params: unknown[] }[] = []
  const db = {
    prepare(sql: string) {
      const stmt = {
        _params: [] as unknown[],
        bind(...p: unknown[]) {
          stmt._params = p
          return stmt
        },
        async first() {
          if (/SELECT notes FROM weddings/i.test(sql)) return { notes: current }
          if (/SELECT vendor_notes FROM wedding_members/i.test(sql)) return { vendor_notes: current }
          if (/SELECT content FROM wedding_docs/i.test(sql)) return { content: current }
          return null
        },
        async run() {
          writes.push({ sql, params: stmt._params })
          return { success: true }
        },
        async all() {
          return { results: [] }
        },
      }
      return stmt
    },
  }
  return { db: db as unknown as D1Database, writes }
}

describe('saveDoc — version guard', () => {
  it('saves the shared doc when the base token matches and updates weddings.notes', async () => {
    const { db, writes } = stubDb('hello')
    const result = await saveDoc(db, 'w1', 'shared', 'hello world', contentToken('hello'), 'u1')
    expect(result).toEqual({ ok: true, token: contentToken('hello world') })
    expect(writes.some((w) => /UPDATE weddings/i.test(w.sql))).toBe(true)
  })

  it('rejects a stale save with a conflict carrying the latest content', async () => {
    const { db, writes } = stubDb('hello')
    const result = await saveDoc(db, 'w1', 'shared', 'hello world', contentToken('OLD'), 'u1')
    expect(result).toEqual({
      ok: false,
      conflict: true,
      content: 'hello',
      token: contentToken('hello'),
    })
    // nothing written on conflict
    expect(writes.some((w) => /UPDATE|INSERT/i.test(w.sql))).toBe(false)
  })

  it('routes vendors-scope saves into wedding_docs', async () => {
    const { db, writes } = stubDb('')
    const result = await saveDoc(db, 'w1', 'vendors', 'team plan', contentToken(''), 'u1')
    expect(result.ok).toBe(true)
    expect(writes.some((w) => /INSERT INTO wedding_docs/i.test(w.sql))).toBe(true)
  })

  it('routes private-scope saves into wedding_members.vendor_notes', async () => {
    const { db, writes } = stubDb('')
    const result = await saveDoc(db, 'w1', 'private', 'just for me', contentToken(''), 'u1')
    expect(result.ok).toBe(true)
    expect(writes.some((w) => /UPDATE wedding_members SET vendor_notes/i.test(w.sql))).toBe(true)
  })
})

describe('appendToDoc', () => {
  it('appends below existing content with a blank-line separator', async () => {
    const { db, writes } = stubDb('First line.')
    const next = await appendToDoc(db, 'w1', 'shared', 'u1', 'Second line.')
    expect(next).toBe('First line.\n\nSecond line.')
    expect(writes.some((w) => /UPDATE weddings/i.test(w.sql))).toBe(true)
  })

  it('writes private appends to vendor_notes', async () => {
    const { db, writes } = stubDb('mine')
    const next = await appendToDoc(db, 'w1', 'private', 'u1', 'more')
    expect(next).toBe('mine\n\nmore')
    expect(writes.some((w) => /UPDATE wedding_members SET vendor_notes/i.test(w.sql))).toBe(true)
  })

  it('returns content unchanged and writes nothing for empty text', async () => {
    const { db, writes } = stubDb('keep me')
    const next = await appendToDoc(db, 'w1', 'shared', 'u1', '   ')
    expect(next).toBe('keep me')
    expect(writes.length).toBe(0)
  })

  it('uses the appended text alone when the doc was empty', async () => {
    const { db } = stubDb('')
    const next = await appendToDoc(db, 'w1', 'vendors', 'u1', 'hello')
    expect(next).toBe('hello')
  })
})
