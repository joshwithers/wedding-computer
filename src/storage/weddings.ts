/**
 * Wedding markdown format and data access layer.
 *
 * Each wedding gets its own folder in the vendor's storage:
 *   weddings/2026-07-12-sarah-james/
 *     wedding.md    ← wedding details + shared notes
 *     todo.md       ← checklist (written by checklists route)
 *     timeline.md   ← run sheet (own rows two-way editable)
 *     notes.md      ← this vendor's private notes (two-way)
 *     vendors.md    ← wedding team (generated, read-only)
 *     log.md        ← changelog (generated, read-only)
 *     files/        ← uploaded documents and images
 *
 * D1 remains the primary query path for weddings (joins with
 * wedding_members, invoices, etc.), with the markdown file
 * as the portable, human-editable representation.
 */

import type { Wedding } from '../types'
import type { StorageBackend, MarkdownDocument } from './types'
import { parseMarkdown, serializeMarkdown } from './markdown'
import { weddingFolderName, slugify } from './slug'
import { recordWriteConflict } from './conflicts'
import { gitBlobSha } from './etag'
import { validDateOrNull } from '../lib/validation'

/** Frontmatter fields for a wedding markdown file */
type WeddingFrontmatter = {
  id: string
  title: string
  date?: string | null
  time?: string | null
  duration_hours?: number | null
  location?: string | null
  location_lat?: number | null
  location_lng?: number | null
  status: string
  ceremony_type?: string | null
  vendor_visibility?: string | null
  ceremony_location?: string | null
  reception_location?: string | null
  reception_time?: string | null
  getting_ready_location?: string | null
  getting_ready_time?: string | null
  getting_ready_1_label?: string | null
  getting_ready_2_location?: string | null
  getting_ready_2_label?: string | null
  getting_ready_2_time?: string | null
  portrait_location?: string | null
  portrait_time?: string | null
  emoji?: string | null
  reception_duration_hours?: number | null
  dress_code?: string | null
  guest_count?: number | null
  timeline_notes?: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
}

/** Top-level directory for all wedding folders */
const WEDDINGS_DIR = 'weddings/'

/** Build the folder path for a wedding: weddings/2026-07-12-sarah-james/ */
export function weddingFolder(title: string, date?: string | null): string {
  return WEDDINGS_DIR + weddingFolderName(title, date) + '/'
}

// ────────────────────────────────────────────
// Serialization: Wedding ↔ Markdown
// ────────────────────────────────────────────

/**
 * Convert a Wedding to a markdown document.
 * Notes become the body; structured fields go in frontmatter.
 */
export function weddingToMarkdown(wedding: Wedding): MarkdownDocument<WeddingFrontmatter> {
  const frontmatter: WeddingFrontmatter = {
    id: wedding.id,
    title: wedding.title,
    date: wedding.date,
    time: wedding.time,
    duration_hours: wedding.duration_hours,
    location: wedding.location,
    location_lat: wedding.location_lat,
    location_lng: wedding.location_lng,
    status: wedding.status,
    ceremony_type: wedding.ceremony_type,
    vendor_visibility: wedding.vendor_visibility,
    ceremony_location: wedding.ceremony_location,
    reception_location: wedding.reception_location,
    reception_time: wedding.reception_time,
    getting_ready_location: wedding.getting_ready_location,
    getting_ready_time: wedding.getting_ready_time,
    getting_ready_1_label: wedding.getting_ready_1_label,
    getting_ready_2_location: wedding.getting_ready_2_location,
    getting_ready_2_label: wedding.getting_ready_2_label,
    getting_ready_2_time: wedding.getting_ready_2_time,
    portrait_location: wedding.portrait_location,
    portrait_time: wedding.portrait_time,
    emoji: wedding.emoji,
    // Bump in/out times are per-vendor (wedding_members) since migration
    // 026 and are exported in vendors.md, not here.
    reception_duration_hours: wedding.reception_duration_hours,
    dress_code: wedding.dress_code,
    guest_count: wedding.guest_count,
    timeline_notes: wedding.timeline_notes,
    created_by_user_id: wedding.created_by_user_id,
    created_at: wedding.created_at,
    updated_at: wedding.updated_at,
  }

  return {
    frontmatter,
    body: wedding.notes ?? '',
  }
}

/**
 * Parse a markdown document back into a Wedding.
 *
 * Accepts the generic MarkdownDocument type so the sync engine
 * can pass parsed files without knowing the frontmatter shape.
 *
 * Throws if the frontmatter is missing a required `id` field.
 */
