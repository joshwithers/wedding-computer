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

export async function deleteUser(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(`UPDATE audit_log SET user_id = NULL, ip_address = NULL WHERE user_id = ?`)
    .bind(userId)
    .run()
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()
}
