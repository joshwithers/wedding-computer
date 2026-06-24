// Data layer for the unified wedding timeline (timeline_items + assignees).
// Wedding-wide and ordered; visibility filtering happens in the route via
// services/timeline-permissions. Reuses updateWedding for the projection shim
// that keeps the legacy weddings.* slot columns in step during phases 1-3.

import type { TimelineItem, TimelineItemAssignee, TimelineCategory, TimelineVisibility, TimelineSlot, TimelineMarker, RunSheetItem, Wedding } from '../types'
import { updateWedding, getWedding } from './weddings'
import { solveTimeline, minToHhmm, type SolverItem, type SunMinutes } from '../lib/timeline-solver'
import { sunMinutesFor } from '../lib/sun'
import { DEFAULT_TIMEZONE } from '../i18n'

export type AssigneeView = {
  id: string
  itemId: string
  kind: 'member' | 'team' | 'label'
  displayName: string
  subtitle: string | null
  avatarUrl: string | null
  memberId: string | null
  teamMemberId: string | null
  label: string | null
  addedToCalendar: boolean
  /** The login user behind this assignee, if any (for "add to my calendar"). */
  userId: string | null
}

export type TimelineItemView = TimelineItem & { assignees: AssigneeView[] }

/** A pickable participant for the assignee picker. */
export type RosterEntry = {
  kind: 'member' | 'team'
  id: string // wedding_member_id or team_member_id
  name: string
  subtitle: string | null
  avatarUrl: string | null
}

const SLOT_ORDER: Record<TimelineSlot, number> = {
  getting_ready_1: 10,
  getting_ready_2: 20,
  ceremony: 30,
  portraits: 40,
  reception: 50,
}

// ── Items ──

export async function listTimeline(db: D1Database, weddingId: string): Promise<TimelineItemView[]> {
  const items = await db
    .prepare(
      `SELECT * FROM timeline_items WHERE wedding_id = ?
       ORDER BY (start_time IS NULL), start_time ASC, sort_order ASC, created_at ASC`
    )
    .bind(weddingId)
    .all<TimelineItem>()
    .then((r) => r.results)
  if (items.length === 0) return []

  const assignees = await listAssigneesForWedding(db, weddingId)
  const byItem = new Map<string, AssigneeView[]>()
  for (const a of assignees) {
    const arr = byItem.get(a.itemId) ?? []
    arr.push(a)
    byItem.set(a.itemId, arr)
  }
  return items.map((it) => ({ ...it, assignees: byItem.get(it.id) ?? [] }))
}

export async function getItem(db: D1Database, weddingId: string, id: string): Promise<TimelineItem | null> {
  return db
    .prepare('SELECT * FROM timeline_items WHERE id = ? AND wedding_id = ?')
    .bind(id, weddingId)
    .first<TimelineItem>()
}

