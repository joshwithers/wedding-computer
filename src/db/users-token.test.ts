import { describe, expect, it } from 'vitest'
import { MockD1Database } from '../storage/__tests__/mock-d1'
import { ensureUserFeedToken, getUserByFeedToken, rotateUserFeedToken } from './users'

describe('personal feed tokens', () => {
  it('stores a hash but authenticates the raw token once generated', async () => {
    const db = new MockD1Database()
    db.seed('users', [
      { id: 'u1', email: 'user@example.com', name: 'User', feed_token: null, deleted_at: null },
    ])

    const token = await rotateUserFeedToken(db as unknown as D1Database, 'u1')
    const stored = db.getTable('users')[0].feed_token as string

    expect(token).toHaveLength(32)
    expect(stored).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(stored).not.toContain(token)

    const user = await getUserByFeedToken(db as unknown as D1Database, token)
    expect(user?.id).toBe('u1')
    expect(await getUserByFeedToken(db as unknown as D1Database, stored)).toBeNull()
  })

  it('only reveals the token when it has just been minted', async () => {
    const db = new MockD1Database()
    const user = { id: 'u1', email: 'user@example.com', name: 'User', feed_token: null, deleted_at: null } as any
    db.seed('users', [user])

    const first = await ensureUserFeedToken(db as unknown as D1Database, user)
    expect(first).toHaveLength(32)

    const updated = { ...user, feed_token: db.getTable('users')[0].feed_token }
    await expect(ensureUserFeedToken(db as unknown as D1Database, updated)).resolves.toBeNull()
  })
})
