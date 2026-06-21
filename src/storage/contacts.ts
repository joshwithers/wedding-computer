/**
 * Contact markdown format and data access layer.
 *
 * Contacts are stored as markdown files:
 *   vendors/{vendor_id}/contacts/john-doe.md
 *
 * Frontmatter holds all structured data. The markdown body
 * holds free-form notes (the "notes" field in the UI).
 *
 * D1 holds a queryable index (file_index table) that caches
 * key fields for fast list/filter/search. The index can
 * always be rebuilt from the markdown files.
 *
 * vendor_id is never stored in the file — it's implicit
 * from the storage path prefix.
 */

import type { Contact } from '../types'
import type { StorageBackend, MarkdownDocument } from './types'
import { parseMarkdown, serializeMarkdown } from './markdown'
import { contactFilename, deduplicateFilename } from './slug'
import { generateId } from '../lib/crypto'
import { recordWriteConflict, StorageConflictError } from './conflicts'

/** Frontmatter fields for a contact markdown file */
type ContactFrontmatter = {
  id: string
  first_name: string
  last_name: string
  email?: string | null
  phone?: string | null
  partner_first_name?: string | null
  partner_last_name?: string | null
  partner_email?: string | null
  partner_phone?: string | null
  address?: string | null
  instagram?: string | null
  facebook?: string | null
  tiktok?: string | null
  website?: string | null
  source?: string | null
  status: string
  wedding_id?: string | null
  wedding_date?: string | null
  wedding_location?: string | null
  tags?: string[]
  form_data?: Record<string, unknown> | null
  last_contacted_at?: string | null
  created_at: string
  updated_at: string
}

/** Directory within a vendor's storage */
const CONTACTS_DIR = 'contacts/'

/**
 * Coerce a value that may be a number (from YAML auto-parsing)
 * back to a string. Phone numbers like 0400123456 get parsed as
 * the integer 400123456 by YAML when unquoted.
 */
function str(val: unknown): string | null {
  if (val == null) return null
  if (typeof val === 'number') return String(val)
  if (typeof val === 'string') return val || null
  return String(val)
}

// ────────────────────────────────────────────
// Serialization: Contact ↔ Markdown
// ────────────────────────────────────────────

/**
 * Convert a Contact to a markdown document.
 * Notes become the body; everything else goes in frontmatter.
 */
export function contactToMarkdown(contact: Contact): MarkdownDocument<ContactFrontmatter> {
  let tags: string[] | undefined
  if (contact.tags) {
    try {
      tags = JSON.parse(contact.tags)
    } catch {
      tags = undefined
    }
  }

  let form_data: Record<string, unknown> | null = null
  if (contact.form_data) {
    try {
      form_data = JSON.parse(contact.form_data)
    } catch {
      form_data = null
    }
  }

  const frontmatter: ContactFrontmatter = {
    id: contact.id,
    first_name: contact.first_name,
    last_name: contact.last_name,
    email: contact.email,
    phone: contact.phone,
    partner_first_name: contact.partner_first_name,
    partner_last_name: contact.partner_last_name,
    partner_email: contact.partner_email,
    partner_phone: contact.partner_phone,
    address: contact.address,
    instagram: contact.instagram,
    facebook: contact.facebook,
    tiktok: contact.tiktok,
    website: contact.website,
    source: contact.source,
    status: contact.status,
    wedding_id: contact.wedding_id,
    wedding_date: contact.wedding_date,
    wedding_location: contact.wedding_location,
    tags,
    form_data,
    last_contacted_at: contact.last_contacted_at,
    created_at: contact.created_at,
    updated_at: contact.updated_at,
  }

  return {
    frontmatter,
    body: contact.notes ?? '',
  }
}

/**
 * Parse a markdown document back into a Contact.
 * vendor_id comes from the storage path, not the file.
 *
 * Accepts the generic MarkdownDocument type so the sync engine
 * can pass parsed files without knowing the frontmatter shape.
 * Every field is null-coalesced so unknown keys are harmless.
 *
 * Throws if the frontmatter is missing a required `id` field.
 */
