import type { Bindings, VendorProfile, Wedding } from '../types'
import type { StorageBackend } from '../storage/types'
import { getStorageWithSecrets } from '../storage'
import { needsMigration, repairContacts } from '../storage/migrate'
import { pushWeddingFiles } from './storage-push'

export type StorageRepairResult = {
  contactsMigrated: number
  contactsRewritten: number
  contactsSkipped: number
  contactErrors: number
  weddingsPushed: number
  weddingErrors: number
}

type RepairOptions = {
  storage?: StorageBackend
  contactLimit?: number
  weddingLimit?: number
  verifyIndexedContacts?: boolean
  includeIndexedWeddings?: boolean
}

const DEFAULT_CONTACT_REPAIR_LIMIT = 20
const DEFAULT_WEDDING_REPAIR_LIMIT = 10

export async function repairVendorStorage(
  env: Bindings,
  vendor: VendorProfile,
  options: RepairOptions = {}
): Promise<StorageRepairResult> {
  const result: StorageRepairResult = {
    contactsMigrated: 0,
    contactsRewritten: 0,
    contactsSkipped: 0,
    contactErrors: 0,
    weddingsPushed: 0,
    weddingErrors: 0,
  }

  const storage = options.storage ?? await getStorageWithSecrets(env, vendor)
  const legacyGitProfile = vendor.storage_type === 'git'
  const verifyIndexedContacts = options.verifyIndexedContacts ?? legacyGitProfile
  const includeIndexedWeddings = options.includeIndexedWeddings ?? legacyGitProfile

  if (verifyIndexedContacts || await needsMigration(env.DB, vendor.id)) {
    const contacts = await repairContacts(storage, env.DB, vendor.id, {
      limit: options.contactLimit ?? DEFAULT_CONTACT_REPAIR_LIMIT,
      verifyIndexedFiles: verifyIndexedContacts,
    })
    result.contactsMigrated = contacts.migrated
    result.contactsRewritten = contacts.rewritten
    result.contactsSkipped = contacts.skipped
    result.contactErrors = contacts.errors
  }

  const weddingLimit = options.weddingLimit ?? DEFAULT_WEDDING_REPAIR_LIMIT
  if (weddingLimit <= 0) return result

  const weddings = await repairableWeddings(env.DB, vendor, weddingLimit, includeIndexedWeddings)
  for (const wedding of weddings) {
    try {
      await pushWeddingFiles(env.DB, storage, vendor.id, wedding)
      result.weddingsPushed++
    } catch (err: any) {
      console.error(`[storage-repair] Failed to repair wedding ${wedding.id} for vendor ${vendor.id}:`, err?.message ?? err)
      result.weddingErrors++
    }
  }

  return result
}

async function repairableWeddings(
  db: D1Database,
  vendor: VendorProfile,
  limit: number,
  includeIndexed: boolean
): Promise<Wedding[]> {
  const rows = await db
    .prepare(
      `SELECT w.*
       FROM weddings w
       JOIN wedding_members wm ON wm.wedding_id = w.id
       LEFT JOIN file_index fi
         ON fi.vendor_id = ?1
        AND fi.entity_type = 'wedding'
        AND fi.entity_id = w.id
       WHERE wm.user_id = ?2
         AND wm.status = 'active'
         AND (
           ?4 = 1
           OR
           fi.id IS NULL
           OR w.updated_at > COALESCE(fi.last_synced_at, '')
         )
       ORDER BY
         CASE WHEN fi.id IS NULL THEN 0 ELSE 1 END,
         w.updated_at DESC
       LIMIT ?3`
    )
    .bind(vendor.id, vendor.user_id, limit, includeIndexed ? 1 : 0)
    .all<Wedding>()

  return rows.results
}
