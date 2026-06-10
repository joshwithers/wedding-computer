/**
 * Full account deletion. Beyond the D1 rows (which deleteUser removes, with
 * FK cascades), an account leaves data in places D1 cascade can't reach:
 * KV (sessions, vendor secrets) and R2 (avatar, vendor logo, and the
 * vendor's whole markdown storage tree). This purges all of it.
 *
 * For git-backed vendors the markdown lives in the user's own GitHub repo —
 * that's theirs, so we leave it (and the inbound webhook simply no-ops once
 * the vendor row is gone).
 */

import type { Bindings, User } from '../types'
import { getVendorByUserId } from '../db/vendors'
import { deleteUser } from '../db/users'
import { deleteVendorSecret } from './secrets'

export async function purgeAccount(env: Bindings, user: User): Promise<void> {
  // 1. KV sessions — the D1 sessions rows cascade on user delete, but their
  //    KV entries (session:<id>) do not, so collect and delete them first.
  try {
    const sessions = await env.DB
      .prepare('SELECT id FROM sessions WHERE user_id = ?')
      .bind(user.id)
      .all<{ id: string }>()
      .then((r) => r.results)
    for (const s of sessions) {
      await env.KV.delete(`session:${s.id}`).catch(() => {})
    }
  } catch (e: any) {
    console.error('[purge] session cleanup failed', e.message)
  }

  // 2. Avatar
  if (user.avatar_r2_key && env.STORAGE) {
    await env.STORAGE.delete(user.avatar_r2_key).catch(() => {})
  }

  // 3. Vendor-scoped storage + secrets
  const vendor = await getVendorByUserId(env.DB, user.id).catch(() => null)
  if (vendor) {
    if (vendor.logo_r2_key && env.STORAGE) {
      await env.STORAGE.delete(vendor.logo_r2_key).catch(() => {})
    }
    // Delete the vendor's R2 storage tree. Git-backed vendors keep their
    // files in their own repo, so only purge R2 for non-git vendors.
    if (env.STORAGE && vendor.storage_type !== 'git') {
      await deleteR2Prefix(env.STORAGE, `vendors/${vendor.id}/`).catch((e: any) =>
        console.error('[purge] R2 tree cleanup failed', e.message)
      )
    }
    for (const name of ['github_access_token', 'github_webhook_secret', 'anthropic_api_key'] as const) {
      await deleteVendorSecret(env.KV, vendor.id, name).catch(() => {})
    }
  }

  // 4. D1 rows (reassigns/removes weddings, anonymizes audit, deletes user
  //    and cascades the rest).
  await deleteUser(env.DB, user.id)
}

/** Delete every object under an R2 prefix, paginating the listing. */
async function deleteR2Prefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined
  do {
    const listed = await bucket.list({ prefix, cursor, limit: 1000 })
    if (listed.objects.length > 0) {
      await bucket.delete(listed.objects.map((o) => o.key))
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)
}
