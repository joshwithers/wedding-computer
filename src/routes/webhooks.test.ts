import { describe, it, expect } from 'vitest'
import { verifySvixSignature } from './webhooks'
import { isEmailSuppressed, suppressEmail } from '../db/emails'
import { MockD1Database } from '../storage/__tests__/mock-d1'

// ─── Svix/Resend webhook signature verification (H11) ───

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function svixSign(id: string, ts: string, body: string, whsec: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    base64ToBytes(whsec.replace(/^whsec_/, '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`))
  return bytesToBase64(new Uint8Array(mac))
}

describe('verifySvixSignature', () => {
  const SECRET = 'whsec_' + btoa('0123456789abcdef0123456789abcdef')
  const id = 'msg_123'
  const ts = '1700000000'
  const body = '{"type":"email.bounced","data":{"to":["dead@example.com"]}}'

  it('accepts a valid signature', async () => {
    const sig = await svixSign(id, ts, body, SECRET)
    expect(await verifySvixSignature(body, { id, timestamp: ts, signature: `v1,${sig}` }, SECRET)).toBe(true)
  })

  it('accepts when one of several signatures matches', async () => {
    const sig = await svixSign(id, ts, body, SECRET)
    expect(
      await verifySvixSignature(body, { id, timestamp: ts, signature: `v1,deadbeef v1,${sig}` }, SECRET)
    ).toBe(true)
  })

  it('rejects a tampered body', async () => {
    const sig = await svixSign(id, ts, body, SECRET)
    expect(await verifySvixSignature(body + ' ', { id, timestamp: ts, signature: `v1,${sig}` }, SECRET)).toBe(false)
  })

  it('rejects the wrong secret', async () => {
    const sig = await svixSign(id, ts, body, SECRET)
    const other = 'whsec_' + btoa('ffffffffffffffffffffffffffffffff')
    expect(await verifySvixSignature(body, { id, timestamp: ts, signature: `v1,${sig}` }, other)).toBe(false)
  })

  it('rejects missing headers', async () => {
    const sig = await svixSign(id, ts, body, SECRET)
    expect(await verifySvixSignature(body, { id: undefined, timestamp: ts, signature: `v1,${sig}` }, SECRET)).toBe(false)
    expect(await verifySvixSignature(body, { id, timestamp: ts, signature: undefined }, SECRET)).toBe(false)
  })
})

// ─── Suppression list helpers (H11) ───

describe('email suppression helpers', () => {
  it('suppresses and detects an address case-insensitively', async () => {
    const db = new MockD1Database() as any
    expect(await isEmailSuppressed(db, 'dead@example.com')).toBe(false)
    await suppressEmail(db, 'Dead@Example.com', 'bounce', 'evt_1')
    expect(await isEmailSuppressed(db, 'dead@example.com')).toBe(true)
    expect(await isEmailSuppressed(db, 'DEAD@EXAMPLE.COM')).toBe(true)
  })

  it('does not suppress an unrelated address', async () => {
    const db = new MockD1Database() as any
    await suppressEmail(db, 'a@example.com', 'complaint')
    expect(await isEmailSuppressed(db, 'b@example.com')).toBe(false)
  })
})
