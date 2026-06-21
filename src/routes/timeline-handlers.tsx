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
  resolveAndMaterialize,
  weddingSunMinutes,
  setActualStart,
  clearAllActuals,
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
import { markTimelineDirty } from '../services/timeline-notify'
import { listPendingTimelineRequests, getTimelineRequest, decideTimelineRequest } from '../db/timeline-requests'
import { proposeChange, applyRequest, diffRows, parsePayload, type RowFields } from '../services/timeline-approval'
import { getWedding } from '../db/weddings'
import { daylightStrip, sunMinutesFor, resolveLocationTimezone } from '../lib/sun'
import { solveTimeline, minToHhmm, hhmmToMin } from '../lib/timeline-solver'
import { nowTimeString } from '../lib/date'
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

function intOrNull(v: unknown): number | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return null
  const n = parseInt(s, 10)
  return isNaN(n) ? null : n
}

const ANCHOR_REFS_SUN = new Set(['sunrise', 'sunset', 'golden_hour'])
// Sections whose value depends on daylight — only these get a "past sunset"
// warning when they slip; receptions etc. are meant to run after dark.
const SUN_SENSITIVE = new Set<TimelineCategory>(['getting_ready', 'ceremony', 'portraits'])

function fieldsFrom(f: Record<string, unknown>, creatable: TimelineVisibility[]): RowFields {
  // The combined "anchor" select encodes both the kind and the reference
  // (e.g. "after:<id>", "sunbefore:sunset"), so the type and ref can't mismatch.
  // The offset is entered as a positive magnitude; the kind sets the sign
  // (sun-before is earlier than the event). An anchor with no valid reference is
  // dropped so the row stays a plain item rather than resolving to a null clock.
  const anchorRaw = str(f.anchor)
  let anchor_type: 'after' | 'before' | 'sun' | null = null
  let anchor_ref: string | null = null
  let anchor_offset_minutes = 0
  if (anchorRaw) {
    const idx = anchorRaw.indexOf(':')
    const kind = idx >= 0 ? anchorRaw.slice(0, idx) : anchorRaw
    const ref = idx >= 0 ? anchorRaw.slice(idx + 1) : ''
    const mag = Math.abs(intOrNull(f.anchor_offset) ?? 0)
    if ((kind === 'after' || kind === 'before') && ref) {
      anchor_type = kind
      anchor_ref = ref
      anchor_offset_minutes = mag
    } else if (kind === 'sunbefore' && ANCHOR_REFS_SUN.has(ref)) {
      anchor_type = 'sun'
      anchor_ref = ref
      anchor_offset_minutes = -mag
    } else if (kind === 'sunafter' && ANCHOR_REFS_SUN.has(ref)) {
      anchor_type = 'sun'
      anchor_ref = ref
      anchor_offset_minutes = mag
    }
  }
  return {
    title: str(f.title) ?? 'Untitled',
    start_time: str(f.start_time),
    end_time: str(f.end_time),
    location: str(f.location),
    description: str(f.description),
    category: coerceCategory(f.category),
    visibility: coerceVisibility(f.visibility, creatable.length ? creatable : ['couple']),
    duration_minutes: intOrNull(f.duration_minutes),
    anchor_type,
    anchor_ref,
    anchor_offset_minutes,
    pinned: 0,
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
        location: wedding.location,
        city: wedding.location_city,
        country: wedding.location_country,
        state: wedding.location_state,
        fallbackTimezone: i18n.timezone,
        locale: i18n.locale,
      })
    : null
  const sunMin: { sunrise: number | null; sunset: number | null; golden_hour: number | null } =
    (wedding &&
      sunMinutesFor({
        lat: wedding.location_lat,
        lng: wedding.location_lng,
        dateStr: wedding.date,
        location: wedding.location,
        city: wedding.location_city,
        country: wedding.location_country,
        state: wedding.location_state,
        fallbackTimezone: i18n.timezone,
      })) || { sunrise: null, sunset: null, golden_hour: null }
  const items = allItems.filter((i) => canSeeItem(i, viewer))
  // Flag rows whose anchor can't be resolved (cycle, dangling ref) so the UI
  // can warn instead of letting them silently lose their time. Solve over ALL
  // items so cross-visibility references still resolve.
  const solverItems = allItems.map((i) => ({
    id: i.id,
    start_time: i.start_time,
    end_time: i.end_time,
    duration_minutes: i.duration_minutes,
    anchor_type: i.anchor_type,
    anchor_ref: i.anchor_ref,
    anchor_offset_minutes: i.anchor_offset_minutes ?? 0,
    pinned: !!i.pinned,
    actual_start: i.actual_start,
    sort_order: i.sort_order,
  }))
  const solved = solveTimeline(solverItems, sunMin)
  const conflictIds = new Set([...solved.values()].filter((v) => v.conflicts.length > 0).map((v) => v.id))

  // Live mode (the day itself): once any section has an actual start, project the
  // tail by re-solving with actuals so a section running long cascades downstream.
  let live: TimelineProps['live']
  if (allItems.some((i) => i.actual_start)) {
    const projectedSolved = solveTimeline(solverItems, sunMin, { useActual: true })
    const projected = new Map<string, { start: string | null; end: string | null }>()
    const slipIds = new Set<string>()
    const sunsetMin = sunMin.sunset ?? null
    let drift = 0
    let latestActual = -1
    for (const it of allItems) {
      const ps = projectedSolved.get(it.id)
      if (!ps) continue
      projected.set(it.id, { start: minToHhmm(ps.startMin), end: minToHhmm(ps.endMin) })
      // Only daylight-dependent sections raise a "past sunset" flag — the
      // reception and evening sections legitimately run after dark.
      if (sunsetMin != null && ps.endMin != null && ps.endMin > sunsetMin && SUN_SENSITIVE.has(it.category)) {
        slipIds.add(it.id)
      }
      // Running drift = the section started most recently (the live checkpoint),
      // by actual time, vs its planned start.
      if (it.actual_start) {
        const actualMin = hhmmToMin(it.actual_start)
        const planMin = solved.get(it.id)?.startMin ?? null
        if (actualMin != null && planMin != null && actualMin > latestActual) {
          latestActual = actualMin
          drift = actualMin - planMin
        }
      }
    }
    live = { projected, slipIds, drift }
  }
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
    conflictIds,
    live,
  }
}

