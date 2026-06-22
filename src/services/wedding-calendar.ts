/**
 * Shared calendar fan-out for a wedding's timeline.
 *
 * Each timeline slot (ceremony, reception, getting ready, portraits) owns
 * one tagged calendar event per vendor, found again on later saves via a
 * "wc:*" marker in the event notes. Every door that changes timeline
 * fields routes through here so all member vendors' calendars (and their
 * CalDAV/iCal feeds) follow: the web edit form, approved timeline change
 * requests, and storage ingests (vault API, GitHub webhook/sweep).
 */

import type { Wedding } from '../types'
import { createEvent, updateEvent, deleteEvent } from '../db/calendar'
import { addHoursToTime, subtractHoursFromTime } from '../lib/date'

export type WeddingTimelineData = {
  emoji: string | null
  ceremonyTime: string | null
  ceremonyDuration: number
  ceremonyLocation: string | null
  gettingReadyTime: string | null
  gettingReadyLocation: string | null
  gettingReady1Label: string | null
  gettingReady2Time: string | null
  gettingReady2Location: string | null
  gettingReady2Label: string | null
  portraitTime: string | null
  portraitLocation: string | null
  receptionTime: string | null
  receptionLocation: string | null
  receptionDuration: number
}

/** Assemble the calendar-relevant timeline fields from a wedding row. */
export function weddingTimelineData(wedding: Wedding): WeddingTimelineData {
  return {
    emoji: wedding.emoji ?? null,
    ceremonyTime: wedding.time ?? null,
    ceremonyDuration: wedding.duration_hours ?? 1,
    ceremonyLocation: wedding.ceremony_location ?? null,
    gettingReadyTime: wedding.getting_ready_time ?? null,
    gettingReadyLocation: wedding.getting_ready_location ?? null,
    gettingReady1Label: wedding.getting_ready_1_label ?? null,
    gettingReady2Time: wedding.getting_ready_2_time ?? null,
    gettingReady2Location: wedding.getting_ready_2_location ?? null,
    gettingReady2Label: wedding.getting_ready_2_label ?? null,
    portraitTime: wedding.portrait_time ?? null,
    portraitLocation: wedding.portrait_location ?? null,
    receptionTime: wedding.reception_time ?? null,
    receptionLocation: wedding.reception_location ?? null,
    receptionDuration: wedding.reception_duration_hours ?? 3,
  }
}

/**
 * Sync per-location calendar events for one vendor on a wedding.
 * Each location with a time gets its own calendar event, tagged with notes
 * like "wc:ceremony" so they can be found and updated on subsequent saves.
 *
 * Default durations:
 *   Getting ready 1/2 = 1h
 *   Ceremony = duration_hours or 1h, with 1h ceremony prep event before
 *   Portraits = 1h
 *   Reception = 3h
 */
