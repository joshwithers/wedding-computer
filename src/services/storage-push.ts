/**
 * Shared push path: write a wedding's files (wedding.md, todo.md,
 * timeline.md, notes.md, vendors.md, log.md) to the vendor's storage
 * backend and keep the file_index in step so the sync engine
 * can tell what changed.
 *
 * Used by route handlers (after an edit, via executionCtx.waitUntil), the
 * 5-minute background sweep, and the manual "Sync all files now" button.
 *
 * Writes are skipped when the regenerated content matches what storage
 * already holds (git blob sha comparison), so repeated pushes don't
 * generate empty commits.
 */

import type { Bindings, RunSheetItem, VendorProfile, Wedding } from '../types'
import type { StorageBackend } from '../storage/types'
import { getStorageWithSecrets } from '../storage'
import { writeWeddingFile } from '../storage/weddings'
import { serializeMarkdown } from '../storage/markdown'
import { timelineToMarkdown } from '../storage/run-sheet-md'
import { timelineCachedData } from '../storage/sync'
import { gitBlobSha } from '../storage/etag'
import { getWeddingTodo } from '../db/todos'
import { exportWeddingLogMarkdown } from '../db/wedding-log'
import { exportWeddingVendorsMarkdown, vendorsCachedData } from '../db/wedding-vendors-export'
import { listRunSheetItems } from '../db/run-sheet'
import { listPendingTimelineRequests } from '../db/timeline-requests'
import { getVendorsDocContent } from '../db/wedding-docs'
import { listOwnedItemsAsRows, listVisibleOtherItemRows } from '../db/timeline'
import { vendorCanAccessWedding } from '../lib/wedding-access'

export type PushResult = {
  folder: string
  wrote: string[]      // files actually written this push
}

/** Safe storage getter — returns null if storage unavailable */
export async function tryGetStorage(
  env: Bindings,
  vendor: VendorProfile
): Promise<StorageBackend | null> {
  try {
    return await getStorageWithSecrets(env, vendor)
  } catch {
    return null
  }
}

/**
 * Push ALL of a wedding's files to a storage backend.
 * Throws if wedding.md cannot be written (todo/log are best-effort).
 */
