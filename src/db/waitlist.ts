import type { WaitlistEntry } from '../types'

// Add (or re-subscribe) an email to the waitlist. Idempotent on email: a repeat
// signup updates name/country and flips status back to 'subscribed' rather than
// erroring on the UNIQUE constraint.
export async function addToWaitlist(
  db: D1Database,
  data: { email: string; name?: string | null; country?: string | null; source?: string | null }
): Promise<WaitlistEntry> {
  const email = data.email.trim().toLowerCase()
  const name = data.name?.trim() || null
  const country = data.country?.trim() || null
  const source = data.source ?? null

  const row = await db
    .prepare(
      `INSERT INTO waitlist (email, name, country, source)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         name = COALESCE(excluded.name, waitlist.name),
         country = COALESCE(excluded.country, waitlist.country),
         status = 'subscribed',
         updated_at = datetime('now')
       RETURNING *`
    )
    .bind(email, name, country, source)
    .first<WaitlistEntry>()
  return row!
}

export async function getWaitlistByToken(
  db: D1Database,
  token: string
): Promise<WaitlistEntry | null> {
  return db
    .prepare('SELECT * FROM waitlist WHERE unsubscribe_token = ?')
    .bind(token)
    .first<WaitlistEntry>()
}

export async function unsubscribeWaitlist(db: D1Database, token: string): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE waitlist SET status = 'unsubscribed', updated_at = datetime('now')
       WHERE unsubscribe_token = ? AND status = 'subscribed'`
    )
    .bind(token)
    .run()
  return (res.meta?.changes ?? 0) > 0
}

export async function countWaitlist(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) as count FROM waitlist WHERE status = 'subscribed'`)
    .first<{ count: number }>()
  return row?.count ?? 0
}
