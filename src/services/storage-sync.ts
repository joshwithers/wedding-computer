/**
 * Background storage sync — runs every 5 minutes via cron, and on
 * GitHub webhook deliveries.
 *
 * Two phases per git-backed vendor:
 *
 * 1. PULL — scan the repo and reconcile external edits into D1
 *    (wedding.md fields, todo.md checklists). Etag comparison makes
 *    this a no-op when nothing changed externally.
 *
 * 2. PUSH — find weddings whose D1 state is newer than the files in
 *    storage and push wedding.md / todo.md / log.md. This is the
 *    backstop for the immediate post-edit pushes in the routes: if one
 *    of those is dropped, the change lands here within 5 minutes.
 *    Also detects date/title changes that require a folder rename.
 *
 * Only processes vendors with storage_type = 'git' (R2 vendors don't
 * need background sync since R2 writes are immediate and reliable).
 */

import type { Bindings, VendorProfile, Wedding } from '../types'
import { getStorageWithSecrets } from '../storage'
import { syncVendor } from '../storage/sync'
import { weddingFolder } from '../storage/weddings'
import { gitBlobSha } from '../storage/etag'
import { pushWeddingFiles } from './storage-push'

type SyncSummary = {
  vendorsChecked: number
  pulled: number       // external changes applied to D1
  weddingsSynced: number
  errors: number
}

type StaleCandidate = Wedding & {
  wedding_file_path: string | null
  wedding_synced_at: string | null
  todo_updated_at: string | null
  todo_synced_at: string | null
  log_latest_at: string | null
  log_synced_at: string | null
  // timeline.md staleness: live run-sheet/pending-request aggregates vs the
  // snapshot stored in the timeline index row's cached_data
  rs_count: number
  rs_latest: string | null
  tr_pending: number
  tr_latest: string | null
  timeline_cached: string | null
  timeline_indexed: number
  // notes.md staleness: sha of the vendor's private notes vs the snapshot
  vendor_notes: string | null
  notes_cached: string | null
  notes_indexed: number
  // vendors.md staleness: membership / couple-vendor aggregates vs snapshot
  member_count: number
  member_latest: string | null
  cv_count: number
  cv_latest: string | null
  vendors_cached: string | null
  vendors_indexed: number
}

export async function syncStorageBackground(env: Bindings): Promise<SyncSummary> {
  const summary: SyncSummary = { vendorsChecked: 0, pulled: 0, weddingsSynced: 0, errors: 0 }

  // Find all vendors with git storage configured
  const vendors = await env.DB
    .prepare(
      `SELECT * FROM vendor_profiles WHERE storage_type = 'git' AND storage_config IS NOT NULL`
    )
    .all<VendorProfile>()
    .then((r) => r.results)

  for (const vendor of vendors) {
    summary.vendorsChecked++
    const result = await syncVendorStorage(env, vendor)
    summary.pulled += result.pulled
    summary.weddingsSynced += result.weddingsSynced
    summary.errors += result.errors
  }

  return summary
}

// How long a per-vendor sync may hold the lock before it auto-expires.
// Generous ceiling for one vendor's pull+push; short enough that a crashed
// invocation doesn't wedge the vendor's sync for long.
const SYNC_LOCK_TTL_SECONDS = 120

/**
 * Pull + push a single vendor's storage. Used by the cron loop and by
 * the GitHub webhook handler (which knows exactly which vendor changed).
 *
 * A best-effort per-vendor KV lock serializes these callers: the 5-minute
 * cron, GitHub webhook deliveries, and the manual "sync now" button can all
 * target the same vendor at once, and two concurrent syncs race the
 * file_index read-modify-writes and generate duplicate GitHub commits /
 * 409s. KV is eventually consistent, so this is not a hard mutex, but it
 * closes the common collision window.
 */
export async function syncVendorStorage(
  env: Bindings,
  vendor: VendorProfile
): Promise<Omit<SyncSummary, 'vendorsChecked'>> {
  const result = { pulled: 0, weddingsSynced: 0, errors: 0 }

  const lockKey = `synclock:${vendor.id}`
  if (await env.KV.get(lockKey)) {
    return result // another sync is already in flight for this vendor
  }
  await env.KV.put(lockKey, '1', { expirationTtl: SYNC_LOCK_TTL_SECONDS })

  try {
    return await runVendorSync(env, vendor, result)
  } finally {
    await env.KV.delete(lockKey).catch(() => {})
  }
}