export function markdownToContact(
  doc: MarkdownDocument,
  vendorId: string
): Contact {
  const fm = doc.frontmatter as ContactFrontmatter

  if (!fm.id || typeof fm.id !== 'string') {
    throw new Error('Contact markdown is missing a required "id" field in frontmatter')
  }

  return {
    id: fm.id,
    vendor_id: vendorId,
    first_name: str(fm.first_name) ?? '',
    last_name: str(fm.last_name) ?? '',
    email: str(fm.email),
    phone: str(fm.phone),
    partner_first_name: str(fm.partner_first_name),
    partner_last_name: str(fm.partner_last_name),
    partner_email: str(fm.partner_email),
    partner_phone: str(fm.partner_phone),
    address: str(fm.address),
    instagram: str(fm.instagram),
    facebook: str(fm.facebook),
    tiktok: str(fm.tiktok),
    website: str(fm.website),
    source: str(fm.source),
    status: (fm.status as Contact['status']) ?? 'new',
    wedding_id: str(fm.wedding_id),
    wedding_date: str(fm.wedding_date),
    wedding_location: str(fm.wedding_location),
    notes: doc.body || null,
    tags: fm.tags ? JSON.stringify(fm.tags) : null,
    form_data: fm.form_data ? JSON.stringify(fm.form_data) : null,
    last_contacted_at: str(fm.last_contacted_at),
    created_at: str(fm.created_at) ?? new Date().toISOString(),
    updated_at: str(fm.updated_at) ?? new Date().toISOString(),
  }
}

/**
 * Extract fields from a contact for the D1 index cache.
 * These let us filter/search/sort without reading files.
 */
export function contactCachedData(contact: Contact): string {
  return JSON.stringify({
    first_name: contact.first_name,
    last_name: contact.last_name,
    email: contact.email,
    phone: contact.phone,
    partner_first_name: contact.partner_first_name,
    partner_last_name: contact.partner_last_name,
    partner_email: contact.partner_email,
    partner_phone: contact.partner_phone,
    address: contact.address,
    instagram: contact.instagram,
    facebook: contact.facebook,
    tiktok: contact.tiktok,
    website: contact.website,
    source: contact.source,
    status: contact.status,
    wedding_id: contact.wedding_id,
    wedding_date: contact.wedding_date,
    wedding_location: contact.wedding_location,
    // notes/tags/form_data complete the cache so detail/edit pages and the
    // merge-on-save can be served from D1 without a storage read. The presence
    // of the `notes` key also marks a row as the complete (v2) cache format.
    notes: contact.notes,
    tags: contact.tags,
    form_data: contact.form_data,
    last_contacted_at: contact.last_contacted_at,
    created_at: contact.created_at,
    updated_at: contact.updated_at,
  })
}

/** Reconstruct a Contact from a complete (v2) cached_data row — no storage read. */
export function contactFromCache(cached: Record<string, unknown>, contactId: string, vendorId: string): Contact {
  const s = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : v == null ? null : String(v))
  return {
    id: contactId,
    vendor_id: vendorId,
    first_name: s(cached.first_name) ?? '',
    last_name: s(cached.last_name) ?? '',
    email: s(cached.email),
    phone: s(cached.phone),
    partner_first_name: s(cached.partner_first_name),
    partner_last_name: s(cached.partner_last_name),
    partner_email: s(cached.partner_email),
    partner_phone: s(cached.partner_phone),
    address: s(cached.address),
    instagram: s(cached.instagram),
    facebook: s(cached.facebook),
    tiktok: s(cached.tiktok),
    website: s(cached.website),
    source: s(cached.source),
    status: (s(cached.status) as Contact['status']) ?? 'new',
    wedding_id: s(cached.wedding_id),
    wedding_date: s(cached.wedding_date),
    wedding_location: s(cached.wedding_location),
    notes: s(cached.notes),
    tags: s(cached.tags),
    form_data: s(cached.form_data),
    last_contacted_at: s(cached.last_contacted_at),
    created_at: s(cached.created_at) ?? new Date().toISOString(),
    updated_at: s(cached.updated_at) ?? new Date().toISOString(),
  }
}

