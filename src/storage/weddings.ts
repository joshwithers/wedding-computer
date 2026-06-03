/**
 * Wedding markdown format and data access layer.
 *
 * Weddings are stored as markdown files in the owner
 * vendor's storage:
 *   vendors/{vendor_id}/weddings/sarah-james-2026-12-15.md
 *
 * Weddings are multi-party entities: couples and other vendors
 * access them through the web app, but the canonical file
 * lives in the creating vendor's storage.
 *
 * D1 remains the primary query path for weddings (joins with
 * wedding_members, invoices, etc.), with the markdown file
 * as the portable, human-editable representation.
 */

import type { Wedding } from '../types'
import type { StorageBackend, MarkdownDocument } from './types'
import { parseMarkdown, serializeMarkdown } from './markdown'
import { weddingFilename, deduplicateFilename } from './slug'

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
  dress_code?: string | null
  guest_count?: number | null
  timeline_notes?: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
}

/** Directory within a vendor's storage */
const WEDDINGS_DIR = 'weddings/'

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
    date: fm.date ?? null,
    time: fm.time ?? null,
    duration_hours: fm.duration_hours ?? null,
    location: fm.location ?? null,
    location_lat: fm.location_lat ?? null,
    location_lng: fm.location_lng ?? null,
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
    dress_code: fm.dress_code ?? null,
    guest_count: fm.guest_count ?? null,
    timeline_notes: fm.timeline_notes ?? null,
    notes: doc.body || null,
    created_by_user_id: fm.created_by_user_id ?? '',
    created_at: fm.created_at ?? new Date().toISOString(),
    updated_at: fm.updated_at ?? new Date().toISOString(),
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
 * Called after creating/updating a wedding in D1.
 */
export async function writeWeddingFile(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string,
  wedding: Wedding
): Promise<void> {
  // Check if this wedding already has a file
  const indexRow = await db
    .prepare(
      'SELECT file_path FROM file_index WHERE vendor_id = ? AND entity_type = ? AND entity_id = ?'
    )
    .bind(vendorId, 'wedding', wedding.id)
    .first<{ file_path: string }>()

  let filePath: string
  if (indexRow) {
    filePath = indexRow.file_path
  } else {
    // Generate a new filename
    const desiredFilename = weddingFilename(wedding.title, wedding.date)
    const existing = await listExistingFilenames(storage)
    const filename = deduplicateFilename(desiredFilename, existing)
    filePath = WEDDINGS_DIR + filename
  }

  const doc = weddingToMarkdown(wedding)
  const content = serializeMarkdown(doc)
  const isNewFile = !indexRow
  const etag = await storage.write(filePath, content)

  // Update file index. If this fails on a new file, clean up the orphaned R2 file.
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
  } catch (err) {
    if (isNewFile) {
      try { await storage.delete(filePath) } catch { /* orphan is acceptable */ }
    }
    throw err
  }
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
    // Delete D1 index first, then storage file.
    // If storage delete fails, orphaned file is harmless and
    // cleaned up on next sync. The reverse would leave a dangling index.
    await db
      .prepare(
        'DELETE FROM file_index WHERE vendor_id = ? AND entity_type = ? AND entity_id = ?'
      )
      .bind(vendorId, 'wedding', weddingId)
      .run()
    try {
      await storage.delete(indexRow.file_path)
    } catch (err) {
      console.error(`[weddings] Failed to delete file ${indexRow.file_path}, orphaned:`, err)
    }
  }
}

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

async function listExistingFilenames(
  storage: StorageBackend
): Promise<Set<string>> {
  const result = await storage.list(WEDDINGS_DIR)
  return new Set(
    result.files.map((f) => f.path.slice(WEDDINGS_DIR.length))
  )
}
