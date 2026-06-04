/**
 * Background storage sync — runs every 5 minutes via cron.
 *
 * Finds weddings that have been updated since their last storage push
 * and syncs all files (wedding.md, todo.md, log.md) to the vendor's
 * storage backend (GitHub/R2).
 *
 * Only processes vendors with storage_type = 'git' (R2 vendors don't
 * need background sync since R2 writes are immediate and reliable).
 */

import type { Bindings, VendorProfile, Wedding } from '../types'
import { getStorage } from '../storage'
import { writeWeddingFile, weddingFolder } from '../storage/weddings'
import { exportWeddingLogMarkdown } from '../db/wedding-log'
import { getWeddingTodo } from '../db/todos'

type SyncResult = {
  vendorsChecked: number
  weddingsSynced: number
  errors: number
}

export async function syncStorageBackground(env: Bindings): Promise<SyncResult> {
  const result: SyncResult = { vendorsChecked: 0, weddingsSynced: 0, errors: 0 }

  // Find all vendors with git storage configured
  const vendors = await env.DB
    .prepare(
      `SELECT * FROM vendor_profiles WHERE storage_type = 'git' AND storage_config IS NOT NULL`
    )
    .all<VendorProfile>()
    .then((r) => r.results)

  for (const vendor of vendors) {
    result.vendorsChecked++

    let storage
    try {
      storage = getStorage(env, vendor)
    } catch {
      continue // skip vendors with broken config
    }

    // Find weddings that need syncing:
    // 1. No file_index entry at all (never been pushed)
    // 2. Wedding updated_at is newer than file_index last_synced_at
    const staleWeddings = await env.DB
      .prepare(
        `SELECT w.* FROM weddings w
         JOIN wedding_members wm ON wm.wedding_id = w.id
         WHERE wm.user_id = (SELECT user_id FROM vendor_profiles WHERE id = ?)
           AND wm.status = 'active'
           AND w.status IN ('planning', 'confirmed')
           AND (
             NOT EXISTS (
               SELECT 1 FROM file_index fi
               WHERE fi.vendor_id = ? AND fi.entity_type = 'wedding' AND fi.entity_id = w.id
             )
             OR w.updated_at > (
               SELECT fi.last_synced_at FROM file_index fi
               WHERE fi.vendor_id = ? AND fi.entity_type = 'wedding' AND fi.entity_id = w.id
             )
           )
         ORDER BY w.updated_at DESC
         LIMIT 10`
      )
      .bind(vendor.id, vendor.id, vendor.id)
      .all<Wedding>()
      .then((r) => r.results)

    for (const wedding of staleWeddings) {
      try {
        const folder = weddingFolder(wedding.title, wedding.date)

        // 1. wedding.md
        await writeWeddingFile(storage, env.DB, vendor.id, wedding)

        // 2. todo.md
        try {
          const todo = await getWeddingTodo(env.DB, vendor.id, wedding.id)
          if (todo) {
            const now = new Date().toISOString()
            const md = `---\nwedding: ${wedding.title}\nwedding_id: ${wedding.id}\nupdated_at: ${now}\n---\n\n${todo.content}\n`
            await storage.write(`${folder}todo.md`, md)
          }
        } catch { /* non-fatal */ }

        // 3. log.md
        try {
          const logMd = await exportWeddingLogMarkdown(env.DB, wedding.id, wedding.title)
          if (logMd.split('\n').length > 2) {
            await storage.write(`${folder}log.md`, logMd)
          }
        } catch { /* non-fatal */ }

        result.weddingsSynced++
      } catch (err: any) {
        console.error(`[sync] Failed to sync wedding ${wedding.id} for vendor ${vendor.id}:`, err.message)
        result.errors++
      }
    }
  }

  return result
}
