// Shared handlers for the unified wedding timeline, used by both the vendor
// route (/app/weddings/:id/timeline*) and the couple route
// (/wedding/:id/timeline*). Each returns the htmx-swappable <TimelineBody>.
//
// Editing model: the timeline LEAD edits shared rows directly; everyone else
// PROPOSES changes that become pending requests the lead approves/declines
// (with a before/after diff + edit-then-approve). Private rows: owner only.
// Assignees are self-service for anyone who can see the row. After every applied
// write we project the named slots back to weddings.* and refresh calendars/vault.

import type { Context } from 'hono'
import type { Env, User, WeddingMember, TimelineCategory, TimelineVisibility } from '../types'
import { TIMELINE_CATEGORIES } from '../types'
import { WeddingTimeline, TimelineBody, type TimelineProps, type PendingView } from '../views/timeline'
import {
  listTimeline,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  addAssignee,
  removeAssignee,
  setAssigneeCalendar,
  assigneeOwnerUserId,
  resolveWeddingRoster,
  projectTimelineToWedding,
  type RosterEntry,
} from '../db/timeline'
import {
  getTimelineLead,
  canSeeItem,
  canEditDirect,
  canPropose,
  canManageAssignees,
  canCreateDirect,
  creatableVisibilities,
  isTimelineLead,
  type TimelineViewer,
} from '../services/timeline-permissions'
import { resyncWeddingCalendars } from '../services/wedding-calendar'
import { listPendingTimelineRequests, getTimelineRequest, decideTimelineRequest } from '../db/timeline-requests'
import { proposeChange, applyRequest, diffRows, parsePayload, type RowFields } from '../services/timeline-approval'
import { getWedding } from '../db/weddings'
import { daylightStrip } from '../lib/sun'
import { t, getI18n } from '../i18n'

type Ctx = Context<Env>

function viewerOf(user: User, member: WeddingMember): TimelineViewer {
  return { userId: user.id, role: member.role, vendorProfileId: member.vendor_profile_id }
}

function coerceCategory(v: unknown): TimelineCategory {
  return TIMELINE_CATEGORIES.includes(v as TimelineCategory) ? (v as TimelineCategory) : 'other'
}

function coerceVisibility(v: unknown, allowed: TimelineVisibility[]): TimelineVisibility {
  return allowed.includes(v as TimelineVisibility) ? (v as TimelineVisibility) : allowed[0] ?? 'couple'
}

function str(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || null
}

function fieldsFrom(f: Record<string, unknown>, creatable: TimelineVisibility[]): RowFields {
  return {
    title: str(f.title) ?? 'Untitled',
    start_time: str(f.start_time),
    end_time: str(f.end_time),
    location: str(f.location),
    description: str(f.description),
    category: coerceCategory(f.category),
    visibility: coerceVisibility(f.visibility, creatable.length ? creatable : ['couple']),
  }
}

async function leadLabel(c: Ctx, weddingId: string, leadUserIds: string[]): Promise<string> {
  const uid = leadUserIds[0]
  if (!uid) return 'Someone'
  const row = await c.env.DB
    .prepare(
      `SELECT COALESCE(vp.business_name, u.name) AS label
       FROM users u
       LEFT JOIN wedding_members wm ON wm.user_id = u.id AND wm.wedding_id = ?
       LEFT JOIN vendor_profiles vp ON vp.id = wm.vendor_profile_id
       WHERE u.id = ? LIMIT 1`
    )
    .bind(weddingId, uid)
    .first<{ label: string }>()
  return row?.label ?? 'Someone'
}

async function buildProps(
  c: Ctx,
  weddingId: string,
  member: WeddingMember,
  user: User,
  basePath: string,
  opts?: { editId?: string; flash?: string }
): Promise<TimelineProps> {
  const viewer = viewerOf(user, member)
  const [allItems, roster, lead, pendingRaw, wedding] = await Promise.all([
    listTimeline(c.env.DB, weddingId),
    resolveWeddingRoster(c.env.DB, weddingId),
    getTimelineLead(c.env.DB, weddingId),
    listPendingTimelineRequests(c.env.DB, weddingId),
    getWedding(c.env.DB, weddingId),
  ])
  const i18n = getI18n()
  const sun = wedding
    ? daylightStrip({
        lat: wedding.location_lat,
        lng: wedding.location_lng,
        dateStr: wedding.date,
        country: wedding.location_country,
        state: wedding.location_state,
        fallbackTimezone: i18n.timezone,
        locale: i18n.locale,
      })
    : null
  const items = allItems.filter((i) => canSeeItem(i, viewer))
  const canDecide = isTimelineLead(lead, viewer.userId)
  const pending: PendingView[] = pendingRaw
    .filter((r) => r.target === 'run_sheet' && (canDecide || r.requested_by_user_id === viewer.userId))
    .map((r) => {
      const p = parsePayload(r)
      return {
        id: r.id,
        op: r.op,
        summary: r.summary ?? '',
        requester: r.requested_by_label ?? 'Someone',
        diff: diffRows(p),
        after: p.after ?? {},
        isOwn: r.requested_by_user_id === viewer.userId,
      }
    })
  return {
    items,
    roster,
    basePath,
    viewer,
    lead,
    leadLabel: await leadLabel(c, weddingId, lead.leadUserIds),
    creatable: creatableVisibilities(viewer),
    pending,
    canDecide,
    editId: opts?.editId,
    flash: opts?.flash,
    sun,
  }
}

