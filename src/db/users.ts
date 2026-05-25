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

export async function updateUser(
  db: D1Database,
  id: string,
  updates: { name?: string; avatar_url?: string | null }
): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []
  if (updates.name !== undefined) {
    sets.push('name = ?')
    values.push(updates.name)
  }
  if (updates.avatar_url !== undefined) {
    sets.push('avatar_url = ?')
    values.push(updates.avatar_url)
  }
  if (sets.length === 0) return
  sets.push("updated_at = datetime('now')")
  values.push(id)
  await db
    .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run()
}

export async function deleteUser(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(`UPDATE audit_log SET user_id = NULL, ip_address = NULL WHERE user_id = ?`)
    .bind(userId)
    .run()
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()
}
