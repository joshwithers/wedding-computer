import { describe, it, expect } from 'vitest'
import { vendorCanAccessWedding } from './mcp'
import { MockD1Database } from '../storage/__tests__/mock-d1'

describe('vendorCanAccessWedding (MCP cross-tenant IDOR gate — H1)', () => {
  function seeded() {
    const db = new MockD1Database()
    db.seed('vendor_profiles', [
      { id: 'vendor-a', user_id: 'user-a' },
      { id: 'vendor-b', user_id: 'user-b' },
      { id: 'vendor-c', user_id: 'user-c' },
    ])
    db.seed('wedding_members', [
      { id: 'm-a', wedding_id: 'wed-1', user_id: 'user-a', status: 'active' },
      { id: 'm-c', wedding_id: 'wed-1', user_id: 'user-c', status: 'removed' },
    ])
    return db
  }

  it('allows an active member', async () => {
    expect(await vendorCanAccessWedding(seeded() as any, 'vendor-a', 'wed-1')).toBe(true)
  })

  it('denies a vendor who was never a member', async () => {
    expect(await vendorCanAccessWedding(seeded() as any, 'vendor-b', 'wed-1')).toBe(false)
  })

  it('denies a vendor whose membership was removed (removal cannot be bypassed via MCP)', async () => {
    expect(await vendorCanAccessWedding(seeded() as any, 'vendor-c', 'wed-1')).toBe(false)
  })

  it('denies an unknown vendor id', async () => {
    expect(await vendorCanAccessWedding(seeded() as any, 'vendor-x', 'wed-1')).toBe(false)
  })

  it('denies an empty wedding id', async () => {
    expect(await vendorCanAccessWedding(seeded() as any, 'vendor-a', '')).toBe(false)
  })
})
