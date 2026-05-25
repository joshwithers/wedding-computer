import { Hono } from 'hono'
import type { Env, CalendarEvent, VendorProfile } from '../types'
import {
  CALDAV_HEADERS, authenticateVendor, unauthorizedResponse, forbiddenResponse,
  xmlResponse, escXml, makeCTag, makeETag, getDepth, parseHrefsFromBody, isMultiget,
  toICalTimestamp,
} from '../lib/dav'

const caldav = new Hono<Env>()

const DB_BATCH = 99

const PRIVILEGE_SET = `<D:current-user-privilege-set>
  <D:privilege><D:read/></D:privilege>
  <D:privilege><D:read-current-user-privilege-set/></D:privilege>
</D:current-user-privilege-set>`

const SUPPORTED_REPORT_SET = `<D:supported-report-set>
  <D:supported-report><D:report><C:calendar-multiget/></D:report></D:supported-report>
  <D:supported-report><D:report><C:calendar-query/></D:report></D:supported-report>
</D:supported-report-set>`

function auth(c: { req: { raw: Request }; env: { DB: D1Database } }) {
  return authenticateVendor(c.env.DB, c.req.raw.headers.get('Authorization') ?? undefined)
}

function unauth() {
  return unauthorizedResponse('CalDAV', CALDAV_HEADERS)
}

// OPTIONS
caldav.on('OPTIONS', '*', (c) => {
  return new Response(null, { status: 204, headers: CALDAV_HEADERS })
})

// Block writes
for (const method of ['PUT', 'DELETE', 'PATCH', 'MKCOL'] as const) {
  caldav.on(method, '*', () => forbiddenResponse(CALDAV_HEADERS))
}

// PROPFIND /principals/:token/
caldav.on('PROPFIND', '/principals/:token/', async (c) => {
  const vendor = await auth(c)
  if (!vendor) return unauth()
  const token = vendor.ical_token!
  const base = `/caldav`
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>${base}/principals/${escXml(token)}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><D:principal/></D:resourcetype>
        <D:current-user-principal><D:href>${base}/principals/${escXml(token)}/</D:href></D:current-user-principal>
        <D:principal-URL><D:href>${base}/principals/${escXml(token)}/</D:href></D:principal-URL>
        <C:calendar-home-set><D:href>${base}/calendars/${escXml(token)}/</D:href></C:calendar-home-set>
        <D:displayname>${escXml(vendor.business_name)}</D:displayname>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`, 207, CALDAV_HEADERS)
})

// PROPFIND /calendars/:token/
caldav.on('PROPFIND', '/calendars/:token/', async (c) => {
  const vendor = await auth(c)
  if (!vendor) return unauth()
  const token = vendor.ical_token!
  const base = `/caldav`
  const ctag = await makeCTag(c.env.DB, 'calendar_events', 'vendor_id', vendor.id)

  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/" xmlns:A="http://apple.com/ns/ical/">
  <D:response>
    <D:href>${base}/calendars/${escXml(token)}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:displayname>Calendars</D:displayname>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>${base}/calendars/${escXml(token)}/bookings/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
        <D:displayname>${escXml(vendor.business_name)} Bookings</D:displayname>
        <CS:getctag>${escXml(ctag)}</CS:getctag>
        <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
        <C:supported-calendar-data><C:calendar-data content-type="text/calendar" version="2.0"/></C:supported-calendar-data>
        <A:calendar-color>#C53030</A:calendar-color>
        ${SUPPORTED_REPORT_SET}
        ${PRIVILEGE_SET}
        <D:owner><D:href>${base}/principals/${escXml(token)}/</D:href></D:owner>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`, 207, CALDAV_HEADERS)
})

// PROPFIND /calendars/:token/bookings/
caldav.on('PROPFIND', '/calendars/:token/bookings/', async (c) => {
  const vendor = await auth(c)
  if (!vendor) return unauth()
  const token = vendor.ical_token!
  const base = `/caldav`
  const depth = getDepth(c.req.raw)
  const ctag = await makeCTag(c.env.DB, 'calendar_events', 'vendor_id', vendor.id)

  const collectionResponse = `<D:response>
    <D:href>${base}/calendars/${escXml(token)}/bookings/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
        <D:displayname>${escXml(vendor.business_name)} Bookings</D:displayname>
        <CS:getctag>${escXml(ctag)}</CS:getctag>
        <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
        ${SUPPORTED_REPORT_SET}
        ${PRIVILEGE_SET}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`

  if (depth === '0') {
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">
  ${collectionResponse}
</D:multistatus>`, 207, CALDAV_HEADERS)
  }

  const rows = await c.env.DB
    .prepare('SELECT * FROM calendar_events WHERE vendor_id = ?')
    .bind(vendor.id)
    .all<CalendarEvent>()
    .then(r => r.results)

  const eventResponses = rows.map(row => {
    const etag = makeETag(row.id, row.updated_at)
    return `<D:response>
    <D:href>${base}/calendars/${escXml(token)}/bookings/${row.id}.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>${escXml(etag)}</D:getetag>
        <D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`
  })

  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">
  ${collectionResponse}
  ${eventResponses.join('\n  ')}
</D:multistatus>`, 207, CALDAV_HEADERS)
})

