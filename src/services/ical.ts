import type { CalendarEvent } from '../types'

export function buildIcalFeed(
  events: CalendarEvent[],
  vendorName: string,
  timezone: string
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Wedding Computer//Calendar//EN',
    `X-WR-CALNAME:${escapeText(vendorName)}`,
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

function buildVevent(event: CalendarEvent, timezone: string): string[] {
  const lines: string[] = ['BEGIN:VEVENT']

  lines.push(`UID:${event.id}@weddingcomputer.com`)
  lines.push(`SUMMARY:${escapeText(event.title)}`)
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

  if (event.notes) {
    lines.push(`DESCRIPTION:${escapeText(event.notes)}`)
  }

  const status = event.type === 'blocked' ? 'BUSY' : 'BUSY'
  lines.push(`TRANSP:OPAQUE`)

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

function escapeText(text: string): string {
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