export async function createItem(
  db: D1Database,
  data: {
    wedding_id: string
    start_time?: string | null
    end_time?: string | null
    title: string
    description?: string | null
    location?: string | null
    category: TimelineCategory
    owner_vendor_id: string | null
    created_by_user_id: string
    visibility: TimelineVisibility
    slot?: TimelineSlot | null
    duration_minutes?: number | null
    anchor_type?: 'after' | 'before' | 'sun' | null
    anchor_ref?: string | null
    anchor_offset_minutes?: number | null
    pinned?: number | null
    marker?: TimelineMarker | null
  }
): Promise<TimelineItem> {
  // Compute sort_order inline via a subquery so creation is a SINGLE round-trip
  // (was a SELECT MAX then INSERT). SQLite serialises writes, so the subquery in
  // each INSERT sees prior rows — this also closes the read-then-write race the
  // two-statement version had under concurrent adds.
  const row = await db
    .prepare(
      `INSERT INTO timeline_items
         (wedding_id, start_time, end_time, title, description, location, category,
          owner_vendor_id, created_by_user_id, visibility, slot, sort_order,
          duration_minutes, anchor_type, anchor_ref, anchor_offset_minutes, pinned, marker)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM timeline_items WHERE wedding_id = ?),
               ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      data.wedding_id,
      data.start_time ?? null,
      data.end_time ?? null,
      data.title,
      data.description ?? null,
      data.location ?? null,
      data.category,
      data.owner_vendor_id,
      data.created_by_user_id,
      data.visibility,
      data.slot ?? null,
      data.wedding_id, // sort_order subquery scope
      data.duration_minutes ?? null,
      data.anchor_type ?? null,
      data.anchor_ref ?? null,
      data.anchor_offset_minutes ?? 0,
      data.pinned ?? 0,
      data.marker ?? null
    )
    .first<TimelineItem>()
  return row!
}

export async function updateItem(
  db: D1Database,
  weddingId: string,
  id: string,
  patch: Partial<
    Pick<
      TimelineItem,
      | 'start_time'
      | 'end_time'
      | 'title'
      | 'description'
      | 'location'
      | 'category'
      | 'visibility'
      | 'sort_order'
      | 'duration_minutes'
      | 'anchor_type'
      | 'anchor_ref'
      | 'anchor_offset_minutes'
      | 'pinned'
    >
  >
): Promise<void> {
  const sets: string[] = []
  const vals: unknown[] = []
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) {
      sets.push(`${k} = ?`)
      vals.push(v)
    }
  }
  if (sets.length === 0) return
  sets.push("updated_at = datetime('now')")
  vals.push(id, weddingId)
  await db.prepare(`UPDATE timeline_items SET ${sets.join(', ')} WHERE id = ? AND wedding_id = ?`).bind(...vals).run()
  // If this is a named headline slot row, keep its derived columns in step (and
  // drop the row if it emptied out) so the timeline-UI / approval / form paths all
  // behave identically — a cleared time/location reflects, not goes stale.
  await reconcileSlotRow(db, weddingId, id)
}

/** Live mode: record (or clear) the real start time of a section on the day. */
export async function setActualStart(db: D1Database, weddingId: string, id: string, value: string | null): Promise<void> {
  await db
    .prepare("UPDATE timeline_items SET actual_start = ?, updated_at = datetime('now') WHERE id = ? AND wedding_id = ?")
    .bind(value, id, weddingId)
    .run()
}

/** Live mode: clear every actual start, ending live mode in one action. */
export async function clearAllActuals(db: D1Database, weddingId: string): Promise<void> {
  await db
    .prepare("UPDATE timeline_items SET actual_start = NULL, updated_at = datetime('now') WHERE wedding_id = ? AND actual_start IS NOT NULL")
    .bind(weddingId)
    .run()
}

export async function deleteItem(db: D1Database, weddingId: string, id: string): Promise<void> {
  const row = await db
    .prepare('SELECT slot FROM timeline_items WHERE id = ? AND wedding_id = ?')
    .bind(id, weddingId)
    .first<{ slot: TimelineSlot | null }>()
  await db.prepare('DELETE FROM timeline_items WHERE id = ? AND wedding_id = ?').bind(id, weddingId).run()
  // The non-destructive projection won't blank a now-missing slot's columns, so
  // clear them here when a named headline slot row is removed.
  if (row?.slot) await clearSlotColumns(db, weddingId, row.slot)
}

/** Rewrite sort_order to match the given id order (batched). */
export async function reorderItems(db: D1Database, weddingId: string, orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return
  const stmts = orderedIds.map((id, i) =>
    db
      .prepare("UPDATE timeline_items SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND wedding_id = ?")
      .bind(i, id, weddingId)
  )
  await db.batch(stmts)
}

// ── Liquid timeline: solve + materialise ──

function toSolverItem(it: TimelineItem): SolverItem {
  return {
    id: it.id,
    start_time: it.start_time,
    end_time: it.end_time,
    duration_minutes: it.duration_minutes,
    anchor_type: it.anchor_type,
    anchor_ref: it.anchor_ref,
    anchor_offset_minutes: it.anchor_offset_minutes ?? 0,
    pinned: !!it.pinned,
    actual_start: it.actual_start,
    sort_order: it.sort_order,
  }
}

/**
 * Re-solve the wedding's timeline and persist each computed start/end back into
 * start_time / end_time, so every downstream reader (display, the legacy slot
 * projection, calendar, markdown, MCP) sees concrete times without needing to
 * know about anchors. Only writes computed rows (anchored or duration-bearing)
 * whose value actually changed. Call synchronously after any timeline write,
 * before rendering + projection.
 */
/** Sun events (sunrise/sunset/golden_hour) in the wedding's local clock, as
 * solver anchor inputs. Empty when the wedding has no coordinates/date. */
/** Sun minutes for an already-loaded wedding row (avoids a duplicate getWedding). */
export function sunMinutesForWedding(w: Wedding): SunMinutes {
  return (
    sunMinutesFor({
      lat: w.location_lat,
      lng: w.location_lng,
      dateStr: w.date,
      location: w.location,
      city: w.location_city,
      country: w.location_country,
      state: w.location_state,
      fallbackTimezone: DEFAULT_TIMEZONE,
    }) ?? {}
  )
}

export async function weddingSunMinutes(db: D1Database, weddingId: string): Promise<SunMinutes> {
  const w = await getWedding(db, weddingId)
  return w ? sunMinutesForWedding(w) : {}
}

export async function resolveAndMaterialize(db: D1Database, weddingId: string, sun: SunMinutes = {}): Promise<void> {
  const items = await db
    .prepare('SELECT * FROM timeline_items WHERE wedding_id = ?')
    .bind(weddingId)
    .all<TimelineItem>()
    .then((r) => r.results)
  if (items.length === 0) return

  const solved = solveTimeline(items.map(toSolverItem), sun)
  const stmts: D1PreparedStatement[] = []
  for (const it of items) {
    const s = solved.get(it.id)
    if (!s) continue
    // Plain absolute rows are their own source of truth — leave them alone.
    if (it.anchor_type == null && it.duration_minutes == null) continue
    const newStart = minToHhmm(s.startMin)
    // End comes from an explicit duration; without one the row is a point in
    // time (end cleared) rather than a zero-length "HH:MM–HH:MM" span.
    const newEnd = it.duration_minutes != null && s.startMin != null ? minToHhmm(s.startMin + it.duration_minutes) : null
    if (newStart !== it.start_time || newEnd !== it.end_time) {
      stmts.push(
        db
          .prepare("UPDATE timeline_items SET start_time = ?, end_time = ?, updated_at = datetime('now') WHERE id = ? AND wedding_id = ?")
          .bind(newStart, newEnd, it.id, weddingId)
      )
    }
  }
  if (stmts.length > 0) await db.batch(stmts)
}

// ── Assignees ──

async function listAssigneesForWedding(db: D1Database, weddingId: string): Promise<AssigneeView[]> {
  const rows = await db
    .prepare(
      `SELECT a.*, u.id AS member_user_id, u.name AS member_user_name, u.avatar_url AS member_avatar,
              wm.role AS member_role, wm.vendor_role AS member_vendor_role,
              vp.business_name AS member_business,
              tm.name AS team_name, tm.avatar_url AS team_avatar, tm.title AS team_title
       FROM timeline_item_assignees a
       JOIN timeline_items ti ON ti.id = a.timeline_item_id AND ti.wedding_id = ?
       LEFT JOIN wedding_members wm ON wm.id = a.wedding_member_id
       LEFT JOIN users u ON u.id = wm.user_id
       LEFT JOIN vendor_profiles vp ON vp.id = wm.vendor_profile_id
       LEFT JOIN team_members tm ON tm.id = a.team_member_id`
    )
    .bind(weddingId)
    .all<Record<string, unknown>>()
    .then((r) => r.results)

  return rows.map((r) => {
    const kind: AssigneeView['kind'] = r.team_member_id ? 'team' : r.wedding_member_id ? 'member' : 'label'
    const displayName =
      (r.team_name as string) ||
      (r.member_business as string) ||
      (r.member_user_name as string) ||
      (r.label as string) ||
      'Someone'
    const subtitle =
      kind === 'team'
        ? ((r.team_title as string) ?? null)
        : kind === 'member'
          ? ((r.member_vendor_role as string) ?? (r.member_role as string) ?? null)
          : null
    return {
      id: r.id as string,
      itemId: r.timeline_item_id as string,
      kind,
      displayName,
      subtitle,
      avatarUrl: ((r.team_avatar as string) || (r.member_avatar as string)) ?? null,
      memberId: (r.wedding_member_id as string) ?? null,
      teamMemberId: (r.team_member_id as string) ?? null,
      label: (r.label as string) ?? null,
      addedToCalendar: r.added_to_calendar === 1,
      userId: (r.member_user_id as string) ?? null,
    }
  })
}

export async function addAssignee(
  db: D1Database,
  itemId: string,
  who: { wedding_member_id?: string | null; team_member_id?: string | null; label?: string | null }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO timeline_item_assignees (timeline_item_id, wedding_member_id, team_member_id, label)
       VALUES (?, ?, ?, ?)`
    )
    .bind(itemId, who.wedding_member_id ?? null, who.team_member_id ?? null, who.label ?? null)
    .run()
}