export async function renderTimelineSection(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string) {
  return <WeddingTimeline {...(await buildProps(c, weddingId, member, user, basePath))} />
}

function body(c: Ctx, props: TimelineProps) {
  return c.html(<TimelineBody {...props} />)
}

/** Side effects after any APPLIED timeline write. */
function afterWrite(c: Ctx, weddingId: string) {
  const env = c.env
  const vendor = c.get('vendor')
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await projectTimelineToWedding(env.DB, weddingId)
        await resyncWeddingCalendars(env.DB, weddingId, vendor?.id)
        if (vendor) {
          const { pushAllWeddingFiles } = await import('../services/storage-push')
          await pushAllWeddingFiles(env, vendor, weddingId)
        }
      } catch (err) {
        console.error('[timeline] afterWrite failed', err)
      }
    })()
  )
}

export async function renderTimeline(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, opts?: { editId?: string; flash?: string }) {
  return body(c, await buildProps(c, weddingId, member, user, basePath, opts))
}

export async function renderEdit(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, itemId: string) {
  const item = await getItem(c.env.DB, weddingId, itemId)
  return renderTimeline(c, weddingId, member, user, basePath, { editId: item ? itemId : undefined })
}

const PROPOSED_FLASH = (name: string) => t('timeline.pending', { name })

export async function addTimelineItem(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string) {
  const f = await c.req.parseBody()
  const viewer = viewerOf(user, member)
  const creatable = creatableVisibilities(viewer)
  const fields = fieldsFrom(f, creatable)
  if (!str(f.title)) return renderTimeline(c, weddingId, member, user, basePath)

  const lead = await getTimelineLead(c.env.DB, weddingId)
  if (canCreateDirect(viewer, lead, fields.visibility)) {
    await createItem(c.env.DB, { wedding_id: weddingId, ...fields, owner_vendor_id: member.vendor_profile_id, created_by_user_id: user.id })
    afterWrite(c, weddingId)
    return renderTimeline(c, weddingId, member, user, basePath)
  }
  await proposeChange(c.env.DB, {
    weddingId, op: 'create', itemId: null,
    payload: { after: fields, owner_vendor_id: member.vendor_profile_id, created_by_user_id: user.id },
    requestedByUserId: user.id, requestedByLabel: user.name, vendorProfileId: member.vendor_profile_id,
    leadUserIds: lead.leadUserIds, queue: c.env.EMAIL_QUEUE,
  })
  return renderTimeline(c, weddingId, member, user, basePath, { flash: PROPOSED_FLASH(await leadLabel(c, weddingId, lead.leadUserIds)) })
}

export async function updateTimelineItem(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, itemId: string) {
  const item = await getItem(c.env.DB, weddingId, itemId)
  if (!item) return renderTimeline(c, weddingId, member, user, basePath)
  const viewer = viewerOf(user, member)
  const lead = await getTimelineLead(c.env.DB, weddingId)
  const f = await c.req.parseBody()
  const creatable = creatableVisibilities(viewer)
  const after = fieldsFrom(f, creatable)

  if (canEditDirect(item, viewer, lead)) {
    await updateItem(c.env.DB, weddingId, itemId, after)
    afterWrite(c, weddingId)
    return renderTimeline(c, weddingId, member, user, basePath)
  }
  if (canPropose(item, viewer, lead)) {
    const before: Partial<RowFields> = {
      title: item.title, start_time: item.start_time, end_time: item.end_time,
      location: item.location, description: item.description, category: item.category, visibility: item.visibility,
    }
    await proposeChange(c.env.DB, {
      weddingId, op: 'update', itemId, payload: { after, before },
      requestedByUserId: user.id, requestedByLabel: user.name, vendorProfileId: member.vendor_profile_id,
      leadUserIds: lead.leadUserIds, queue: c.env.EMAIL_QUEUE,
    })
    return renderTimeline(c, weddingId, member, user, basePath, { flash: PROPOSED_FLASH(await leadLabel(c, weddingId, lead.leadUserIds)) })
  }
  return renderTimeline(c, weddingId, member, user, basePath)
}

