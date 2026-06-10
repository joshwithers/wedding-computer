import type { BroadcastRecipient } from '../types'

export type AudienceSelection = {
  vendors: boolean
  couples: boolean
  waitlist: boolean
  /** Optional case-insensitive country filter. Empty/undefined = all countries. */
  country?: string | null
}

type Row = { email: string | null; name: string | null; country: string | null; token?: string | null; user_id?: string | null }

// Users who disabled the 'announcements' notification preference are excluded.
// Missing key = enabled (opt-out model), so COALESCE(..., 1).
const ANNOUNCEMENTS_ENABLED = `COALESCE(json_extract(u.notification_prefs, '$.announcements'), 1) != 0`

// Resolve the deduped set of recipients for a broadcast. A person who appears in
// more than one selected audience (e.g. a vendor who also joined the waitlist) is
// emailed once. Country is matched case-insensitively against the best-available
// field per audience: vendor business country, the user's profile country for
// couples, and the self-reported country for the waitlist.
export async function getBroadcastRecipients(
  db: D1Database,
  sel: AudienceSelection
): Promise<BroadcastRecipient[]> {
  const country = sel.country?.trim() || null
  const byEmail = new Map<string, BroadcastRecipient>()

  const add = (rows: Row[], audience: BroadcastRecipient['audience']) => {
    for (const r of rows) {
      const email = r.email?.trim().toLowerCase()
      if (!email) continue
      const existing = byEmail.get(email)
      if (existing) {
        // Already queued from an earlier audience — keep it, but retain an
        // unsubscribe token if this source has one (waitlist) and a user id
        // if this source is a platform user.
        if (!existing.unsubscribeToken && r.token) existing.unsubscribeToken = r.token
        if (!existing.userId && r.user_id) existing.userId = r.user_id
        continue
      }
      byEmail.set(email, {
        email,
        name: r.name?.trim() || null,
        country: r.country?.trim() || null,
        audience,
        unsubscribeToken: r.token ?? null,
        userId: r.user_id ?? null,
      })
    }
  }

  if (sel.vendors) {
    const sql =
      `SELECT u.id AS user_id, u.email AS email, u.name AS name, vp.location_country AS country
       FROM vendor_profiles vp JOIN users u ON u.id = vp.user_id
       WHERE ${ANNOUNCEMENTS_ENABLED}` +
      (country ? ` AND LOWER(vp.location_country) = LOWER(?)` : '')
    const stmt = country ? db.prepare(sql).bind(country) : db.prepare(sql)
    add((await stmt.all<Row>()).results, 'vendor')
  }

  if (sel.couples) {
    const sql =
      `SELECT DISTINCT u.id AS user_id, u.email AS email, u.name AS name, u.country AS country
       FROM wedding_members wm JOIN users u ON u.id = wm.user_id
       WHERE wm.role = 'couple' AND wm.status != 'removed' AND ${ANNOUNCEMENTS_ENABLED}` +
      (country ? ` AND LOWER(u.country) = LOWER(?)` : '')
    const stmt = country ? db.prepare(sql).bind(country) : db.prepare(sql)
    add((await stmt.all<Row>()).results, 'couple')
  }

  if (sel.waitlist) {
    const sql =
      `SELECT email, name, country, unsubscribe_token AS token
       FROM waitlist WHERE status = 'subscribed'` +
      (country ? ` AND LOWER(country) = LOWER(?)` : '')
    const stmt = country ? db.prepare(sql).bind(country) : db.prepare(sql)
    add((await stmt.all<Row>()).results, 'waitlist')
  }

  return [...byEmail.values()]
}

// Distinct, non-empty country values across all three audiences — used to
// populate the country filter dropdown in the admin broadcast form.
export async function getBroadcastCountries(db: D1Database): Promise<string[]> {
  const queries = [
    `SELECT DISTINCT location_country AS country FROM vendor_profiles WHERE location_country IS NOT NULL AND location_country != ''`,
    `SELECT DISTINCT country FROM users WHERE country IS NOT NULL AND country != ''`,
    `SELECT DISTINCT country FROM waitlist WHERE country IS NOT NULL AND country != ''`,
  ]
  const results = await Promise.all(queries.map((q) => db.prepare(q).all<{ country: string }>()))

  const seen = new Map<string, string>() // lowercase -> original casing
  for (const r of results) {
    for (const row of r.results) {
      const c = row.country?.trim()
      if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c)
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}