export async function removeAssignee(db: D1Database, itemId: string, assigneeId: string): Promise<void> {
  await db
    .prepare('DELETE FROM timeline_item_assignees WHERE id = ? AND timeline_item_id = ?')
    .bind(assigneeId, itemId)
    .run()
}

/** Toggle a person's calendar opt-in for a section (scoped to their identity). */
export async function setAssigneeCalendar(
  db: D1Database,
  assigneeId: string,
  on: boolean
): Promise<void> {
  await db
    .prepare('UPDATE timeline_item_assignees SET added_to_calendar = ? WHERE id = ?')
    .bind(on ? 1 : 0, assigneeId)
    .run()
}

/** The login user behind an assignee row (for guarding "add to my calendar"). */
export async function assigneeOwnerUserId(db: D1Database, assigneeId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT wm.user_id FROM timeline_item_assignees a
       JOIN wedding_members wm ON wm.id = a.wedding_member_id
       WHERE a.id = ?`
    )
    .bind(assigneeId)
    .first<{ user_id: string }>()
  return row?.user_id ?? null
}

export type UserCalendarRow = {
  id: string
  title: string
  wedding_title: string
  wedding_date: string
  start_time: string | null
  end_time: string | null
  location: string | null
  description: string | null
  created_at: string
  updated_at: string
  // Couple identity + venue timezone, so the timeline feed shows full names,
  // contact details and venue-local times (mirrors EnrichedCalendarEvent).
  couple_names: string | null
  couple_email: string | null
  wedding_location: string | null
  wedding_location_state: string | null
  wedding_location_country: string | null
}

// Shared SELECT for calendar-bound timeline rows. The WHERE supplies the
// scoping predicate (per-user, or per-vendor-profile) plus the opted-in/active
// filters; callers append id filters + ORDER BY. `{SCOPE}` is substituted with
// the scoping column so the rest of the query stays identical.
const CALENDAR_ROW_SELECT = (scopeCol: string, visClause: string) =>
  `SELECT ti.id, ti.title, ti.start_time, ti.end_time, ti.location, ti.description,
              ti.created_at, ti.updated_at, w.date AS wedding_date, w.title AS wedding_title,
              w.location AS wedding_location, w.location_state AS wedding_location_state,
              w.location_country AS wedding_location_country,
              (SELECT GROUP_CONCAT(cu.name, ' & ') FROM wedding_members cwm JOIN users cu ON cu.id = cwm.user_id
                 WHERE cwm.wedding_id = ti.wedding_id AND cwm.role = 'couple' AND cwm.status = 'active') AS couple_names,
              (SELECT cu.email FROM wedding_members cwm JOIN users cu ON cu.id = cwm.user_id
                 WHERE cwm.wedding_id = ti.wedding_id AND cwm.role = 'couple' AND cwm.status = 'active'
                 ORDER BY cwm.created_at LIMIT 1) AS couple_email
       FROM timeline_item_assignees a
       JOIN wedding_members wm ON wm.id = a.wedding_member_id
       JOIN timeline_items ti ON ti.id = a.timeline_item_id
       JOIN weddings w ON w.id = ti.wedding_id
       WHERE wm.${scopeCol} = ? AND wm.status = 'active' AND w.date IS NOT NULL
         -- markers (sun rows) aren't events; respect timeline visibility so a
         -- private/vendors-only item never leaks onto the wrong calendar.
         AND ti.marker IS NULL AND (${visClause})`

// A couple/guest only sees 'couple' items; a vendor sees couple + vendors-only +
// their own private items (mirrors canSeeItem in services/timeline-permissions).
const USER_CALENDAR_SELECT = CALENDAR_ROW_SELECT('user_id', "ti.visibility = 'couple'")
const VENDOR_CALENDAR_SELECT = CALENDAR_ROW_SELECT(
  'vendor_profile_id',
  "ti.visibility IN ('couple','vendors') OR ti.owner_vendor_id = wm.vendor_profile_id",
)

/** Timeline sections this user is assigned to and has opted into, across weddings. */
export async function listUserCalendarRows(db: D1Database, userId: string): Promise<UserCalendarRow[]> {
  return db
    .prepare(`${USER_CALENDAR_SELECT}
       ORDER BY w.date ASC, (ti.start_time IS NULL), ti.start_time ASC`)
    .bind(userId)
    .all<UserCalendarRow>()
    .then((r) => r.results)
}

// ── Vendor-scoped variants for the vendor's business feed (iCal + CalDAV) ──
// Keyed on the vendor PROFILE, not its owner user — a vendor's membership user
// is not always the profile owner, and a vendor wants every section assigned to
// any of its own memberships.

/** Timeline sections assigned to this vendor (any membership) + opted in. */
export async function listVendorCalendarRows(db: D1Database, vendorId: string): Promise<UserCalendarRow[]> {
  return db
    .prepare(`${VENDOR_CALENDAR_SELECT}
       ORDER BY w.date ASC, (ti.start_time IS NULL), ti.start_time ASC`)
    .bind(vendorId)
    .all<UserCalendarRow>()
    .then((r) => r.results)
}

/** A single calendar-bound timeline row, scoped to the vendor (CalDAV GET). */
export async function getVendorCalendarRow(
  db: D1Database,
  vendorId: string,
  itemId: string
): Promise<UserCalendarRow | null> {
  return db
    .prepare(`${VENDOR_CALENDAR_SELECT} AND ti.id = ? LIMIT 1`)
    .bind(vendorId, itemId)
    .first<UserCalendarRow>()
}

/**
 * Calendar-bound timeline rows by id, scoped to the vendor (CalDAV multiget).
 * The id list comes from a client-supplied REPORT body, so chunk the IN clause
 * (≤99 + the vendor bind) to stay under D1's bound-parameter ceiling — mirrors
 * listEnrichedEventsByIds in db/calendar.ts.
 */
export async function getVendorCalendarRowsByIds(
  db: D1Database,
  vendorId: string,
  itemIds: string[]
): Promise<UserCalendarRow[]> {
  if (itemIds.length === 0) return []
  const out: UserCalendarRow[] = []
  for (let i = 0; i < itemIds.length; i += 99) {
    const batch = itemIds.slice(i, i + 99)
    const placeholders = batch.map(() => '?').join(', ')
    const rows = await db
      .prepare(`${VENDOR_CALENDAR_SELECT} AND ti.id IN (${placeholders})`)
      .bind(vendorId, ...batch)
      .all<UserCalendarRow>()
      .then((r) => r.results)
    out.push(...rows)
  }
  return out
}

// ── Roster (for the assignee picker): members + each vendor's assigned staff ──

export async function resolveWeddingRoster(db: D1Database, weddingId: string): Promise<RosterEntry[]> {
  // Independent queries — one round-trip, not two serial ones.
  const [members, staff] = await Promise.all([
    db
      .prepare(
        `SELECT wm.id, u.name AS user_name, u.avatar_url, wm.role, wm.vendor_role, vp.business_name
         FROM wedding_members wm
         JOIN users u ON u.id = wm.user_id
         LEFT JOIN vendor_profiles vp ON vp.id = wm.vendor_profile_id
         WHERE wm.wedding_id = ? AND wm.status = 'active'
         ORDER BY wm.role, wm.created_at`
      )
      .bind(weddingId)
      .all<{ id: string; user_name: string; avatar_url: string | null; role: string; vendor_role: string | null; business_name: string | null }>()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT tm.id, tm.name, tm.avatar_url, tm.title, vp.business_name
         FROM wedding_team_assignments wta
         JOIN team_members tm ON tm.id = wta.team_member_id
         JOIN wedding_members wm ON wm.id = wta.wedding_member_id
         LEFT JOIN vendor_profiles vp ON vp.id = wm.vendor_profile_id
         WHERE wta.wedding_id = ?`
      )
      .bind(weddingId)
      .all<{ id: string; name: string; avatar_url: string | null; title: string | null; business_name: string | null }>()
      .then((r) => r.results),
  ])

  const memberEntries: RosterEntry[] = members.map((m) => ({
    kind: 'member',
    id: m.id,
    name: m.business_name || m.user_name,
    subtitle: m.vendor_role || (m.role === 'couple' ? 'Couple' : m.role),
    avatarUrl: m.avatar_url,
  }))
  const staffEntries: RosterEntry[] = staff.map((s) => ({
    kind: 'team',
    id: s.id,
    name: s.name,
    subtitle: [s.title, s.business_name].filter(Boolean).join(' · ') || null,
    avatarUrl: s.avatar_url,
  }))
  return [...memberEntries, ...staffEntries]
}

