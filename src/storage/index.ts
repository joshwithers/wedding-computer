/**
 * Storage factory — creates the right StorageBackend for a vendor.
 *
 * Every vendor gets a StorageBackend based on their config.
 * R2 is the canonical launch storage backend. Legacy "git" profiles are
 * intentionally served from R2 while the old integration is disabled.
 *
 * Usage in routes:
 *   const storage = await getStorageWithSecrets(c.env, vendor)
 *   const contact = await getContact(storage, c.env.DB, vendor.id, id)
 */

import type { Bindings, VendorProfile } from '../types'
import type { StorageBackend } from './types'
import { R2StorageBackend } from './r2'

function r2Storage(env: Bindings, vendor: VendorProfile): StorageBackend {
  if (!env.STORAGE) {
    throw new Error('R2 storage binding (STORAGE) is not configured')
  }
  return new R2StorageBackend(env.STORAGE, vendor.id)
}

/**
 * Get the storage backend for a vendor.
 * Throws if the required bindings are missing.
 */
export function getStorage(env: Bindings, vendor: VendorProfile): StorageBackend {
  const storageType = vendor.storage_type ?? 'r2'

  switch (storageType) {
    case 'r2':
      return r2Storage(env, vendor)

    case 'git':
      console.warn(`[storage] GitHub storage is disabled for launch; using R2 for vendor ${vendor.id}.`)
      return r2Storage(env, vendor)

    default:
      throw new Error(`Unknown storage type: ${storageType}`)
  }
}

export async function getStorageWithSecrets(
  env: Bindings,
  vendor: VendorProfile
): Promise<StorageBackend> {
  return getStorage(env, vendor)
}
