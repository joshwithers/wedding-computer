import type { Bindings } from '../types'
import { getWedding } from '../db/weddings'
import { deliver, type NotifyEnv, type Recipient } from './notifications'
import { timelineUpdatedEmail } from './email'

// "The run sheet changed" notification, debounced.
//
// Direct timeline/run-sheet edits (the common case — most weddings have no
// controlling planner) notify nobody today. We mark the wedding "dirty" in KV
// on each applied change, then a cron sweep emails the rest of the run-sheet
// team once edits settle, so a single editing session sends one summary, not
// one email per row. Recipients are the vendors who actually have items on the
// run sheet — the people the change is relevant to.

const PREFIX = 'tldirty:'
const RECORD_TTL = 60 * 60 * 24 * 2 // 2 days — safety net; the cron clears sooner
const QUIET_MS = 15 * 60 * 1000 // send once no change has landed for 15 min
const MAX_PER_RUN = 100

type DirtyRecord = { lastChangeAt: number; editorUserId: string }

/** Mark a wedding's run sheet as changed so the cron will notify the team. */
export async function markTimelineDirty(kv: KVNamespace, weddingId: string, editorUserId: string): Promise<void> {
  const rec: DirtyRecord = { lastChangeAt: Date.now(), editorUserId }
  await kv.put(`${PREFIX}${weddingId}`, JSON.stringify(rec), { expirationTtl: RECORD_TTL }).catch(() => {})
}

// Vendors on the wedding who own or are assigned to a run-sheet item — minus
// the person who just made the change. These are the people for whom an updated
// run sheet matters.
async function getRunSheetRecipients(db: D1Database, weddingId: string, editorUserId: string): Promise<Recipient[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT u.id, u.email, u.name, u.notification_prefs
       FROM wedding_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.wedding_id = ?1 AND wm.role = 'vendor' AND wm.status = 'active'
         AND u.id != ?2 AND u.deleted_at IS NULL
         AND (
           EXISTS (
             SELECT 1 FROM timeline_items ti
             WHERE ti.wedding_id = wm.wedding_id
               AND ti.owner_vendor_id IS NOT NULL AND ti.owner_vendor_id = wm.vendor_profile_id
           )
           OR EXISTS (
             SELECT 1 FROM timeline_item_assignees tia
             JOIN timeline_items ti2 ON ti2.id = tia.timeline_item_id
             WHERE ti2.wedding_id = wm.wedding_id AND tia.wedding_member_id = wm.id
           )
         )`
    )
    .bind(weddingId, editorUserId)
    .all<Recipient>()
  return rows.results
}

/**
 * Daily/5-min sweep: for each dirty wedding whose edits have settled (no change
 * in the last QUIET_MS), email the run-sheet team a single summary and clear
 * the marker. Returns the number of emails sent.
 */
export async function flushTimelineNotifications(env: Bindings): Promise<number> {
  const list = await env.KV.list({ prefix: PREFIX, limit: 1000 })
  const now = Date.now()
  const notifyEnv: NotifyEnv = {
    db: env.DB,
    resendApiKey: env.RESEND_API_KEY,
    appUrl: env.APP_URL,
    sessionSecret: env.SESSION_SECRET,
  }
  let sent = 0
  let processed = 0

  for (const entry of list.keys) {
    if (processed >= MAX_PER_RUN) break
    const raw = await env.KV.get(entry.name)
    if (!raw) continue
    let rec: DirtyRecord
    try {
      rec = JSON.parse(raw)
    } catch {
      await env.KV.delete(entry.name)
      continue
    }
    if (now - (rec.lastChangeAt ?? 0) < QUIET_MS) continue // still settling
    processed++

    const weddingId = entry.name.slice(PREFIX.length)
    const wedding = await getWedding(env.DB, weddingId)
    if (wedding) {
      const recipients = await getRunSheetRecipients(env.DB, weddingId, rec.editorUserId ?? '')
      for (const r of recipients) {
        const ok = await deliver(notifyEnv, {
          key: 'wedding_updates',
          recipient: r,
          subject: `The run sheet for ${wedding.title} was updated`,
          html: timelineUpdatedEmail({ weddingTitle: wedding.title, appUrl: env.APP_URL, weddingId }),
        }).catch(() => false)
        if (ok) sent++
      }
    }

    // Clear the marker only if no newer edit landed while we were sending
    // (compare-and-delete) — otherwise leave it for the next settled sweep.
    const still = await env.KV.get(entry.name)
    if (still) {
      try {
        if ((JSON.parse(still) as DirtyRecord).lastChangeAt === rec.lastChangeAt) {
          await env.KV.delete(entry.name)
        }
      } catch {
        await env.KV.delete(entry.name)
      }
    }
  }

  return sent
}
