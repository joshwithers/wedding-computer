import type { EnrichedCalendarEvent } from '../types'
import type { UserCalendarRow } from '../db/timeline'
import type { WeddingDayRow } from '../db/weddings'
import { addHoursToTime } from '../lib/date'
import { resolveLocationTimezone } from '../lib/sun'

// Human label for a wc:<slot> booking event when no real run-sheet item is
// matched (the synthetic ceremony-prep block + legacy rows).
const WC_SLOT_LABEL: Record<string, string> = {
  'wc:getting_ready_1': 'Getting ready',
  'wc:getting_ready_2': 'Getting ready',
  'wc:ceremony_prep': 'Ceremony prep',
  'wc:ceremony': 'Ceremony',
  'wc:portraits': 'Portraits',
  'wc:reception': 'Reception',
}

/** The couple's full display name, e.g. "Olivia Smith & Ethan Jones".
 *  Prefers the vendor's own contact (full first+last), then the shared couple
 *  membership (works for added-to weddings), then the wedding title. */
function coupleDisplayName(e: EnrichedCalendarEvent): string | null {
  const name1 = [e.contact_first_name, e.contact_last_name].filter(Boolean).join(' ').trim()
  const name2 = [e.partner_first_name, e.partner_last_name].filter(Boolean).join(' ').trim()
  if (name1 && name2) return `${name1} & ${name2}`
  if (name1) return name1
  if (e.couple_names) return e.couple_names
  return e.wedding_title || null
}

/**
 * A personal calendar feed built from a user's assigned + opted-in timeline
 * sections (one VEVENT per row). Stable UID `ts-<item_id>` so subscribers see
 * in-place updates, never delete+re-add. Reuses the same time/escape helpers
 * as the vendor feed.
 */
