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
  resolveWeddingRoster,
  projectTimelineToWedding,
  resolveAndMaterialize,
  weddingSunMinutes,
  sunMinutesForWedding,
  setActualStart,
  clearAllActuals,
  touchTimelineItemsForWedding,
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
import { markTimelineDirty } from '../services/timeline-notify'
import { appendWeddingLog } from '../db/wedding-log'
import { listPendingTimelineRequests, getTimelineRequest, decideTimelineRequest } from '../db/timeline-requests'
import { proposeChange, applyRequest, diffRows, parsePayload, type RowFields } from '../services/timeline-approval'
import { getWedding } from '../db/weddings'
import { daylightStrip, sunMinutesFor, resolveLocationTimezone } from '../lib/sun'
import { solveTimeline, minToHhmm, hhmmToMin } from '../lib/timeline-solver'
import { nowTimeString, formatDate } from '../lib/date'
import { timed } from '../lib/timing'
import { t, getI18n } from '../i18n'
import { getCouplePartners } from '../services/couple-contact'
import {
  buildWallpaperHtml,
  selectKeyMoments,
  singleSharedLocation,
  firstScheduledLocation,
  sunMarkerMoment,
  eventTypeLabels,
  timeLabel,
  generateTagline,
  resolveExportPalette,
  WALLPAPER_W,
  WALLPAPER_H,
  buildRunSheetPages,
  selectRunSheetMoments,
  RUNSHEET_W,
  RUNSHEET_H,
} from '../services/timeline-export'
import { renderPng, renderPdf } from '../services/og-render'

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
  opts?: {
    editId?: string
    flash?: string
    // Reuse data the save handler already fetched to skip duplicate round-trips
    // on the re-render. Both are invariant across timeline saves (no save mutates
    // the lead membership or the wedding's date/location). Omitted on the
    // read-only GET render path, which self-fetches.
    lead?: Awaited<ReturnType<typeof getTimelineLead>>
    wedding?: Awaited<ReturnType<typeof getWedding>>
    // The roster (people available to assign) is invariant across an assignee
    // add/remove, so those handlers pass theirs through to skip the re-fetch.
    roster?: RosterEntry[]
    // Re-populate the add form after a validation failure (so typed input isn't
    // lost) + an inline error. When omitted, the add form defaults its location
    // to the last item's location.
    addValues?: Partial<RowFields>
    addError?: string
  }
): Promise<TimelineProps> {
  const viewer = viewerOf(user, member)
  // Resolve the lead before the batch so leadLabel can run inside it (instead of
  // a trailing serial round-trip). Reuse the handler's lead when provided.
  const lead = opts?.lead ?? (await getTimelineLead(c.env.DB, weddingId))
  const [allItems, roster, pendingRaw, wedding, leadLbl] = await timed(c, 'tl_render_q', () => Promise.all([
    listTimeline(c.env.DB, weddingId),
    opts?.roster ? Promise.resolve(opts.roster) : resolveWeddingRoster(c.env.DB, weddingId),
    listPendingTimelineRequests(c.env.DB, weddingId),
    opts?.wedding ?? getWedding(c.env.DB, weddingId),
    leadLabel(c, weddingId, lead.leadUserIds),
  ]))
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
    .filter((r) => canDecide || r.requested_by_user_id === viewer.userId)
    .map((r) => {
      const p = parsePayload(r)
      return {
        id: r.id,
        target: r.target,
        op: r.op,
        summary: r.summary ?? '',
        requester: r.requested_by_label ?? 'Someone',
        // Wedding-headline requests (a date/etc. change from the wedding form)
        // carry a flat field map plus a human summary, not a run-sheet
        // before/after — so diffRows is empty and the card leans on the summary.
        // Only run-sheet rows get the per-field diff + edit-then-approve form.
        diff: r.target === 'run_sheet' ? diffRows(p) : [],
        after: p.after ?? {},
        isOwn: r.requested_by_user_id === viewer.userId,
      }
    })
  // Default the next add's location to the last item that has one (people add
  // consecutive run-sheet items at the same venue). Skipped when re-populating
  // after a validation failure (we keep what they typed instead).
  const lastLocation = [...items].reverse().find((i) => !i.marker && i.location)?.location ?? null
  const addValues = opts?.addValues ?? (lastLocation ? { location: lastLocation } : undefined)
  return {
    items,
    roster,
    basePath,
    viewer,
    lead,
    leadLabel: leadLbl,
    creatable: creatableVisibilities(viewer),
    pending,
    canDecide,
    editId: opts?.editId,
    flash: opts?.flash,
    sun,
    conflictIds,
    live,
    addValues,
    addError: opts?.addError,
  }
}