// REPORT /calendars/:token/bookings/
caldav.on('REPORT', '/calendars/:token/bookings/', async (c) => {
  const vendor = await auth(c)
  if (!vendor) return unauth()
  const token = vendor.ical_token!
  const base = `/caldav`
  const body = await c.req.text()

  let rows: CalendarEvent[]

  if (isMultiget(body)) {
    const hrefs = parseHrefsFromBody(body)
    const ids = hrefs.map(h => {
      const match = h.match(/\/([^/]+)\.ics$/)
      return match ? match[1] : null
    }).filter((id): id is string => id !== null)

    rows = []
    for (let i = 0; i < ids.length; i += DB_BATCH) {
      const batch = ids.slice(i, i + DB_BATCH)
      const placeholders = batch.map(() => '?').join(',')
      const batchRows = await c.env.DB
        .prepare(`SELECT * FROM calendar_events WHERE vendor_id = ? AND id IN (${placeholders})`)
        .bind(vendor.id, ...batch)
        .all<CalendarEvent>()
        .then(r => r.results)
      rows.push(...batchRows)
    }
  } else {
    rows = await c.env.DB
      .prepare('SELECT * FROM calendar_events WHERE vendor_id = ?')
      .bind(vendor.id)
      .all<CalendarEvent>()
      .then(r => r.results)
  }

  const responses = rows.map(row => {
    const ical = buildICalEvent(row, vendor)
    const etag = makeETag(row.id, row.updated_at)
    return `<D:response>
    <D:href>${base}/calendars/${escXml(token)}/bookings/${row.id}.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>${escXml(etag)}</D:getetag>
        <C:calendar-data>${escXml(ical)}</C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`
  })

  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  ${responses.join('\n  ')}
</D:multistatus>`, 207, CALDAV_HEADERS)
})

// GET /calendars/:token/bookings/:uid.ics
caldav.get('/calendars/:token/bookings/:uid', async (c) => {
  const vendor = await auth(c)
  if (!vendor) return unauth()
  let uid = c.req.param('uid')
  if (uid.endsWith('.ics')) uid = uid.slice(0, -4)

  const row = await c.env.DB
    .prepare('SELECT * FROM calendar_events WHERE id = ? AND vendor_id = ?')
    .bind(uid, vendor.id)
    .first<CalendarEvent>()
  if (!row) return c.text('Not found', 404)

  const ical = buildICalEvent(row, vendor)
  const etag = makeETag(row.id, row.updated_at)
  return new Response(ical, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      ETag: etag,
      ...CALDAV_HEADERS,
    },
  })
})

// Debug endpoint
caldav.get('/debug/:token', async (c) => {
  const vendor = await auth(c)
  if (!vendor) return unauth()
  const ctag = await makeCTag(c.env.DB, 'calendar_events', 'vendor_id', vendor.id)
  const total = await c.env.DB
    .prepare('SELECT COUNT(*) as cnt FROM calendar_events WHERE vendor_id = ?')
    .bind(vendor.id)
    .first<{ cnt: number }>()
  return c.json({
    vendor: vendor.business_name,
    ctag,
    totalEvents: total?.cnt ?? 0,
  })
})

function escIcal(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function nextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function formatLocalTimestamp(date: string, time: string): string {
  const [h, m] = time.split(':')
  return `${date.replace(/-/g, '')}T${h.padStart(2, '0')}${m.padStart(2, '0')}00`
}

function buildICalEvent(event: CalendarEvent, vendor: VendorProfile): string {
  const tz = vendor.timezone || 'Australia/Sydney'
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Wedding Computer//Calendar//EN',
    `X-WR-TIMEZONE:${tz}`,
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@weddingcomputer.com`,
    `SUMMARY:${escIcal(event.title)}`,
    `DTSTAMP:${toICalTimestamp(event.created_at)}`,
  ]

  if (event.all_day === 1 || !event.start_time) {
    lines.push(`DTSTART;VALUE=DATE:${event.date.replace(/-/g, '')}`)
    lines.push(`DTEND;VALUE=DATE:${nextDay(event.date)}`)
  } else {
    lines.push(`DTSTART;TZID=${tz}:${formatLocalTimestamp(event.date, event.start_time)}`)
    if (event.end_time) {
      lines.push(`DTEND;TZID=${tz}:${formatLocalTimestamp(event.date, event.end_time)}`)
    }
  }

  if (event.notes) {
    lines.push(`DESCRIPTION:${escIcal(event.notes)}`)
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
    lines.push(`LAST-MODIFIED:${toICalTimestamp(event.updated_at)}`)
  }

  lines.push('END:VEVENT')
  lines.push('END:VCALENDAR')

  return lines.join('\r\n') + '\r\n'
}

export default caldav
