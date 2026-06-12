import { describe, it, expect } from 'vitest'
import { verifyWebhook } from './stripe'

// ─── Stripe webhook signature verification ───
// Two dashboard endpoints (platform events + Connect events) deliver to the
// same route, each signed with its own secret — the handler tries both.

async function stripeSign(payload: string, timestamp: number, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`)
  )
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

describe('verifyWebhook', () => {
  const PLATFORM_SECRET = 'whsec_platform_0123456789abcdef'
  const CONNECT_SECRET = 'whsec_connect_fedcba9876543210'
  const payload = '{"id":"evt_1","type":"account.updated","data":{"object":{}}}'

  it('accepts a signature from the platform endpoint secret', async () => {
    const ts = Math.floor(Date.now() / 1000)
    const sig = `t=${ts},v1=${await stripeSign(payload, ts, PLATFORM_SECRET)}`
    const event = await verifyWebhook(payload, sig, PLATFORM_SECRET)
    expect(event?.type).toBe('account.updated')
  })

  it('accepts a signature from the Connect endpoint secret', async () => {
    const ts = Math.floor(Date.now() / 1000)
    const sig = `t=${ts},v1=${await stripeSign(payload, ts, CONNECT_SECRET)}`
    const event = await verifyWebhook(payload, sig, CONNECT_SECRET)
    expect(event?.type).toBe('account.updated')
  })

  it('rejects a signature made with a different secret', async () => {
    const ts = Math.floor(Date.now() / 1000)
    const sig = `t=${ts},v1=${await stripeSign(payload, ts, CONNECT_SECRET)}`
    expect(await verifyWebhook(payload, sig, PLATFORM_SECRET)).toBeNull()
  })

  it('rejects a tampered payload', async () => {
    const ts = Math.floor(Date.now() / 1000)
    const sig = `t=${ts},v1=${await stripeSign(payload, ts, PLATFORM_SECRET)}`
    expect(await verifyWebhook(payload + ' ', sig, PLATFORM_SECRET)).toBeNull()
  })

  it('rejects a stale timestamp', async () => {
    const ts = Math.floor(Date.now() / 1000) - 600
    const sig = `t=${ts},v1=${await stripeSign(payload, ts, PLATFORM_SECRET)}`
    expect(await verifyWebhook(payload, sig, PLATFORM_SECRET)).toBeNull()
  })

  it('rejects a malformed signature header', async () => {
    expect(await verifyWebhook(payload, 'garbage', PLATFORM_SECRET)).toBeNull()
    expect(await verifyWebhook(payload, 't=,v1=', PLATFORM_SECRET)).toBeNull()
  })
})
