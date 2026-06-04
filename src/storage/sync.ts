/**
 * Sync engine — reconciles D1 index with actual files in storage.
 *
 * The markdown files in R2/Git are the source of truth for contacts.
 * This engine scans storage and updates the D1 index to match.
 *
 * Three cases:
 * 1. File in storage but NOT in index → new external file, index it
 * 2. File in storage AND in index, etags match → no change, skip
 * 3. File in storage AND in index, etags differ → re-parse, update index
 * 4. Index entry but NO file in storage → deleted externally, remove from index
 *
 * Conflict detection happens at write time: if we try to write and
 * the file's etag doesn't match what we last saw, we record a conflict
 * instead of overwriting.
 */

import type { Contact, Wedding } from '../types'
import type { StorageBackend, FileMeta } from './types'
import { parseMarkdown, ParseError } from './markdown'
import { markdownToContact, contactCachedData, syncToContactsTable } from './contacts'
import { markdownToWedding, weddingCachedData } from './weddings'
import { isIgnoredPath } from './github'
export { checkForExternalChange, recordConflict } from './conflicts'

export type SyncResult = {
  indexed: number    // new files found and indexed
  updated: number    // existing files with changed content
  removed: number    // index entries for deleted files
  errors: number     // files that failed to parse
  skipped: number    // unchanged files (etag match)
}

/**
 * Full sync: scan all files in a vendor's storage and
 * reconcile the D1 index. Safe to run on a schedule or
 * triggered by webhook.
 */
export async function syncVendor(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string
): Promise<SyncResult> {
  const result: SyncResult = {
    indexed: 0,
    updated: 0,
    removed: 0,
    errors: 0,
    skipped: 0,
  }

  // Run contact and wedding syncs independently — one failing
  // should not prevent the other from completing.
  const results = await Promise.allSettled([
    syncEntityType(storage, db, vendorId, 'contact', 'contacts/'),
    syncEntityType(storage, db, vendorId, 'wedding', 'weddings/'),
  ])

  for (const r of results) {
    if (r.status === 'fulfilled') {
      result.indexed += r.value.indexed
      result.updated += r.value.updated
      result.removed += r.value.removed
      result.errors += r.value.errors
      result.skipped += r.value.skipped
    } else {
      console.error('[sync] Entity type sync failed:', r.reason)
      result.errors++
    }
  }

  return result
}

/**
 * Sync one entity type (contacts or weddings) for a vendor.
 */
async function syncEntityType(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string,
  entityType: 'contact' | 'wedding',
  prefix: string
): Promise<SyncResult> {
  const result: SyncResult = {
    indexed: 0,
    updated: 0,
    removed: 0,
    errors: 0,
    skipped: 0,
  }

  // Get all files from storage (with pagination)
  const storageFiles = await listAllFiles(storage, prefix)

  // Get all index entries for this entity type
  const indexRows = await db
    .prepare(
      'SELECT entity_id, file_path, etag FROM file_index WHERE vendor_id = ? AND entity_type = ?'
    )
    .bind(vendorId, entityType)
    .all<{ entity_id: string; file_path: string; etag: string }>()

  const indexByPath = new Map(
    indexRows.results.map((r) => [r.file_path, r])
  )
  const storageByPath = new Map(
    storageFiles.map((f) => [f.path, f])
  )

  // Process files that exist in storage (skip non-data files)
  for (const [path, fileMeta] of storageByPath) {
    if (isIgnoredPath(path)) {
      result.skipped++
      continue
    }
    const indexEntry = indexByPath.get(path)

    if (indexEntry && indexEntry.etag === fileMeta.etag) {
      // Etags match — file unchanged
      result.skipped++
      continue
    }

    // File is new or changed — read and parse it
    try {
      const file = await storage.read(path)
      if (!file) continue

      const doc = parseMarkdown(file.content)
      let entityId: string
      let cachedData: string

      if (entityType === 'contact') {
        const contact = markdownToContact(doc, vendorId)
        entityId = contact.id
        cachedData = contactCachedData(contact)
        await syncToContactsTable(db, contact)
      } else {
        const wedding = markdownToWedding(doc)
        entityId = wedding.id
        cachedData = weddingCachedData(wedding)
        await syncToWeddingsTable(db, wedding)
        await ensureSyncedWeddingMembership(db, vendorId, wedding)
      }

      // Upsert the index row
      await db
        .prepare(
          `INSERT INTO file_index (vendor_id, entity_type, entity_id, file_path, etag, cached_data, last_synced_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(vendor_id, file_path) DO UPDATE SET
             entity_id = excluded.entity_id,
             etag = excluded.etag,
             cached_data = excluded.cached_data,
             last_synced_at = datetime('now')`
        )
        .bind(vendorId, entityType, entityId, path, file.meta.etag, cachedData)
        .run()

      if (indexEntry) {
        result.updated++
      } else {
        result.indexed++
      }
    } catch (err) {
      if (err instanceof ParseError) {
        console.error(`[sync] Failed to parse ${path}: ${err.message}`)
      } else {
        console.error(`[sync] Error processing ${path}:`, err)
      }
      result.errors++
    }
  }

  // Remove index entries for files that no longer exist in storage
  for (const [path, indexEntry] of indexByPath) {
    if (!storageByPath.has(path)) {
      await db
        .prepare(
          'DELETE FROM file_index WHERE vendor_id = ? AND entity_type = ? AND file_path = ?'
        )
        .bind(vendorId, entityType, path)
        .run()
      result.removed++
    }
  }

  return result
}