/**
 * Fast read of a contact straight from the D1 index (no storage round-trip).
 * Returns null when the row is missing or still the old (pre-notes) cache
 * format, so the caller can fall back to a storage read.
 */
export async function getContactCached(
  db: D1Database,
  vendorId: string,
  contactId: string
): Promise<{ contact: Contact; filePath: string; indexedEtag: string } | null> {
  const row = await db
    .prepare('SELECT file_path, etag, cached_data FROM file_index WHERE vendor_id = ? AND entity_type = ? AND entity_id = ?')
    .bind(vendorId, 'contact', contactId)
    .first<{ file_path: string; etag: string; cached_data: string | null }>()
  if (!row || !row.cached_data) return null
  let cached: Record<string, unknown>
  try {
    cached = JSON.parse(row.cached_data)
  } catch {
    return null
  }
  if (!('notes' in cached)) return null // old format — fall back to storage
  return { contact: contactFromCache(cached, contactId, vendorId), filePath: row.file_path, indexedEtag: row.etag }
}

// ────────────────────────────────────────────
// Data access — replaces src/db/contacts.ts
// ────────────────────────────────────────────

export type ContactFilters = {
  status?: string
  search?: string
}

/**
 * List contacts from the D1 index (fast, filterable).
 * Returns the same Contact shape the routes expect.
 */
export async function listContacts(
  db: D1Database,
  vendorId: string,
  filters?: ContactFilters
): Promise<Contact[]> {
  let query = `SELECT entity_id, cached_data, file_path, created_at
    FROM file_index
    WHERE vendor_id = ? AND entity_type = 'contact'`
  const params: unknown[] = [vendorId]

  if (filters?.status) {
    query += ` AND json_extract(cached_data, '$.status') = ?`
    params.push(filters.status)
  }

  if (filters?.search) {
    query += ` AND (
      json_extract(cached_data, '$.first_name') LIKE ? OR
      json_extract(cached_data, '$.last_name') LIKE ? OR
      json_extract(cached_data, '$.email') LIKE ? OR
      json_extract(cached_data, '$.partner_first_name') LIKE ? OR
      json_extract(cached_data, '$.partner_last_name') LIKE ?
    )`
    const term = `%${filters.search}%`
    params.push(term, term, term, term, term)
  }

  query += ` ORDER BY json_extract(cached_data, '$.created_at') DESC LIMIT 500`

  const rows = await db
    .prepare(query)
    .bind(...params)
    .all<{ entity_id: string; cached_data: string; file_path: string; created_at: string }>()

  return rows.results.flatMap((row) => {
    let c: Record<string, unknown>
    try {
      c = JSON.parse(row.cached_data)
    } catch {
      console.error(`[contacts] Corrupt cached_data for entity ${row.entity_id}, skipping`)
      return []
    }
    return [{
      id: row.entity_id,
      vendor_id: vendorId,
      first_name: c.first_name ?? '',
      last_name: c.last_name ?? '',
      email: c.email ?? null,
      phone: c.phone ?? null,
      partner_first_name: c.partner_first_name ?? null,
      partner_last_name: c.partner_last_name ?? null,
      partner_email: c.partner_email ?? null,
      partner_phone: c.partner_phone ?? null,
      address: c.address ?? null,
      instagram: c.instagram ?? null,
      facebook: c.facebook ?? null,
      tiktok: c.tiktok ?? null,
      website: c.website ?? null,
      source: c.source ?? null,
      status: c.status ?? 'new',
      wedding_id: c.wedding_id ?? null,
      wedding_date: c.wedding_date ?? null,
      wedding_location: c.wedding_location ?? null,
      notes: null, // not cached — read the file for detail view
      tags: null,
      form_data: null,
      last_contacted_at: c.last_contacted_at ?? null,
      created_at: c.created_at ?? row.created_at,
      updated_at: c.updated_at ?? '',
    } as Contact]
  })
}