export async function pushWeddingFiles(
  db: D1Database,
  storage: StorageBackend,
  vendorId: string,
  wedding: Wedding
): Promise<PushResult> {
  const wrote: string[] = []

  // 1. wedding.md — also handles folder rename if date/title changed.
  // writeWeddingFile itself skips no-op writes.
  const folder = await writeWeddingFile(storage, db, vendorId, wedding)

  // 2. todo.md — the checklist (if one exists)
  try {
    const todo = await getWeddingTodo(db, vendorId, wedding.id)
    if (todo) {
      const md = serializeMarkdown({
        frontmatter: {
          wedding: wedding.title,
          wedding_id: wedding.id,
          updated_at: todo.updated_at,
        },
        body: todo.content,
      })
      if (await writeCompanion(db, storage, vendorId, wedding.id, 'todo', folder + 'todo.md', md)) {
        wrote.push('todo.md')
      }
    }
  } catch (err: any) {
    console.error(`[storage] FAILED push todo.md ${wedding.id}:`, err.message)
  }

  // 3. timeline.md — the unified wedding timeline (own rows editable, rest
  // generated). Sourced from timeline_items, mapped to the run-sheet row shape
  // so the markdown format is byte-identical to before.
  try {
    const ownItems = await listOwnedItemsAsRows(db, wedding.id, vendorId)
    const others = await listVisibleOtherItemRows(db, wedding.id, vendorId)
    const pending = await listPendingTimelineRequests(db, wedding.id)
    const indexRow = await db
      .prepare(
        "SELECT id FROM file_index WHERE vendor_id = ? AND entity_type = 'timeline' AND entity_id = ?"
      )
      .bind(vendorId, wedding.id)
      .first()
    if (ownItems.length > 0 || others.length > 0 || pending.length > 0 || indexRow) {
      const md = timelineToMarkdown({
        wedding,
        ownItems,
        otherVendors: others,
        pendingRequests: pending,
        updatedAt: ownItems.reduce<string | null>(
          (max, i) => (max && max > i.updated_at ? max : i.updated_at),
          null
        ),
      })
      if (
        await writeCompanion(db, storage, vendorId, wedding.id, 'timeline', folder + 'timeline.md', md, null)
      ) {
        wrote.push('timeline.md')
      }
    }
  } catch (err: any) {
    console.error(`[storage] FAILED push timeline.md ${wedding.id}:`, err.message)
  }

  // 4. notes.md — this vendor's private notes for the wedding
  try {
    const membership = await db
      .prepare(
        `SELECT wm.vendor_notes FROM wedding_members wm
         JOIN vendor_profiles vp ON vp.user_id = wm.user_id
         WHERE wm.wedding_id = ? AND vp.id = ? AND wm.status = 'active'`
      )
      .bind(wedding.id, vendorId)
      .first<{ vendor_notes: string | null }>()
    const notesIndexRow = await db
      .prepare(
        "SELECT id FROM file_index WHERE vendor_id = ? AND entity_type = 'notes' AND entity_id = ?"
      )
      .bind(vendorId, wedding.id)
      .first()
    if (membership && (membership.vendor_notes || notesIndexRow)) {
      const body = membership.vendor_notes ?? ''
      const md = serializeMarkdown({
        frontmatter: { wedding: wedding.title, wedding_id: wedding.id, private: true },
        body,
      })
      const cached = JSON.stringify({ sha: await gitBlobSha(body) })
      if (
        await writeCompanion(db, storage, vendorId, wedding.id, 'notes', folder + 'notes.md', md, cached)
      ) {
        wrote.push('notes.md')
      }
    }
  } catch (err: any) {
    console.error(`[storage] FAILED push notes.md ${wedding.id}:`, err.message)
  }

  // 4b. team.md — the vendors-only collaborative doc (shared across vendors,
  // two-way; the couple never sees this file).
  try {
    const teamBody = await getVendorsDocContent(db, wedding.id)
    const teamIndexRow = await db
      .prepare(
        "SELECT id FROM file_index WHERE vendor_id = ? AND entity_type = 'doc' AND entity_id = ?"
      )
      .bind(vendorId, wedding.id)
      .first()
    if (teamBody || teamIndexRow) {
      const body = teamBody ?? ''
      const md = serializeMarkdown({
        frontmatter: { wedding: wedding.title, wedding_id: wedding.id, scope: 'vendors' },
        body,
      })
      const cached = JSON.stringify({ sha: await gitBlobSha(body) })
      if (
        await writeCompanion(db, storage, vendorId, wedding.id, 'doc', folder + 'team.md', md, cached)
      ) {
        wrote.push('team.md')
      }
    }
  } catch (err: any) {
    console.error(`[storage] FAILED push team.md ${wedding.id}:`, err.message)
  }

  // 5. vendors.md — the wedding team (generated, read-only)
  try {
    const md = await exportWeddingVendorsMarkdown(db, wedding, vendorId)
    const cached = await vendorsCachedData(db, wedding.id)
    if (
      await writeCompanion(db, storage, vendorId, wedding.id, 'vendors', folder + 'vendors.md', md, cached)
    ) {
      wrote.push('vendors.md')
    }
  } catch (err: any) {
    console.error(`[storage] FAILED push vendors.md ${wedding.id}:`, err.message)
  }

  // 6. log.md — the changelog
  try {
    const md = await exportWeddingLogMarkdown(db, wedding.id, wedding.title)
    if (md.split('\n').length > 2) {
      if (await writeCompanion(db, storage, vendorId, wedding.id, 'log', folder + 'log.md', md)) {
        wrote.push('log.md')
      }
    }
  } catch (err: any) {
    console.error(`[storage] FAILED push log.md ${wedding.id}:`, err.message)
  }

  return { folder, wrote }
}

/**
 * Other vendors' run sheet items, grouped per vendor — shown read-only in
 * timeline.md (and the MCP timeline tool) when the couple has made the
 * vendor list visible.
 */