// ── Headline-field write path ──
// The structured "headline" wedding fields (ceremony / getting-ready / portraits
// / reception time+location+label) are EDITED as the named slot timeline_items
// rows — the source of truth. Field-shaped writers (MCP propose_timeline_change,
// and any legacy field editor) route through here so their edits land on the
// rows and then project to the columns, instead of writing columns that the
// projection would later clobber. date + durations are not slot positions, so
// they stay direct wedding-column fields (returned to the caller to write).

const SLOT_FIELD_MAP: Record<string, { slot: TimelineSlot; attr: 'start_time' | 'location' | 'title'; category: TimelineCategory; defaultTitle: string }> = {
  time: { slot: 'ceremony', attr: 'start_time', category: 'ceremony', defaultTitle: 'Ceremony' },
  ceremony_location: { slot: 'ceremony', attr: 'location', category: 'ceremony', defaultTitle: 'Ceremony' },
  getting_ready_time: { slot: 'getting_ready_1', attr: 'start_time', category: 'getting_ready', defaultTitle: 'Getting ready' },
  getting_ready_location: { slot: 'getting_ready_1', attr: 'location', category: 'getting_ready', defaultTitle: 'Getting ready' },
  getting_ready_1_label: { slot: 'getting_ready_1', attr: 'title', category: 'getting_ready', defaultTitle: 'Getting ready' },
  getting_ready_2_time: { slot: 'getting_ready_2', attr: 'start_time', category: 'getting_ready', defaultTitle: 'Getting ready' },
  getting_ready_2_location: { slot: 'getting_ready_2', attr: 'location', category: 'getting_ready', defaultTitle: 'Getting ready' },
  getting_ready_2_label: { slot: 'getting_ready_2', attr: 'title', category: 'getting_ready', defaultTitle: 'Getting ready' },
  portrait_time: { slot: 'portraits', attr: 'start_time', category: 'portraits', defaultTitle: 'Portraits' },
  portrait_location: { slot: 'portraits', attr: 'location', category: 'portraits', defaultTitle: 'Portraits' },
  reception_time: { slot: 'reception', attr: 'start_time', category: 'reception', defaultTitle: 'Reception' },
  reception_location: { slot: 'reception', attr: 'location', category: 'reception', defaultTitle: 'Reception' },
}

