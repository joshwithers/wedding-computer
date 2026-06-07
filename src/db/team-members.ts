import type { TeamMember, WeddingTeamAssignment } from '../types'

export async function listTeamMembers(
  db: D1Database,
  vendorId: string,
  activeOnly = true
): Promise<TeamMember[]> {
  const query = activeOnly
    ? 'SELECT * FROM team_members WHERE vendor_id = ? AND is_active = 1 ORDER BY name'
    : 'SELECT * FROM team_members WHERE vendor_id = ? ORDER BY is_active DESC, name'
  return db
    .prepare(query)
    .bind(vendorId)
    .all<TeamMember>()
    .then((r) => r.results)
}

export async function getTeamMember(
  db: D1Database,
  vendorId: string,
  memberId: string
): Promise<TeamMember | null> {
  return db
    .prepare('SELECT * FROM team_members WHERE id = ? AND vendor_id = ?')
    .bind(memberId, vendorId)
    .first<TeamMember>()
}

export async function createTeamMember(
  db: D1Database,
  vendorId: string,
  data: {
    name: string
    email?: string | null
    phone?: string | null
    title?: string | null
    notes?: string | null
    user_id?: string | null
  }
): Promise<TeamMember> {
  const result = await db
    .prepare(
      `INSERT INTO team_members (vendor_id, name, email, phone, title, notes, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      vendorId,
      data.name,
      data.email ?? null,
      data.phone ?? null,
      data.title ?? null,
      data.notes ?? null,
      data.user_id ?? null
    )
    .first<TeamMember>()
  return result!
}

export async function updateTeamMember(
  db: D1Database,
  vendorId: string,
  memberId: string,
  data: Partial<Pick<TeamMember, 'name' | 'email' | 'phone' | 'title' | 'notes' | 'is_active' | 'avatar_url'>>
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
  values.push(memberId, vendorId)
  await db
    .prepare(`UPDATE team_members SET ${sets.join(', ')} WHERE id = ? AND vendor_id = ?`)
    .bind(...values)
    .run()
}

export async function deleteTeamMember(
  db: D1Database,
  vendorId: string,
  memberId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM team_members WHERE id = ? AND vendor_id = ?')
    .bind(memberId, vendorId)
    .run()
}

export async function countTeamMembers(
  db: D1Database,
  vendorId: string
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) as count FROM team_members WHERE vendor_id = ? AND is_active = 1')
    .bind(vendorId)
    .first<{ count: number }>()
  return row?.count ?? 0
}

export type TeamAssignmentWithMember = WeddingTeamAssignment & {
  member_name: string
  member_email: string | null
  member_phone: string | null
  member_title: string | null
}

export async function listWeddingTeamAssignments(
  db: D1Database,
  weddingId: string,
  weddingMemberId: string
): Promise<TeamAssignmentWithMember[]> {
  return db
    .prepare(
      `SELECT wta.*, tm.name as member_name, tm.email as member_email,
              tm.phone as member_phone, tm.title as member_title
       FROM wedding_team_assignments wta
       JOIN team_members tm ON tm.id = wta.team_member_id
       WHERE wta.wedding_id = ? AND wta.wedding_member_id = ?
       ORDER BY wta.assigned_at`
    )
    .bind(weddingId, weddingMemberId)
    .all<TeamAssignmentWithMember>()
    .then((r) => r.results)
}

export async function listAllWeddingTeamAssignments(
  db: D1Database,
  weddingId: string
): Promise<(TeamAssignmentWithMember & { vendor_business_name: string | null })[]> {
  return db
    .prepare(
      `SELECT wta.*, tm.name as member_name, tm.email as member_email,
              tm.phone as member_phone, tm.title as member_title,
              vp.business_name as vendor_business_name
       FROM wedding_team_assignments wta
       JOIN team_members tm ON tm.id = wta.team_member_id
       JOIN wedding_members wm ON wm.id = wta.wedding_member_id
       LEFT JOIN vendor_profiles vp ON vp.id = wm.vendor_profile_id
       WHERE wta.wedding_id = ?
       ORDER BY vp.business_name, wta.assigned_at`
    )
    .bind(weddingId)
    .all<TeamAssignmentWithMember & { vendor_business_name: string | null }>()
    .then((r) => r.results)
}

export async function assignTeamMember(
  db: D1Database,
  data: {
    wedding_id: string
    wedding_member_id: string
    team_member_id: string
    role?: string | null
    notes?: string | null
  }
): Promise<WeddingTeamAssignment> {
  const result = await db
    .prepare(
      `INSERT INTO wedding_team_assignments (wedding_id, wedding_member_id, team_member_id, role, notes)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(wedding_id, team_member_id) DO UPDATE SET
         role = excluded.role, notes = excluded.notes
       RETURNING *`
    )
    .bind(
      data.wedding_id,
      data.wedding_member_id,
      data.team_member_id,
      data.role ?? null,
      data.notes ?? null
    )
    .first<WeddingTeamAssignment>()
  return result!
}

export async function unassignTeamMember(
  db: D1Database,
  weddingId: string,
  assignmentId: string,
  vendorId: string
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM wedding_team_assignments
       WHERE id = ? AND wedding_id = ?
       AND team_member_id IN (SELECT id FROM team_members WHERE vendor_id = ?)`
    )
    .bind(assignmentId, weddingId, vendorId)
    .run()
}

export async function getTeamMemberSchedule(
  db: D1Database,
  vendorId: string,
  teamMemberId: string
): Promise<{ wedding_id: string; wedding_title: string; wedding_date: string | null; role: string | null }[]> {
  return db
    .prepare(
      `SELECT w.id as wedding_id, w.title as wedding_title, w.date as wedding_date, wta.role
       FROM wedding_team_assignments wta
       JOIN weddings w ON w.id = wta.wedding_id
       JOIN team_members tm ON tm.id = wta.team_member_id
       WHERE tm.vendor_id = ? AND wta.team_member_id = ?
       ORDER BY w.date ASC`
    )
    .bind(vendorId, teamMemberId)
    .all<{ wedding_id: string; wedding_title: string; wedding_date: string | null; role: string | null }>()
    .then((r) => r.results)
}
