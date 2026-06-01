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
import type { StorageBackend, StorageConfig } from './types'
import { R2StorageBackend } from './r2'
import { GitHubStorageBackend } from './github'

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
      // Parse storage config for git settings
      let config: StorageConfig | null = null
      if (vendor.storage_config) {
        try { config = JSON.parse(vendor.storage_config) } catch { /* ignore */ }
      }

      if (config?.git_repo && config?.git_access_token) {
        return new GitHubStorageBackend({
          token: config.git_access_token,
          repo: config.git_repo,
          branch: config.git_branch ?? 'main',
          path: config.git_path ?? '',
        })
      }

      // Git configured but missing credentials — fall back to R2
      if (env.STORAGE) {
        console.warn(`[storage] Vendor ${vendor.id} has git storage but missing config. Using R2.`)
        return new R2StorageBackend(env.STORAGE, vendor.id)
      }
      throw new Error('Git storage is not fully configured and R2 is unavailable')
    }

    default:
      throw new Error(`Unknown storage type: ${storageType}`)
  }
}