/** The weddings.* columns that map onto timeline slot rows (the headline fields). */
export const HEADLINE_FIELDS = Object.keys(SLOT_FIELD_MAP)

/** Pull just the headline (slot-mapped) fields off a wedding-shaped object. */
export function pickHeadlineFields(w: Record<string, unknown>): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {}
  for (const k of HEADLINE_FIELDS) out[k] = (w[k] as string | number | null | undefined) ?? null
  return out
}

/**
 * Apply field-shaped headline changes to the slot timeline_items rows (upserting
 * each slot). Returns the NON-slot fields (date, durations) for the caller to
 * write directly to the wedding row. Call projectTimelineToWedding afterwards to
 * refresh the derived columns.
 */
export async function applyHeadlineFieldsToTimeline(
  db: D1Database,
  weddingId: string,
  fields: Record<string, string | number | null>,
  createdByUserId: string | null
): Promise<Record<string, string | number | null>> {
  type SlotVals = { start_time?: string | null; location?: string | null; title?: string | null; category: TimelineCategory; defaultTitle: string }
  const bySlot = new Map<TimelineSlot, SlotVals>()
  const direct: Record<string, string | number | null> = {}

  for (const [k, v] of Object.entries(fields)) {
    const m = SLOT_FIELD_MAP[k]
    if (!m) {
      direct[k] = v
      continue
    }
    const cur = bySlot.get(m.slot) ?? { category: m.category, defaultTitle: m.defaultTitle }
    cur[m.attr] = v == null ? null : String(v)
    bySlot.set(m.slot, cur)
  }

  for (const [slot, vals] of bySlot) {
    const existing = await db
      .prepare('SELECT id FROM timeline_items WHERE wedding_id = ? AND slot = ?')
      .bind(weddingId, slot)
      .first<{ id: string }>()
    // A slot with no time, no location, and no custom label carries nothing — keep
    // it out of the timeline so clearing a headline section doesn't leave a ghost
    // "Ceremony — —" row. (Routed slot state is complete, so vals is the full state.)
    const empty = !vals.start_time && !vals.location && (!vals.title || vals.title === vals.defaultTitle)
    if (existing) {
      if (empty) {
        await deleteItem(db, weddingId, existing.id) // also clears the slot's columns
        continue
      }
      const patch: Partial<Pick<TimelineItem, 'start_time' | 'location' | 'title'>> = {}
      if ('start_time' in vals) patch.start_time = vals.start_time ?? null
      if ('location' in vals) patch.location = vals.location ?? null
      if ('title' in vals) patch.title = vals.title || vals.defaultTitle
      await updateItem(db, weddingId, existing.id, patch)
    } else if (!empty) {
      await createItem(db, {
        wedding_id: weddingId,
        slot,
        category: vals.category,
        visibility: 'couple',
        owner_vendor_id: null,
        created_by_user_id: createdByUserId ?? '',
        title: vals.title || vals.defaultTitle,
        start_time: vals.start_time ?? null,
        location: vals.location ?? null,
      })
    }
  }

  return direct
}

