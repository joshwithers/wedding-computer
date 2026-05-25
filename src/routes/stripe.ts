import { Hono } from 'hono'
import type { Env } from '../types'
import { updateVendor } from '../db/vendors'
import { recordPayment, recalculateInvoiceStatus } from '../db/invoices'

const stripe = new Hono<Env>()

stripe.post('/webhooks/stripe', async (c) => {
  const body = await c.req.text()
  const sig = c.req.header('stripe-signature')

  if (!sig) return c.json({ error: 'Missing signature' }, 400)

  const event = await verifyWebhook(body, sig, c.env.STRIPE_WEBHOOK_SECRET)
  if (!event) return c.json({ error: 'Invalid signature' }, 400)

  switch (event.type) {
    case 'account.updated': {
      const account = event.data.object as {
        id: string
        charges_enabled: boolean
        metadata?: { vendor_id?: string }
      }
      if (account.charges_enabled && account.metadata?.vendor_id) {
        await updateVendor(c.env.DB, account.metadata.vendor_id, {
          stripe_onboarding_complete: 1,
        } as any)
        console.log('[STRIPE] onboarding complete for vendor', account.metadata.vendor_id)
      }
      break
    }

    case 'payment_intent.succeeded': {
      const intent = event.data.object as {
        id: string
        metadata?: { payment_id?: string; vendor_id?: string; invoice_id?: string }
      }
      const meta = intent.metadata
      if (meta?.payment_id && meta?.vendor_id && meta?.invoice_id) {
        await recordPayment(c.env.DB, meta.vendor_id, meta.payment_id, 'stripe')
        await recalculateInvoiceStatus(c.env.DB, meta.vendor_id, meta.invoice_id)
        console.log('[STRIPE] payment recorded', meta.payment_id)
      }
      break
    }

    default:
      console.log('[STRIPE] unhandled event', event.type)
  }

  return c.json({ received: true })
})

async function verifyWebhook(
  payload: string,
  signature: string,
  secret: string
): Promise<{ type: string; data: { object: any } } | null> {
  const parts = signature.split(',').reduce(
    (acc, part) => {
      const [key, val] = part.split('=')
      if (key === 't') acc.timestamp = val
      if (key === 'v1') acc.signatures.push(val)
      return acc
    },
    { timestamp: '', signatures: [] as string[] }
  )

  if (!parts.timestamp || parts.signatures.length === 0) return null

  const age = Math.floor(Date.now() / 1000) - parseInt(parts.timestamp)
  if (age > 300) return null

  const signed = `${parts.timestamp}.${payload}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed))
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const valid = parts.signatures.some((s) => timingSafeEqual(s, expected))
  if (!valid) return null

  return JSON.parse(payload)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

export default stripe