export async function syncWeddingCalendarEvents(
  db: D1Database,
  vendorId: string,
  weddingId: string,
  weddingTitle: string,
  weddingDate: string,
  data: WeddingTimelineData
) {
  // Define the events we want to exist
  type PlannedEvent = {
    tag: string                   // e.g. "wc:ceremony"
    title: string
    startTime: string | null
    endTime: string | null
    location: string | null
    shouldExist: boolean          // false → delete if present
  }

  // Emoji prefix for all event titles
  const pfx = data.emoji ? `${data.emoji} ` : ''

  // The modern run sheet (timeline_items) is the source of truth for the
  // schedule. The calendar feed renders those items directly; here we keep just
  // ONE wc:ceremony anchor per vendor so the wedding still shows on the in-app
  // calendar. The other 5 legacy slot events are retired — shouldExist:false
  // makes resync DELETE any that linger from the old model. (Phase B removes the
  // structured weddings.* columns + this generation entirely.)
  const events: PlannedEvent[] = [
    {
      tag: 'wc:getting_ready_1',
      title: `${pfx}${weddingTitle} — Getting ready`,
      startTime: data.gettingReadyTime,
      endTime: null,
      location: data.gettingReadyLocation,
      shouldExist: false,
    },
    {
      tag: 'wc:getting_ready_2',
      title: `${pfx}${weddingTitle} — Getting ready`,
      startTime: data.gettingReady2Time,
      endTime: null,
      location: data.gettingReady2Location,
      shouldExist: false,
    },
    {
      tag: 'wc:ceremony_prep',
      title: `${pfx}${weddingTitle} — Ceremony prep`,
      startTime: data.ceremonyTime ? subtractHoursFromTime(data.ceremonyTime, 1) : null,
      endTime: data.ceremonyTime,
      location: data.ceremonyLocation,
      shouldExist: false,
    },
    {
      tag: 'wc:ceremony',
      title: `${pfx}${weddingTitle} — Ceremony`,
      startTime: data.ceremonyTime,
      endTime: data.ceremonyTime ? addHoursToTime(data.ceremonyTime, data.ceremonyDuration) : null,
      location: data.ceremonyLocation,
      shouldExist: !!data.ceremonyTime, // wedding-day anchor (in-app calendar) when a time is known
    },
    {
      tag: 'wc:portraits',
      title: `${pfx}${weddingTitle} — Portraits`,
      startTime: data.portraitTime,
      endTime: null,
      location: data.portraitLocation,
      shouldExist: false,
    },
    {
      tag: 'wc:reception',
      title: `${pfx}${weddingTitle} — Reception`,
      startTime: data.receptionTime,
      endTime: null,
      location: data.receptionLocation,
      shouldExist: false,
    },
  ]

  // Fetch all existing tagged events for this wedding
  const existing = await db
    .prepare(
      `SELECT id, notes FROM calendar_events
       WHERE vendor_id = ? AND wedding_id = ? AND notes LIKE 'wc:%'`
    )
    .bind(vendorId, weddingId)
    .all<{ id: string; notes: string }>()
    .then((r) => r.results)

  const existingByTag = new Map(existing.map((e) => [e.notes, e.id]))

  // Also find the legacy "booking" event (no tag) — migrate it to wc:ceremony
  if (!existingByTag.has('wc:ceremony')) {
    const legacy = await db
      .prepare(
        `SELECT id FROM calendar_events
         WHERE vendor_id = ? AND wedding_id = ? AND type = 'booking' AND (notes IS NULL OR notes NOT LIKE 'wc:%')
         LIMIT 1`
      )
      .bind(vendorId, weddingId)
      .first<{ id: string }>()
    if (legacy) {
      existingByTag.set('wc:ceremony', legacy.id)
    }
  }

  for (const planned of events) {
    const existingId = existingByTag.get(planned.tag)

    if (planned.shouldExist) {
      if (existingId) {
        // Update existing
        await updateEvent(db, vendorId, existingId, {
          title: planned.title,
          date: weddingDate,
          start_time: planned.startTime,
          end_time: planned.endTime,
          all_day: planned.startTime ? 0 : 1,
          notes: planned.tag,
        })
      } else {
        // Create new
        await createEvent(db, vendorId, {
          title: planned.title,
          date: weddingDate,
          start_time: planned.startTime,
          end_time: planned.endTime,
          all_day: !planned.startTime,
          type: 'booking',
          wedding_id: weddingId,
          notes: planned.tag,
        })
      }
    } else if (existingId) {
      // Should not exist but does → remove
      await deleteEvent(db, vendorId, existingId)
    }
  }
}

/**
 * Re-derive the tagged calendar events for every active vendor member of a
 * wedding from its current D1 row. One vendor's failure doesn't stop the
 * rest. No-op while the wedding has no date — there is nowhere to put
 * events yet. `fallbackVendorId` covers weddings without member rows
 * (shouldn't happen, but the web form always synced the editor's own
 * calendar as a backstop).
 */
export async function resyncWeddingCalendars(
  db: D1Database,
  weddingId: string,
  fallbackVendorId?: string
): Promise<void> {
  const wedding = await db
    .prepare('SELECT * FROM weddings WHERE id = ?')
    .bind(weddingId)
    .first<Wedding>()
  if (!wedding?.date) return

  const data = weddingTimelineData(wedding)
  // The wc:ceremony event derives its time from the structured headline column
  // (weddings.time), which is only populated from a ceremony SLOT row. When the
  // run-sheet has a Ceremony (or any) item with a time but no slot, that column
  // is null — which used to make the main wedding event ALL-DAY even though the
  // timeline clearly has a time. Fall back to the earliest timeline time
  // (preferring a ceremony-category item) so the event is properly timed.
  if (!data.ceremonyTime) {
    const t = await db
      .prepare(
        `SELECT start_time FROM timeline_items
         WHERE wedding_id = ? AND start_time IS NOT NULL AND marker IS NULL
         ORDER BY (category <> 'ceremony'), start_time ASC
         LIMIT 1`
      )
      .bind(weddingId)
      .first<{ start_time: string }>()
    if (t?.start_time) data.ceremonyTime = t.start_time
  }

  const vendorMembers = await db
    .prepare(
      `SELECT DISTINCT vendor_profile_id FROM wedding_members
       WHERE wedding_id = ? AND status = 'active' AND vendor_profile_id IS NOT NULL`
    )
    .bind(weddingId)
    .all<{ vendor_profile_id: string }>()
    .then((r) => r.results)

  for (const vm of vendorMembers) {
    try {
      await syncWeddingCalendarEvents(db, vm.vendor_profile_id, weddingId, wedding.title, wedding.date, data)
    } catch (err) {
      console.error(`[wedding-calendar] calendar sync failed for vendor ${vm.vendor_profile_id}:`, err)
    }
  }

  if (vendorMembers.length === 0 && fallbackVendorId) {
    await syncWeddingCalendarEvents(db, fallbackVendorId, weddingId, wedding.title, wedding.date, data)
  }
}
