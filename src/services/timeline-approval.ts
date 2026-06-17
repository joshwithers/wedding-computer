// Approval flow for the unified timeline. When a non-lead member changes a
// SHARED row, the change becomes a pending timeline_change_request (target
// 'run_sheet', run_sheet_item_id = the timeline item id) addressed to the
// timeline lead, who approves (optionally editing first) or declines. Reuses
// the existing request table + notify_timeline_change_* queue messages.

import { createTimelineRequest } from '../db/timeline-requests'
import { createItem, updateItem, deleteItem } from '../db/timeline'
import { appendWeddingLog } from '../db/wedding-log'
import type {
  TimelineChangeRequest,
  TimelineCategory,
  TimelineVisibility,
} from '../types'

export type RowFields = {
  start_time: string | null
  end_time: string | null
  title: string
  description: string | null
  location: string | null
  category: TimelineCategory
  visibility: TimelineVisibility
  // Liquid anchoring (optional; preserved through propose/approve).
  duration_minutes?: number | null
  anchor_type?: 'after' | 'before' | 'sun' | null
  anchor_ref?: string | null
  anchor_offset_minutes?: number
  pinned?: number
}

export type ProposalPayload = {
  after?: Partial<RowFields>
  before?: Partial<RowFields>
  /** For create requests: who would own the new row. */
  owner_vendor_id?: string | null
  created_by_user_id?: string
}

const FIELDS: { key: keyof RowFields; label: string }[] = [
  { key: 'start_time', label: 'Start' },
  { key: 'end_time', label: 'End' },
  { key: 'title', label: 'What' },
  { key: 'location', label: 'Location' },
  { key: 'category', label: 'Part of day' },
  { key: 'visibility', label: 'Visibility' },
  { key: 'duration_minutes', label: 'Duration' },
  { key: 'anchor_type', label: 'Relative start' },
  { key: 'description', label: 'Details' },
]

function show(v: unknown): string {
  const s = v == null ? '' : String(v)
  return s.trim() === '' ? '—' : s
}

/** Human "Start: 15:00 → 15:30; Location: — → Chapel". */
export function diffSummary(before: Partial<RowFields> | undefined, after: Partial<RowFields> | undefined): string {
  const parts: string[] = []
  for (const f of FIELDS) {
    const b = before?.[f.key]
    const a = after?.[f.key]
    if (after && f.key in after && String(b ?? '') !== String(a ?? '')) {
      parts.push(`${f.label}: ${show(b)} → ${show(a)}`)
    }
  }
  return parts.join('; ')
}

/** The per-field before/after rows a diff card renders (changed fields only). */
export function diffRows(payload: ProposalPayload): { key: keyof RowFields; label: string; before: string; after: string }[] {
  const out: { key: keyof RowFields; label: string; before: string; after: string }[] = []
  for (const f of FIELDS) {
    const a = payload.after?.[f.key]
    const b = payload.before?.[f.key]
    if (payload.after && f.key in payload.after && String(b ?? '') !== String(a ?? '')) {
      out.push({ key: f.key, label: f.label, before: show(b), after: show(a) })
    }
  }
  return out
}

export function parsePayload(req: TimelineChangeRequest): ProposalPayload {
  try {
    return JSON.parse(req.payload) as ProposalPayload
  } catch {
    return {}
  }
}

/** Record a pending change addressed to the lead, log it, and notify the lead. */
export async function proposeChange(
  db: D1Database,
  opts: {
    weddingId: string
    op: 'create' | 'update' | 'delete'
    itemId: string | null
    payload: ProposalPayload
    requestedByUserId: string
    requestedByLabel: string | null
    vendorProfileId: string | null
    leadUserIds: string[]
    queue?: Queue
  }
): Promise<TimelineChangeRequest> {
  const summary =
    opts.op === 'delete'
      ? `Remove "${opts.payload.before?.title ?? 'section'}"`
      : opts.op === 'create'
        ? `Add "${opts.payload.after?.title ?? 'section'}"`
        : diffSummary(opts.payload.before, opts.payload.after) || 'Timeline change'

  const req = await createTimelineRequest(db, {
    wedding_id: opts.weddingId,
    requested_by_user_id: opts.requestedByUserId,
    requested_by_label: opts.requestedByLabel,
    target: 'run_sheet',
    op: opts.op,
    run_sheet_item_id: opts.itemId,
    vendor_profile_id: opts.vendorProfileId,
    payload: opts.payload as Record<string, unknown>,
    summary,
  })

  await appendWeddingLog(db, opts.weddingId, opts.requestedByUserId, 'Timeline change requested', summary).catch(() => {})

  if (opts.queue) {
    await opts.queue
      .send({
        type: 'notify_timeline_change_requested',
        payload: JSON.stringify({
          weddingId: opts.weddingId,
          requesterLabel: opts.requestedByLabel,
          summary,
          controllerUserIds: opts.leadUserIds,
        }),
      })
      .catch((e: any) => console.error('[timeline-approval] notify enqueue failed', e?.message))
  }

  return req
}

/**
 * Apply an approved request to the timeline. `editedAfter` lets the lead tweak
 * the proposed values before approving (edit-then-approve) for create/update.
 */
export async function applyRequest(
  db: D1Database,
  req: TimelineChangeRequest,
  editedAfter?: Partial<RowFields>
): Promise<void> {
  const payload = parsePayload(req)
  const after = { ...(payload.after ?? {}), ...(editedAfter ?? {}) }

  if (req.op === 'create') {
    await createItem(db, {
      wedding_id: req.wedding_id,
      title: after.title ?? 'Untitled',
      start_time: after.start_time ?? null,
      end_time: after.end_time ?? null,
      description: after.description ?? null,
      location: after.location ?? null,
      category: (after.category as TimelineCategory) ?? 'other',
      visibility: (after.visibility as TimelineVisibility) ?? 'couple',
      owner_vendor_id: payload.owner_vendor_id ?? null,
      created_by_user_id: payload.created_by_user_id ?? req.requested_by_user_id,
      duration_minutes: after.duration_minutes ?? null,
      anchor_type: after.anchor_type ?? null,
      anchor_ref: after.anchor_ref ?? null,
      anchor_offset_minutes: after.anchor_offset_minutes ?? 0,
      pinned: after.pinned ?? 0,
    })
    return
  }
  if (!req.run_sheet_item_id) return
  if (req.op === 'delete') {
    await deleteItem(db, req.wedding_id, req.run_sheet_item_id)
    return
  }
  // update
  await updateItem(db, req.wedding_id, req.run_sheet_item_id, {
    title: after.title,
    start_time: after.start_time ?? null,
    end_time: after.end_time ?? null,
    description: after.description ?? null,
    location: after.location ?? null,
    category: after.category as TimelineCategory,
    visibility: after.visibility as TimelineVisibility,
    duration_minutes: after.duration_minutes,
    anchor_type: after.anchor_type,
    anchor_ref: after.anchor_ref,
    anchor_offset_minutes: after.anchor_offset_minutes,
    pinned: after.pinned,
  })
}
