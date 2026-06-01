/**
 * Data migration: D1 contacts table → markdown files + file index.
 *
 * Existing vendors have contacts stored only in the D1 `contacts` table.
 * This migration reads them out, writes markdown files to storage, and
 * populates the file_index table.
 *
 * Safe to run multiple times — it skips contacts that are already indexed.
 *
 * Usage:
 *   const result = await migrateContacts(storage, db, vendorId)
 *   console.log(`Migrated ${result.migrated} contacts, skipped ${result.skipped}`)
 */

import type { Contact, Wedding } from '../types'
import type { StorageBackend } from './types'
import { contactToMarkdown, contactCachedData } from './contacts'
import { weddingToMarkdown, weddingCachedData } from './weddings'
import { serializeMarkdown } from './markdown'
import { contactFilename, weddingFilename, deduplicateFilename } from './slug'

export type MigrationResult = {
  migrated: number
  skipped: number
  errors: number
}

/**
 * Migrate all contacts for a vendor from D1 to markdown files.
 */
export async function migrateContacts(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string
): Promise<MigrationResult> {
  const result: MigrationResult = { migrated: 0, skipped: 0, errors: 0 }

  // Get already-indexed contact IDs to skip
  const indexed = await db
    .prepare(
      'SELECT entity_id FROM file_index WHERE vendor_id = ? AND entity_type = ?'
    )
    .bind(vendorId, 'contact')
    .all<{ entity_id: string }>()
  const indexedIds = new Set(indexed.results.map((r) => r.entity_id))

  // Get all contacts from the old D1 table
  const contacts = await db
    .prepare('SELECT * FROM contacts WHERE vendor_id = ? ORDER BY created_at')
    .bind(vendorId)
    .all<Contact>()

  // Track filenames for deduplication within this batch
  const existingFiles = await listExistingContactFilenames(storage)

  for (const contact of contacts.results) {
    if (indexedIds.has(contact.id)) {
      result.skipped++
      continue
    }

    try {
      // Generate filename
      const desiredFilename = contactFilename(
        contact.first_name,
        contact.last_name,
        contact.partner_first_name,
        contact.partner_last_name
      )
      const filename = deduplicateFilename(desiredFilename, existingFiles)
      const filePath = 'contacts/' + filename

      // Track this filename to avoid collisions within the batch
      existingFiles.add(filename)

      // Serialize to markdown
      const doc = contactToMarkdown(contact)
      const content = serializeMarkdown(doc)

      // Write to storage
      const etag = await storage.write(filePath, content)

      // Index in D1. If this fails, clean up the orphaned file.
      try {
        await db
          .prepare(
            `INSERT INTO file_index (vendor_id, entity_type, entity_id, file_path, etag, cached_data, last_synced_at)
             VALUES (?, 'contact', ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(vendor_id, file_path) DO UPDATE SET
               entity_id = excluded.entity_id,
               etag = excluded.etag,
               cached_data = excluded.cached_data,
               last_synced_at = datetime('now')`
          )
          .bind(vendorId, contact.id, filePath, etag, contactCachedData(contact))
          .run()
      } catch (indexErr) {
        try { await storage.delete(filePath) } catch { /* orphan is acceptable */ }
        throw indexErr
      }

      result.migrated++
    } catch (err) {
      console.error(`[migrate] Failed to migrate contact ${contact.id}:`, err)
      result.errors++
    }
  }

  return result
}

/**
 * Migrate all weddings for a vendor from D1 to markdown files.
 * Only migrates weddings created by this vendor.
 */
export async function migrateWeddings(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string,
  userId: string
): Promise<MigrationResult> {
  const result: MigrationResult = { migrated: 0, skipped: 0, errors: 0 }

  const indexed = await db
    .prepare(
      'SELECT entity_id FROM file_index WHERE vendor_id = ? AND entity_type = ?'
    )
    .bind(vendorId, 'wedding')
    .all<{ entity_id: string }>()
  const indexedIds = new Set(indexed.results.map((r) => r.entity_id))

  // Get weddings this vendor owns or is a member of
  const weddings = await db
    .prepare(
      `SELECT w.* FROM weddings w
       JOIN wedding_members wm ON wm.wedding_id = w.id
       WHERE wm.user_id = ? AND wm.status = 'active'
       ORDER BY w.created_at`
    )
    .bind(userId)
    .all<Wedding>()

  const existingFiles = await listExistingWeddingFilenames(storage)

  for (const wedding of weddings.results) {
    if (indexedIds.has(wedding.id)) {
      result.skipped++
      continue
    }

    try {
      const desiredFilename = weddingFilename(wedding.title, wedding.date)
      const filename = deduplicateFilename(desiredFilename, existingFiles)
      const filePath = 'weddings/' + filename
      existingFiles.add(filename)

      const doc = weddingToMarkdown(wedding)
      const content = serializeMarkdown(doc)
      const etag = await storage.write(filePath, content)

      try {
        await db
          .prepare(
            `INSERT INTO file_index (vendor_id, entity_type, entity_id, file_path, etag, cached_data, last_synced_at)
             VALUES (?, 'wedding', ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(vendor_id, file_path) DO UPDATE SET
               entity_id = excluded.entity_id,
               etag = excluded.etag,
               cached_data = excluded.cached_data,
               last_synced_at = datetime('now')`
          )
          .bind(vendorId, wedding.id, filePath, etag, weddingCachedData(wedding))
          .run()
      } catch (indexErr) {
        try { await storage.delete(filePath) } catch { /* orphan is acceptable */ }
        throw indexErr
      }

      result.migrated++
    } catch (err) {
      console.error(`[migrate] Failed to migrate wedding ${wedding.id}:`, err)
      result.errors++
    }
  }

  return result
}

/**
 * Check if a vendor needs migration (has contacts in D1 but
 * none in the file index).
 */
export async function needsMigration(
  db: D1Database,
  vendorId: string
): Promise<boolean> {
  const [indexCount, contactCount] = await Promise.all([
    db
      .prepare(
        'SELECT COUNT(*) as count FROM file_index WHERE vendor_id = ? AND entity_type = ?'
      )
      .bind(vendorId, 'contact')
      .first<{ count: number }>(),
    db
      .prepare('SELECT COUNT(*) as count FROM contacts WHERE vendor_id = ?')
      .bind(vendorId)
      .first<{ count: number }>(),
  ])

  // Needs migration if there are D1 contacts but no indexed files
  return (contactCount?.count ?? 0) > 0 && (indexCount?.count ?? 0) === 0
}

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

async function listExistingContactFilenames(
  storage: StorageBackend
): Promise<Set<string>> {
  const result = await storage.list('contacts/')
  return new Set(result.files.map((f) => f.path.slice('contacts/'.length)))
}

async function listExistingWeddingFilenames(
  storage: StorageBackend
): Promise<Set<string>> {
  const result = await storage.list('weddings/')
  return new Set(result.files.map((f) => f.path.slice('weddings/'.length)))
}