async function runVendorSync(
  env: Bindings,
  vendor: VendorProfile,
  result: { pulled: number; weddingsSynced: number; errors: number }
): Promise<Omit<SyncSummary, 'vendorsChecked'>> {
  let storage
  try {
    storage = await getStorageWithSecrets(env, vendor)
  } catch {
    return result // skip vendors with broken config
  }

  // Skip the (full recursive tree) pull when the backend is unchanged since
  // the last clean sync. The push phase still runs — it's cheap when there's
  // nothing to push and is how D1 edits reach storage. (R2 has no fingerprint
  // and is never skipped; its list is local and cheap anyway.)
  const fpKey = `syncfp:${vendor.id}`
  const fingerprint = storage.stateFingerprint ? await storage.stateFingerprint().catch(() => null) : null
  const skipPull = !!fingerprint && (await env.KV.get(fpKey)) === fingerprint

  // ── Phase 1: pull external edits into D1 ──
  if (!skipPull) {
    try {
      const pull = await syncVendor(storage, env.DB, vendor.id, {
        queue: env.EMAIL_QUEUE,
        requestedByLabel: vendor.business_name,
      })
      result.pulled = pull.indexed + pull.updated + pull.removed
      result.errors += pull.errors
      if (result.pulled > 0) {
        console.log(`[sync] Pulled for vendor ${vendor.id}: ${pull.indexed} new, ${pull.updated} updated, ${pull.removed} removed`)
      }
    } catch (err: any) {
      console.error(`[sync] Pull failed for vendor ${vendor.id}:`, err.message)
      result.errors++
    }
  }

  // ── Phase 2: push stale D1 state out to storage ──
  const candidates = await env.DB
    .prepare(
      `SELECT w.*,
         fiw.file_path AS wedding_file_path, fiw.last_synced_at AS wedding_synced_at,
         wt.updated_at AS todo_updated_at, fit.last_synced_at AS todo_synced_at,
         (SELECT MAX(wl.created_at) FROM wedding_log wl WHERE wl.wedding_id = w.id) AS log_latest_at,
         fil.last_synced_at AS log_synced_at,
         (SELECT COUNT(*) FROM timeline_items r WHERE r.wedding_id = w.id) AS rs_count,
         (SELECT MAX(r.updated_at) FROM timeline_items r WHERE r.wedding_id = w.id) AS rs_latest,
         (SELECT COUNT(*) FROM timeline_change_requests t WHERE t.wedding_id = w.id AND t.status = 'pending') AS tr_pending,
         (SELECT MAX(t.created_at) FROM timeline_change_requests t WHERE t.wedding_id = w.id AND t.status = 'pending') AS tr_latest,
         fitl.cached_data AS timeline_cached,
         (fitl.id IS NOT NULL) AS timeline_indexed,
         wm.vendor_notes AS vendor_notes,
         fin.cached_data AS notes_cached,
         (fin.id IS NOT NULL) AS notes_indexed,
         (SELECT COUNT(*) FROM wedding_members m2 WHERE m2.wedding_id = w.id AND m2.status = 'active') AS member_count,
         (SELECT MAX(COALESCE(m2.accepted_at, m2.created_at)) FROM wedding_members m2 WHERE m2.wedding_id = w.id AND m2.status = 'active') AS member_latest,
         (SELECT COUNT(*) FROM couple_vendors cv WHERE cv.wedding_id = w.id AND cv.status != 'removed') AS cv_count,
         (SELECT MAX(cv.updated_at) FROM couple_vendors cv WHERE cv.wedding_id = w.id AND cv.status != 'removed') AS cv_latest,
         fiv.cached_data AS vendors_cached,
         (fiv.id IS NOT NULL) AS vendors_indexed
       FROM weddings w
       JOIN wedding_members wm ON wm.wedding_id = w.id
       LEFT JOIN file_index fiw ON fiw.vendor_id = ?1 AND fiw.entity_type = 'wedding' AND fiw.entity_id = w.id
       LEFT JOIN wedding_todos wt ON wt.vendor_id = ?1 AND wt.wedding_id = w.id
       LEFT JOIN file_index fit ON fit.vendor_id = ?1 AND fit.entity_type = 'todo' AND fit.entity_id = w.id
       LEFT JOIN file_index fil ON fil.vendor_id = ?1 AND fil.entity_type = 'log' AND fil.entity_id = w.id
       LEFT JOIN file_index fitl ON fitl.vendor_id = ?1 AND fitl.entity_type = 'timeline' AND fitl.entity_id = w.id
       LEFT JOIN file_index fin ON fin.vendor_id = ?1 AND fin.entity_type = 'notes' AND fin.entity_id = w.id
       LEFT JOIN file_index fiv ON fiv.vendor_id = ?1 AND fiv.entity_type = 'vendors' AND fiv.entity_id = w.id
       WHERE wm.user_id = (SELECT user_id FROM vendor_profiles WHERE id = ?1)
         AND wm.status = 'active'
         AND w.status IN ('planning', 'confirmed')
       ORDER BY w.updated_at DESC
       LIMIT 25`
    )
    .bind(vendor.id)
    .all<StaleCandidate>()
    .then((r) => r.results)

  for (const candidate of candidates) {
    if (!(await needsPush(candidate))) continue

    try {
      await pushWeddingFiles(env.DB, storage, vendor.id, candidate)
      result.weddingsSynced++
    } catch (err: any) {
      console.error(`[sync] Failed to sync wedding ${candidate.id} for vendor ${vendor.id}:`, err.message)
      result.errors++
    }
  }

  // Remember the backend state so the next run can skip the pull — but only
  // after a clean sync, so an error always re-pulls next time. If the push
  // wrote nothing the head is still `fingerprint`; otherwise re-fetch it.
  if (fingerprint && result.errors === 0) {
    const finalFp =
      result.weddingsSynced > 0 && storage.stateFingerprint
        ? (await storage.stateFingerprint().catch(() => null)) ?? fingerprint
        : fingerprint
    await env.KV.put(fpKey, finalFp).catch(() => {})
  }

  return result
}