/**
 * Get a single contact by reading its markdown file.
 * Looks up the file path from the D1 index, then reads from storage.
 */
export async function getContact(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string,
  contactId: string
): Promise<{ contact: Contact; etag: string; indexedEtag: string; filePath: string; rawContent: string } | null> {
  const indexRow = await db
    .prepare(
      'SELECT file_path, etag FROM file_index WHERE vendor_id = ? AND entity_type = ? AND entity_id = ?'
    )
    .bind(vendorId, 'contact', contactId)
    .first<{ file_path: string; etag: string }>()

  if (!indexRow) return null

  const file = await storage.read(indexRow.file_path)
  if (!file) {
    // File was deleted externally — clean up the stale index entry
    console.error(`[contacts] Stale index: ${indexRow.file_path} missing from storage, removing index`)
    try { await deleteIndex(db, vendorId, contactId) } catch { /* best effort */ }
    return null
  }

  const doc = parseMarkdown<ContactFrontmatter>(file.content)
  const contact = markdownToContact(doc, vendorId)

  return {
    contact,
    etag: file.meta.etag,
    indexedEtag: indexRow.etag,
    filePath: indexRow.file_path,
    rawContent: file.content,
  }
}

/**
 * Create a new contact: write markdown file, then index in D1.
 */
export async function createContact(
  storage: StorageBackend,
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
    address?: string | null
    instagram?: string | null
    facebook?: string | null
    tiktok?: string | null
    website?: string | null
    source?: string | null
    wedding_id?: string | null
    status?: Contact['status']
    wedding_date?: string | null
    wedding_location?: string | null
    notes?: string | null
    form_data?: string | null
    tags?: string | null
  }
): Promise<Contact> {
  const id = generateId()
  const now = new Date().toISOString()

  const contact: Contact = {
    id,
    vendor_id: vendorId,
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email ?? null,
    phone: data.phone ?? null,
    partner_first_name: data.partner_first_name ?? null,
    partner_last_name: data.partner_last_name ?? null,
    partner_email: data.partner_email ?? null,
    partner_phone: data.partner_phone ?? null,
    address: data.address ?? null,
    instagram: data.instagram ?? null,
    facebook: data.facebook ?? null,
    tiktok: data.tiktok ?? null,
    website: data.website ?? null,
    source: data.source ?? null,
    status: data.status ?? 'new',
    wedding_id: data.wedding_id ?? null,
    wedding_date: data.wedding_date ?? null,
    wedding_location: data.wedding_location ?? null,
    notes: data.notes ?? null,
    tags: data.tags ?? null,
    form_data: data.form_data ?? null,
    last_contacted_at: null,
    created_at: now,
    updated_at: now,
  }

  // Generate a human-readable filename, deduplicating if needed
  const desiredFilename = contactFilename(
    contact.first_name,
    contact.last_name,
    contact.partner_first_name,
    contact.partner_last_name
  )
  const existing = await listExistingFilenames(db, vendorId)
  const filename = deduplicateFilename(desiredFilename, existing)
  const filePath = CONTACTS_DIR + filename

  // Serialize to markdown and write to storage
  const doc = contactToMarkdown(contact)
  const content = serializeMarkdown(doc)
  const etag = await storage.write(filePath, content)

  // Index in D1. If this fails, clean up the orphaned R2 file.
  try {
    await upsertIndex(db, vendorId, contact, filePath, etag)
  } catch (err) {
    // Best-effort cleanup of the file we just wrote
    try { await storage.delete(filePath) } catch { /* orphan is acceptable */ }
    throw err
  }

  // Backward compat: also write to the old contacts table so
  // dashboard, analytics, invoices, CardDAV etc. still work.
  // Non-critical — log and continue if this fails.
  try {
    await syncToContactsTable(db, contact)
  } catch (err) {
    console.error(`[contacts] syncToContactsTable failed for ${contact.id}:`, err)
  }

  return contact
}

/**
 * Update a contact: read the file, merge changes, write back.
 * If the name changed, the file gets renamed too.
 */
