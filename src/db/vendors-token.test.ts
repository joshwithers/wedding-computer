import { describe, it, expect, beforeEach } from 'vitest'
import { getVendorByIcalToken } from './vendors'
import { sha256Hex } from '../lib/crypto'
import { MockD1Database } from '../storage/__tests__/mock-d1'

const RAW_TOKEN = 'aabbccddeeff00112233445566778899'

describe('sha256Hex', () => {
  it('matches the known SHA-256 test vector', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})

describe('getVendorByIcalToken (hashed at rest)', () => {
  let db: MockD1Database

  beforeEach(() => {
    db = new MockD1Database()
  })

  it('finds a vendor stored with a hashed token', async () => {
    db.seed('vendor_profiles', [
      { id: 'v1', business_name: 'Test', ical_token: `sha256:${await sha256Hex(RAW_TOKEN)}` },
    ])

    const vendor = await getVendorByIcalToken(db as unknown as D1Database, RAW_TOKEN)
    expect(vendor?.id).toBe('v1')
  })

  it('accepts a legacy plaintext token and upgrades the row in place', async () => {
    db.seed('vendor_profiles', [{ id: 'v1', business_name: 'Test', ical_token: RAW_TOKEN }])

    const vendor = await getVendorByIcalToken(db as unknown as D1Database, RAW_TOKEN)
    expect(vendor?.id).toBe('v1')

    const stored = db.getTable('vendor_profiles')[0].ical_token as string
    expect(stored).toBe(`sha256:${await sha256Hex(RAW_TOKEN)}`)

    // And the upgraded row keeps authenticating
    const again = await getVendorByIcalToken(db as unknown as D1Database, RAW_TOKEN)
    expect(again?.id).toBe('v1')
  })

  it('rejects wrong and short tokens', async () => {
    db.seed('vendor_profiles', [
      { id: 'v1', business_name: 'Test', ical_token: `sha256:${await sha256Hex(RAW_TOKEN)}` },
    ])

    expect(await getVendorByIcalToken(db as unknown as D1Database, 'f'.repeat(32))).toBeNull()
    expect(await getVendorByIcalToken(db as unknown as D1Database, 'short')).toBeNull()
  })

  it('never matches the stored hash used as a token', async () => {
    const storedHash = `sha256:${await sha256Hex(RAW_TOKEN)}`
    db.seed('vendor_profiles', [{ id: 'v1', business_name: 'Test', ical_token: storedHash }])

    // A leaked hash must not be usable as a credential
    expect(await getVendorByIcalToken(db as unknown as D1Database, storedHash)).toBeNull()
  })
})
