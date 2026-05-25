import type { Wedding, WeddingMember } from '../types'

export type WeddingWithRole = Wedding & {
  role: string
  vendor_role: string | null
}

export async function listWeddingsForVendor(
  db: D1Database,
  userId: string
): Promise<WeddingWithRole[]> {
  return db
    .prepare(
      `SELECT w.*, wm.role, wm.vendor_role
       FROM weddings w
       JOIN wedding_members wm ON wm.wedding_id = w.id
       WHERE wm.user_id = ? AND wm.status = 'active'
       ORDER BY w.date ASC`
    )
    .bind(userId)
    .all<WeddingWithRole>()
    .then((r) => r.results)
}

export async function getWedding(
  db: D1Database,
  weddingId: string
): Promise<Wedding | null> {
  return db
    .prepare('SELECT * FROM weddings WHERE id = ?')
    .bind(weddingId)
    .first<Wedding>()
}

export async function createWedding(
  db: D1Database,
  data: {
    title: string
    date?: string | null
    time?: string | null
    location?: string | null
    notes?: string | null
    created_by_user_id: string
  }
): Promise<Wedding> {
  const result = await db
    .prepare(
      `INSERT INTO weddings (title, date, time, location, notes, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      data.title,
      data.date ?? null,
      data.time ?? null,
      data.location ?? null,
      data.notes ?? null,
      data.created_by_user_id
    )
    .first<Wedding>()
  return result!
}

export async function updateWedding(
  db: D1Database,
  weddingId: string,
  data: Partial<Pick<Wedding, 'title' | 'date' | 'time' | 'location' | 'status' | 'notes'>>
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
  values.push(weddingId)
  await db
    .prepare(`UPDATE weddings SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run()
}

export async function addWeddingMember(
  db: D1Database,
  data: {
    wedding_id: string
    user_id: string
    role: string
    vendor_profile_id?: string | null
    vendor_role?: string | null
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO wedding_members (wedding_id, user_id, role, vendor_profile_id, vendor_role, status, accepted_at)
       VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))
       ON CONFLICT(wedding_id, user_id) DO UPDATE SET
         role = excluded.role, status = 'active', accepted_at = datetime('now')`
    )
    .bind(
      data.wedding_id,
      data.user_id,
      data.role,
      data.vendor_profile_id ?? null,
      data.vendor_role ?? null
    )
    .run()
}

export async function getWeddingMembers(
  db: D1Database,
  weddingId: string
): Promise<(WeddingMember & { user_name: string; user_email: string; business_name: string | null })[]> {
  return db
    .prepare(
      `SELECT wm.*, u.name as user_name, u.email as user_email, vp.business_name
       FROM wedding_members wm
       JOIN users u ON u.id = wm.user_id
       LEFT JOIN vendor_profiles vp ON vp.id = wm.vendor_profile_id
       WHERE wm.wedding_id = ? AND wm.status = 'active'
       ORDER BY wm.role, wm.created_at`
    )
    .bind(weddingId)
    .all<WeddingMember & { user_name: string; user_email: string; business_name: string | null }>()
    .then((r) => r.results)
}

export async function getMembership(
  db: D1Database,
  weddingId: string,
  userId: string
): Promise<WeddingMember | null> {
  return db
    .prepare(
      `SELECT * FROM wedding_members WHERE wedding_id = ? AND user_id = ? AND status = 'active'`
    )
    .bind(weddingId, userId)
    .first<WeddingMember>()
}
