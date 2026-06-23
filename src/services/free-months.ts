import type { Env } from '../types'
import { getSubscription } from '../db/subscriptions'
import { getVendorById } from '../db/vendors'

// Redeem a vendor's banked free months as a Stripe customer-balance credit, so
// their upcoming Pro invoices are reduced automatically. Only applies when the
// vendor is an ACTIVE Pro subscriber with a Stripe customer; otherwise the
// months stay banked and are redeemed as a trial at their next checkout.
// Zeroes the local balance once credited. Safe to call repeatedly (no-op at 0).
//
// The credit mirrors the subscription's OWN price and currency. Stripe customer
// balances are per-currency — an AUD credit never discounts a USD-billed
// invoice — and since 2026-06-23 Pro is charged in the visitor's local currency
// (see services/pricing.ts). We read the live subscription's locked unit amount
// (not the current market price, which FX may have moved away from since signup)
// so each free month exactly covers one of their real invoices. AUD subscribers
// are unchanged (A$28 × months, credited in AUD).
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

  // The subscription's own locked price + currency is what Stripe actually
  // bills, so crediting it guarantees the balance applies and one month is
  // fully covered. A balance in any other currency would strand.
  const priced = await fetchSubscriptionPrice(env.STRIPE_SECRET_KEY, sub.stripe_subscription_id)
  if (!priced) {
    // Fetch failed or no resolvable price — don't risk crediting the wrong
    // amount/currency. Leave the months banked so this retries next trigger.
    console.error('[free-months] unresolved subscription price, leaving banked', vendorId)
    return
  }

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
        amount: String(-priced.unitAmount * months),
        currency: priced.currency,
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

// Read the live subscription's billed monthly amount and ISO currency
// (lowercase) straight from Stripe — summing line items × quantity. Returns
// null if the lookup fails or no positive amount resolves, so the caller leaves
// the months banked rather than guessing.
async function fetchSubscriptionPrice(
  stripeSecretKey: string,
  subscriptionId: string
): Promise<{ unitAmount: number; currency: string } | null> {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${stripeSecretKey}` },
  })
  if (!res.ok) {
    console.error('[free-months] subscription fetch failed', subscriptionId, res.status)
    return null
  }
  const data = (await res.json().catch(() => null)) as {
    currency?: string
    items?: { data?: Array<{ quantity?: number; price?: { unit_amount?: number; currency?: string } }> }
  } | null
  if (!data) return null

  let unitAmount = 0
  let currency = data.currency ?? null
  for (const item of data.items?.data ?? []) {
    const amount = item.price?.unit_amount
    if (typeof amount === 'number') unitAmount += amount * (item.quantity ?? 1)
    if (item.price?.currency) currency = item.price.currency
  }

  if (!currency || unitAmount <= 0) return null
  return { unitAmount, currency }
}
