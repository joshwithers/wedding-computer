import type { Referral } from '../types'

// A vendor can hold at most this many unredeemed free months (shared cap across
// referral rewards and admin gifts). A "free month" is a billing credit toward Pro.
export const FREE_MONTHS_CAP = 9

type GrantSource = 'referral_reward' | 'referred_signup' | 'admin_gift'

export type GrantResult = {
  applied: number // months actually added after clamping
  balance: number // resulting free_months balance
  clamped: boolean // true if the request was reduced by the cap
}

// Pure cap math: how much of `requested` can be added on top of `current`
// without exceeding `cap`. Extracted for deterministic unit testing.
export function capGrant(current: number, requested: number, cap = FREE_MONTHS_CAP): GrantResult {
  const req = Math.max(0, Math.floor(requested))
  const base = Math.max(0, current)
  const target = Math.min(cap, base + req)
  const applied = target - base
  return { applied, balance: target, clamped: applied < req }
}

// Add free months to a vendor, clamped to FREE_MONTHS_CAP, and record a ledger row.
export async function grantFreeMonths(
  db: D1Database,
  vendorId: string,
  months: number,
  source: GrantSource,
  opts: { grantedByUserId?: string | null; note?: string | null } = {}
): Promise<GrantResult> {
  const vendor = await db
    .prepare('SELECT free_months FROM vendor_profiles WHERE id = ?')
    .bind(vendorId)
    .first<{ free_months: number }>()
  if (!vendor) return { applied: 0, balance: 0, clamped: false }

  const current = vendor.free_months ?? 0
  const { applied, balance, clamped } = capGrant(current, months)

  if (applied <= 0) {
    return { applied: 0, balance: current, clamped }
  }

  await db
    .prepare("UPDATE vendor_profiles SET free_months = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(balance, vendorId)
    .run()
  await db
    .prepare(
      `INSERT INTO free_month_grants (vendor_id, months, source, granted_by_user_id, note)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(vendorId, applied, source, opts.grantedByUserId ?? null, opts.note ?? null)
    .run()

  return { applied, balance, clamped }
}

// Consume one free month (used when realizing a credit against a Stripe invoice).
// Returns true if a month was actually consumed.
export async function consumeFreeMonth(db: D1Database, vendorId: string): Promise<boolean> {
  const res = await db
    .prepare(
      "UPDATE vendor_profiles SET free_months = free_months - 1, updated_at = datetime('now') WHERE id = ? AND free_months > 0"
    )
    .bind(vendorId)
    .run()
  return (res.meta?.changes ?? 0) > 0
}

// Record a pending referral. No-op on self-referral or if one already exists.
export async function createReferral(
  db: D1Database,
  referrerVendorId: string,
  referredVendorId: string
): Promise<void> {
  if (referrerVendorId === referredVendorId) return
  await db
    .prepare(
      'INSERT OR IGNORE INTO referrals (referrer_vendor_id, referred_vendor_id) VALUES (?, ?)'
    )
    .bind(referrerVendorId, referredVendorId)
    .run()
}

// Convert a referral when the referred vendor becomes a paying subscriber.
// Idempotent: only the first call (while still pending) grants rewards.
// Returns the referrer's vendor id (for notification) or null if nothing to do.
export async function convertReferral(
  db: D1Database,
  referredVendorId: string
): Promise<{ referrerVendorId: string } | null> {
  const ref = await db
    .prepare("SELECT * FROM referrals WHERE referred_vendor_id = ? AND status = 'pending'")
    .bind(referredVendorId)
    .first<Referral>()
  if (!ref) return null

  // Flip to converted atomically; if another delivery already did, bail.
  const upd = await db
    .prepare(
      "UPDATE referrals SET status = 'converted', converted_at = datetime('now') WHERE id = ? AND status = 'pending'"
    )
    .bind(ref.id)
    .run()
  if ((upd.meta?.changes ?? 0) === 0) return null

  await grantFreeMonths(db, referredVendorId, 1, 'referred_signup', {
    note: 'Welcome reward — signed up via a referral',
  })
  await grantFreeMonths(db, ref.referrer_vendor_id, 1, 'referral_reward', {
    note: 'Referred a new Pro subscriber',
  })

  return { referrerVendorId: ref.referrer_vendor_id }
}

export type ReferralStats = { pending: number; converted: number; freeMonths: number }

export async function getReferralStats(db: D1Database, vendorId: string): Promise<ReferralStats> {
  const rows = await db
    .prepare('SELECT status, COUNT(*) as n FROM referrals WHERE referrer_vendor_id = ? GROUP BY status')
    .bind(vendorId)
    .all<{ status: string; n: number }>()
  let pending = 0
  let converted = 0
  for (const r of rows.results) {
    if (r.status === 'pending') pending = r.n
    else if (r.status === 'converted') converted = r.n
  }
  const v = await db
    .prepare('SELECT free_months FROM vendor_profiles WHERE id = ?')
    .bind(vendorId)
    .first<{ free_months: number }>()
  return { pending, converted, freeMonths: v?.free_months ?? 0 }
}

export type ReferralRow = {
  status: string
  created_at: string
  converted_at: string | null
  business_name: string
}

export async function listReferrals(db: D1Database, vendorId: string): Promise<ReferralRow[]> {
  const rows = await db
    .prepare(
      `SELECT r.status, r.created_at, r.converted_at, vp.business_name
       FROM referrals r
       JOIN vendor_profiles vp ON vp.id = r.referred_vendor_id
       WHERE r.referrer_vendor_id = ?
       ORDER BY r.created_at DESC`
    )
    .bind(vendorId)
    .all<ReferralRow>()
  return rows.results
}

export type GrantRow = {
  months: number
  source: string
  note: string | null
  created_at: string
  business_name: string
  vendor_email: string
  granted_by_email: string | null
}

export async function listRecentGrants(db: D1Database, limit = 20): Promise<GrantRow[]> {
  const rows = await db
    .prepare(
      `SELECT g.months, g.source, g.note, g.created_at,
              vp.business_name, u.email AS vendor_email, au.email AS granted_by_email
       FROM free_month_grants g
       JOIN vendor_profiles vp ON vp.id = g.vendor_id
       JOIN users u ON u.id = vp.user_id
       LEFT JOIN users au ON au.id = g.granted_by_user_id
       ORDER BY g.created_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<GrantRow>()
  return rows.results
}