export async function deleteTimelineItem(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, itemId: string) {
  const item = await getItem(c.env.DB, weddingId, itemId)
  if (!item) return renderTimeline(c, weddingId, member, user, basePath)
  const viewer = viewerOf(user, member)
  const lead = await getTimelineLead(c.env.DB, weddingId)
  if (canEditDirect(item, viewer, lead)) {
    await deleteItem(c.env.DB, weddingId, itemId)
    afterWrite(c, weddingId)
    return renderTimeline(c, weddingId, member, user, basePath)
  }
  if (canPropose(item, viewer, lead)) {
    await proposeChange(c.env.DB, {
      weddingId, op: 'delete', itemId, payload: { before: { title: item.title, start_time: item.start_time } },
      requestedByUserId: user.id, requestedByLabel: user.name, vendorProfileId: member.vendor_profile_id,
      leadUserIds: lead.leadUserIds, queue: c.env.EMAIL_QUEUE,
    })
    return renderTimeline(c, weddingId, member, user, basePath, { flash: PROPOSED_FLASH(await leadLabel(c, weddingId, lead.leadUserIds)) })
  }
  return renderTimeline(c, weddingId, member, user, basePath)
}

export async function addTimelineAssignee(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, itemId: string) {
  const item = await getItem(c.env.DB, weddingId, itemId)
  const lead = await getTimelineLead(c.env.DB, weddingId)
  if (item && canManageAssignees(item, viewerOf(user, member), lead)) {
    const f = await c.req.parseBody()
    const who = str(f.who)
    if (who) {
      const roster: RosterEntry[] = await resolveWeddingRoster(c.env.DB, weddingId)
      const match = roster.find((r) => r.name.toLowerCase() === who.toLowerCase())
      if (match?.kind === 'member') await addAssignee(c.env.DB, itemId, { wedding_member_id: match.id })
      else if (match?.kind === 'team') await addAssignee(c.env.DB, itemId, { team_member_id: match.id })
      else await addAssignee(c.env.DB, itemId, { label: who })
      afterWrite(c, weddingId)
    }
  }
  return renderTimeline(c, weddingId, member, user, basePath)
}

export async function removeTimelineAssignee(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, itemId: string, assigneeId: string) {
  const item = await getItem(c.env.DB, weddingId, itemId)
  const lead = await getTimelineLead(c.env.DB, weddingId)
  if (item && canManageAssignees(item, viewerOf(user, member), lead)) {
    await removeAssignee(c.env.DB, itemId, assigneeId)
    afterWrite(c, weddingId)
  }
  return renderTimeline(c, weddingId, member, user, basePath)
}

// ── Approvals (lead only) ──

async function decide(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, requestId: string, approve: boolean) {
  const lead = await getTimelineLead(c.env.DB, weddingId)
  if (!isTimelineLead(lead, user.id)) return renderTimeline(c, weddingId, member, user, basePath)
  const req = await getTimelineRequest(c.env.DB, weddingId, requestId)
  if (!req || req.status !== 'pending') return renderTimeline(c, weddingId, member, user, basePath)

  if (approve) {
    // edit-then-approve: use any edited fields the lead submitted
    let edited: Partial<RowFields> | undefined
    if (req.op !== 'delete') {
      const f = await c.req.parseBody()
      if (str(f.title) != null || 'start_time' in f) {
        edited = fieldsFrom(f, ['couple', 'vendors', 'private'])
      }
    }
    await applyRequest(c.env.DB, req, edited)
    afterWrite(c, weddingId)
  }
  await decideTimelineRequest(c.env.DB, requestId, user.id, approve ? 'approved' : 'declined')
  await c.env.EMAIL_QUEUE
    .send({
      type: 'notify_timeline_change_decided',
      payload: JSON.stringify({ weddingId, requesterUserId: req.requested_by_user_id, deciderLabel: user.name, approved: approve, summary: req.summary }),
    })
    .catch(() => {})
  return renderTimeline(c, weddingId, member, user, basePath)
}

/** A user opts their OWN assignment in/out of their personal calendar feed. */
export async function toggleAssigneeCalendar(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, itemId: string, assigneeId: string) {
  const owner = await assigneeOwnerUserId(c.env.DB, assigneeId)
  if (owner === user.id) {
    const cur = await c.env.DB
      .prepare('SELECT added_to_calendar FROM timeline_item_assignees WHERE id = ? AND timeline_item_id = ?')
      .bind(assigneeId, itemId)
      .first<{ added_to_calendar: number }>()
    if (cur) await setAssigneeCalendar(c.env.DB, assigneeId, cur.added_to_calendar !== 1)
  }
  return renderTimeline(c, weddingId, member, user, basePath)
}

export function approveTimelineRequest(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, requestId: string) {
  return decide(c, weddingId, member, user, basePath, requestId, true)
}

export function declineTimelineRequest(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, requestId: string) {
  return decide(c, weddingId, member, user, basePath, requestId, false)
}