export function markdownToWedding(
  doc: MarkdownDocument
): Wedding {
  const fm = doc.frontmatter as WeddingFrontmatter

  if (!fm.id || typeof fm.id !== 'string') {
    throw new Error('Wedding markdown is missing a required "id" field in frontmatter')
  }

  return {
    id: fm.id,
    title: fm.title ?? '',
    date: validDateOrNull(fm.date),
    time: fm.time ?? null,
    duration_hours: fm.duration_hours ?? null,
    location: fm.location ?? null,
    location_lat: fm.location_lat ?? null,
    location_lng: fm.location_lng ?? null,
    // Derived region columns live in the D1 index (geocoded), not the markdown.
    location_city: null,
    location_state: null,
    location_country: null,
    status: (fm.status as Wedding['status']) ?? 'planning',
    ceremony_type: fm.ceremony_type ?? null,
    vendor_visibility: (fm.vendor_visibility as Wedding['vendor_visibility']) ?? 'private',
    ceremony_location: fm.ceremony_location ?? null,
    reception_location: fm.reception_location ?? null,
    reception_time: fm.reception_time ?? null,
    getting_ready_location: fm.getting_ready_location ?? null,
    getting_ready_time: fm.getting_ready_time ?? null,
    getting_ready_1_label: fm.getting_ready_1_label ?? null,
    getting_ready_2_location: fm.getting_ready_2_location ?? null,
    getting_ready_2_label: fm.getting_ready_2_label ?? null,
    getting_ready_2_time: fm.getting_ready_2_time ?? null,
    portrait_location: fm.portrait_location ?? null,
    portrait_time: fm.portrait_time ?? null,
    emoji: fm.emoji ?? null,
    reception_duration_hours: fm.reception_duration_hours ?? null,
    dress_code: fm.dress_code ?? null,
    guest_count: fm.guest_count ?? null,
    timeline_notes: fm.timeline_notes ?? null,
    notes: doc.body || null,
    created_by_user_id: fm.created_by_user_id ?? '',
    created_at: fm.created_at ?? new Date().toISOString(),
    updated_at: fm.updated_at ?? new Date().toISOString(),
    // Lifecycle state is operational (D1), not vault markdown — defaults here.
    confirmed_at: null,
    completed_at: null,
    cancelled_at: null,
    postponed_at: null,
    cancellation_reason: null,
    cancellation_note: null,
    original_date: null,
  }
}

/**
 * Extract key fields for the D1 index cache.
 */
export function weddingCachedData(wedding: Wedding): string {
  return JSON.stringify({
    title: wedding.title,
    date: wedding.date,
    time: wedding.time,
    location: wedding.location,
    status: wedding.status,
    ceremony_type: wedding.ceremony_type,
    guest_count: wedding.guest_count,
    created_at: wedding.created_at,
    updated_at: wedding.updated_at,
  })
}

// ────────────────────────────────────────────
// File operations
// ────────────────────────────────────────────

/**
 * Write a wedding to storage as a markdown file.
 * Handles folder renames when date or title changes.
 *
 * Returns the resolved folder path so callers (pushAllWeddingFiles)
 * can write todo.md and log.md to the same location.
 */
