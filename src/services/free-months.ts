import { getSubscription } from '../db/subscriptions'
import { getVendorById } from '../db/vendors'

const MONTH_CENTS = 2800 // Pro is $28 AUD/mo

// Redeem a vendor's banked free months as a Stripe customer-balance credit, so
// their upcoming Pro invoices are reduced automatically. Only applies when the
// vendor is an ACTIVE Pro subscriber with a Stripe customer; otherwise the
// months stay banked and are redeemed as a trial at their next checkout.
// Zeroes the local balance once credited. Safe to call repeatedly (no-op at 0).
export async function redeemBankedMonthsToStripe(
  stripeSecretKey: string,
  db: D1Database,
  vendorId: string
): Promise<void> {
  const sub = await getSubscription(db, vendorId)
  if (
    !sub ||
    sub.plan !== 'pro' ||
    (sub.status !== 'active' && sub.status !== 'trialing') ||
    !sub.stripe_customer_id
  ) {
    return // not an active subscriber — leave the months banked
  }

  const vendor = await getVendorById(db, vendorId)
  const months = vendor?.free_months ?? 0
  if (months <= 0) return

  // Negative customer balance = account credit Stripe applies to next invoices.
  const res = await fetch(
    `https://api.stripe.com/v1/customers/${sub.stripe_customer_id}/balance_transactions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        amount: String(-MONTH_CENTS * months),
        currency: 'aud',
        description: `${months} free month${months === 1 ? '' : 's'} (Wedding Computer)`,
      }).toString(),
    }
  )

  if (!res.ok) {
    console.error('[free-months] Stripe credit failed', vendorId, await res.text())
    return // leave balance banked so it can be retried
  }

  await db
    .prepare("UPDATE vendor_profiles SET free_months = 0, updated_at = datetime('now') WHERE id = ?")
    .bind(vendorId)
    .run()
}
