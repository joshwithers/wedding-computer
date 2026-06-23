import type { VendorProfile } from '../types'

export async function vendorCanAccessWedding(
  db: D1Database,
  vendor: Pick<VendorProfile, 'id' | 'user_id'>,
  weddingId: string
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM wedding_members
       WHERE wedding_id = ? AND status = 'active' AND role = 'vendor'
         AND (vendor_profile_id = ? OR user_id = ?)
       LIMIT 1`
    )
    .bind(weddingId, vendor.id, vendor.user_id)
    .first()
  return !!row
}