export async function updateContact(
  storage: StorageBackend,
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
      | 'address'
      | 'instagram'
      | 'facebook'
      | 'tiktok'
      | 'website'
      | 'source'
      | 'status'
      | 'wedding_id'
      | 'wedding_date'
      | 'wedding_location'
      | 'notes'
      | 'tags'
      | 'last_contacted_at'
    >
  >
): Promise<void> {
  const renamesFile =
    data.first_name !== undefined ||
    data.last_name !== undefined ||
    data.partner_first_name !== undefined ||
    data.partner_last_name !== undefined

  // Fast path: an in-place edit (no rename) of a contact already complete in the
  // D1 index. Merge from the cache and write CONDITIONALLY on the indexed etag —
  // no storage read. If the file changed under us the conditional write throws
  // StorageConflictError, which we turn into a recorded conflict (both versions
  // kept, nothing clobbered). Renames + un-cached rows fall through to the
  // storage-read path below.
  if (!renamesFile) {
    const cached = await getContactCached(db, vendorId, contactId)
    if (cached) {
      const updated: Contact = { ...cached.contact }
      for (const [key, val] of Object.entries(data)) {
        if (val !== undefined) (updated as Record<string, unknown>)[key] = val
      }
      updated.updated_at = new Date().toISOString()
      const content = serializeMarkdown(contactToMarkdown(updated))
      try {
        const etag = await storage.write(cached.filePath, content, cached.indexedEtag)
        await upsertIndex(db, vendorId, updated, cached.filePath, etag)
      } catch (e) {
        if (e instanceof StorageConflictError) {
          const cur = await storage.read(cached.filePath).catch(() => null)
          await recordWriteConflict(
            db, vendorId, 'contact', contactId, cached.filePath,
            content, cur?.content ?? '', cached.indexedEtag, cur?.meta.etag ?? cached.indexedEtag
          ) // throws StorageConflictError
        }
        throw e
      }
      try {
        await syncToContactsTable(db, updated)
      } catch (err) {
        console.error(`[contacts] syncToContactsTable failed for ${updated.id}:`, err)
      }
      return
    }
  }

  const result = await getContact(storage, db, vendorId, contactId)
  if (!result) return

  const { contact, filePath, etag: remoteEtag, indexedEtag, rawContent } = result

  // Merge updates into the contact
  const updated: Contact = { ...contact }
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      ;(updated as Record<string, unknown>)[key] = val
    }
  }
  updated.updated_at = new Date().toISOString()

  // If the name changed, the file needs a new name
  const nameChanged =
    data.first_name !== undefined ||
    data.last_name !== undefined ||
    data.partner_first_name !== undefined ||
    data.partner_last_name !== undefined

  let newFilePath = filePath
  if (nameChanged) {
    const desiredFilename = contactFilename(
      updated.first_name,
      updated.last_name,
      updated.partner_first_name,
      updated.partner_last_name
    )
    const desiredPath = CONTACTS_DIR + desiredFilename
    if (desiredPath !== filePath) {
      const existing = await listExistingFilenames(db, vendorId)
      // Don't conflict with current filename (it's being replaced)
      const currentFilename = filePath.slice(CONTACTS_DIR.length)
      existing.delete(currentFilename)
      const filename = deduplicateFilename(desiredFilename, existing)
      newFilePath = CONTACTS_DIR + filename
    }
  }

  // Serialize and write
  const doc = contactToMarkdown(updated)
  const content = serializeMarkdown(doc)

  if (remoteEtag !== indexedEtag) {
    await recordWriteConflict(
      db,
      vendorId,
      'contact',
      contactId,
      filePath,
      content,
      rawContent,
      indexedEtag,
      remoteEtag
    )
  }

  if (newFilePath !== filePath) {
    // Rename: write new file, update D1 index atomically, THEN delete old file.
    // If D1 fails, the old file + index are still valid (new file is orphaned but harmless).
    const etag = await storage.write(newFilePath, content)
    try {
      await db.batch([
        db.prepare(
          'DELETE FROM file_index WHERE vendor_id = ? AND entity_type = ? AND entity_id = ?'
        ).bind(vendorId, 'contact', contactId),
        db.prepare(
          `INSERT INTO file_index (vendor_id, entity_type, entity_id, file_path, etag, cached_data, last_synced_at)
           VALUES (?, 'contact', ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(vendor_id, file_path) DO UPDATE SET
             entity_id = excluded.entity_id,
             etag = excluded.etag,
             cached_data = excluded.cached_data,
             last_synced_at = datetime('now')`
        ).bind(vendorId, updated.id, newFilePath, etag, contactCachedData(updated)),
      ])
    } catch (err) {
      // D1 failed — clean up the new file, leave old file intact
      try { await storage.delete(newFilePath) } catch { /* orphan is acceptable */ }
      throw err
    }
    // D1 succeeded — safe to remove the old file (best-effort)
    try { await storage.delete(filePath) } catch { /* orphaned old file is acceptable */ }
  } else {
    // Reuse the SHA from the read above so a git backend skips a redundant
    // GET-for-SHA round-trip (R2 ignores it). remoteEtag is that blob's SHA.
    const etag = await storage.write(filePath, content, remoteEtag)
    await upsertIndex(db, vendorId, updated, filePath, etag)
  }

  // Backward compat: sync to old contacts table.
  // Non-critical — log and continue if this fails.
  try {
    await syncToContactsTable(db, updated)
  } catch (err) {
    console.error(`[contacts] syncToContactsTable failed for ${updated.id}:`, err)
  }
}

