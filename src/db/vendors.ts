import type { VendorProfile } from '../types'

export async function getVendorByUserId(
  db: D1Database,
  userId: string
): Promise<VendorProfile | null> {
  return db
    .prepare('SELECT * FROM vendor_profiles WHERE user_id = ?')
    .bind(userId)
    .first<VendorProfile>()
}

export async function getVendorById(
  db: D1Database,
  id: string
): Promise<VendorProfile | null> {
  return db
    .prepare('SELECT * FROM vendor_profiles WHERE id = ?')
    .bind(id)
    .first<VendorProfile>()
}

export async function createVendor(
  db: D1Database,
  userId: string,
  businessName: string,
  category: string,
  emailHandle?: string | null
): Promise<VendorProfile> {
  const result = await db
    .prepare(
      `INSERT INTO vendor_profiles (user_id, business_name, category, email_handle)
       VALUES (?, ?, ?, ?)
       RETURNING *`
    )
    .bind(userId, businessName, category, emailHandle ?? null)
    .first<VendorProfile>()
  return result!
}

export async function getVendorWithEmail(
  db: D1Database,
  vendorId: string
): Promise<(VendorProfile & { user_email: string; user_name: string }) | null> {
  return db
    .prepare(
      `SELECT vp.*, u.email AS user_email, u.name AS user_name
       FROM vendor_profiles vp
       JOIN users u ON u.id = vp.user_id
       WHERE vp.id = ?`
    )
    .bind(vendorId)
    .first()
}

export async function getVendorByIcalToken(
  db: D1Database,
  token: string
): Promise<VendorProfile | null> {
  return db
    .prepare('SELECT * FROM vendor_profiles WHERE ical_token = ?')
    .bind(token)
    .first<VendorProfile>()
}

export async function updateVendor(
  db: D1Database,
  id: string,
  updates: Partial<
    Pick<
      VendorProfile,
      | 'business_name'
      | 'category'
      | 'phone'
      | 'website'
      | 'instagram'
      | 'bio'
      | 'location'
      | 'timezone'
      | 'enquiry_form'
      | 'booking_form'
      | 'ical_token'
      | 'stripe_account_id'
      | 'stripe_onboarding_complete'
      | 'anthropic_api_key'
      | 'email_handle'
      | 'ceremony_types'
      | 'storage_type'
      | 'storage_config'
      | 'tax_label'
      | 'tax_rate'
      | 'tax_inclusive'
      | 'tax_number'
      | 'tax_number_label'
      | 'business_address'
      | 'invoice_prefix'
      | 'next_invoice_number'
      | 'card_fee_enabled'
      | 'card_fee_percent'
      | 'service_templates'
      | 'invoice_defaults'
      | 'is_agency'
      | 'location_city'
      | 'location_state'
      | 'location_country'
      | 'location_lat'
      | 'location_lng'
      | 'location_place_id'
      | 'availability_sharing'
      | 'directory_listed'
    >
  >
): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`)
      values.push(val)
    }
  }
  if (sets.length === 0) return
  sets.push("updated_at = datetime('now')")
  values.push(id)
  await db
    .prepare(`UPDATE vendor_profiles SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run()
}