// ── Derived read-model: project the named slot rows into weddings.* columns ──
// timeline_items is the SINGLE SOURCE OF TRUTH for the schedule; the legacy
// weddings.* slot columns are a PERMANENT auto-generated read-model that the
// calendar fan-out, iCal/CalDAV/CardDAV feeds, NOIM, the couple/vendor displays,
// and the MCP wedding model (read by the iOS app) all consume. This runs after
// every timeline write so those consumers stay current.

/** Which weddings.* columns each slot row projects into (+ the slot's default title). */
const SLOT_COLUMNS: Record<TimelineSlot, { time: string; location: string; label?: string; defaultTitle: string }> = {
  getting_ready_1: { time: 'getting_ready_time', location: 'getting_ready_location', label: 'getting_ready_1_label', defaultTitle: 'Getting ready' },
  getting_ready_2: { time: 'getting_ready_2_time', location: 'getting_ready_2_location', label: 'getting_ready_2_label', defaultTitle: 'Getting ready' },
  ceremony: { time: 'time', location: 'ceremony_location', defaultTitle: 'Ceremony' },
  portraits: { time: 'portrait_time', location: 'portrait_location', defaultTitle: 'Portraits' },
  reception: { time: 'reception_time', location: 'reception_location', defaultTitle: 'Reception' },
}

/**
 * Keep a named slot row's derived weddings.* columns in step after a DIRECT row
 * edit (the timeline-UI and approval paths call updateItem without going through
 * applyWeddingUpdate's column compensation). Mirrors the row's current attrs onto
 * its columns — INCLUDING nulls, so clearing a headline time/location via the UI
 * actually clears the column the non-destructive projection would otherwise leave
 * stale — and drops the row entirely when it has emptied out (no ghost section).
 */
async function reconcileSlotRow(db: D1Database, weddingId: string, id: string): Promise<void> {
  const r = await db
    .prepare('SELECT slot, start_time, location, title FROM timeline_items WHERE id = ? AND wedding_id = ?')
    .bind(id, weddingId)
    .first<{ slot: TimelineSlot | null; start_time: string | null; location: string | null; title: string | null }>()
  if (!r?.slot) return // freeform row — no headline columns to sync
  const cols = SLOT_COLUMNS[r.slot]
  const empty = !r.start_time && !r.location && (!r.title || r.title === cols.defaultTitle)
  if (empty) {
    await deleteItem(db, weddingId, id) // also clears the slot's columns
    return
  }
  const patch: Record<string, string | null> = { [cols.time]: r.start_time ?? null, [cols.location]: r.location ?? null }
  if (cols.label) patch[cols.label] = r.title ?? null
  await updateWedding(db, weddingId, patch as any)
}

