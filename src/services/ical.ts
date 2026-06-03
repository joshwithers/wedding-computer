import type { EnrichedCalendarEvent } from '../types'

export function buildIcalFeed(
  events: EnrichedCalendarEvent[],
  vendorName: string,
  timezone: string
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
    lines.push(...buildVevent(event, timezone))
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

/** Build a single VEVENT block (no VCALENDAR wrapper). Exported for CalDAV. */
export function buildVevent(event: EnrichedCalendarEvent, timezone: string): string[] {
  const lines: string[] = ['BEGIN:VEVENT']

  lines.push(`UID:${event.id}@weddingcomputer.com`)
  lines.push(`SUMMARY:${escapeIcalText(event.title)}`)
  lines.push(`DTSTAMP:${formatUtcTimestamp(event.created_at)}`)

  if (event.all_day === 1 || !event.start_time) {
    lines.push(`DTSTART;VALUE=DATE:${event.date.replace(/-/g, '')}`)
    lines.push(`DTEND;VALUE=DATE:${nextDay(event.date)}`)
  } else {
    lines.push(`DTSTART;TZID=${timezone}:${formatLocalTimestamp(event.date, event.start_time)}`)
    if (event.end_time) {
      lines.push(`DTEND;TZID=${timezone}:${formatLocalTimestamp(event.date, event.end_time)}`)
    }
  }

  // Rich description with wedding + contact details
  const description = buildEventDescription(event)
  if (description) {
    lines.push(`DESCRIPTION:${escapeIcalText(description)}`)
  }

  // Location from wedding if booking event
  if (event.wedding_location && event.type === 'booking') {
    lines.push(`LOCATION:${escapeIcalText(event.wedding_location)}`)
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

  const hasWeddingData = event.wedding_id && (event.contact_first_name || event.wedding_title)

  if (hasWeddingData) {
    const name1 = [event.contact_first_name, event.contact_last_name].filter(Boolean).join(' ')
    const name2 = [event.partner_first_name, event.partner_last_name].filter(Boolean).join(' ')

    // Couple header
    if (name1 && name2) {
      lines.push(`💒 ${name1} & ${name2}`)
    } else if (name1) {
      lines.push(`💒 ${name1}`)
    } else if (event.wedding_title) {
      lines.push(`💒 ${event.wedding_title}`)
    }

    // Wedding date (if different from event date)
    if (event.wedding_date && event.wedding_date !== event.date) {
      lines.push(`Wedding Date: ${formatDisplayDate(event.wedding_date)}`)
    }

    // Ceremony details
    if (event.wedding_time || event.wedding_location || event.ceremony_type) {
      lines.push('')
      if (event.wedding_time) {
        lines.push(`⛪ Ceremony: ${event.wedding_time}`)
      }
      if (event.wedding_location) {
        lines.push(`📍 ${event.wedding_location}`)
      }
      if (event.ceremony_type) {
        lines.push(`Type: ${capitalize(event.ceremony_type)}`)
      }
      if (event.duration_hours) {
        lines.push(`Duration: ${event.duration_hours}h`)
      }
    }

    // Getting ready
    if (event.getting_ready_time || event.getting_ready_location) {
      lines.push('')
      if (event.getting_ready_time) {
        lines.push(`🏨 Getting Ready: ${event.getting_ready_time}`)
      } else {
        lines.push('🏨 Getting Ready')
      }
      if (event.getting_ready_location) {
        lines.push(`📍 ${event.getting_ready_location}`)
      }
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
    }
  }

  // Original event notes
  if (event.notes) {
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