/**
 * List all .md files under a prefix, handling pagination.
 */
async function listAllFiles(
  storage: StorageBackend,
  prefix: string
): Promise<FileMeta[]> {
  const allFiles: FileMeta[] = []
  let cursor: string | undefined

  do {
    const result = await storage.list(prefix, cursor)
    allFiles.push(...result.files)
    cursor = result.cursor
  } while (cursor)

  return allFiles
}

// ────────────────────────────────────────────
// Conflict detection helpers
// ────────────────────────────────────────────

/**
 * Resolve a conflict: apply the chosen resolution and clean up.
 */
export async function resolveConflict(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string,
  conflictId: string,
  resolution: 'keep_remote' | 'keep_local' | 'merge',
  mergedContent?: string
): Promise<void> {
  const conflict = await db
    .prepare('SELECT * FROM file_conflicts WHERE id = ? AND vendor_id = ?')
    .bind(conflictId, vendorId)
    .first<{
      id: string
      entity_type: string
      entity_id: string
      file_path: string
      local_content: string
      remote_content: string
    }>()

  if (!conflict) return

  let contentToWrite: string

  switch (resolution) {
    case 'keep_remote':
      // Remote version wins — just re-index from what's in storage
      contentToWrite = conflict.remote_content
      break
    case 'keep_local':
      // Local version wins — overwrite the file
      contentToWrite = conflict.local_content
      break
    case 'merge':
      // User-provided merged content
      if (!mergedContent) {
        throw new Error('Merged content is required for merge resolution')
      }
      contentToWrite = mergedContent
      break
  }

  // Write the resolved content
  const etag = await storage.write(conflict.file_path, contentToWrite)

  // Re-index the file
  const doc = parseMarkdown(contentToWrite)
  let entityId: string
  let cachedData: string

  if (conflict.entity_type === 'contact') {
    const contact = markdownToContact(doc, vendorId)
    entityId = contact.id
    cachedData = contactCachedData(contact)
  } else {
    const wedding = markdownToWedding(doc)
    entityId = wedding.id
    cachedData = weddingCachedData(wedding)
  }

  // Update index and mark conflict resolved (use batch for atomicity)
  await db.batch([
    db
      .prepare(
        `INSERT INTO file_index (vendor_id, entity_type, entity_id, file_path, etag, cached_data, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(vendor_id, file_path) DO UPDATE SET
           entity_id = excluded.entity_id,
           etag = excluded.etag,
           cached_data = excluded.cached_data,
           last_synced_at = datetime('now')`
      )
      .bind(vendorId, conflict.entity_type, entityId, conflict.file_path, etag, cachedData),
    db
      .prepare(
        `UPDATE file_conflicts SET status = 'resolved', resolved_at = datetime('now'), resolution = ?
         WHERE id = ?`
      )
      .bind(resolution, conflictId),
  ])
}

/**
 * List pending conflicts for a vendor.
 */
export async function listPendingConflicts(
  db: D1Database,
  vendorId: string
): Promise<
  {
    id: string
    entity_type: string
    entity_id: string
    file_path: string
    created_at: string
  }[]
