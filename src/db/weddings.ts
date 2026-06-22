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

// Count the vendor's own *active* (upcoming or undated) weddings — the unit the
// free-plan cap is measured against. Scoped to weddings this user originated
// (created_by_user_id), so weddings a planner invited them into never count,
// and past weddings free up a slot.
export async function countActiveOwnWeddings(
  db: D1Database,
  userId: string,
  today: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT w.id) AS c
       FROM weddings w
       JOIN wedding_members wm ON wm.wedding_id = w.id
       WHERE wm.user_id = ? AND wm.role = 'vendor' AND wm.status = 'active'
         AND w.created_by_user_id = ?
         AND w.is_demo = 0
         AND (w.status IS NULL OR w.status NOT IN ('completed', 'cancelled'))
         AND (w.date IS NULL OR w.date >= ?)`
    )
    .bind(userId, userId, today)
    .first<{ c: number }>()
  return row?.c ?? 0
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
    duration_hours?: number | null
    location?: string | null
    notes?: string | null
    ceremony_type?: string | null
    created_by_user_id: string
  }
): Promise<Wedding> {
  const result = await db
    .prepare(
      `INSERT INTO weddings (title, date, time, duration_hours, location, notes, ceremony_type, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      data.title,
      data.date ?? null,
      data.time ?? null,
      data.duration_hours ?? null,
      data.location ?? null,
      data.notes ?? null,
      data.ceremony_type ?? 'wedding',
      data.created_by_user_id
    )
    .first<Wedding>()
  return result!
}

export async function updateWedding(
  db: D1Database,
  weddingId: string,
  data: Partial<Pick<Wedding, 'title' | 'date' | 'time' | 'duration_hours' | 'location' | 'status' | 'notes' | 'ceremony_type' | 'vendor_visibility' | 'ceremony_location' | 'reception_location' | 'reception_time' | 'getting_ready_location' | 'getting_ready_time' | 'getting_ready_1_label' | 'getting_ready_2_location' | 'getting_ready_2_label' | 'getting_ready_2_time' | 'portrait_location' | 'portrait_time' | 'emoji' | 'bump_in_time' | 'bump_out_time' | 'reception_duration_hours' | 'timeline_notes' | 'dress_code' | 'guest_count'>>
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
    vendor_roles?: string | null // JSON array of vendor-type slugs for this wedding
    invited_instagram?: string | null // sanitized handle for an email-invited vendor with no profile
    can_manage?: boolean
    is_financial_party?: boolean
  }
): Promise<void> {
  // On re-add (upsert), COALESCE the new per-wedding fields so the many callers
  // that don't pass them (createWedding, invites, booking) never wipe roles or a
  // prefilled handle a manager set earlier.
  await db
    .prepare(
      `INSERT INTO wedding_members (wedding_id, user_id, role, vendor_profile_id, vendor_role, vendor_roles, invited_instagram, can_manage, is_financial_party, status, accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
       ON CONFLICT(wedding_id, user_id) DO UPDATE SET
         role = excluded.role, can_manage = excluded.can_manage,
         is_financial_party = excluded.is_financial_party,
         -- Link a profile id if one is now known (e.g. a re-add after the invited
         -- vendor onboarded); COALESCE so a profile-less caller never unlinks it.
         -- This keeps the credits dedup (which keys on vendor_profile_id) correct.
         vendor_profile_id = COALESCE(excluded.vendor_profile_id, vendor_profile_id),
         vendor_roles = COALESCE(excluded.vendor_roles, vendor_roles),
         invited_instagram = COALESCE(excluded.invited_instagram, invited_instagram),
         status = 'active', accepted_at = datetime('now')`
    )
    .bind(
      data.wedding_id,
      data.user_id,
      data.role,
      data.vendor_profile_id ?? null,
      data.vendor_role ?? null,
      data.vendor_roles ?? null,
      data.invited_instagram ?? null,
      data.can_manage ? 1 : 0,
      data.is_financial_party ? 1 : 0,
    )
    .run()
}

/**
 * Replace the per-wedding vendor type(s) for one member. Keeps the singular
 * vendor_role in sync (= first chosen role) for backward-compatible readers.
 * Scoped by wedding + user; callers must already have checked can_manage.
 */
export async function setWeddingMemberRoles(
  db: D1Database,
  weddingId: string,
  userId: string,
  roles: string[]
): Promise<void> {
  const clean = roles.map((r) => r.trim()).filter(Boolean)
  await db
    .prepare(
      `UPDATE wedding_members
       SET vendor_roles = ?3, vendor_role = ?4
       WHERE wedding_id = ?1 AND user_id = ?2 AND role = 'vendor'`
    )
    .bind(weddingId, userId, clean.length ? JSON.stringify(clean) : null, clean[0] ?? null)
    .run()
}

export async function getWeddingMembers(
  db: D1Database,
  weddingId: string
): Promise<(WeddingMember & { user_name: string; user_email: string; user_notification_prefs: string; business_name: string | null; vendor_instagram: string | null; vendor_website: string | null; vendor_categories: string | null; vendor_primary_category: string | null; celebrant_term: string | null })[]> {
  return db
    .prepare(
      `SELECT wm.*, u.name as user_name, u.email as user_email, u.notification_prefs as user_notification_prefs,
              vp.business_name, vp.instagram as vendor_instagram, vp.website as vendor_website,
              vp.categories as vendor_categories, vp.category as vendor_primary_category,
              vp.celebrant_term
       FROM wedding_members wm
       JOIN users u ON u.id = wm.user_id
       LEFT JOIN vendor_profiles vp ON vp.id = wm.vendor_profile_id
       WHERE wm.wedding_id = ? AND wm.status = 'active'
       ORDER BY wm.role, wm.created_at`
    )
    .bind(weddingId)
    .all<WeddingMember & { user_name: string; user_email: string; user_notification_prefs: string; business_name: string | null; vendor_instagram: string | null; vendor_website: string | null; vendor_categories: string | null; vendor_primary_category: string | null; celebrant_term: string | null }>()
    .then((r) => r.results)
}

export async function getFirstCoupleWedding(
  db: D1Database,
  userId: string
): Promise<{ wedding_id: string } | null> {
  return db
    .prepare(
      `SELECT wedding_id FROM wedding_members
       WHERE user_id = ? AND role = 'couple' AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(userId)
    .first<{ wedding_id: string }>()
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

/**
 * Membership of ANY status (including 'removed'/'invited'). The couple
 * add-vendor flow needs this to guard against silently flipping an existing
 * couple/guest member into a vendor, or resurrecting a removed vendor —
 * getMembership only returns active rows and would miss both.
 */
export async function getAnyMembership(
  db: D1Database,
  weddingId: string,
  userId: string
): Promise<WeddingMember | null> {
  return db
    .prepare('SELECT * FROM wedding_members WHERE wedding_id = ? AND user_id = ?')
    .bind(weddingId, userId)
    .first<WeddingMember>()
}

/**
 * Does this user have a waiting vendor invite — an active vendor membership
 * with no vendor_profile yet? Used to deep-link a just-signed-in invitee
 * into vendor onboarding.
 */
export async function hasPendingVendorInvite(
  db: D1Database,
  userId: string
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 FROM wedding_members WHERE user_id = ? AND role = 'vendor' AND vendor_profile_id IS NULL AND status = 'active' LIMIT 1"
    )
    .bind(userId)
    .first()
  return !!row
}
