import type { Subscription, D1Like } from '../types'

export async function getSubscription(
  db: D1Database,
  vendorId: string
): Promise<Subscription | null> {
  return db
    .prepare('SELECT * FROM subscriptions WHERE vendor_id = ?')
    .bind(vendorId)
    .first<Subscription>()
}

export async function getSubscriptionByStripeId(
  db: D1Database,
  stripeSubscriptionId: string
): Promise<Subscription | null> {
  return db
    .prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?')
    .bind(stripeSubscriptionId)
    .first<Subscription>()
}

export async function createSubscription(
  db: D1Database,
  data: {
    vendor_id: string
    stripe_customer_id: string | null
    stripe_subscription_id: string | null
    plan: string
    status: string
    current_period_start?: string | null
    current_period_end?: string | null
  }
): Promise<Subscription> {
  // Upsert on the UNIQUE vendor_id: a vendor has one subscription row. When they
  // re-subscribe (a new Stripe subscription id under the same vendor), refresh the
  // row to track the live subscription instead of throwing on the UNIQUE constraint.
  const result = await db
    .prepare(
      `INSERT INTO subscriptions (vendor_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_start, current_period_end)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(vendor_id) DO UPDATE SET
         stripe_customer_id = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id,
         plan = excluded.plan,
         status = excluded.status,
         current_period_start = excluded.current_period_start,
         current_period_end = excluded.current_period_end,
         cancel_at_period_end = 0,
         updated_at = datetime('now')
       RETURNING *`
    )
    .bind(
      data.vendor_id,
      data.stripe_customer_id,
      data.stripe_subscription_id,
      data.plan,
      data.status,
      data.current_period_start ?? null,
      data.current_period_end ?? null
    )
    .first<Subscription>()
  return result!
}

export async function updateSubscription(
  db: D1Database,
  vendorId: string,
  data: Partial<
    Pick<
      Subscription,
      | 'plan'
      | 'status'
      | 'stripe_subscription_id'
      | 'stripe_customer_id'
      | 'current_period_start'
      | 'current_period_end'
      | 'cancel_at_period_end'
    >
  >
): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`)
      values.push(val)
    }
  }
  if (sets.length === 0) return
  sets.push("updated_at = datetime('now')")
  values.push(vendorId)
  await db
    .prepare(`UPDATE subscriptions SET ${sets.join(', ')} WHERE vendor_id = ?`)
    .bind(...values)
    .run()

  // Pro-loss complement (migration 076 white-label): hide_branding is gated on
  // Pro at write time but read WITHOUT a Pro check on public forms/emails, so a
  // lapsed vendor would otherwise stay un-branded forever. updateSubscription is
  // the single chokepoint for every downgrade (all Stripe webhook paths), so
  // when a status update drops the vendor out of Pro (anything other than
  // active/trialing — the exact inverse of isProVendor) we re-show branding.
  // Guarded on `status` being explicitly set: bare cancel_at_period_end toggles
  // (the in-app "cancel at period end") retain Pro and must not reset it.
  if (data.status !== undefined && data.status !== 'active' && data.status !== 'trialing') {
    await db
      .prepare('UPDATE vendor_profiles SET hide_branding = 0 WHERE id = ?')
      .bind(vendorId)
      .run()
  }
}

export async function isProVendor(
  db: D1Like,
  vendorId: string
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 as found FROM subscriptions
       WHERE vendor_id = ? AND plan = 'pro' AND status IN ('active', 'trialing')`
    )
    .bind(vendorId)
    .first<{ found: number }>()
  return row !== null
}

export async function getActiveProCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as count FROM subscriptions
       WHERE plan = 'pro' AND status IN ('active', 'trialing')`
    )
    .first<{ count: number }>()
  return row?.count ?? 0
}

export async function getMRR(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as count FROM subscriptions
       WHERE plan = 'pro' AND status IN ('active', 'trialing')`
    )
    .first<{ count: number }>()
  return (row?.count ?? 0) * 2800
}

export async function getConversionRate(db: D1Database): Promise<number> {
  const totalRow = await db
    .prepare('SELECT COUNT(*) as count FROM vendor_profiles')
    .first<{ count: number }>()
  const total = totalRow?.count ?? 0
  if (total === 0) return 0

  const proRow = await db
    .prepare(
      `SELECT COUNT(*) as count FROM subscriptions
       WHERE plan = 'pro' AND status IN ('active', 'trialing')`
    )
    .first<{ count: number }>()
  const pro = proRow?.count ?? 0

  return pro / total
}