> {
  const rows = await db
    .prepare(
      `SELECT id, entity_type, entity_id, file_path, created_at
       FROM file_conflicts
       WHERE vendor_id = ? AND status = 'pending'
       ORDER BY created_at DESC`
    )
    .bind(vendorId)
    .all<{
      id: string
      entity_type: string
      entity_id: string
      file_path: string
      created_at: string
    }>()

  return rows.results
}

/**
 * Rebuild the entire index for a vendor from scratch.
 * Deletes all existing index entries and re-scans storage.
 * Use when the index might be corrupt or after a migration.
 */
export async function rebuildIndex(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string
): Promise<SyncResult> {
  // Clear existing index
  await db
    .prepare('DELETE FROM file_index WHERE vendor_id = ?')
    .bind(vendorId)
    .run()

  // Full sync from scratch
  return syncVendor(storage, db, vendorId)
}

async function syncToWeddingsTable(
  db: D1Database,
  wedding: Wedding
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO weddings (
        id, title, date, time, duration_hours, location, location_lat, location_lng,
        status, ceremony_type, vendor_visibility, ceremony_location, reception_location,
        reception_time, getting_ready_location, getting_ready_time, getting_ready_1_label,
        getting_ready_2_location, getting_ready_2_label, getting_ready_2_time,
        portrait_location, portrait_time, timeline_notes, dress_code, guest_count,
        notes, created_by_user_id, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         date = excluded.date,
         time = excluded.time,
         duration_hours = excluded.duration_hours,
         location = excluded.location,
         location_lat = excluded.location_lat,
         location_lng = excluded.location_lng,
         status = excluded.status,
         ceremony_type = excluded.ceremony_type,
         vendor_visibility = excluded.vendor_visibility,
         ceremony_location = excluded.ceremony_location,
         reception_location = excluded.reception_location,
         reception_time = excluded.reception_time,
         getting_ready_location = excluded.getting_ready_location,
         getting_ready_time = excluded.getting_ready_time,
         getting_ready_1_label = excluded.getting_ready_1_label,
         getting_ready_2_location = excluded.getting_ready_2_location,
         getting_ready_2_label = excluded.getting_ready_2_label,
         getting_ready_2_time = excluded.getting_ready_2_time,
         portrait_location = excluded.portrait_location,
         portrait_time = excluded.portrait_time,
         timeline_notes = excluded.timeline_notes,
         dress_code = excluded.dress_code,
         guest_count = excluded.guest_count,
         notes = excluded.notes,
         updated_at = excluded.updated_at`
    )
    .bind(
      wedding.id,
      wedding.title,
      wedding.date,
      wedding.time,
      wedding.duration_hours,
      wedding.location,
      wedding.location_lat,
      wedding.location_lng,
      wedding.status,
      wedding.ceremony_type,
      wedding.vendor_visibility,
      wedding.ceremony_location,
      wedding.reception_location,
      wedding.reception_time,
      wedding.getting_ready_location,
      wedding.getting_ready_time,
      wedding.getting_ready_1_label,
      wedding.getting_ready_2_location,
      wedding.getting_ready_2_label,
      wedding.getting_ready_2_time,
      wedding.portrait_location,
      wedding.portrait_time,
      wedding.timeline_notes,
      wedding.dress_code,
      wedding.guest_count,
      wedding.notes,
      wedding.created_by_user_id,
      wedding.created_at,
      wedding.updated_at
    )
    .run()
}

async function ensureSyncedWeddingMembership(
  db: D1Database,
  vendorId: string,
  wedding: Wedding
): Promise<void> {
  const vendor = await db
    .prepare('SELECT user_id, category FROM vendor_profiles WHERE id = ?')
    .bind(vendorId)
    .first<{ user_id: string; category: string }>()

  if (!vendor?.user_id) return

  const existing = await db
    .prepare('SELECT id FROM wedding_members WHERE wedding_id = ? AND user_id = ?')
    .bind(wedding.id, vendor.user_id)
    .first<{ id: string }>()

  if (existing) return

  await db
    .prepare(
      `INSERT INTO wedding_members
        (wedding_id, user_id, role, vendor_profile_id, vendor_role, can_manage, is_financial_party, status, accepted_at)
       VALUES (?, ?, 'vendor', ?, ?, 1, 0, 'active', datetime('now'))`
    )
    .bind(wedding.id, vendor.user_id, vendorId, vendor.category ?? null)
    .run()
}
