import type { CoupleVendor } from '../types'

export async function listCoupleVendors(
  db: D1Database,
  weddingId: string
): Promise<CoupleVendor[]> {
  return db
    .prepare(
      `SELECT * FROM couple_vendors
       WHERE wedding_id = ? AND status != 'removed'
       ORDER BY
         CASE status WHEN 'booked' THEN 0 WHEN 'contacted' THEN 1 WHEN 'considering' THEN 2 END,
         name ASC`
    )
    .bind(weddingId)
    .all<CoupleVendor>()
    .then((r) => r.results)
}

export async function getCoupleVendor(
  db: D1Database,
  weddingId: string,
  id: string
): Promise<CoupleVendor | null> {
  return db
    .prepare('SELECT * FROM couple_vendors WHERE id = ? AND wedding_id = ?')
    .bind(id, weddingId)
    .first<CoupleVendor>()
}

export async function getCoupleVendorByProfileId(
  db: D1Database,
  weddingId: string,
  vendorProfileId: string
): Promise<CoupleVendor | null> {
  return db
    .prepare('SELECT * FROM couple_vendors WHERE wedding_id = ? AND vendor_profile_id = ?')
    .bind(weddingId, vendorProfileId)
    .first<CoupleVendor>()
}

export async function createCoupleVendor(
  db: D1Database,
  weddingId: string,
  data: {
    name: string
    category?: string | null
    email?: string | null
    phone?: string | null
    website?: string | null
    instagram?: string | null
    notes?: string | null
    expected_price_cents?: number | null
    vendor_profile_id?: string | null
    status?: string
  }
): Promise<CoupleVendor> {
  const result = await db
    .prepare(
      `INSERT INTO couple_vendors (wedding_id, name, category, email, phone, website, instagram, notes, expected_price_cents, vendor_profile_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      weddingId,
      data.name,
      data.category ?? null,
      data.email ?? null,
      data.phone ?? null,
      data.website ?? null,
      data.instagram ?? null,
      data.notes ?? null,
      data.expected_price_cents ?? null,
      data.vendor_profile_id ?? null,
      data.status ?? 'considering'
    )
    .first<CoupleVendor>()
  return result!
}

export async function updateCoupleVendor(
  db: D1Database,
  weddingId: string,
  id: string,
  data: Partial<Pick<CoupleVendor,
    'name' | 'category' | 'email' | 'phone' | 'website' | 'instagram' |
    'notes' | 'expected_price_cents' | 'vendor_profile_id' | 'status'
  >>
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
  values.push(id, weddingId)
  await db
    .prepare(`UPDATE couple_vendors SET ${sets.join(', ')} WHERE id = ? AND wedding_id = ?`)
    .bind(...values)
    .run()
}

export async function deleteCoupleVendor(
  db: D1Database,
  weddingId: string,
  id: string
): Promise<void> {
  await db
    .prepare('DELETE FROM couple_vendors WHERE id = ? AND wedding_id = ? AND vendor_profile_id IS NULL')
    .bind(id, weddingId)
    .run()
}

export async function syncPlatformVendors(
  db: D1Database,
  weddingId: string
): Promise<number> {
  const platformVendors = await db
    .prepare(
      `SELECT wm.vendor_profile_id, vp.business_name, vp.category, vp.phone, vp.website, vp.instagram
       FROM wedding_members wm
       JOIN vendor_profiles vp ON vp.id = wm.vendor_profile_id
       WHERE wm.wedding_id = ? AND wm.status = 'active'
         AND wm.role IN ('owner', 'vendor')
         AND wm.vendor_profile_id IS NOT NULL`
    )
    .bind(weddingId)
    .all<{
      vendor_profile_id: string
      business_name: string
      category: string
      phone: string | null
      website: string | null
      instagram: string | null
    }>()
    .then((r) => r.results)

  if (platformVendors.length === 0) return 0

  const existing = await db
    .prepare(
      `SELECT vendor_profile_id FROM couple_vendors
       WHERE wedding_id = ? AND vendor_profile_id IS NOT NULL`
    )
    .bind(weddingId)
    .all<{ vendor_profile_id: string }>()
    .then((r) => new Set(r.results.map((e) => e.vendor_profile_id)))

  const toInsert = platformVendors.filter((v) => !existing.has(v.vendor_profile_id))
  if (toInsert.length === 0) return 0

  const stmts = toInsert.map((v) =>
    db
      .prepare(
        `INSERT INTO couple_vendors (wedding_id, name, category, phone, website, instagram, vendor_profile_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'booked')`
      )
      .bind(weddingId, v.business_name, v.category, v.phone, v.website, v.instagram, v.vendor_profile_id)
  )
  await db.batch(stmts)
  return toInsert.length
}
