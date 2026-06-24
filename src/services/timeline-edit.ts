/**
 * Shared timeline-permission layer.
 *
 * A wedding's timeline (date, ceremony/reception/getting-ready times and
 * venues) can be controlled by a managing planner or venue. When one is on
 * the wedding, timeline changes from anyone else become a pending
 * timeline_change_request instead of a direct write.
 *
 * The app routes (vendor wedding edit, couple edit) enforce this in their
 * handlers; this module is the same rule for every other door into the
 * data — vault API writes and MCP tools — so a file
 * edit can never bypass an approval the web form would have required.
 */

import type { Wedding } from '../types'
import { createTimelineRequest, getTimelineControllers } from '../db/timeline-requests'
import { appendWeddingLog } from '../db/wedding-log'

/** Wedding fields whose changes a controlling planner/venue must approve. */
export const TIMELINE_FIELDS = [
  'date', 'time', 'duration_hours',
  'ceremony_location', 'reception_location', 'reception_time',
  'getting_ready_location', 'getting_ready_time', 'getting_ready_1_label',
  'getting_ready_2_location', 'getting_ready_2_label', 'getting_ready_2_time',
  'portrait_location', 'portrait_time', 'reception_duration_hours',
] as const

export type TimelineField = (typeof TIMELINE_FIELDS)[number]

/**
 * Wedding fields a vendor-authored file may never change: the couple
 * controls vendor_visibility, and provenance fields are immutable.
 */
export const VENDOR_FILE_PROTECTED_FIELDS = [
  'vendor_visibility', 'created_by_user_id', 'created_at',
] as const

/** Timeline fields whose value differs between current and incoming. */
export function changedTimelineFields(
  current: Wedding,
  incoming: Partial<Wedding>
): TimelineField[] {
  return TIMELINE_FIELDS.filter((f) => {
    if (!(f in incoming)) return false
    const oldVal = current[f] ?? null
    const newVal = incoming[f] ?? null
    return String(oldVal ?? '') !== String(newVal ?? '')
  })
}

/** Human summary of timeline changes, e.g. `date: 2026-07-12 → 2026-07-13`. */
export function summarizeTimelineChanges(
  current: Wedding,
  incoming: Partial<Wedding>,
  fields: TimelineField[]
): string {
  return fields
    .map((f) => `${f}: ${current[f] ?? '—'} → ${incoming[f] ?? '—'}`)
    .join('; ')
}

export type TimelineControl = {
  hasControllers: boolean
  isController: boolean
  controllerUserIds: string[]
}

/** Is this wedding's timeline controlled, and is the user a controller? */
export async function getTimelineControl(
  db: D1Database,
  weddingId: string,
  userId: string
): Promise<TimelineControl> {
  const controllers = await getTimelineControllers(db, weddingId)
  return {
    hasControllers: controllers.length > 0,
    isController: controllers.some((tc) => tc.user_id === userId),
    controllerUserIds: controllers.map((tc) => tc.user_id),
  }
}

/**
 * Pure routing decision: split a vendor's wedding update into the part that
 * applies directly and the part that must go through approval. Protected
 * (couple-only) fields are dropped entirely.
 */
export function partitionVendorWeddingUpdate(
  current: Wedding,
  incoming: Wedding,
  control: Pick<TimelineControl, 'hasControllers' | 'isController'>
): {
  direct: Wedding
  pendingFields: TimelineField[]
  pendingPayload: Record<string, unknown>
} {
  const direct: Wedding = { ...incoming }
  for (const f of VENDOR_FILE_PROTECTED_FIELDS) {
    ;(direct as Record<string, unknown>)[f] = current[f]
  }

  const changed = changedTimelineFields(current, direct)
  if (changed.length === 0 || !control.hasControllers || control.isController) {
    return { direct, pendingFields: [], pendingPayload: {} }
  }

  const pendingPayload: Record<string, unknown> = {}
  for (const f of changed) {
    pendingPayload[f] = direct[f] ?? null
    ;(direct as Record<string, unknown>)[f] = current[f]
  }
  return { direct, pendingFields: changed, pendingPayload }
}

/**
 * Record a pending timeline change request (plus log entry and controller
 * notification). Used by the sync ingest and MCP after partitioning.
 */
export async function queueTimelineChangeRequest(
  db: D1Database,
  data: {
    wedding: Wedding
    requestedByUserId: string
    requestedByLabel: string | null
    payload: Record<string, unknown>
    summary: string
    controllerUserIds: string[]
    queue?: Queue
  }
): Promise<void> {
  const request = await createTimelineRequest(db, {
    wedding_id: data.wedding.id,
    requested_by_user_id: data.requestedByUserId,
    requested_by_label: data.requestedByLabel,
    target: 'wedding',
    op: 'update',
    payload: data.payload,
    summary: data.summary || null,
  })
  await appendWeddingLog(
    db,
    data.wedding.id,
    data.requestedByUserId,
    'Timeline change requested',
    request.summary
  ).catch(() => {})
  if (data.queue) {
    await data.queue
      .send({
        type: 'notify_timeline_change_requested',
        payload: JSON.stringify({
          weddingId: data.wedding.id,
          requesterLabel: data.requestedByLabel,
          summary: request.summary,
          controllerUserIds: data.controllerUserIds,
        }),
      })
      .catch((e: any) =>
        console.error('[timeline-edit] request notify enqueue failed', e.message)
      )
  }
}
