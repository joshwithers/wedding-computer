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
import { contactFilename, deduplicateFilename } from './slug'
import { weddingFolder } from './weddings'

export type MigrationResult = {
  migrated: number
  skipped: number
  errors: number
}

export type ContactRepairResult = MigrationResult & {
  rewritten: number
}

export type ContactRepairOptions = {
  limit?: number
  verifyIndexedFiles?: boolean
}

/**
 * Migrate all contacts for a vendor from D1 to markdown files.
 */
export async function migrateContacts(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string
): Promise<MigrationResult> {
  return repairContacts(storage, db, vendorId)
}

/**
 * Repair the contact storage index for a vendor.
 *
 * This handles both historical D1-only rows and stale file_index rows whose
 * markdown file is no longer present. It never overwrites an existing file.
 */
export async function repairContacts(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string,
  options: ContactRepairOptions = {}
): Promise<ContactRepairResult> {
  const result: ContactRepairResult = { migrated: 0, rewritten: 0, skipped: 0, errors: 0 }
  const verifyIndexedFiles = options.verifyIndexedFiles ?? true
  const limit = options.limit ?? null
  let repaired = 0
  const existingFiles = await listExistingContactFilenames(storage)

  async function writeContactMarkdown(
    contact: Contact,
    filePath: string,
    rewritingMissingIndexedFile: boolean
  ): Promise<void> {
    existingFiles.add(filePath.slice('contacts/'.length))

    const doc = contactToMarkdown(contact)
    const content = serializeMarkdown(doc)
    const etag = await storage.write(filePath, content)

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

    if (rewritingMissingIndexedFile) {
      result.rewritten++
    } else {
      result.migrated++
    }
    repaired++
  }

  // Bounded repair is used by production queues. Process only legacy git-SHA
  // index rows first, then unindexed D1-only rows, so each invocation makes
  // progress without re-heading the entire contact table.
  if (limit !== null && verifyIndexedFiles) {
    const indexedContacts = await db
      .prepare(
        `SELECT c.*, fi.file_path AS __file_path
         FROM contacts c
         JOIN file_index fi
           ON fi.vendor_id = c.vendor_id
          AND fi.entity_type = 'contact'
          AND fi.entity_id = c.id
         WHERE c.vendor_id = ?
           AND LENGTH(COALESCE(fi.etag, '')) = 40
         ORDER BY c.created_at
         LIMIT ?`
      )
      .bind(vendorId, limit)
      .all<Contact & { __file_path: string }>()

    for (const contact of indexedContacts.results) {
      try {
        const existing = await storage.head(contact.__file_path)
        if (existing) {
          await db
            .prepare(
              `UPDATE file_index
               SET etag = ?, cached_data = ?, last_synced_at = datetime('now')
               WHERE vendor_id = ? AND entity_type = 'contact' AND entity_id = ?`
            )
            .bind(existing.etag, contactCachedData(contact), vendorId, contact.id)
            .run()
          result.skipped++
          repaired++
          continue
        }
        await writeContactMarkdown(contact, contact.__file_path, true)
      } catch (err) {
        console.error(`[migrate] Failed to repair contact ${contact.id}:`, err)
        result.errors++
      }
    }

    const remaining = limit - repaired
    if (remaining <= 0) return result

    const unindexedContacts = await db
      .prepare(
        `SELECT c.*
         FROM contacts c
         LEFT JOIN file_index fi
           ON fi.vendor_id = c.vendor_id
          AND fi.entity_type = 'contact'
          AND fi.entity_id = c.id
         WHERE c.vendor_id = ? AND fi.id IS NULL
         ORDER BY c.created_at
         LIMIT ?`
      )
      .bind(vendorId, remaining)
      .all<Contact>()

    for (const contact of unindexedContacts.results) {
      try {
        const desiredFilename = contactFilename(
          contact.first_name,
          contact.last_name,
          contact.partner_first_name,
          contact.partner_last_name
        )
        const filename = deduplicateFilename(desiredFilename, existingFiles)
        await writeContactMarkdown(contact, 'contacts/' + filename, false)
      } catch (err) {
        console.error(`[migrate] Failed to repair contact ${contact.id}:`, err)
        result.errors++
      }
    }

    return result
  }

  const indexed = await db
    .prepare(
      'SELECT entity_id, file_path FROM file_index WHERE vendor_id = ? AND entity_type = ?'
    )
    .bind(vendorId, 'contact')
    .all<{ entity_id: string; file_path: string }>()
  const indexedById = new Map(indexed.results.map((r) => [r.entity_id, r.file_path]))

  const contacts = await db
    .prepare('SELECT * FROM contacts WHERE vendor_id = ? ORDER BY created_at')
    .bind(vendorId)
    .all<Contact>()

  for (const contact of contacts.results) {
    try {
      const indexedPath = indexedById.get(contact.id)
      if (indexedPath) {
        if (!verifyIndexedFiles || await storage.head(indexedPath)) {
          result.skipped++
          continue
        }
        await writeContactMarkdown(contact, indexedPath, true)
        continue
      }

      const desiredFilename = contactFilename(
        contact.first_name,
        contact.last_name,
        contact.partner_first_name,
        contact.partner_last_name
      )
      const filename = deduplicateFilename(desiredFilename, existingFiles)
      await writeContactMarkdown(contact, 'contacts/' + filename, false)
    } catch (err) {
      console.error(`[migrate] Failed to repair contact ${contact.id}:`, err)
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

  for (const wedding of weddings.results) {
    if (indexedIds.has(wedding.id)) {
      result.skipped++
      continue
    }

    try {
      const folder = weddingFolder(wedding.title, wedding.date)
      const filePath = folder + 'wedding.md'

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
  const row = await db
    .prepare(
      `SELECT c.id
       FROM contacts c
       LEFT JOIN file_index fi
         ON fi.vendor_id = c.vendor_id
        AND fi.entity_type = 'contact'
        AND fi.entity_id = c.id
       WHERE c.vendor_id = ? AND fi.id IS NULL
       LIMIT 1`
    )
    .bind(vendorId)
    .first<{ id: string }>()

  return !!row
}

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

async function listExistingContactFilenames(
  storage: StorageBackend
): Promise<Set<string>> {
  const files = new Set<string>()
  let cursor: string | undefined
  do {
    const result = await storage.list('contacts/', cursor)
    for (const file of result.files) {
      files.add(file.path.slice('contacts/'.length))
    }
    cursor = result.cursor
  } while (cursor)
  return files
}
