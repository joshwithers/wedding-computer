// Permission model for the unified wedding timeline.
//
// Two ideas:
//  1. Every wedding ALWAYS has a timeline LEAD — the schedule's owner/approver.
//     Resolved by precedence: planner/venue (can_manage) → couple → creating /
//     first vendor. Never empty. Non-lead edits to SHARED rows route to the lead
//     (the approval flow, phase 2).
//  2. Per-row VISIBILITY (couple / vendors / private) gates who can see a row,
//     mirroring the wedding_docs scopes.

import { getTimelineControllers } from '../db/timeline-requests'
import type { TimelineItem } from '../types'

export type TimelineLeadSource = 'planner_venue' | 'couple' | 'vendor_fallback'

export type TimelineLead = {
  /** user_ids who own/approve the schedule (never empty unless the wedding has no members). */
  leadUserIds: string[]
  source: TimelineLeadSource
}

/**
 * The always-resolved owner(s) of a wedding's timeline. Precedence:
 *   1. planner/venue vendors with can_manage (the existing "controllers")
 *   2. else the couple
 *   3. else the creating vendor, else the earliest active member
 */
export async function getTimelineLead(db: D1Database, weddingId: string): Promise<TimelineLead> {
  const controllers = await getTimelineControllers(db, weddingId)
  if (controllers.length > 0) {
    return { leadUserIds: controllers.map((c) => c.user_id), source: 'planner_venue' }
  }

  const couple = await db
    .prepare(
      `SELECT user_id FROM wedding_members
       WHERE wedding_id = ? AND status = 'active' AND role = 'couple'
       ORDER BY created_at ASC`
    )
    .bind(weddingId)
    .all<{ user_id: string }>()
    .then((r) => r.results)
  if (couple.length > 0) {
    return { leadUserIds: couple.map((m) => m.user_id), source: 'couple' }
  }

  // Fallback: the creating vendor if still active, else the earliest active
  // vendor member, else the earliest active member of any role.
  const creator = await db
    .prepare(
      `SELECT w.created_by_user_id AS uid
       FROM weddings w
       JOIN wedding_members wm ON wm.wedding_id = w.id AND wm.user_id = w.created_by_user_id AND wm.status = 'active'
       WHERE w.id = ?`
    )
    .bind(weddingId)
    .first<{ uid: string }>()
  if (creator?.uid) return { leadUserIds: [creator.uid], source: 'vendor_fallback' }

  const fallback = await db
    .prepare(
      `SELECT user_id FROM wedding_members
       WHERE wedding_id = ? AND status = 'active'
       ORDER BY (role = 'vendor') DESC, created_at ASC
       LIMIT 1`
    )
    .bind(weddingId)
    .first<{ user_id: string }>()
  return { leadUserIds: fallback ? [fallback.user_id] : [], source: 'vendor_fallback' }
}

export function isTimelineLead(lead: TimelineLead, userId: string): boolean {
  return lead.leadUserIds.includes(userId)
}

export type TimelineViewer = {
  userId: string
  role: 'vendor' | 'couple' | 'guest' | string
  vendorProfileId: string | null
}

/** Can this viewer SEE the row, given its visibility scope? */
export function canSeeItem(item: Pick<TimelineItem, 'visibility' | 'owner_vendor_id'>, viewer: TimelineViewer): boolean {
  switch (item.visibility) {
    case 'couple':
      return true // everyone on the wedding
    case 'vendors':
      return viewer.role === 'vendor'
    case 'private':
      return viewer.vendorProfileId != null && item.owner_vendor_id === viewer.vendorProfileId
    default:
      return false
  }
}

/**
 * Can this viewer edit the row DIRECTLY (no approval)? Private rows: the owner
 * vendor only. Shared rows (couple/vendors): ONLY the timeline lead. Everyone
 * else who can see a shared row may PROPOSE a change instead (canPropose), which
 * routes to the lead for approval.
 */
export function canEditDirect(
  item: Pick<TimelineItem, 'visibility' | 'owner_vendor_id'>,
  viewer: TimelineViewer,
  lead: TimelineLead
): boolean {
  if (item.visibility === 'private') {
    return viewer.vendorProfileId != null && item.owner_vendor_id === viewer.vendorProfileId
  }
  return isTimelineLead(lead, viewer.userId)
}

/**
 * Can this viewer PROPOSE a change to a shared row (→ pending for the lead)?
 * Any active member who can see the row and isn't the lead.
 */
export function canPropose(
  item: Pick<TimelineItem, 'visibility' | 'owner_vendor_id'>,
  viewer: TimelineViewer,
  lead: TimelineLead
): boolean {
  if (item.visibility === 'private') return false
  if (!canSeeItem(item, viewer)) return false
  return !isTimelineLead(lead, viewer.userId)
}

/** Show edit/remove controls when the viewer can either edit directly or propose. */
export function canEditOrPropose(
  item: Pick<TimelineItem, 'visibility' | 'owner_vendor_id'>,
  viewer: TimelineViewer,
  lead: TimelineLead
): boolean {
  return canEditDirect(item, viewer, lead) || canPropose(item, viewer, lead)
}

/**
 * Assignees ("who's on this section") are operational and self-service: any
 * member who can see a shared row may add/remove people on it directly (no
 * approval). Private rows: the owner only.
 */
export function canManageAssignees(
  item: Pick<TimelineItem, 'visibility' | 'owner_vendor_id'> & { marker?: TimelineItem['marker'] },
  viewer: TimelineViewer,
  lead: TimelineLead
): boolean {
  // Sun markers are facts of earth — nobody is "on" a sunrise.
  if (item.marker) return false
  if (item.visibility === 'private') return canEditDirect(item, viewer, lead)
  return canSeeItem(item, viewer)
}

/** Can the viewer CREATE a row of this visibility directly (no approval)? */
export function canCreateDirect(
  viewer: TimelineViewer,
  lead: TimelineLead,
  visibility: TimelineItem['visibility']
): boolean {
  if (visibility === 'private') return viewer.vendorProfileId != null
  return isTimelineLead(lead, viewer.userId)
}

/** Visibility scopes this viewer may create rows in. */
export function creatableVisibilities(viewer: TimelineViewer): TimelineItem['visibility'][] {
  if (viewer.role === 'vendor') return ['couple', 'vendors', 'private']
  return ['couple'] // couple/guest create shared (couple-visible) rows
}