export async function renderTimelineSection(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string) {
  return <WeddingTimeline {...(await buildProps(c, weddingId, member, user, basePath))} />
}

function body(c: Ctx, props: TimelineProps) {
  return c.html(<TimelineBody {...props} />)
}

/** Side effects after any APPLIED timeline write. */
async function afterWrite(c: Ctx, weddingId: string) {
  const env = c.env
  const vendor = c.get('vendor')
  // A run-sheet change was applied directly (not proposed) — mark the wedding
  // so the debounced cron notifies the rest of the run-sheet team.
  await markTimelineDirty(env.KV, weddingId, c.get('user')?.id ?? '').catch(() => {})
  // Re-solve the liquid timeline and persist concrete start/end times BEFORE we
  // render + project, so display, the legacy slot columns, calendars and
  // markdown all reflect the recomputed clock. (Sun anchors get their minutes
  // wired in Phase B.)
  try {
    await resolveAndMaterialize(env.DB, weddingId, await weddingSunMinutes(env.DB, weddingId))
  } catch (err) {
    console.error('[timeline] materialize failed', err)
  }
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
    await afterWrite(c, weddingId)
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

// Drop "Sunrise" and "Sunset" onto the timeline as sun-anchored items (offset
// 0), so they show the right local time and stay correct if the date/location
// changes. Skips events already present; needs a date + location to compute.
export async function addSunTimes(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string) {
  const sun = await weddingSunMinutes(c.env.DB, weddingId)
  const events: { ref: string; title: string }[] = []
  if (sun.sunrise != null) events.push({ ref: 'sunrise', title: t('timeline.sun.sunrise') })
  if (sun.sunset != null) events.push({ ref: 'sunset', title: t('timeline.sun.sunset') })
  if (events.length === 0) {
    return renderTimeline(c, weddingId, member, user, basePath, { flash: t('timeline.sun.unavailable') })
  }

  // Don't duplicate — skip if a marker with this title already exists. (We match
  // on title, not the sun anchor, so a real event like "Portraits" anchored to
  // sunset doesn't block adding the actual Sunset marker.)
  const existing = await listTimeline(c.env.DB, weddingId)
  const present = (title: string) => existing.some((it) => it.title.trim().toLowerCase() === title.toLowerCase())

  const viewer = viewerOf(user, member)
  // Sun events are facts everyone should see — the couple-visible ("shared") row.
  const visibility: TimelineVisibility = 'couple'
  const lead = await getTimelineLead(c.env.DB, weddingId)

  let created = 0
  let proposed = 0
  for (const ev of events) {
    if (present(ev.title)) continue
    const fields: RowFields = {
      title: ev.title,
      start_time: null,
      end_time: null,
      location: null,
      description: null,
      category: 'other',
      visibility,
      duration_minutes: null,
      anchor_type: 'sun',
      anchor_ref: ev.ref,
      anchor_offset_minutes: 0,
      pinned: 0,
    }
    if (canCreateDirect(viewer, lead, visibility)) {
      await createItem(c.env.DB, { wedding_id: weddingId, ...fields, owner_vendor_id: member.vendor_profile_id, created_by_user_id: user.id })
      created++
    } else {
      await proposeChange(c.env.DB, {
        weddingId, op: 'create', itemId: null,
        payload: { after: fields, owner_vendor_id: member.vendor_profile_id, created_by_user_id: user.id },
        requestedByUserId: user.id, requestedByLabel: user.name, vendorProfileId: member.vendor_profile_id,
        leadUserIds: lead.leadUserIds, queue: c.env.EMAIL_QUEUE,
      })
      proposed++
    }
  }

  if (created > 0) await afterWrite(c, weddingId)
  if (proposed > 0) {
    return renderTimeline(c, weddingId, member, user, basePath, { flash: PROPOSED_FLASH(await leadLabel(c, weddingId, lead.leadUserIds)) })
  }
  if (created === 0) {
    return renderTimeline(c, weddingId, member, user, basePath, { flash: t('timeline.sun.alreadyAdded') })
  }
  return renderTimeline(c, weddingId, member, user, basePath)
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
    await afterWrite(c, weddingId)
    return renderTimeline(c, weddingId, member, user, basePath)
  }
  if (canPropose(item, viewer, lead)) {
    const before: Partial<RowFields> = {
      title: item.title, start_time: item.start_time, end_time: item.end_time,
      location: item.location, description: item.description, category: item.category, visibility: item.visibility,
      duration_minutes: item.duration_minutes, anchor_type: item.anchor_type,
      anchor_ref: item.anchor_ref, anchor_offset_minutes: item.anchor_offset_minutes,
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
    await afterWrite(c, weddingId)
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

/** Live mode: the lead marks a section as started now (or clears it). */
export async function startTimelineItem(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, itemId: string, start: boolean) {
  const item = await getItem(c.env.DB, weddingId, itemId)
  if (!item) return renderTimeline(c, weddingId, member, user, basePath)
  const lead = await getTimelineLead(c.env.DB, weddingId)
  if (!canEditDirect(item, viewerOf(user, member), lead)) return renderTimeline(c, weddingId, member, user, basePath)
  // Stamp the venue's local clock, not the (possibly remote) clicker's.
  let stamp: string | null = null
  if (start) {
    const w = await getWedding(c.env.DB, weddingId)
    const tz = resolveLocationTimezone(w?.location_country, w?.location_state, getI18n().timezone)
    stamp = nowTimeString(tz)
  }
  await setActualStart(c.env.DB, weddingId, itemId, stamp)
  return renderTimeline(c, weddingId, member, user, basePath)
}

/** Live mode: the lead clears every actual start, ending the live view. */
export async function endLiveTimeline(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string) {
  const lead = await getTimelineLead(c.env.DB, weddingId)
  if (!isTimelineLead(lead, user.id)) return renderTimeline(c, weddingId, member, user, basePath)
  await clearAllActuals(c.env.DB, weddingId)
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
      await afterWrite(c, weddingId)
    }
  }
  return renderTimeline(c, weddingId, member, user, basePath)
}

export async function removeTimelineAssignee(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, itemId: string, assigneeId: string) {
  const item = await getItem(c.env.DB, weddingId, itemId)
  const lead = await getTimelineLead(c.env.DB, weddingId)
  if (item && canManageAssignees(item, viewerOf(user, member), lead)) {
    await removeAssignee(c.env.DB, itemId, assigneeId)
    await afterWrite(c, weddingId)
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
    await afterWrite(c, weddingId)
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
