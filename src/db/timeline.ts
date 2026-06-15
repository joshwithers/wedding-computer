// Data layer for the unified wedding timeline (timeline_items + assignees).
// Wedding-wide and ordered; visibility filtering happens in the route via
// services/timeline-permissions. Reuses updateWedding for the projection shim
// that keeps the legacy weddings.* slot columns in step during phases 1-3.

import type { TimelineItem, TimelineItemAssignee, TimelineCategory, TimelineVisibility, TimelineSlot, RunSheetItem } from '../types'
import { updateWedding } from './weddings'

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
  }
): Promise<TimelineItem> {
  const next = await db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM timeline_items WHERE wedding_id = ?')
    .bind(data.wedding_id)
    .first<{ n: number }>()
  const row = await db
    .prepare(
      `INSERT INTO timeline_items
         (wedding_id, start_time, end_time, title, description, location, category,
          owner_vendor_id, created_by_user_id, visibility, slot, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      next?.n ?? 0
    )
    .first<TimelineItem>()
  return row!
}

export async function updateItem(
  db: D1Database,
  weddingId: string,
  id: string,
  patch: Partial<Pick<TimelineItem, 'start_time' | 'end_time' | 'title' | 'description' | 'location' | 'category' | 'visibility' | 'sort_order'>>
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
}

export async function deleteItem(db: D1Database, weddingId: string, id: string): Promise<void> {
  await db.prepare('DELETE FROM timeline_items WHERE id = ? AND wedding_id = ?').bind(id, weddingId).run()
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
}

/** Timeline sections this user is assigned to and has opted into, across weddings. */
export async function listUserCalendarRows(db: D1Database, userId: string): Promise<UserCalendarRow[]> {
  return db
    .prepare(
      `SELECT ti.id, ti.title, ti.start_time, ti.end_time, ti.location, ti.description,
              ti.created_at, ti.updated_at, w.date AS wedding_date, w.title AS wedding_title
       FROM timeline_item_assignees a
       JOIN wedding_members wm ON wm.id = a.wedding_member_id
       JOIN timeline_items ti ON ti.id = a.timeline_item_id
       JOIN weddings w ON w.id = ti.wedding_id
       WHERE wm.user_id = ? AND a.added_to_calendar = 1 AND wm.status = 'active' AND w.date IS NOT NULL
       ORDER BY w.date ASC, (ti.start_time IS NULL), ti.start_time ASC`
    )
    .bind(userId)
    .all<UserCalendarRow>()
    .then((r) => r.results)
}

// ── Roster (for the assignee picker): members + each vendor's assigned staff ──

export async function resolveWeddingRoster(db: D1Database, weddingId: string): Promise<RosterEntry[]> {
  const members = await db
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
    .then((r) => r.results)

  const staff = await db
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
    .then((r) => r.results)

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
    if (existing) {
      const patch: Partial<Pick<TimelineItem, 'start_time' | 'location' | 'title'>> = {}
      if ('start_time' in vals) patch.start_time = vals.start_time ?? null
      if ('location' in vals) patch.location = vals.location ?? null
      if ('title' in vals) patch.title = vals.title || vals.defaultTitle
      await updateItem(db, weddingId, existing.id, patch)
    } else {
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

export async function projectTimelineToWedding(db: D1Database, weddingId: string): Promise<void> {
  const slots = await db
    .prepare("SELECT slot, start_time, location, title FROM timeline_items WHERE wedding_id = ? AND slot IS NOT NULL")
    .bind(weddingId)
    .all<{ slot: TimelineSlot; start_time: string | null; location: string | null; title: string | null }>()
    .then((r) => r.results)
  const by = new Map(slots.map((s) => [s.slot, s]))
  const gr1 = by.get('getting_ready_1')
  const gr2 = by.get('getting_ready_2')
  const cer = by.get('ceremony')
  const por = by.get('portraits')
  const rec = by.get('reception')

  await updateWedding(db, weddingId, {
    time: cer?.start_time ?? null,
    ceremony_location: cer?.location ?? null,
    getting_ready_time: gr1?.start_time ?? null,
    getting_ready_location: gr1?.location ?? null,
    getting_ready_1_label: gr1?.title ?? null,
    getting_ready_2_time: gr2?.start_time ?? null,
    getting_ready_2_location: gr2?.location ?? null,
    getting_ready_2_label: gr2?.title ?? null,
    portrait_time: por?.start_time ?? null,
    portrait_location: por?.location ?? null,
    reception_time: rec?.start_time ?? null,
    reception_location: rec?.location ?? null,
  })
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
}