export async function listOtherVendorItems(
  db: D1Database,
  wedding: Wedding,
  vendorId: string
): Promise<{ label: string; items: RunSheetItem[] }[]> {
  if (wedding.vendor_visibility !== 'visible') return []
  const rows = await db
    .prepare(
      `SELECT rsi.*, vp.business_name FROM run_sheet_items rsi
       JOIN vendor_profiles vp ON vp.id = rsi.vendor_id
       WHERE rsi.wedding_id = ? AND rsi.vendor_id != ?
       ORDER BY vp.business_name, rsi.sort_order ASC, rsi.time ASC`
    )
    .bind(wedding.id, vendorId)
    .all<RunSheetItem & { business_name: string | null }>()
    .then((r) => r.results)

  const groups = new Map<string, RunSheetItem[]>()
  for (const row of rows) {
    const label = row.business_name ?? 'Another vendor'
    const group = groups.get(label) ?? []
    group.push(row)
    groups.set(label, group)
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }))
}

/**
 * Route-facing wrapper: resolve storage + wedding, push everything.
 * Best-effort — never throws. Call inside executionCtx.waitUntil() so
 * the Workers runtime keeps it alive after the response is sent.
 */
export async function pushAllWeddingFiles(
  env: Bindings,
  vendor: VendorProfile,
  weddingId: string
): Promise<void> {
  const storage = await tryGetStorage(env, vendor)
  if (!storage) {
    console.log(`[storage] No storage backend for vendor ${vendor.id} (type=${vendor.storage_type ?? 'none'})`)
    return
  }

  if (!(await vendorCanAccessWedding(env.DB, vendor, weddingId))) {
    console.warn(`[storage] Refused wedding file push for non-member vendor ${vendor.id} wedding ${weddingId}`)
    return
  }

  const wedding = await env.DB
    .prepare('SELECT * FROM weddings WHERE id = ?')
    .bind(weddingId)
    .first<Wedding>()
  if (!wedding) return

  try {
    const result = await pushWeddingFiles(env.DB, storage, vendor.id, wedding)
    console.log(`[storage] Pushed wedding files ${weddingId} → ${result.folder} (${result.wrote.join(', ') || 'no changes'})`)
  } catch (err: any) {
    console.error(`[storage] FAILED push wedding.md ${weddingId}:`, err.message)
  }
}

/**
 * Write a companion file (todo.md, timeline.md, notes.md, vendors.md,
 * log.md), skipping no-ops and keeping file_index current. Returns true
 * when a write actually happened.
 */
async function writeCompanion(
  db: D1Database,
  storage: StorageBackend,
  vendorId: string,
  weddingId: string,
  entityType: 'todo' | 'log' | 'timeline' | 'notes' | 'vendors' | 'doc',
  path: string,
  content: string,
  cachedData: string | null = null
): Promise<boolean> {
  const indexRow = await db
    .prepare(
      'SELECT file_path, etag, cached_data FROM file_index WHERE vendor_id = ? AND entity_type = ? AND entity_id = ?'
    )
    .bind(vendorId, entityType, weddingId)
    .first<{ file_path: string; etag: string; cached_data: string | null }>()

  const contentSha = await gitBlobSha(content)
  if (indexRow && indexRow.file_path === path && indexRow.etag === contentSha) {
    // Unchanged — skip the write, but refresh the change-detection
    // snapshot so the sweep stops flagging this file as stale.
    if ((indexRow.cached_data ?? null) !== (cachedData ?? null)) {
      await db
        .prepare('UPDATE file_index SET cached_data = ? WHERE vendor_id = ? AND file_path = ?')
        .bind(cachedData, vendorId, path)
        .run()
    }
    return false
  }

  const etag = await storage.write(path, content)

  // If the file moved (folder rename outside writeWeddingFile's pass),
  // drop the old row so UNIQUE(vendor_id, file_path) stays clean.
  if (indexRow && indexRow.file_path !== path) {
    await db
      .prepare('DELETE FROM file_index WHERE vendor_id = ? AND file_path = ?')
      .bind(vendorId, indexRow.file_path)
      .run()
  }

  await db
    .prepare(
      `INSERT INTO file_index (vendor_id, entity_type, entity_id, file_path, etag, cached_data, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(vendor_id, file_path) DO UPDATE SET
         entity_type = excluded.entity_type,
         entity_id = excluded.entity_id,
         etag = excluded.etag,
         cached_data = excluded.cached_data,
         last_synced_at = datetime('now')`
    )
    .bind(vendorId, entityType, weddingId, path, etag, cachedData)
    .run()

  return true
}
