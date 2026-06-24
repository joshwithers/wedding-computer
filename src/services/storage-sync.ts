/**
 * Background storage repair.
 *
 * GitHub sync is disabled for launch. The queue now exists to materialise
 * historical D1-only contacts and weddings into the canonical R2 markdown
 * store, including legacy profiles whose storage_type is still "git".
 */

import type { Bindings, VendorProfile } from '../types'
import { getStorageWithSecrets } from '../storage'
import { repairVendorStorage } from './storage-repair'

type SyncSummary = {
  vendorsChecked: number
  pulled: number
  contactsSynced: number
  weddingsSynced: number
  errors: number
}

export async function syncStorageBackground(env: Bindings): Promise<SyncSummary> {
  const summary: SyncSummary = { vendorsChecked: 0, pulled: 0, contactsSynced: 0, weddingsSynced: 0, errors: 0 }

  const vendors = await env.DB
    .prepare(
      `SELECT DISTINCT vp.*
       FROM vendor_profiles vp
       WHERE vp.storage_type = 'git'
          OR EXISTS (
            SELECT 1
            FROM contacts c
            LEFT JOIN file_index fi
              ON fi.vendor_id = c.vendor_id
             AND fi.entity_type = 'contact'
             AND fi.entity_id = c.id
            WHERE c.vendor_id = vp.id AND fi.id IS NULL
          )
          OR EXISTS (
            SELECT 1
            FROM weddings w
            JOIN wedding_members wm ON wm.wedding_id = w.id
            LEFT JOIN file_index fi
              ON fi.vendor_id = vp.id
             AND fi.entity_type = 'wedding'
             AND fi.entity_id = w.id
            WHERE wm.user_id = vp.user_id
              AND wm.status = 'active'
              AND fi.id IS NULL
          )`
    )
    .all<VendorProfile>()
    .then((r) => r.results)

  for (const vendor of vendors) {
    summary.vendorsChecked++
    const result = await syncVendorStorage(env, vendor)
    summary.pulled += result.pulled
    summary.contactsSynced += result.contactsSynced
    summary.weddingsSynced += result.weddingsSynced
    summary.errors += result.errors
  }

  return summary
}

const SYNC_LOCK_TTL_SECONDS = 120

export async function syncVendorStorage(
  env: Bindings,
  vendor: VendorProfile
): Promise<Omit<SyncSummary, 'vendorsChecked'>> {
  const result = { pulled: 0, contactsSynced: 0, weddingsSynced: 0, errors: 0 }

  const lockKey = `synclock:${vendor.id}`
  if (await env.KV.get(lockKey)) {
    return result
  }
  await env.KV.put(lockKey, '1', { expirationTtl: SYNC_LOCK_TTL_SECONDS })

  try {
    let storage
    try {
      storage = await getStorageWithSecrets(env, vendor)
    } catch {
      return result
    }

    const repaired = await repairVendorStorage(env, vendor, { storage })
    result.contactsSynced += repaired.contactsMigrated + repaired.contactsRewritten
    result.weddingsSynced += repaired.weddingsPushed
    result.errors += repaired.contactErrors + repaired.weddingErrors
    return result
  } finally {
    await env.KV.delete(lockKey).catch(() => {})
  }
}
