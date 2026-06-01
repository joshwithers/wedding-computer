/**
 * Storage factory — creates the right StorageBackend for a vendor.
 *
 * Every vendor gets a StorageBackend based on their config:
 * - "r2" (default): files stored in the platform's R2 bucket
 * - "git" (future): files synced with a GitHub/GitLab repo
 *
 * Usage in routes:
 *   const storage = getStorage(c.env, vendor)
 *   const contact = await getContact(storage, c.env.DB, vendor.id, id)
 */

import type { Bindings, VendorProfile } from '../types'
import type { StorageBackend } from './types'
import { R2StorageBackend } from './r2'

/**
 * Get the storage backend for a vendor.
 * Throws if the required bindings are missing.
 */
export function getStorage(env: Bindings, vendor: VendorProfile): StorageBackend {
  const storageType = vendor.storage_type ?? 'r2'

  switch (storageType) {
    case 'r2': {
      if (!env.STORAGE) {
        throw new Error('R2 storage binding (STORAGE) is not configured')
      }
      return new R2StorageBackend(env.STORAGE, vendor.id)
    }

    case 'git': {
      // Git backend will be implemented in a future PR.
      // For now, fall through to R2 so existing vendors don't break.
      if (!env.STORAGE) {
        throw new Error('R2 storage binding (STORAGE) is not configured')
      }
      console.warn(`[storage] Vendor ${vendor.id} has git storage configured but git backend is not yet available. Using R2.`)
      return new R2StorageBackend(env.STORAGE, vendor.id)
    }

    default:
      throw new Error(`Unknown storage type: ${storageType}`)
  }
}
