import type { TimelineChangeRequest } from '../types'

// Timeline change requests: pending edits to a wedding's timeline (or run
// sheet) awaiting approval from a controlling planner/venue.

export async function createTimelineRequest(
  db: D1Database,
  data: {
    wedding_id: string
    requested_by_user_id: string
    requested_by_label?: string | null
    target: 'wedding' | 'run_sheet'
    op?: 'create' | 'update' | 'delete'
    run_sheet_item_id?: string | null
    vendor_profile_id?: string | null
    payload: Record<string, unknown>
    summary?: string | null
  }
): Promise<TimelineChangeRequest> {
  const result = await db
    .prepare(
      `INSERT INTO timeline_change_requests
        (wedding_id, requested_by_user_id, requested_by_label, target, op, run_sheet_item_id, vendor_profile_id, payload, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      data.wedding_id,
      data.requested_by_user_id,
      data.requested_by_label ?? null,
      data.target,
      data.op ?? 'update',
      data.run_sheet_item_id ?? null,
      data.vendor_profile_id ?? null,
      JSON.stringify(data.payload),
      data.summary ?? null
    )
    .first<TimelineChangeRequest>()
  return result!
}

export async function listPendingTimelineRequests(
  db: D1Database,
  weddingId: string
): Promise<TimelineChangeRequest[]> {
  return db
    .prepare(
      `SELECT * FROM timeline_change_requests
       WHERE wedding_id = ? AND status = 'pending'
       ORDER BY created_at ASC`
    )
    .bind(weddingId)
    .all<TimelineChangeRequest>()
    .then((r) => r.results)
}

export async function getTimelineRequest(
  db: D1Database,
  weddingId: string,
  requestId: string
): Promise<TimelineChangeRequest | null> {
  return db
    .prepare('SELECT * FROM timeline_change_requests WHERE id = ? AND wedding_id = ?')
    .bind(requestId, weddingId)
    .first<TimelineChangeRequest>()
}

export async function decideTimelineRequest(
  db: D1Database,
  requestId: string,
  decidedByUserId: string,
  decision: 'approved' | 'declined'
): Promise<void> {
  await db
    .prepare(
      `UPDATE timeline_change_requests
       SET status = ?, decided_by_user_id = ?, decided_at = datetime('now')
       WHERE id = ? AND status = 'pending'`
    )
    .bind(decision, decidedByUserId, requestId)
    .run()
}

/**
 * Active managing vendors whose business is a planner or venue — the people
 * who control this wedding's timeline. When this list is non-empty, timeline
 * edits from anyone else require approval from one of them.
 */
export async function getTimelineControllers(
  db: D1Database,
  weddingId: string
): Promise<{ user_id: string; vendor_profile_id: string; business_name: string }[]> {
  return db
    .prepare(
      `SELECT wm.user_id, wm.vendor_profile_id, vp.business_name
       FROM wedding_members wm
       JOIN vendor_profiles vp ON vp.id = wm.vendor_profile_id
       WHERE wm.wedding_id = ? AND wm.status = 'active' AND wm.role = 'vendor' AND wm.can_manage = 1
         AND EXISTS (
           SELECT 1 FROM json_each(COALESCE(vp.categories, json_array(vp.category))) j
           WHERE j.value IN ('planner', 'venue')
         )`
    )
    .bind(weddingId)
    .all<{ user_id: string; vendor_profile_id: string; business_name: string }>()
    .then((r) => r.results)
}