export async function writeWeddingFile(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string,
  wedding: Wedding
): Promise<string> {
  // Check if this wedding already has a file
  const indexRow = await db
    .prepare(
      'SELECT file_path, etag FROM file_index WHERE vendor_id = ? AND entity_type = ? AND entity_id = ?'
    )
    .bind(vendorId, 'wedding', wedding.id)
    .first<{ file_path: string; etag: string }>()

  const desiredFolder = await resolveWeddingFolder(storage, db, vendorId, wedding, indexRow?.file_path)
  const desiredPath = desiredFolder + 'wedding.md'

  const doc = weddingToMarkdown(wedding)
  const content = serializeMarkdown(doc)

  if (!indexRow) {
    // ── New wedding: write to desired path ──
    const etag = await storage.write(desiredPath, content)
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
        .bind(vendorId, wedding.id, desiredPath, etag, weddingCachedData(wedding))
        .run()
    } catch (err) {
      try { await storage.delete(desiredPath) } catch { /* orphan ok */ }
      throw err
    }
    return desiredFolder
  }

  const oldPath = indexRow.file_path
  const oldFolder = oldPath.substring(0, oldPath.lastIndexOf('/') + 1)

  // No-op guard: if the content matches what we last synced and the
  // folder is unchanged, there is nothing to write. This keeps the
  // 5-minute background sweep and webhook round-trips from generating
  // empty commits. (Only ever matches for git backends — R2 etags use
  // a different scheme and fall through to a normal write.)
  if (oldFolder === desiredFolder) {
    const contentSha = await gitBlobSha(content)
    if (contentSha === indexRow.etag) {
      const stillExists = await storage.head(oldPath).catch(() => null)
      if (stillExists) return oldFolder
    }
  }

  const remoteFile = await storage.read(oldPath)
  if (remoteFile && remoteFile.meta.etag !== indexRow.etag) {
    await recordWriteConflict(
      db,
      vendorId,
      'wedding',
      wedding.id,
      oldPath,
      content,
      remoteFile.content,
      indexRow.etag,
      remoteFile.meta.etag
    )
  }

  if (oldFolder === desiredFolder) {
    // ── Same folder: just update wedding.md in place ──
    // We just read the current version above for the conflict check, so hand
    // its sha to write() to skip the backend's redundant pre-write lookup.
    const etag = await storage.write(oldPath, content, remoteFile?.meta.etag)
    await db
      .prepare(
        `UPDATE file_index SET etag = ?, cached_data = ?, last_synced_at = datetime('now')
         WHERE vendor_id = ? AND entity_type = 'wedding' AND entity_id = ?`
      )
      .bind(etag, weddingCachedData(wedding), vendorId, wedding.id)
      .run()
    return oldFolder
  }

  // ── Folder changed (date or title changed): move all files ──
  console.log(`[storage] Renaming wedding folder: ${oldFolder} → ${desiredFolder}`)

  // 1. Write wedding.md to the new folder
  const etag = await storage.write(desiredPath, content)

  // 2. Move companion files — best-effort
  for (const companion of ['todo.md', 'timeline.md', 'notes.md', 'vendors.md', 'log.md']) {
    try {
      const oldCompanion = await storage.read(oldFolder + companion)
      if (oldCompanion) {
        const newEtag = await storage.write(desiredFolder + companion, oldCompanion.content)
        await storage.delete(oldFolder + companion)
        // Keep the sync index pointing at the new location
        await db
          .prepare(
            `UPDATE file_index SET file_path = ?, etag = ?, last_synced_at = datetime('now')
             WHERE vendor_id = ? AND file_path = ?`
          )
          .bind(desiredFolder + companion, newEtag, vendorId, oldFolder + companion)
          .run()
      }
    } catch { /* non-fatal: companion files are regenerated on next push */ }
  }

  // 3. Move uploaded files — list and relocate
  try {
    const oldFiles = await storage.list(oldFolder + 'files/')
    for (const f of oldFiles.files) {
      try {
        const filename = f.path.split('/').pop()
        if (!filename) continue
        await storage.move(f.path, desiredFolder + 'files/' + filename)
      } catch { /* best-effort per file */ }
    }
  } catch { /* files dir may not exist */ }

  // 4. Update D1 index atomically — point to new path
  try {
    await db.batch([
      db.prepare(
        'DELETE FROM file_index WHERE vendor_id = ? AND entity_type = ? AND entity_id = ?'
      ).bind(vendorId, 'wedding', wedding.id),
      db.prepare(
        `INSERT INTO file_index (vendor_id, entity_type, entity_id, file_path, etag, cached_data, last_synced_at)
         VALUES (?, 'wedding', ?, ?, ?, ?, datetime('now'))`
      ).bind(vendorId, wedding.id, desiredPath, etag, weddingCachedData(wedding)),
    ])
  } catch (err) {
    // D1 failed — clean up new file, old file + index still valid
    try { await storage.delete(desiredPath) } catch { /* orphan ok */ }
    throw err
  }

  // 5. Delete old wedding.md — D1 is already updated, safe to clean up
  try { await storage.delete(oldPath) } catch { /* orphaned old file is acceptable */ }

  // 6. Clean up the pre-folder flat file (weddings/<title-slug>.md) if
  // one is still lying around from the legacy format
  try { await cleanupLegacyWeddingFile(storage, wedding) } catch { /* best effort */ }

  return desiredFolder
}

async function resolveWeddingFolder(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string,
  wedding: Wedding,
  currentPath?: string
): Promise<string> {
  const baseName = weddingFolderName(wedding.title, wedding.date)

  let suffix = 1
  while (true) {
    const folderName = suffix === 1 ? baseName : `${baseName}-${suffix}`
    const folder = WEDDINGS_DIR + folderName + '/'
    const path = folder + 'wedding.md'

    const owner = await db
      .prepare('SELECT entity_id FROM file_index WHERE vendor_id = ? AND entity_type = ? AND file_path = ?')
      .bind(vendorId, 'wedding', path)
      .first<{ entity_id: string }>()

    if (!owner || owner.entity_id === wedding.id) {
      if (path === currentPath || !(await storage.head(path).catch(() => null))) {
        return folder
      }
    }

    suffix++
  }
}

