import type { Env } from '../types'
import { getSubscription } from '../db/subscriptions'
import { getVendorById } from '../db/vendors'
import { getProPrice, isCurrencyCode, type CurrencyCode } from './pricing'

// Redeem a vendor's banked free months as a Stripe customer-balance credit, so
// their upcoming Pro invoices are reduced automatically. Only applies when the
// vendor is an ACTIVE Pro subscriber with a Stripe customer; otherwise the
// months stay banked and are redeemed as a trial at their next checkout.
// Zeroes the local balance once credited. Safe to call repeatedly (no-op at 0).
//
// The credit is issued in the SUBSCRIPTION's own currency. Stripe customer
// balances are per-currency — an AUD credit never discounts a USD-billed
// invoice — and since 2026-06-23 Pro is charged in the visitor's local currency
// (see services/pricing.ts). So we read the live subscription's currency and
// credit one month's real price in it: A$28 for AUD, US$19 for USD, ¥2,800 for
// JPY, etc. AUD subscribers are unchanged (A$28 × months, credited in AUD).
export async function redeemBankedMonthsToStripe(
  env: Env['Bindings'],
  vendorId: string
): Promise<void> {
  const sub = await getSubscription(env.DB, vendorId)
  if (
    !sub ||
    sub.plan !== 'pro' ||
    (sub.status !== 'active' && sub.status !== 'trialing') ||
    !sub.stripe_customer_id ||
    !sub.stripe_subscription_id
  ) {
    return // not an active subscriber — leave the months banked
  }

  const vendor = await getVendorById(env.DB, vendorId)
  const months = vendor?.free_months ?? 0
  if (months <= 0) return

  // Match the credit to what Stripe will actually bill. The subscription's
  // currency is authoritative; a balance in any other currency would strand.
  const currency = await fetchSubscriptionCurrency(env.STRIPE_SECRET_KEY, sub.stripe_subscription_id)
  if (!isCurrencyCode(currency)) {
    // Unknown/unsupported (or fetch failed) — don't risk crediting the wrong
    // currency. Leave the months banked so this retries on the next trigger.
    console.error('[free-months] unresolved subscription currency, leaving banked', vendorId, currency)
    return
  }
  const price = await getProPrice(env, currency.toUpperCase() as CurrencyCode)

  // Negative customer balance = account credit Stripe applies to next invoices.
  // unitAmount is already in Stripe minor units (cents, or whole yen for
  // zero-decimal JPY) — exactly what the balance_transactions API expects.
  const res = await fetch(
    `https://api.stripe.com/v1/customers/${sub.stripe_customer_id}/balance_transactions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        amount: String(-price.unitAmount * months),
        currency: price.stripeCurrency,
        description: `${months} free month${months === 1 ? '' : 's'} (Wedding Computer)`,
      }).toString(),
    }
  )

  if (!res.ok) {
    console.error('[free-months] Stripe credit failed', vendorId, await res.text())
    return // leave balance banked so it can be retried
  }

  await env.DB
    .prepare("UPDATE vendor_profiles SET free_months = 0, updated_at = datetime('now') WHERE id = ?")
    .bind(vendorId)
    .run()
}

// Fetch the live subscription's three-letter ISO currency (lowercase), or null
// if the lookup fails or the field is absent. Keeping AUD subscribers identical
// relies on Stripe reporting their subscription currency as 'aud'.
async function fetchSubscriptionCurrency(
  stripeSecretKey: string,
  subscriptionId: string
): Promise<string | null> {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${stripeSecretKey}` },
  })
  if (!res.ok) {
    console.error('[free-months] subscription fetch failed', subscriptionId, res.status)
    return null
  }
  const data = (await res.json().catch(() => null)) as { currency?: string } | null
  return data?.currency ?? null
}