export async function projectTimelineToWedding(db: D1Database, weddingId: string): Promise<void> {
  const slots = await db
    .prepare("SELECT slot, start_time, location, title FROM timeline_items WHERE wedding_id = ? AND slot IS NOT NULL")
    .bind(weddingId)
    .all<{ slot: TimelineSlot; start_time: string | null; location: string | null; title: string | null }>()
    .then((r) => r.results)
  const by = new Map(slots.map((s) => [s.slot, s]))

  // NON-DESTRUCTIVE projection, at ATTR granularity: only write a column when the
  // slot row actually carries a value for it. A slot with no row, OR a row whose
  // own attr is null, leaves the matching column untouched — a headline
  // location/label can exist with no time (051 never backfilled a row; no row is
  // made until the time is set), and a column can be populated by a writer that
  // doesn't touch the row (legacy data, the Obsidian wedding.md sync). Blanking
  // those here would silently destroy them. The deliberate CLEAR paths null the
  // column explicitly instead: clearSlotColumns on row delete, and applyWeddingUpdate
  // writing the touched slot's columns directly.
  const patch: Record<string, string> = {}
  for (const [slot, cols] of Object.entries(SLOT_COLUMNS) as [TimelineSlot, { time: string; location: string; label?: string }][]) {
    const r = by.get(slot)
    if (!r) continue
    if (r.start_time != null) patch[cols.time] = r.start_time
    if (r.location != null) patch[cols.location] = r.location
    if (cols.label && r.title != null) patch[cols.label] = r.title
  }
  if (Object.keys(patch).length > 0) await updateWedding(db, weddingId, patch as any)
}

/**
 * Clear the weddings.* columns for a slot — used when its slot row is DELETED, so
 * the (now non-destructive) projection doesn't leave the columns stale.
 */
export async function clearSlotColumns(db: D1Database, weddingId: string, slot: TimelineSlot): Promise<void> {
  const cols = SLOT_COLUMNS[slot]
  if (!cols) return
  const patch: Record<string, string | null> = { [cols.time]: null, [cols.location]: null }
  if (cols.label) patch[cols.label] = null
  await updateWedding(db, weddingId, patch as any)
}

/**
 * Apply a wedding-details update where the headline TIME/location/label fields are
 * routed onto the timeline slot rows (the single source of truth) instead of being
 * written straight to the derived weddings.* columns — which projectTimelineToWedding
 * would otherwise clobber. Non-slot fields (date, durations, title, location,
 * status, …) are written directly via updateWedding.
 *
 * A slot is touched only when one of its fields actually CHANGES vs `current` (so
 * re-submitting a form with untouched slots never spawns needless rows). When a
 * slot IS touched, its COMPLETE state is routed — every one of its attrs, taking
 * each from `fields` if present else from `current` — so a newly-materialised row
 * always carries the slot's full time+location+label and never drops a sibling
 * the (non-destructive) projection would then surface as null.
 *
 * This is the field-shaped writer the vendor + couple wedding-edit forms, their
 * approved-change applier, wedding creation, and MCP propose_timeline_change all
 * go through, so no writer clobbers the source-of-truth rows.
 */
export async function applyWeddingUpdate(
  db: D1Database,
  weddingId: string,
  fields: Record<string, string | number | null>,
  createdByUserId: string | null,
  current?: Record<string, unknown> | null
): Promise<void> {
  // Columns belonging to each slot (so a touched slot routes its whole state).
  const colsBySlot = new Map<TimelineSlot, string[]>()
  for (const [col, m] of Object.entries(SLOT_FIELD_MAP)) {
    const arr = colsBySlot.get(m.slot) ?? []
    arr.push(col)
    colsBySlot.set(m.slot, arr)
  }

  const routed: Record<string, string | number | null> = {}
  const touched = new Set<TimelineSlot>()
  for (const [k, v] of Object.entries(fields)) {
    const m = SLOT_FIELD_MAP[k]
    if (!m) {
      routed[k] = v // non-slot → direct column write (returned by applyHeadlineFieldsToTimeline)
      continue
    }
    if (!current || (((current as any)[k] ?? null) !== (v ?? null))) touched.add(m.slot)
  }
  // Route the COMPLETE state of every touched slot — sourcing each attr from the
  // submitted fields when present, otherwise from `current` — so a created row is
  // never missing a location/label the caller didn't resubmit (e.g. the couple
  // form omits ceremony_location; MCP sends only the single changed field).
  const touchedCols: Record<string, string | number | null> = {}
  for (const slot of touched) {
    for (const col of colsBySlot.get(slot)!) {
      const v = col in fields ? fields[col] : current ? ((current as any)[col] ?? null) : null
      routed[col] = v
      touchedCols[col] = v
    }
  }

  // applyHeadlineFieldsToTimeline upserts (or, when a slot empties out, removes)
  // the slot rows and returns the non-slot fields for a direct column write. We
  // ALSO write the touched slot columns directly — including explicit nulls — so a
  // CLEAR lands on the column (the non-destructive projection only writes non-null
  // row attrs, so it would otherwise leave a stale value). The projection then
  // re-affirms the row's surviving values and leaves untouched slots alone.
  const direct = await applyHeadlineFieldsToTimeline(db, weddingId, routed, createdByUserId)
  const colWrite = { ...touchedCols, ...direct }
  if (Object.keys(colWrite).length > 0) await updateWedding(db, weddingId, colWrite as any)
  await projectTimelineToWedding(db, weddingId)
}

