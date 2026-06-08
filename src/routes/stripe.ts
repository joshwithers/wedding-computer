import { Hono } from 'hono'
import type { Env } from '../types'
import { updateVendor } from '../db/vendors'
import { recordPayment, recalculateInvoiceStatus } from '../db/invoices'
import { getSubscriptionByStripeId, createSubscription, updateSubscription } from '../db/subscriptions'
import { convertReferral, consumeFreeMonths } from '../db/referrals'
import { redeemBankedMonthsToStripe } from '../services/free-months'
import { track } from '../services/analytics'

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

    case 'checkout.session.completed': {
      const session = event.data.object as {
        id: string
        subscription: string | null
        customer: string | null
        metadata?: { vendor_id?: string; user_id?: string; free_months_applied?: string }
        mode: string
      }
      if (session.mode === 'subscription' && session.subscription && session.metadata?.vendor_id) {
        const vendorId = session.metadata.vendor_id
        const existing = await getSubscriptionByStripeId(c.env.DB, session.subscription)
        if (!existing) {
          await createSubscription(c.env.DB, {
            vendor_id: vendorId,
            stripe_customer_id: session.customer ?? null,
            stripe_subscription_id: session.subscription,
            plan: 'pro',
            status: 'active',
          })
          console.log('[STRIPE] subscription created for vendor', vendorId)

          // Banked free months were redeemed as the checkout trial — consume them.
          const applied = parseInt(session.metadata.free_months_applied ?? '0', 10)
          if (applied > 0) {
            await consumeFreeMonths(c.env.DB, vendorId, applied)
            console.log('[STRIPE] consumed', applied, 'free months as trial for', vendorId)
          }

          // Referral: a referred vendor just became a paying subscriber.
          // Reward both the new subscriber and their referrer (idempotent).
          try {
            const conv = await convertReferral(c.env.DB, vendorId)
            if (conv) {
              await c.env.EMAIL_QUEUE.send({ type: 'referral_reward', vendorId: conv.referrerVendorId })
              console.log('[STRIPE] referral converted, referrer rewarded', conv.referrerVendorId)
              // The referrer may already be an active subscriber — credit them now.
              await redeemBankedMonthsToStripe(c.env.STRIPE_SECRET_KEY, c.env.DB, conv.referrerVendorId)
            }
          } catch (e: any) {
            console.error('[STRIPE] referral conversion failed', e.message)
          }

          // The new subscriber's reward (and any leftover banked months not used
          // by the trial) become an account credit on their next invoices.
          await redeemBankedMonthsToStripe(c.env.STRIPE_SECRET_KEY, c.env.DB, vendorId)
        }
      }
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as {
        id: string
        status: string
        cancel_at_period_end: boolean
        current_period_start: number
        current_period_end: number
      }
      const existing = await getSubscriptionByStripeId(c.env.DB, sub.id)
      if (existing) {
        const statusMap: Record<string, string> = {
          active: 'active',
          past_due: 'past_due',
          canceled: 'cancelled',
          trialing: 'trialing',
          incomplete: 'active',
          incomplete_expired: 'cancelled',
          unpaid: 'past_due',
        }
        await updateSubscription(c.env.DB, existing.vendor_id, {
          status: (statusMap[sub.status] ?? 'active') as any,
          cancel_at_period_end: sub.cancel_at_period_end ? 1 : 0,
          current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        })
        console.log('[STRIPE] subscription updated', sub.id, sub.status)
      }
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as { id: string }
      const existing = await getSubscriptionByStripeId(c.env.DB, sub.id)
      if (existing) {
        await updateSubscription(c.env.DB, existing.vendor_id, {
          status: 'cancelled',
          cancel_at_period_end: 0,
        })
        console.log('[STRIPE] subscription cancelled', sub.id)
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