export async function renderTimelineSection(
  c: Ctx,
  weddingId: string,
  member: WeddingMember,
  user: User,
  basePath: string,
  opts?: {
    wedding?: Awaited<ReturnType<typeof getWedding>>
    lead?: Awaited<ReturnType<typeof getTimelineLead>>
  }
) {
  return <WeddingTimeline {...(await buildProps(c, weddingId, member, user, basePath, opts))} />
}

function body(c: Ctx, props: TimelineProps) {
  return c.html(<TimelineBody {...props} />)
}

/** Side effects after any APPLIED timeline write. Returns the wedding it loaded
 *  so the re-render can reuse it instead of fetching it again. Pass `log` to
 *  record the change in the wedding's activity log (written off the response
 *  path, alongside the dirty flag / projection / push). */
/** Deferred side effects shared by every applied timeline write — none of these
 *  block the re-render. Activity log, the debounced "run sheet updated" dirty
 *  flag, the legacy slot-column projection, and the markdown/vault push. */
function deferTimelineSideEffects(
  c: Ctx,
  weddingId: string,
  log?: { action: string; detail?: string | null }
) {
  const env = c.env
  const vendor = c.get('vendor')
  const userId = c.get('user')?.id ?? ''
  c.executionCtx.waitUntil(
    (async () => {
      try {
        if (log) await appendWeddingLog(env.DB, weddingId, userId || null, log.action, log.detail ?? null).catch((e) => console.error('[wedding-log] append failed', e))
        // Mark the wedding dirty so the debounced cron notifies the run-sheet team.
        await markTimelineDirty(env.KV, weddingId, userId).catch(() => {})
        await projectTimelineToWedding(env.DB, weddingId)
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

async function afterWrite(
  c: Ctx,
  weddingId: string,
  log?: { action: string; detail?: string | null },
  preWedding?: Awaited<ReturnType<typeof getWedding>>
) {
  const env = c.env
  // Re-solve the liquid timeline and persist concrete start/end times BEFORE we
  // render + project, so display, the legacy slot columns, calendars and
  // markdown all reflect the recomputed clock. The view renders the persisted
  // start_time, so this MUST stay awaited before the re-render (a deferral here
  // would show new/anchored rows as "—"). One getWedding feeds both this and
  // the re-render. Everything else (dirty flag, projection, calendars, vault
  // push) is deferred so the edit feels instant. NOTE: only call afterWrite for
  // writes that can move the clock — assignee add/remove uses
  // deferTimelineSideEffects directly to skip this SELECT-all-items + re-solve.
  const wedding = preWedding ?? (await getWedding(env.DB, weddingId))
  try {
    await timed(c, 'tl_materialize', () => resolveAndMaterialize(env.DB, weddingId, wedding ? sunMinutesForWedding(wedding) : {}))
  } catch (err) {
    console.error('[timeline] materialize failed', err)
  }
  deferTimelineSideEffects(c, weddingId, log)
  return wedding
}

export async function renderTimeline(
  c: Ctx,
  weddingId: string,
  member: WeddingMember,
  user: User,
  basePath: string,
  opts?: {
    editId?: string
    flash?: string
    lead?: Awaited<ReturnType<typeof getTimelineLead>>
    wedding?: Awaited<ReturnType<typeof getWedding>>
    roster?: RosterEntry[]
    addValues?: Partial<RowFields>
    addError?: string
  }
) {
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
  // Missing title: re-render with what they typed + an inline error, never a
  // blank form (don't make them retype start/end/location/etc).
  if (!str(f.title)) return renderTimeline(c, weddingId, member, user, basePath, { addValues: fields, addError: t('timeline.field.titleRequired') })

  // lead + wedding are independent of the create itself — fetch in parallel and
  // reuse the wedding in afterWrite (saves a serial getWedding on the hot path).
  const [lead, preWedding] = await Promise.all([
    getTimelineLead(c.env.DB, weddingId),
    getWedding(c.env.DB, weddingId),
  ])
  if (canCreateDirect(viewer, lead, fields.visibility)) {
    await createItem(c.env.DB, { wedding_id: weddingId, ...fields, owner_vendor_id: member.vendor_profile_id, created_by_user_id: user.id })
    const wedding = await afterWrite(c, weddingId, { action: 'Timeline item added', detail: fields.title }, preWedding)
    return renderTimeline(c, weddingId, member, user, basePath, { lead, wedding })
  }
  await proposeChange(c.env.DB, {
    weddingId, op: 'create', itemId: null,
    payload: { after: fields, owner_vendor_id: member.vendor_profile_id, created_by_user_id: user.id },
    requestedByUserId: user.id, requestedByLabel: user.name, vendorProfileId: member.vendor_profile_id,
    leadUserIds: lead.leadUserIds, queue: c.env.EMAIL_QUEUE,
  })
  return renderTimeline(c, weddingId, member, user, basePath, { flash: PROPOSED_FLASH(await leadLabel(c, weddingId, lead.leadUserIds)) })
}

// Core: drop "Sunrise"/"Sunset" markers onto the timeline as sun-anchored items
// (offset 0) and materialise their clock. Sunrise/sunset are objective facts of
// the date + venue, so they go straight to the shared (couple-visible) timeline
// with no approval. Skips events already present (title match, so a real
// "Portraits" anchored to sunset doesn't block the actual Sunset marker). Shared
// by the timeline UI handler and the MCP add_sun_times tool. Needs a date +
// location to compute; returns the titles created.
export async function addSunMarkers(
  db: D1Database,
  weddingId: string,
  ownerVendorId: string | null,
  createdByUserId: string
): Promise<{ available: boolean; created: string[] }> {
  const sun = await weddingSunMinutes(db, weddingId)
  const events: { ref: 'sunrise' | 'sunset'; title: string }[] = []
  if (sun.sunrise != null) events.push({ ref: 'sunrise', title: t('timeline.sun.sunrise') })
  if (sun.sunset != null) events.push({ ref: 'sunset', title: t('timeline.sun.sunset') })
  if (events.length === 0) return { available: false, created: [] }

  const existing = await listTimeline(db, weddingId)
  const present = (title: string) => existing.some((it) => it.title.trim().toLowerCase() === title.toLowerCase())

  const created: string[] = []
  for (const ev of events) {
    if (present(ev.title)) continue
    await createItem(db, {
      wedding_id: weddingId,
      title: ev.title,
      start_time: null,
      end_time: null,
      location: null,
      description: null,
      category: 'other',
      visibility: 'couple',
      duration_minutes: null,
      anchor_type: 'sun',
      anchor_ref: ev.ref,
      anchor_offset_minutes: 0,
      pinned: 0,
      marker: ev.ref,
      owner_vendor_id: ownerVendorId,
      created_by_user_id: createdByUserId,
    })
    created.push(ev.title)
  }
  if (created.length > 0) await resolveAndMaterialize(db, weddingId, sun)
  return { available: true, created }
}

export async function addSunTimes(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string) {
  const { available, created } = await addSunMarkers(c.env.DB, weddingId, member.vendor_profile_id, user.id)
  if (!available) {
    return renderTimeline(c, weddingId, member, user, basePath, { flash: t('timeline.sun.unavailable') })
  }
  if (created.length === 0) {
    return renderTimeline(c, weddingId, member, user, basePath, { flash: t('timeline.sun.alreadyAdded') })
  }
  const wedding = await afterWrite(c, weddingId, { action: 'Sun times added', detail: created.join(', ') })
  return renderTimeline(c, weddingId, member, user, basePath, { wedding })
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
    const wedding = await afterWrite(c, weddingId, { action: 'Timeline item updated', detail: after.title ?? item.title })
    return renderTimeline(c, weddingId, member, user, basePath, { lead, wedding })
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
  // Sun markers are facts anyone may add — and remove — directly, no approval.
  if (item.marker) {
    await deleteItem(c.env.DB, weddingId, itemId)
    const wedding = await afterWrite(c, weddingId, { action: 'Timeline item removed', detail: item.title })
    return renderTimeline(c, weddingId, member, user, basePath, { wedding })
  }
  const viewer = viewerOf(user, member)
  const lead = await getTimelineLead(c.env.DB, weddingId)
  if (canEditDirect(item, viewer, lead)) {
    await deleteItem(c.env.DB, weddingId, itemId)
    const wedding = await afterWrite(c, weddingId, { action: 'Timeline item removed', detail: item.title })
    return renderTimeline(c, weddingId, member, user, basePath, { lead, wedding })
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
  if (!canEditDirect(item, viewerOf(user, member), lead)) return renderTimeline(c, weddingId, member, user, basePath, { lead })
  // Stamp the venue's local clock, not the (possibly remote) clicker's.
  let stamp: string | null = null
  let w: Awaited<ReturnType<typeof getWedding>> | undefined
  if (start) {
    w = await getWedding(c.env.DB, weddingId)
    const tz = resolveLocationTimezone(w?.location_country, w?.location_state, getI18n().timezone)
    stamp = nowTimeString(tz)
  }
  await setActualStart(c.env.DB, weddingId, itemId, stamp)
  return renderTimeline(c, weddingId, member, user, basePath, { lead, wedding: w })
}

/** Live mode: the lead clears every actual start, ending the live view. */
export async function endLiveTimeline(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string) {
  const lead = await getTimelineLead(c.env.DB, weddingId)
  if (!isTimelineLead(lead, user.id)) return renderTimeline(c, weddingId, member, user, basePath, { lead })
  await clearAllActuals(c.env.DB, weddingId)
  return renderTimeline(c, weddingId, member, user, basePath, { lead })
}

export async function addTimelineAssignee(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, itemId: string) {
  // item + lead are independent — fetch together instead of two serial waves.
  const [item, lead] = await Promise.all([
    getItem(c.env.DB, weddingId, itemId),
    getTimelineLead(c.env.DB, weddingId),
  ])
  // Reuse the matched roster on the re-render (it's invariant across the write).
  let roster: RosterEntry[] | undefined
  if (item && canManageAssignees(item, viewerOf(user, member), lead)) {
    const f = await c.req.parseBody()
    const who = str(f.who)
    if (who) {
      roster = await resolveWeddingRoster(c.env.DB, weddingId)
      const match = roster.find((r) => r.name.toLowerCase() === who.toLowerCase())
      if (match?.kind === 'member') await addAssignee(c.env.DB, itemId, { wedding_member_id: match.id })
      else if (match?.kind === 'team') await addAssignee(c.env.DB, itemId, { team_member_id: match.id })
      else await addAssignee(c.env.DB, itemId, { label: who })
      // Assignees never move the clock, so skip afterWrite's SELECT-all + re-solve
      // (resolveAndMaterialize) — just run the deferred log/dirty/projection/push.
      deferTimelineSideEffects(c, weddingId)
    }
  }
  return renderTimeline(c, weddingId, member, user, basePath, { lead, roster })
}

export async function removeTimelineAssignee(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, itemId: string, assigneeId: string) {
  const [item, lead] = await Promise.all([
    getItem(c.env.DB, weddingId, itemId),
    getTimelineLead(c.env.DB, weddingId),
  ])
  if (item && canManageAssignees(item, viewerOf(user, member), lead)) {
    await removeAssignee(c.env.DB, itemId, assigneeId)
    // Same as add: no clock change, so skip materialize.
    deferTimelineSideEffects(c, weddingId)
  }
  return renderTimeline(c, weddingId, member, user, basePath, { lead })
}

// ── Approvals (lead only) ──

async function decide(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, requestId: string, approve: boolean) {
  const lead = await getTimelineLead(c.env.DB, weddingId)
  if (!isTimelineLead(lead, user.id)) return renderTimeline(c, weddingId, member, user, basePath, { lead })
  const req = await getTimelineRequest(c.env.DB, weddingId, requestId)
  if (!req || req.status !== 'pending') return renderTimeline(c, weddingId, member, user, basePath, { lead })

  let wedding: Awaited<ReturnType<typeof afterWrite>> | undefined
  if (approve) {
    // edit-then-approve: use any edited fields the lead submitted
    let edited: Partial<RowFields> | undefined
    if (req.op !== 'delete') {
      const f = await c.req.parseBody()
      if (str(f.title) != null || 'start_time' in f) {
        edited = fieldsFrom(f, ['couple', 'vendors', 'private'])
      }
    }
    // Capture a wedding-date change BEFORE applying, so an approved request to
    // set/move/clear the date announces it just like the direct-edit path does.
    let dateChange: { oldDate: string | null; newDate: string | null } | null = null
    if (req.target === 'wedding') {
      try {
        const fields = JSON.parse(req.payload) as Record<string, unknown>
        if ('date' in fields) {
          const before = await getWedding(c.env.DB, weddingId)
          const oldDate = before?.date ?? null
          const newDate = (fields.date as string | null) ?? null
          if (oldDate !== newDate) dateChange = { oldDate, newDate }
        }
      } catch { /* unparseable payload — applyRequest will no-op too */ }
    }

    await applyRequest(c.env.DB, req, edited)
    wedding = await afterWrite(c, weddingId, { action: 'Timeline change approved', detail: req.summary })

    if (dateChange) {
      // Shift the wedding's timeline rows so CalDAV devices re-pull at the new
      // date, then announce. Skip BOTH the approver (acting now) and the
      // requester (who gets the separate "change approved" email below).
      c.executionCtx.waitUntil(touchTimelineItemsForWedding(c.env.DB, weddingId).catch(() => {}))
      c.executionCtx.waitUntil(
        c.env.EMAIL_QUEUE.send({
          type: 'notify_wedding_date_changed',
          payload: JSON.stringify({
            weddingId,
            oldDate: dateChange.oldDate,
            newDate: dateChange.newDate,
            editorUserId: user.id,
            skipUserId: req.requested_by_user_id,
          }),
        }).catch((e: any) => console.error('[timeline] date-change notify enqueue failed', e?.message))
      )
    }
  }
  await decideTimelineRequest(c.env.DB, requestId, user.id, approve ? 'approved' : 'declined')
  // Approvals are logged via afterWrite above; declines apply no write, so log here.
  if (!approve) c.executionCtx.waitUntil(appendWeddingLog(c.env.DB, weddingId, user.id, 'Timeline change declined', req.summary).catch((e) => console.error('[wedding-log] append failed', e)))
  await c.env.EMAIL_QUEUE
    .send({
      type: 'notify_timeline_change_decided',
      payload: JSON.stringify({ weddingId, requesterUserId: req.requested_by_user_id, deciderLabel: user.name, approved: approve, summary: req.summary }),
    })
    .catch(() => {})
  return renderTimeline(c, weddingId, member, user, basePath, { lead, wedding })
}

export function approveTimelineRequest(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, requestId: string) {
  return decide(c, weddingId, member, user, basePath, requestId, true)
}

export function declineTimelineRequest(c: Ctx, weddingId: string, member: WeddingMember, user: User, basePath: string, requestId: string) {
  return decide(c, weddingId, member, user, basePath, requestId, false)
}

/**
 * Shared data load for the timeline exports (wallpaper PNG + run-sheet PDF).
 * Couple names use the richest available surnames (vendor's contact → couple
 * members → title); a warm AI tagline is woven in (cached, best-effort). The
 * caller is already membership-scoped by the route guard. Returns null if the
 * wedding doesn't exist.
 */
async function loadExportData(c: Ctx, weddingId: string) {
  const wedding = await getWedding(c.env.DB, weddingId)
  if (!wedding) return null
  // The downloading vendor's brand styles the export; couples get the house look.
  const vendor = c.get('vendor')
  const [partners, items] = await Promise.all([
    getCouplePartners(c.env.DB, weddingId, { vendorId: vendor?.id, title: wedding.title }),
    listTimeline(c.env.DB, weddingId),
  ])
  const dateLabel = wedding.date ? formatDate(wedding.date) : ''
  const locationLabel =
    [wedding.location_city, wedding.location_state].filter(Boolean).join(', ') || wedding.location || undefined
  // Venue-local sunset, compact (matches the run-sheet's "5:08pm" time style).
  // Best-effort — omitted when there's no date or the place can't be resolved.
  const sunMin = sunMinutesFor({
    lat: wedding.location_lat,
    lng: wedding.location_lng,
    dateStr: wedding.date,
    location: wedding.location,
    city: wedding.location_city,
    country: wedding.location_country,
    state: wedding.location_state,
    fallbackTimezone: getI18n().timezone,
  })
  const sunsetHhmm = sunMin?.sunset != null ? minToHhmm(sunMin.sunset) : null
  // Put the venue-local sunset INTO the schedule (not a header stat) so it reads
  // as a moment in the day, on both exports. Skipped when the couple already
  // dropped a real sunset marker via "add sun times", so it's never doubled.
  const exportItems =
    sunsetHhmm && !items.some((i) => i.marker === 'sunset')
      ? [...items, sunMarkerMoment(weddingId, sunsetHhmm)]
      : items
  // The address for the wallpaper, in priority order: the one venue every item
  // shares → the first scheduled item's venue (when they span places) → the
  // structured ceremony venue → the wedding's location → the city/state label.
  // So there's always a venue line, even for a multi-stop or single-item day.
  const wallpaperAddress =
    singleSharedLocation(items) ||
    firstScheduledLocation(items) ||
    wedding.ceremony_location ||
    wedding.location ||
    locationLabel
  // Event wording from the wedding's type so an elopement isn't presented as a
  // generic "wedding" — drives the overline and the AI tagline's flavour.
  const { noun: eventNoun, label: eventLabel } = eventTypeLabels(wedding.ceremony_type)
  const names = partners.map((p) => p.first).filter(Boolean).join(' & ') || wedding.title
  const tagline = await generateTagline(c.env, { weddingId, names, dateLabel, locationLabel, eventNoun })
  const slug = (names || 'wedding').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'wedding'
  const { palette, display } = resolveExportPalette(vendor?.brand_theme)
  return { wedding, partners, items: exportItems, dateLabel, locationLabel, wallpaperAddress, eventLabel, names, tagline, slug, palette, display }
}

/** Run sheet → phone-lockscreen wallpaper PNG (the ≤8 key moments). */
export async function wallpaperPng(c: Ctx, weddingId: string, _member: WeddingMember, _user: User) {
  const d = await loadExportData(c, weddingId)
  if (!d) return c.text('Not found', 404)
  const html = buildWallpaperHtml({
    partners: d.partners,
    dateLabel: d.dateLabel,
    locationLabel: d.wallpaperAddress,
    tagline: d.tagline,
    eventLabel: d.eventLabel,
    items: selectKeyMoments(d.items),
    palette: d.palette,
  })
  const png = await renderPng(c.env, html, WALLPAPER_W, WALLPAPER_H, d.display)
  return new Response(png, {
    headers: {
      'content-type': 'image/png',
      // inline so it opens in a tab — on a phone the vendor can long-press →
      // save to photos → set as lockscreen; on desktop, right-click → save.
      'content-disposition': `inline; filename="${d.slug}-wallpaper.png"`,
      'cache-control': 'private, max-age=300',
    },
  })
}

/** Run sheet → full printable A4 PDF (every timed item + sun markers, with
 * location and assigned people, paginated). */
export async function runSheetPdf(c: Ctx, weddingId: string, _member: WeddingMember, _user: User) {
  const d = await loadExportData(c, weddingId)
  if (!d) return c.text('Not found', 404)
  const pages = buildRunSheetPages({
    partners: d.partners,
    dateLabel: d.dateLabel,
    locationLabel: d.locationLabel,
    tagline: d.tagline,
    eventLabel: d.eventLabel,
    items: selectRunSheetMoments(d.items),
    palette: d.palette,
  })
  const pdf = await renderPdf(c.env, pages, RUNSHEET_W, RUNSHEET_H, d.display)
  return new Response(pdf, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${d.slug}-run-sheet.pdf"`,
      'cache-control': 'private, max-age=300',
    },
  })
}