export function buildTimelineFeed(
  rows: UserCalendarRow[],
  calName: string,
  timezone: string,
  weddingDays: WeddingDayRow[] = []
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Wedding Computer//Timeline//EN',
    `X-WR-CALNAME:${escapeIcalText(calName)}`,
    `X-WR-TIMEZONE:${timezone}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  for (const r of rows) lines.push(...buildTimelineVevent(r, timezone))
  for (const w of weddingDays) lines.push(...buildWeddingDayVevent(w, timezone))
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

/** Build a single timeline-section VEVENT block (no VCALENDAR wrapper). Exported for CalDAV. */
export function buildTimelineVevent(r: UserCalendarRow, timezone: string): string[] {
  // Show times in the WEDDING venue's local timezone, not the subscriber's.
  const tz = resolveLocationTimezone(r.wedding_location_country, r.wedding_location_state, timezone)
  const couple = r.couple_names || r.wedding_title
  const lines: string[] = ['BEGIN:VEVENT']
  lines.push(`UID:ts-${r.id}@weddingcomputer.com`)
  // Couple full names first, the run-sheet item's own title as the suffix.
  lines.push(`SUMMARY:${escapeIcalText(couple ? `${couple} — ${r.title}` : r.title)}`)
  lines.push(`DTSTAMP:${formatUtcTimestamp(r.created_at)}`)
  if (!r.start_time) {
    lines.push(`DTSTART;VALUE=DATE:${r.wedding_date.replace(/-/g, '')}`)
    lines.push(`DTEND;VALUE=DATE:${nextDay(r.wedding_date)}`)
  } else {
    lines.push(`DTSTART;TZID=${tz}:${formatLocalTimestamp(r.wedding_date, r.start_time)}`)
    const end = r.end_time ?? addHoursToTime(r.start_time, 1)
    lines.push(`DTEND;TZID=${tz}:${formatLocalTimestamp(r.wedding_date, end)}`)
  }
  const loc = r.location ?? r.wedding_location
  if (loc) lines.push(`LOCATION:${escapeIcalText(loc)}`)
  const descLines: string[] = []
  if (r.description) descLines.push(r.description)
  if (couple) {
    if (descLines.length) descLines.push('')
    descLines.push(`💒 ${couple}`)
    if (r.couple_email) descLines.push(`📧 ${r.couple_email}`)
  }
  if (descLines.length) lines.push(`DESCRIPTION:${escapeIcalText(descLines.join('\n'))}`)
  lines.push('TRANSP:OPAQUE', 'CATEGORIES:Wedding')
  if (r.updated_at) lines.push(`LAST-MODIFIED:${formatUtcTimestamp(r.updated_at)}`)
  lines.push('END:VEVENT')
  return lines
}

/**
 * The wedding itself as an ALL-DAY event (DTSTART;VALUE=DATE) for a dated
 * wedding — a day-marker that rides alongside the timed run-sheet items. Stable
 * UID `wd-<wedding_id>` so subscribers see in-place date moves, never
 * delete+re-add. TRANSP:TRANSPARENT keeps it a non-blocking banner so it doesn't
 * double-count busy time with the timeline items.
 */
export function buildWeddingDayVevent(w: WeddingDayRow, timezone: string): string[] {
  // Resolve venue tz for consistency with the other builders (unused for an
  // all-day DATE value, but keeps the signature uniform if we ever add times).
  void resolveLocationTimezone(w.location_country, w.location_state, timezone)
  const couple = w.couple_names || w.wedding_title
  const emoji = w.emoji || '💍'
  const lines: string[] = ['BEGIN:VEVENT']
  lines.push(`UID:wd-${w.id}@weddingcomputer.com`)
  lines.push(`SUMMARY:${escapeIcalText(`${emoji} ${couple} — Wedding day`)}`)
  lines.push(`DTSTAMP:${formatUtcTimestamp(w.created_at)}`)
  lines.push(`DTSTART;VALUE=DATE:${w.date.replace(/-/g, '')}`)
  lines.push(`DTEND;VALUE=DATE:${nextDay(w.date)}`)
  const loc = w.ceremony_location ?? w.location
  if (loc) lines.push(`LOCATION:${escapeIcalText(loc)}`)
  const descLines: string[] = [`💒 ${couple}`]
  if (w.couple_email) descLines.push(`📧 ${w.couple_email}`)
  if (w.time) descLines.push(`⛪ Ceremony: ${w.time}`)
  if (loc) descLines.push(`📍 ${loc}`)
  lines.push(`DESCRIPTION:${escapeIcalText(descLines.join('\n'))}`)
  lines.push('TRANSP:TRANSPARENT', 'CATEGORIES:Wedding')
  if (w.updated_at) lines.push(`LAST-MODIFIED:${formatUtcTimestamp(w.updated_at)}`)
  lines.push('END:VEVENT')
  return lines
}

export function buildIcalFeed(
  events: EnrichedCalendarEvent[],
  vendorName: string,
  timezone: string,
  timelineRows: UserCalendarRow[] = [],
  weddingDays: WeddingDayRow[] = []
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Wedding Computer//Calendar//EN',
    `X-WR-CALNAME:${escapeIcalText(vendorName)}`,
    `X-WR-TIMEZONE:${timezone}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  for (const event of events) {
    // Legacy wc:<slot> booking events are retired — the run sheet (timeline rows
    // below) drives the calendar. Skip defensively in case an upstream filter
    // is ever removed.
    if ((event.notes ?? '').startsWith('wc:')) continue
    lines.push(...buildVevent(event, timezone))
  }

  // The vendor's assigned timeline sections (run-sheet items) ride alongside
  // their manual events. Distinct `ts-` UIDs — never collide with bookings.
  for (const r of timelineRows) {
    lines.push(...buildTimelineVevent(r, timezone))
  }

  // The wedding itself as an all-day marker. Distinct `wd-` UIDs.
  for (const w of weddingDays) {
    lines.push(...buildWeddingDayVevent(w, timezone))
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

/** Build a single VEVENT block (no VCALENDAR wrapper). Exported for CalDAV. */
export function buildVevent(event: EnrichedCalendarEvent, timezone: string): string[] {
  const lines: string[] = ['BEGIN:VEVENT']

  lines.push(`UID:${event.id}@weddingcomputer.com`)

  // For a wc:<slot> booking event, title it "<couple full names> — <run-sheet
  // item title>" (real timeline title, falling back to the slot label) so it
  // matches the run sheet and never says "Ceremony" for a prep block. Manual
  // events (no wc: tag) keep their own title.
  const wcTag = event.notes && event.notes.startsWith('wc:') ? event.notes : null
  if (wcTag) {
    const itemTitle = event.timeline_item_title || WC_SLOT_LABEL[wcTag] || 'Wedding'
    const couple = coupleDisplayName(event)
    lines.push(`SUMMARY:${escapeIcalText(couple ? `${couple} — ${itemTitle}` : itemTitle)}`)
  } else {
    lines.push(`SUMMARY:${escapeIcalText(event.title)}`)
  }
  lines.push(`DTSTAMP:${formatUtcTimestamp(event.created_at)}`)

  // Times in the wedding VENUE's local timezone (derived from its location), not
  // the subscriber's feed timezone.
  const tz = resolveLocationTimezone(event.wedding_location_country, event.wedding_location_state, timezone)
  if (event.all_day === 1 || !event.start_time) {
    lines.push(`DTSTART;VALUE=DATE:${event.date.replace(/-/g, '')}`)
    lines.push(`DTEND;VALUE=DATE:${nextDay(event.date)}`)
  } else {
    lines.push(`DTSTART;TZID=${tz}:${formatLocalTimestamp(event.date, event.start_time)}`)
    if (event.end_time) {
      lines.push(`DTEND;TZID=${tz}:${formatLocalTimestamp(event.date, event.end_time)}`)
    }
  }

  // Rich description with wedding + contact details
  const description = buildEventDescription(event)
  if (description) {
    lines.push(`DESCRIPTION:${escapeIcalText(description)}`)
  }

  // Location — prefer ceremony_location, fall back to city/region
  if (event.type === 'booking') {
    const loc = event.ceremony_location ?? event.wedding_location
    if (loc) lines.push(`LOCATION:${escapeIcalText(loc)}`)
  }

  lines.push('TRANSP:OPAQUE')

  if (event.type === 'booking') {
    lines.push('CATEGORIES:Booking')
  } else if (event.type === 'blocked') {
    lines.push('CATEGORIES:Blocked')
  } else if (event.type === 'personal') {
    lines.push('CATEGORIES:Personal')
  }

  if (event.updated_at) {
    lines.push(`LAST-MODIFIED:${formatUtcTimestamp(event.updated_at)}`)
  }

  lines.push('END:VEVENT')
  return lines
}

/** Build a rich description string with wedding and contact details. */
function buildEventDescription(event: EnrichedCalendarEvent): string {
  const lines: string[] = []

  // The run-sheet item's own note for THIS event leads the description.
  if (event.timeline_item_description) {
    lines.push(event.timeline_item_description)
  }

  const hasWeddingData = event.wedding_id && (event.contact_first_name || event.couple_names || event.wedding_title)

  if (hasWeddingData) {
    const name1 = [event.contact_first_name, event.contact_last_name].filter(Boolean).join(' ')
    const name2 = [event.partner_first_name, event.partner_last_name].filter(Boolean).join(' ')

    if (lines.length) lines.push('')
    // Couple header
    if (name1 && name2) {
      lines.push(`💒 ${name1} & ${name2}`)
    } else if (name1) {
      lines.push(`💒 ${name1}`)
    } else if (event.couple_names) {
      lines.push(`💒 ${event.couple_names}`)
    } else if (event.wedding_title) {
      lines.push(`💒 ${event.wedding_title}`)
    }

    // Wedding date (if different from event date)
    if (event.wedding_date && event.wedding_date !== event.date) {
      lines.push(`Wedding Date: ${formatDisplayDate(event.wedding_date)}`)
    }

    // Ceremony details
    if (event.wedding_time || event.ceremony_location || event.wedding_location || event.ceremony_type) {
      lines.push('')
      if (event.wedding_time) {
        lines.push(`⛪ Ceremony: ${event.wedding_time}`)
      }
      if (event.ceremony_location) {
        lines.push(`📍 ${event.ceremony_location}`)
      } else if (event.wedding_location) {
        lines.push(`📍 ${event.wedding_location}`)
      }
      if (event.ceremony_type) {
        lines.push(`Type: ${capitalize(event.ceremony_type)}`)
      }
      if (event.duration_hours) {
        lines.push(`Duration: ${event.duration_hours}h`)
      }
    }

    // Getting ready (party 1)
    if (event.getting_ready_time || event.getting_ready_location) {
      lines.push('')
      const label1 = event.getting_ready_1_label ?? 'Party 1'
      if (event.getting_ready_time) {
        lines.push(`🏨 Getting Ready (${label1}): ${event.getting_ready_time}`)
      } else {
        lines.push(`🏨 Getting Ready (${label1})`)
      }
      if (event.getting_ready_location) {
        lines.push(`📍 ${event.getting_ready_location}`)
      }
    }

    // Getting ready (party 2)
    if (event.getting_ready_2_location) {
      lines.push('')
      const label2 = event.getting_ready_2_label ?? 'Party 2'
      lines.push(`🏨 Getting Ready (${label2})`)
      lines.push(`📍 ${event.getting_ready_2_location}`)
    }

    // Portraits
    if (event.portrait_location) {
      lines.push('')
      lines.push(`📸 Portraits`)
      lines.push(`📍 ${event.portrait_location}`)
    }

    // Reception
    if (event.reception_time || event.reception_location) {
      lines.push('')
      if (event.reception_time) {
        lines.push(`🥂 Reception: ${event.reception_time}`)
      } else {
        lines.push('🥂 Reception')
      }
      if (event.reception_location) {
        lines.push(`📍 ${event.reception_location}`)
      }
    }

    // Extra details
    if (event.dress_code || event.guest_count) {
      lines.push('')
      if (event.dress_code) lines.push(`👔 Dress Code: ${event.dress_code}`)
      if (event.guest_count) lines.push(`👥 Guests: ${event.guest_count}`)
    }

    // Contact details
    if (name1 || name2) {
      lines.push('')
      lines.push('━━━━━━━━━━━━━━━━━━')
      if (name1) {
        lines.push(`👤 ${name1}`)
        if (event.contact_email) lines.push(`📧 ${event.contact_email}`)
        if (event.contact_phone) lines.push(`📱 ${event.contact_phone}`)
      }
      if (name2) {
        if (name1) lines.push('')
        lines.push(`👤 ${name2}`)
        if (event.partner_email) lines.push(`📧 ${event.partner_email}`)
        if (event.partner_phone) lines.push(`📱 ${event.partner_phone}`)
      }
    } else if (event.couple_email || event.couple_names) {
      // No contact of our own (a wedding we were added to) — still surface the
      // couple from the shared membership so the vendor can reach them.
      lines.push('')
      lines.push('━━━━━━━━━━━━━━━━━━')
      if (event.couple_names) lines.push(`👤 ${event.couple_names}`)
      if (event.couple_email) lines.push(`📧 ${event.couple_email}`)
    }
  }

  // Original event notes (skip the internal wc:<slot> sync tag — not for humans)
  if (event.notes && !event.notes.startsWith('wc:')) {
    if (lines.length > 0) {
      lines.push('')
      lines.push('━━━━━━━━━━━━━━━━━━')
    }
    lines.push(`📝 ${event.notes}`)
  }

  // Timeline notes from wedding
  if (event.timeline_notes) {
    lines.push('')
    lines.push(`🗓️ Timeline: ${event.timeline_notes}`)
  }

  // Wedding notes
  if (event.wedding_notes) {
    lines.push('')
    lines.push(`💭 ${event.wedding_notes}`)
  }

  return lines.join('\n')
}

export function escapeIcalText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function formatUtcTimestamp(iso: string): string {
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'
  const d = new Date(normalized)
  if (isNaN(d.getTime())) {
    const now = new Date()
    return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}T000000Z`
  }
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const h = String(d.getUTCHours()).padStart(2, '0')
  const min = String(d.getUTCMinutes()).padStart(2, '0')
  const s = String(d.getUTCSeconds()).padStart(2, '0')
  return `${y}${m}${day}T${h}${min}${s}Z`
}

function formatLocalTimestamp(date: string, time: string): string {
  const [h, m] = time.split(':')
  return `${date.replace(/-/g, '')}T${h.padStart(2, '0')}${m.padStart(2, '0')}00`
}

function nextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function formatDisplayDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00')
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
  } catch {
    return dateStr
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