/**
 * Update just the status (common in the pipeline drag-drop UI).
 */
export async function updateContactStatus(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string,
  contactId: string,
  status: string
): Promise<void> {
  await updateContact(storage, db, vendorId, contactId, {
    status: status as Contact['status'],
  })
}

/**
 * Delete a contact: remove the markdown file and D1 index row.
 */
export async function deleteContact(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string,
  contactId: string
): Promise<void> {
  const indexRow = await db
    .prepare(
      'SELECT file_path FROM file_index WHERE vendor_id = ? AND entity_type = ? AND entity_id = ?'
    )
    .bind(vendorId, 'contact', contactId)
    .first<{ file_path: string }>()

  if (indexRow) {
    // Delete D1 index first (authoritative), then storage file.
    // If storage delete fails, we get an orphaned file — harmless
    // and cleaned up on next sync. The reverse (file deleted, index
    // intact) would leave a dangling index entry.
    await deleteIndex(db, vendorId, contactId)
    try {
      await storage.delete(indexRow.file_path)
    } catch (err) {
      console.error(`[contacts] Failed to delete file ${indexRow.file_path}, orphaned:`, err)
    }
  }

  // Backward compat: also remove from old contacts table
  await db
    .prepare('DELETE FROM contacts WHERE id = ? AND vendor_id = ?')
    .bind(contactId, vendorId)
    .run()
}

/**
 * Count contacts by status from the D1 index.
 */
export async function countContactsByStatus(
  db: D1Database,
  vendorId: string
): Promise<Record<string, number>> {
  const rows = await db
    .prepare(
      `SELECT json_extract(cached_data, '$.status') as status, COUNT(*) as count
       FROM file_index
       WHERE vendor_id = ? AND entity_type = 'contact'
       GROUP BY json_extract(cached_data, '$.status')`
    )
    .bind(vendorId)
    .all<{ status: string; count: number }>()

  const counts: Record<string, number> = {}
  for (const row of rows.results) {
    counts[row.status] = row.count
  }
  return counts
}

// ────────────────────────────────────────────
// Index management
// ────────────────────────────────────────────

