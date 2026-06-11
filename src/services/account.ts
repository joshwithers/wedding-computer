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
import { deleteUser, softDeleteUser, listExpiredDeletedUserIds, getUserById } from '../db/users'
import { deleteVendorSecret } from './secrets'

/** Delete every one of a user's sessions (D1 rows cascade on hard delete, but
 *  their KV `session:<id>` entries do not — collect and clear them). */
async function destroyAllSessions(env: Bindings, userId: string): Promise<void> {
  try {
    const sessions = await env.DB
      .prepare('SELECT id FROM sessions WHERE user_id = ?')
      .bind(userId)
      .all<{ id: string }>()
      .then((r) => r.results)
    for (const s of sessions) {
      await env.KV.delete(`session:${s.id}`).catch(() => {})
    }
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run().catch(() => {})
  } catch (e: any) {
    console.error('[account] session cleanup failed', e.message)
  }
}

/**
 * Soft-delete an account: mark it for deletion (30-day grace) and log the user
 * out everywhere. Nothing is destroyed yet — signing back in restores it
 * (auth.tsx), and purgeExpiredAccounts hard-purges once the grace elapses.
 */
export async function softDeleteAccount(env: Bindings, user: User): Promise<void> {
  await softDeleteUser(env.DB, user.id)
  await destroyAllSessions(env, user.id)
}

/** Hard-purge accounts past their grace window. Called from the nightly cron. */
export async function purgeExpiredAccounts(env: Bindings): Promise<void> {
  const ids = await listExpiredDeletedUserIds(env.DB, 30)
  for (const id of ids) {
    const user = await getUserById(env.DB, id)
    if (user) {
      await purgeAccount(env, user).catch((e: any) =>
        console.error('[account] purge expired failed', id, e.message)
      )
    }
  }
  if (ids.length > 0) console.log(`[account] purged ${ids.length} expired soft-deleted accounts`)
}

export async function purgeAccount(env: Bindings, user: User): Promise<void> {
  // 1. Sessions (KV entries don't cascade with the D1 rows).
  await destroyAllSessions(env, user.id)

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
