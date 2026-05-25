import type { Session } from '../types'

export async function createSession(
  db: D1Database,
  session: Session
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(
      session.id,
      session.user_id,
      session.expires_at,
      session.ip_address,
      session.user_agent
    )
    .run()
}

export async function deleteSession(
  db: D1Database,
  id: string
): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run()
}

export async function deleteUserSessions(
  db: D1Database,
  userId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM sessions WHERE user_id = ?')
    .bind(userId)
    .run()
}
