import type { User } from '../types'

export async function getUserByEmail(
  db: D1Database,
  email: string
): Promise<User | null> {
  return db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first<User>()
}

export async function getUserById(
  db: D1Database,
  id: string
): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>()
}

export async function createUser(
  db: D1Database,
  email: string,
  name: string
): Promise<User> {
  const result = await db
    .prepare(
      `INSERT INTO users (email, name, email_verified) VALUES (?, ?, 1)
       RETURNING *`
    )
    .bind(email.toLowerCase(), name)
    .first<User>()
  return result!
}

export type UserUpdates = {
  name?: string
  phone?: string | null
  date_of_birth?: string | null
  address_line_1?: string | null
  address_line_2?: string | null
  city?: string | null
  state?: string | null
  postcode?: string | null
  country?: string | null
  instagram?: string | null
  facebook?: string | null
  tiktok?: string | null
  linkedin?: string | null
  website?: string | null
  avatar_url?: string | null
  avatar_r2_key?: string | null
}

const UPDATABLE_FIELDS = [
  'name', 'phone', 'date_of_birth',
  'address_line_1', 'address_line_2', 'city', 'state', 'postcode', 'country',
  'instagram', 'facebook', 'tiktok', 'linkedin', 'website',
  'avatar_url', 'avatar_r2_key',
] as const

export async function updateUser(
  db: D1Database,
  id: string,
  updates: UserUpdates
): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []

  for (const field of UPDATABLE_FIELDS) {
    if (updates[field] !== undefined) {
      sets.push(`${field} = ?`)
      values.push(updates[field])
    }
  }

  if (sets.length === 0) return
  sets.push("updated_at = datetime('now')")
  values.push(id)
  await db
    .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run()
}

export async function updateNotificationPrefs(
  db: D1Database,
  id: string,
  prefs: Record<string, boolean>
): Promise<void> {
  await db
    .prepare(`UPDATE users SET notification_prefs = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(JSON.stringify(prefs), id)
    .run()
}

export async function updateUserEmail(
  db: D1Database,
  id: string,
  newEmail: string
): Promise<void> {
  await db
    .prepare(`UPDATE users SET email = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(newEmail.toLowerCase(), id)
    .run()
}

/** Soft-delete: mark the account for deletion (30-day grace). Reversible. */
export async function softDeleteUser(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare("UPDATE users SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .bind(userId)
    .run()
}

/** Cancel a pending soft-delete (e.g. the user signed back in). */
export async function restoreUser(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare("UPDATE users SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?")
    .bind(userId)
    .run()
}

/** Accounts whose grace period has elapsed and are due for a hard purge. */
export async function listExpiredDeletedUserIds(db: D1Database, graceDays = 30): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-' || ? || ' days') LIMIT 500`
    )
    .bind(graceDays)
    .all<{ id: string }>()
  return rows.results.map((r) => r.id)
}

export async function deleteUser(db: D1Database, userId: string): Promise<void> {
  // weddings.created_by_user_id has no ON DELETE action and FK enforcement is
  // on, so deleting a user who created a wedding would otherwise fail. Hand
  // each such wedding to another active member where one exists (preserves a
  // valid owner); weddings with no other active member are the departing
  // user's alone and are removed with the account.
  await db
    .prepare(
      `UPDATE weddings SET created_by_user_id = (
         SELECT wm.user_id FROM wedding_members wm
         WHERE wm.wedding_id = weddings.id AND wm.user_id != ?1 AND wm.status = 'active'
         ORDER BY wm.created_at LIMIT 1
       )
       WHERE created_by_user_id = ?1
         AND EXISTS (
           SELECT 1 FROM wedding_members wm
           WHERE wm.wedding_id = weddings.id AND wm.user_id != ?1 AND wm.status = 'active'
         )`
    )
    .bind(userId)
    .run()

  // Solo weddings (still created_by this user): clear the nullable no-action
  // child references so the wedding can be deleted, then delete it. Every
  // other table referencing weddings is ON DELETE CASCADE or SET NULL
  // (verified across schema.sql + all migrations); these four are the only
  // RESTRICT references.
  for (const table of ['contacts', 'invoices', 'calendar_events', 'service_contracts']) {
    await db
      .prepare(
        `UPDATE ${table} SET wedding_id = NULL
         WHERE wedding_id IN (SELECT id FROM weddings WHERE created_by_user_id = ?1)`
      )
      .bind(userId)
      .run()
  }
  await db.prepare('DELETE FROM weddings WHERE created_by_user_id = ?1').bind(userId).run()

  await db
    .prepare(`UPDATE audit_log SET user_id = NULL, ip_address = NULL WHERE user_id = ?`)
    .bind(userId)
    .run()
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()
}