async function upsertIndex(
  db: D1Database,
  vendorId: string,
  contact: Contact,
  filePath: string,
  etag: string
): Promise<void> {
  // One index row per contact: drop any stale-path row for this contact (file
  // renamed) before inserting, atomically, so the UNIQUE(vendor_id,
  // entity_type, entity_id) constraint is never transiently violated.
  await db.batch([
    db
      .prepare(
        "DELETE FROM file_index WHERE vendor_id = ? AND entity_type = 'contact' AND entity_id = ? AND file_path != ?"
      )
      .bind(vendorId, contact.id, filePath),
    db
      .prepare(
        `INSERT INTO file_index (vendor_id, entity_type, entity_id, file_path, etag, cached_data, last_synced_at)
         VALUES (?, 'contact', ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(vendor_id, file_path) DO UPDATE SET
           entity_id = excluded.entity_id,
           etag = excluded.etag,
           cached_data = excluded.cached_data,
           last_synced_at = datetime('now')`
      )
      .bind(vendorId, contact.id, filePath, etag, contactCachedData(contact)),
  ])
}

async function deleteIndex(
  db: D1Database,
  vendorId: string,
  contactId: string
): Promise<void> {
  await db
    .prepare(
      'DELETE FROM file_index WHERE vendor_id = ? AND entity_type = ? AND entity_id = ?'
    )
    .bind(vendorId, 'contact', contactId)
    .run()
}

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

/**
 * Existing contact filenames for a vendor, used to deduplicate when
 * creating/renaming files. Sourced from the D1 file_index (complete, cheap)
 * rather than storage.list(), which caps at 1000 objects — past that, a
 * collision would silently overwrite an existing contact's file.
 */
async function listExistingFilenames(
  db: D1Database,
  vendorId: string
): Promise<Set<string>> {
  const rows = await db
    .prepare("SELECT file_path FROM file_index WHERE vendor_id = ? AND entity_type = 'contact'")
    .bind(vendorId)
    .all<{ file_path: string }>()
  return new Set(
    rows.results
      .map((r) => r.file_path)
      .filter((p) => p.startsWith(CONTACTS_DIR))
      .map((p) => p.slice(CONTACTS_DIR.length))
  )
}

/**
 * Backward compatibility: upsert the old `contacts` D1 table
 * so that dashboard, analytics, invoices, CardDAV, and other
 * code that queries contacts directly continues to work.
 *
 * This will be removed once all queries migrate to file_index.
 */
export async function syncToContactsTable(
  db: D1Database,
  contact: Contact
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO contacts (id, vendor_id, first_name, last_name, email, phone,
        partner_first_name, partner_last_name, partner_email, partner_phone,
        address, instagram, facebook, tiktok, website,
        source, status, wedding_id, wedding_date, wedding_location, notes,
        tags, form_data, last_contacted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         first_name = excluded.first_name,
         last_name = excluded.last_name,
         email = excluded.email,
         phone = excluded.phone,
         partner_first_name = excluded.partner_first_name,
         partner_last_name = excluded.partner_last_name,
         partner_email = excluded.partner_email,
         partner_phone = excluded.partner_phone,
         address = excluded.address,
         instagram = excluded.instagram,
         facebook = excluded.facebook,
         tiktok = excluded.tiktok,
         website = excluded.website,
         source = excluded.source,
         status = excluded.status,
         wedding_id = excluded.wedding_id,
         wedding_date = excluded.wedding_date,
         wedding_location = excluded.wedding_location,
         notes = excluded.notes,
         tags = excluded.tags,
         form_data = excluded.form_data,
         last_contacted_at = excluded.last_contacted_at,
         updated_at = excluded.updated_at
       WHERE contacts.vendor_id = excluded.vendor_id`
    )
    .bind(
      contact.id,
      contact.vendor_id,
      contact.first_name,
      contact.last_name,
      contact.email,
      contact.phone,
      contact.partner_first_name,
      contact.partner_last_name,
      contact.partner_email,
      contact.partner_phone,
      contact.address,
      contact.instagram,
      contact.facebook,
      contact.tiktok,
      contact.website,
      contact.source,
      contact.status,
      contact.wedding_id,
      contact.wedding_date,
      contact.wedding_location,
      contact.notes,
      contact.tags,
      contact.form_data,
      contact.last_contacted_at,
      contact.created_at,
      contact.updated_at
    )
    .run()
}