/** Map a freeform category to the slot used when a row is promoted (unused in P1). */
export const SLOT_SEQUENCE = SLOT_ORDER

// ── timeline_items ⇆ RunSheetItem shape ──
// Lets the existing timeline.md generator/parser/diff (storage/run-sheet-md.ts +
// db/run-sheet diff) and the MCP run-sheet tools drive the UNIFIED timeline
// without changing the markdown format or the MCP shapes. start_time ⇆ time;
// the first assignee's display name ⇆ the 'Who' column.

function toRunSheetRow(item: TimelineItem, assignedTo: string | null): RunSheetItem {
  return {
    id: item.id,
    wedding_id: item.wedding_id,
    vendor_id: item.owner_vendor_id ?? '',
    time: item.start_time,
    end_time: item.end_time,
    title: item.title,
    description: item.description,
    location: item.location,
    assigned_to: assignedTo,
    category: item.category,
    sort_order: item.sort_order,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }
}

async function firstAssigneeLabels(db: D1Database, weddingId: string): Promise<Map<string, string>> {
  const assignees = await listAssigneesForWedding(db, weddingId)
  const m = new Map<string, string>()
  for (const a of assignees) if (!m.has(a.itemId)) m.set(a.itemId, a.displayName)
  return m
}

/** This vendor's OWN timeline rows as RunSheetItem-shaped rows (two-way editable in their vault/MCP). */
export async function listOwnedItemsAsRows(db: D1Database, weddingId: string, vendorId: string): Promise<RunSheetItem[]> {
  const items = await db
    .prepare(
      `SELECT * FROM timeline_items WHERE wedding_id = ? AND owner_vendor_id = ?
       ORDER BY (start_time IS NULL), start_time ASC, sort_order ASC, created_at ASC`
    )
    .bind(weddingId, vendorId)
    .all<TimelineItem>()
    .then((r) => r.results)
  const labels = await firstAssigneeLabels(db, weddingId)
  return items.map((i) => toRunSheetRow(i, labels.get(i.id) ?? null))
}

/** Rows visible to this vendor but owned by others (couple / other vendors), grouped by owner — read-only. */
export async function listVisibleOtherItemRows(
  db: D1Database,
  weddingId: string,
  vendorId: string
): Promise<{ label: string; items: RunSheetItem[] }[]> {
  const rows = await db
    .prepare(
      `SELECT ti.*, vp.business_name AS owner_name
       FROM timeline_items ti
       LEFT JOIN vendor_profiles vp ON vp.id = ti.owner_vendor_id
       WHERE ti.wedding_id = ? AND ti.visibility IN ('couple','vendors')
         AND (ti.owner_vendor_id IS NULL OR ti.owner_vendor_id != ?)
       ORDER BY owner_name, (ti.start_time IS NULL), ti.start_time ASC, ti.sort_order ASC`
    )
    .bind(weddingId, vendorId)
    .all<TimelineItem & { owner_name: string | null }>()
    .then((r) => r.results)
  const labels = await firstAssigneeLabels(db, weddingId)
  const groups = new Map<string, RunSheetItem[]>()
  for (const r of rows) {
    const label = r.owner_name ?? 'Couple'
    const arr = groups.get(label) ?? []
    arr.push(toRunSheetRow(r, labels.get(r.id) ?? null))
    groups.set(label, arr)
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }))
}

export type ParsedRowDiff = {
  creates: { time: string | null; end_time: string | null; title: string; description: string | null; location: string | null; category: TimelineCategory }[]
  updates: { id: string; changes: { time?: string | null; end_time?: string | null; title?: string; description?: string | null; location?: string | null; category?: TimelineCategory; sort_order?: number } }[]
  deletes: string[]
}

/** Apply a parsed-row diff (from the timeline.md/MCP machinery) to the vendor's OWNED timeline rows. */
export async function applyTimelineRowDiff(
  db: D1Database,
  weddingId: string,
  vendorId: string,
  createdByUserId: string | null,
  diff: ParsedRowDiff
): Promise<void> {
  for (const id of diff.deletes) await deleteItem(db, weddingId, id)
  for (const u of diff.updates) {
    const c = u.changes
    await updateItem(db, weddingId, u.id, {
      title: c.title,
      start_time: c.time,
      end_time: c.end_time,
      description: c.description,
      location: c.location,
      category: c.category,
      sort_order: c.sort_order,
    })
  }
  for (const cr of diff.creates) {
    await createItem(db, {
      wedding_id: weddingId,
      title: cr.title || 'Untitled',
      start_time: cr.time,
      end_time: cr.end_time,
      description: cr.description,
      location: cr.location,
      category: cr.category,
      owner_vendor_id: vendorId,
      created_by_user_id: createdByUserId ?? '',
      visibility: 'vendors',
    })
  }
  // Re-solve so anchored/duration rows get concrete times after an external
  // (markdown/Obsidian or MCP) edit, just like the web write path does. Anchored
  // rows are app-governed: a manual time edit in the vault is recomputed from
  // the anchor here rather than sticking.
  await resolveAndMaterialize(db, weddingId, await weddingSunMinutes(db, weddingId))
}