/**
 * Delete the legacy flat-format file (weddings/<title-slug>.md) for a
 * wedding, if it exists and actually belongs to this wedding. These
 * files predate the folder layout and confuse anyone browsing the repo
 * because they show stale data.
 */
export async function cleanupLegacyWeddingFile(
  storage: StorageBackend,
  wedding: Wedding
): Promise<boolean> {
  const legacyPath = WEDDINGS_DIR + slugify(wedding.title) + '.md'
  const file = await storage.read(legacyPath)
  if (!file) return false

  // Only delete when the frontmatter id matches — never touch a file we
  // cannot positively identify as this wedding's old copy.
  try {
    const doc = parseMarkdown(file.content)
    if (doc.frontmatter.id !== wedding.id) return false
  } catch {
    return false
  }

  await storage.delete(legacyPath)
  console.log(`[storage] Removed legacy flat file ${legacyPath}`)
  return true
}

/**
 * Read a wedding from its markdown file.
 * Used by the sync engine to detect external changes.
 */
export async function readWeddingFile(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string,
  weddingId: string
): Promise<{ wedding: Wedding; etag: string; filePath: string } | null> {
  const indexRow = await db
    .prepare(
      'SELECT file_path, etag FROM file_index WHERE vendor_id = ? AND entity_type = ? AND entity_id = ?'
    )
    .bind(vendorId, 'wedding', weddingId)
    .first<{ file_path: string; etag: string }>()

  if (!indexRow) return null

  const file = await storage.read(indexRow.file_path)
  if (!file) {
    // File was deleted externally — clean up the stale index entry
    console.error(`[weddings] Stale index: ${indexRow.file_path} missing from storage, removing index`)
    try {
      await db
        .prepare('DELETE FROM file_index WHERE vendor_id = ? AND entity_type = ? AND entity_id = ?')
        .bind(vendorId, 'wedding', weddingId)
        .run()
    } catch { /* best effort */ }
    return null
  }

  const doc = parseMarkdown<WeddingFrontmatter>(file.content)
  const wedding = markdownToWedding(doc)

  return {
    wedding,
    etag: file.meta.etag,
    filePath: indexRow.file_path,
  }
}

/**
 * Delete a wedding's markdown file and index row.
 */
export async function deleteWeddingFile(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string,
  weddingId: string
): Promise<void> {
  const indexRow = await db
    .prepare(
      'SELECT file_path FROM file_index WHERE vendor_id = ? AND entity_type = ? AND entity_id = ?'
    )
    .bind(vendorId, 'wedding', weddingId)
    .first<{ file_path: string }>()

  if (indexRow) {
    // Delete D1 index first, then storage files.
    // If a storage delete fails, the orphaned file is harmless and
    // cleaned up on next sync. The reverse would leave a dangling index.
    await db
      .prepare(
        "DELETE FROM file_index WHERE vendor_id = ? AND entity_type IN ('wedding', 'todo', 'timeline', 'notes', 'vendors', 'log', 'doc') AND entity_id = ?"
      )
      .bind(vendorId, weddingId)
      .run()
    const folder = indexRow.file_path.substring(0, indexRow.file_path.lastIndexOf('/') + 1)
    for (const path of [
      indexRow.file_path,
      folder + 'todo.md',
      folder + 'timeline.md',
      folder + 'notes.md',
      folder + 'vendors.md',
      folder + 'team.md',
      folder + 'log.md',
    ]) {
      try {
        await storage.delete(path)
      } catch (err) {
        console.error(`[weddings] Failed to delete file ${path}, orphaned:`, err)
      }
    }
  }
}

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

async function listExistingFolders(
  storage: StorageBackend
): Promise<Set<string>> {
  const result = await storage.list(WEDDINGS_DIR)
  // Extract folder names from paths like "weddings/2026-07-12-sarah-james/wedding.md"
  const folders = new Set<string>()
  for (const f of result.files) {
    const rel = f.path.slice(WEDDINGS_DIR.length)
    const slashIdx = rel.indexOf('/')
    if (slashIdx > 0) folders.add(rel.slice(0, slashIdx))
  }
  return folders
}
