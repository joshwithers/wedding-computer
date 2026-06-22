import type { VendorProfile } from '../types'
import { generateToken } from '../lib/crypto'
import { sanitizeInstagramHandle } from '../lib/instagram'

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

export type VendorSearchHit = {
  id: string
  business_name: string
  category: string
  location_city: string | null
  location_state: string | null
}

/** Typeahead for the add-vendor-to-a-wedding autolookup. Matches existing
 *  vendors by business name, EXCLUDING anyone already on the wedding and
 *  soft-deleted accounts. Returns name/category/city only — never the email
 *  (the invite resolves that server-side), so this can't be used to harvest
 *  contact details. Prefix matches rank first. */
export async function searchVendorsForWedding(
  db: D1Database,
  weddingId: string,
  q: string,
  limit = 8
): Promise<VendorSearchHit[]> {
  const term = q.trim()
  if (term.length < 2) return []
  const res = await db
    .prepare(
      `SELECT vp.id, vp.business_name, vp.category, vp.location_city, vp.location_state
       FROM vendor_profiles vp
       JOIN users u ON u.id = vp.user_id
       WHERE u.deleted_at IS NULL
         AND vp.business_name LIKE ?1 COLLATE NOCASE
         AND vp.user_id NOT IN (SELECT user_id FROM wedding_members WHERE wedding_id = ?2)
       ORDER BY (vp.business_name LIKE ?3 COLLATE NOCASE) DESC, vp.business_name ASC
       LIMIT ?4`
    )
    .bind(`%${term}%`, weddingId, `${term}%`, limit)
    .all<VendorSearchHit>()
  return res.results
}

export async function createVendor(
  db: D1Database,
  userId: string,
  businessName: string,
  category: string,
  emailHandle?: string | null,
  referrerVendorId?: string | null,
  categories?: string[] | null
): Promise<VendorProfile> {
  const referralCode = await generateToken(8)
  const all = categories && categories.length > 0 ? categories : [category]
  const result = await db
    .prepare(
      `INSERT INTO vendor_profiles (user_id, business_name, category, categories, email_handle, referral_code, referred_by_vendor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(userId, businessName, category, JSON.stringify(all), emailHandle ?? null, referralCode, referrerVendorId ?? null)
    .first<VendorProfile>()
  return result!
}

export async function getVendorByReferralCode(
  db: D1Database,
  code: string
): Promise<VendorProfile | null> {
  return db
    .prepare('SELECT * FROM vendor_profiles WHERE referral_code = ?')
    .bind(code)
    .first<VendorProfile>()
}

export async function dismissSetup(db: D1Database, vendorId: string): Promise<void> {
  await db
    .prepare("UPDATE vendor_profiles SET setup_dismissed = 1, updated_at = datetime('now') WHERE id = ?")
    .bind(vendorId)
    .run()
}

export async function dismissDemo(db: D1Database, vendorId: string): Promise<void> {
  await db
    .prepare("UPDATE vendor_profiles SET demo_dismissed = 1, updated_at = datetime('now') WHERE id = ?")
    .bind(vendorId)
    .run()
}

export async function getVendorWithEmail(
  db: D1Database,
  vendorId: string
): Promise<(VendorProfile & { user_email: string; user_name: string; user_notification_prefs: string }) | null> {
  return db
    .prepare(
      `SELECT vp.*, u.email AS user_email, u.name AS user_name, u.notification_prefs AS user_notification_prefs
       FROM vendor_profiles vp
       JOIN users u ON u.id = vp.user_id
       WHERE vp.id = ?`
    )
    .bind(vendorId)
    .first()
}

/**
 * Resolve a vendor by their device-sync token.
 *
 * Tokens are stored hashed (`sha256:<hex>`). Rows created before hashing
 * hold the raw token — those still authenticate and are upgraded to the
 * hashed form in place on first use.
 */
export async function getVendorByIcalToken(
  db: D1Database,
  token: string
): Promise<VendorProfile | null> {
  if (!token || token.length < 32) return null

  const { sha256Hex } = await import('../lib/crypto')
  const hashed = `sha256:${await sha256Hex(token)}`

  const byHash = await db
    .prepare('SELECT * FROM vendor_profiles WHERE ical_token = ?')
    .bind(hashed)
    .first<VendorProfile>()
  if (byHash) return byHash

  // Legacy plaintext row — accept and upgrade to the hashed form.
  // Raw tokens are bare hex; anything carrying a hash prefix must never
  // match here, or a leaked column value would become a credential.
  if (token.includes(':')) return null
  const legacy = await db
    .prepare('SELECT * FROM vendor_profiles WHERE ical_token = ?')
    .bind(token)
    .first<VendorProfile>()
  if (legacy) {
    try {
      await db
        .prepare('UPDATE vendor_profiles SET ical_token = ? WHERE id = ?')
        .bind(hashed, legacy.id)
        .run()
      legacy.ical_token = hashed
    } catch (err) {
      console.error('[vendors] Failed to upgrade legacy sync token:', err)
    }
  }
  return legacy
}

// Resolve a vendor by their write-only enquiry intake key (API/webhook channel).
// Separate from ical_token so this key can only ever create leads.
export async function getVendorByEnquiryKey(
  db: D1Database,
  key: string
): Promise<VendorProfile | null> {
  if (!key || key.length < 16) return null
  return db
    .prepare('SELECT * FROM vendor_profiles WHERE enquiry_key = ?')
    .bind(key)
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
      | 'categories'
      | 'phone'
      | 'website'
      | 'instagram'
      | 'bio'
      | 'location'
      | 'timezone'
      | 'enquiry_form'
      | 'booking_form'
      | 'ical_token'
      | 'enquiry_key'
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
      | 'logo_r2_key'
      | 'brand_theme'
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
      values.push(key === 'instagram' ? sanitizeInstagramHandle(val as string | null) : val)
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
