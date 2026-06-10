/**
 * Shared push path: write a wedding's files (wedding.md, todo.md, log.md)
 * to the vendor's storage backend (GitHub/R2) and keep the file_index in
 * step so the sync engine can tell what changed.
 *
 * Used by route handlers (after an edit, via executionCtx.waitUntil), the
 * 5-minute background sweep, and the manual "Sync all files now" button.
 *
 * Writes are skipped when the regenerated content matches what storage
 * already holds (git blob sha comparison), so repeated pushes don't
 * generate empty commits.
 */

import type { Bindings, VendorProfile, Wedding } from '../types'
import type { StorageBackend } from '../storage/types'
import { getStorageWithSecrets } from '../storage'
import { writeWeddingFile } from '../storage/weddings'
import { serializeMarkdown } from '../storage/markdown'
import { gitBlobSha } from '../storage/etag'
import { getWeddingTodo } from '../db/todos'
import { exportWeddingLogMarkdown } from '../db/wedding-log'

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

  // 3. log.md — the changelog
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
 * Write todo.md or log.md, skipping no-ops and keeping file_index
 * current. Returns true when a write actually happened.
 */
async function writeCompanion(
  db: D1Database,
  storage: StorageBackend,
  vendorId: string,
  weddingId: string,
  entityType: 'todo' | 'log',
  path: string,
  content: string
): Promise<boolean> {
  const indexRow = await db
    .prepare(
      'SELECT file_path, etag FROM file_index WHERE vendor_id = ? AND entity_type = ? AND entity_id = ?'
    )
    .bind(vendorId, entityType, weddingId)
    .first<{ file_path: string; etag: string }>()

  const contentSha = await gitBlobSha(content)
  if (indexRow && indexRow.file_path === path && indexRow.etag === contentSha) {
    return false // unchanged — skip the write entirely
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
       VALUES (?, ?, ?, ?, ?, NULL, datetime('now'))
       ON CONFLICT(vendor_id, file_path) DO UPDATE SET
         entity_type = excluded.entity_type,
         entity_id = excluded.entity_id,
         etag = excluded.etag,
         last_synced_at = datetime('now')`
    )
    .bind(vendorId, entityType, weddingId, path, etag)
    .run()

  return true
}
