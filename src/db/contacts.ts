import type { Contact } from '../types'

export type ContactFilters = {
  status?: string
  search?: string
}

export async function listContacts(
  db: D1Database,
  vendorId: string,
  filters?: ContactFilters
): Promise<Contact[]> {
  let query = `SELECT id, vendor_id, first_name, last_name, email, phone,
    partner_first_name, partner_last_name, partner_email, partner_phone,
    source, status, wedding_id, wedding_date, wedding_location,
    last_contacted_at, created_at, updated_at
    FROM contacts WHERE vendor_id = ?`
  const params: unknown[] = [vendorId]

  if (filters?.status) {
    query += ' AND status = ?'
    params.push(filters.status)
  }

  if (filters?.search) {
    query += ` AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR partner_first_name LIKE ? OR partner_last_name LIKE ?)`
    const term = `%${filters.search}%`
    params.push(term, term, term, term, term)
  }

  query += ' ORDER BY created_at DESC LIMIT 500'

  return db
    .prepare(query)
    .bind(...params)
    .all<Contact>()
    .then((r) => r.results)
}

export async function getContact(
  db: D1Database,
  vendorId: string,
  contactId: string
): Promise<Contact | null> {
  return db
    .prepare('SELECT * FROM contacts WHERE id = ? AND vendor_id = ?')
    .bind(contactId, vendorId)
    .first<Contact>()
}

export async function createContact(
  db: D1Database,
  vendorId: string,
  data: {
    first_name: string
    last_name: string
    email?: string | null
    phone?: string | null
    partner_first_name?: string | null
    partner_last_name?: string | null
    partner_email?: string | null
    partner_phone?: string | null
    source?: string | null
    wedding_date?: string | null
    wedding_location?: string | null
    notes?: string | null
    form_data?: string | null
    /** Imports preserve the source system's created date; defaults to now. */
    created_at?: string | null
  }
): Promise<Contact> {
  const result = await db
    .prepare(
      `INSERT INTO contacts (vendor_id, first_name, last_name, email, phone,
        partner_first_name, partner_last_name, partner_email, partner_phone,
        source, wedding_date, wedding_location, notes, form_data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
       RETURNING *`
    )
    .bind(
      vendorId,
      data.first_name,
      data.last_name,
      data.email ?? null,
      data.phone ?? null,
      data.partner_first_name ?? null,
      data.partner_last_name ?? null,
      data.partner_email ?? null,
      data.partner_phone ?? null,
      data.source ?? null,
      data.wedding_date ?? null,
      data.wedding_location ?? null,
      data.notes ?? null,
      data.form_data ?? null,
      data.created_at ?? null
    )
    .first<Contact>()
  return result!
}

export async function updateContact(
  db: D1Database,
  vendorId: string,
  contactId: string,
  data: Partial<
    Pick<
      Contact,
      | 'first_name'
      | 'last_name'
      | 'email'
      | 'phone'
      | 'partner_first_name'
      | 'partner_last_name'
      | 'partner_email'
      | 'partner_phone'
      | 'source'
      | 'status'
      | 'wedding_id'
      | 'wedding_date'
      | 'wedding_location'
      | 'notes'
    >
  >
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
  values.push(contactId, vendorId)
  await db
    .prepare(
      `UPDATE contacts SET ${sets.join(', ')} WHERE id = ? AND vendor_id = ?`
    )
    .bind(...values)
    .run()
}

export async function updateContactStatus(
  db: D1Database,
  vendorId: string,
  contactId: string,
  status: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE contacts SET status = ?, updated_at = datetime('now') WHERE id = ? AND vendor_id = ?`
    )
    .bind(status, contactId, vendorId)
    .run()
}

export async function deleteContact(
  db: D1Database,
  vendorId: string,
  contactId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM contacts WHERE id = ? AND vendor_id = ?')
    .bind(contactId, vendorId)
    .run()
}

export async function countContactsByStatus(
  db: D1Database,
  vendorId: string
): Promise<Record<string, number>> {
  const rows = await db
    .prepare(
      'SELECT status, COUNT(*) as count FROM contacts WHERE vendor_id = ? GROUP BY status'
    )
    .bind(vendorId)
    .all<{ status: string; count: number }>()
  const counts: Record<string, number> = {}
  for (const row of rows.results) {
    counts[row.status] = row.count
  }
  return counts
}