async function needsPush(c: StaleCandidate): Promise<boolean> {
  // Never pushed at all
  if (!c.wedding_file_path || !c.wedding_synced_at) return true

  // Wedding row changed since the last push
  if (c.updated_at > c.wedding_synced_at) return true

  // Date/title changed (possibly via an external wedding.md edit that was
  // just pulled) and the folder no longer matches — push to trigger rename
  const desiredFolder = weddingFolder(c.title, c.date)
  const currentFolder = c.wedding_file_path.substring(0, c.wedding_file_path.lastIndexOf('/') + 1)
  if (desiredFolder !== currentFolder) return true

  // Checklist changed since todo.md was last written
  if (c.todo_updated_at && (!c.todo_synced_at || c.todo_updated_at > c.todo_synced_at)) return true

  // Log grew since log.md was last written
  if (c.log_latest_at && (!c.log_synced_at || c.log_latest_at > c.log_synced_at)) return true

  // Run sheet or pending approvals drifted from the timeline.md snapshot
  if (timelineStale(c)) return true

  // Private notes drifted from the notes.md snapshot
  if (await notesStale(c)) return true

  // Wedding team / couple vendor list drifted from the vendors.md snapshot
  if (vendorsStale(c)) return true

  return false
}

function parseCached(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function timelineStale(c: StaleCandidate): boolean {
  const hasContent = c.rs_count > 0 || c.tr_pending > 0
  if (!c.timeline_indexed) return hasContent // first write
  const cached = parseCached(c.timeline_cached)
  if (!cached) return true // ingest left it null (new rows need ids) or unreadable
  return (
    cached.c !== c.rs_count ||
    (cached.l ?? null) !== (c.rs_latest ?? null) ||
    cached.p !== c.tr_pending ||
    (cached.pl ?? null) !== (c.tr_latest ?? null)
  )
}

async function notesStale(c: StaleCandidate): Promise<boolean> {
  if (!c.notes_indexed) return !!c.vendor_notes // first write
  const cached = parseCached(c.notes_cached)
  if (!cached) return true
  return cached.sha !== (await gitBlobSha(c.vendor_notes ?? ''))
}

function vendorsStale(c: StaleCandidate): boolean {
  if (!c.vendors_indexed) return true // first write
  const cached = parseCached(c.vendors_cached)
  if (!cached) return true
  return (
    cached.mc !== c.member_count ||
    (cached.ml ?? null) !== (c.member_latest ?? null) ||
    cached.cv !== c.cv_count ||
    (cached.cvl ?? null) !== (c.cv_latest ?? null)
  )
}
