import { Hono } from 'hono'
import type { Env, CalendarEvent } from '../types'
import {
  CALDAV_HEADERS, authenticateProVendor, basicAuthToken, unauthorizedResponse, forbiddenResponse,
  xmlResponse, escXml, makeETag, getDepth, parseHrefsFromBody, isMultiget,
} from '../lib/dav'
import { isAuthThrottled, recordAuthFailure } from '../middleware/rate-limit'
import { listAllEnrichedEvents, listEnrichedEventsByIds, getEnrichedEvent } from '../db/calendar'
import {
  listVendorCalendarRows, getVendorCalendarRow, getVendorCalendarRowsByIds, type UserCalendarRow,
} from '../db/timeline'
import { buildVevent, buildTimelineVevent } from '../services/ical'

const caldav = new Hono<Env>()

// Only sync a bounded window of events so a poll's cost is O(window), not
// O(all-of-vendor-history). Applied consistently to the depth-1 listing, the
// REPORT, and the ctag so the client sees one coherent set. Fixed literal —
// never user input. (A client can still fetch an older event by id via the
// single-event GET / multiget.)
const CALENDAR_WINDOW = "date >= date('now', '-6 months') AND date <= date('now', '+2 years')"
// Same window, but column-qualified for the enriched REPORT query, which joins
// weddings (also a `date` column) — an unqualified `date` is ambiguous there.
const CALENDAR_WINDOW_CE = "ce.date >= date('now', '-6 months') AND ce.date <= date('now', '+2 years')"

const PRIVILEGE_SET = `<D:current-user-privilege-set>
  <D:privilege><D:read/></D:privilege>
  <D:privilege><D:read-current-user-privilege-set/></D:privilege>
</D:current-user-privilege-set>`

const SUPPORTED_REPORT_SET = `<D:supported-report-set>
  <D:supported-report><D:report><C:calendar-multiget/></D:report></D:supported-report>
  <D:supported-report><D:report><C:calendar-query/></D:report></D:supported-report>
</D:supported-report-set>`

async function auth(c: { req: { raw: Request }; env: { DB: D1Database; KV: KVNamespace } }) {
  // Pro-gated: non-Pro vendors resolve to null → 401.
  const header = c.req.raw.headers.get('Authorization') ?? undefined
  if (!header) return null

  const ip = c.req.raw.headers.get('cf-connecting-ip') ?? 'unknown'
  if (await isAuthThrottled(c.env.KV, ip)) return null

  const vendor = await authenticateProVendor(c.env.DB, header)
  if (!vendor) await recordAuthFailure(c.env.KV, ip)
  return vendor
}

/** The client's own raw token, for building hrefs it can navigate to. */
function reqToken(c: { req: { raw: Request } }): string {
  return basicAuthToken(c.req.raw.headers.get('Authorization') ?? undefined) ?? ''
}

function unauth() {
  return unauthorizedResponse('CalDAV', CALDAV_HEADERS)
}

function wrapVCalendar(veventLines: string[], timezone: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Wedding Computer//Calendar//EN',
    `X-WR-TIMEZONE:${timezone}`,
    'METHOD:PUBLISH',
    ...veventLines,
    'END:VCALENDAR',
  ]
  return lines.join('\r\n') + '\r\n'
}

// Assigned + opted-in timeline sections (bump in/out, call times) ride alongside
// the vendor's bookings. Their hrefs carry a `ts-` prefix so the id space never
// collides with calendar_events ids, and GET/multiget can route by it.
const TS_PREFIX = 'ts-'

/** The same -6mo..+2y window as CALENDAR_WINDOW, as date strings for JS filtering. */
function caldavWindow(): { start: string; end: string } {
  const now = new Date()
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const start = new Date(now); start.setMonth(start.getMonth() - 6)
  const end = new Date(now); end.setFullYear(end.getFullYear() + 2)
  return { start: fmt(start), end: fmt(end) }
}

/** Vendor's assigned + opted-in timeline rows within the sync window. */
async function windowedTimelineRows(db: D1Database, vendorId: string): Promise<UserCalendarRow[]> {
  const { start, end } = caldavWindow()
  const rows = await listVendorCalendarRows(db, vendorId)
  return rows.filter((r) => r.wedding_date >= start && r.wedding_date <= end)
}

/**
 * CTag over BOTH the vendor's bookings and their opted-in timeline rows, so a
 * change to either invalidates the client's cache. The timeline term is a
 * signature over the exact opted-in (id, updated_at) set — not just count +
 * max-mtime — so a same-count "swap" (one section out, another in) still moves
 * the tag even when timestamps coincide. Same 8-byte SHA-256 shape as makeCTag.
 */
async function combinedCTag(db: D1Database, vendorId: string): Promise<string> {
  const ev = await db
    .prepare(`SELECT COUNT(*) as cnt, MAX(updated_at) as ts FROM calendar_events WHERE vendor_id = ? AND ${CALENDAR_WINDOW} AND (notes IS NULL OR notes NOT LIKE 'wc:%')`)
    .bind(vendorId)
    .first<{ cnt: number; ts: string | null }>()
  const tl = await db
    .prepare(
      `SELECT group_concat(sig, '|') as sig FROM (
         SELECT ti.id || ':' || ti.updated_at AS sig
         FROM timeline_item_assignees a
         JOIN wedding_members wm ON wm.id = a.wedding_member_id
         JOIN timeline_items ti ON ti.id = a.timeline_item_id
         JOIN weddings w ON w.id = ti.wedding_id
         WHERE wm.vendor_profile_id = ? AND wm.status = 'active' AND w.date IS NOT NULL
           AND ti.marker IS NULL AND (ti.visibility IN ('couple','vendors') OR ti.owner_vendor_id = wm.vendor_profile_id)
         ORDER BY ti.id
       )`
    )
    .bind(vendorId)
    .first<{ sig: string | null }>()
  const raw = `${ev?.cnt ?? 0}:${ev?.ts ?? ''}:${tl?.sig ?? ''}`
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(hash)).slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A REPORT <D:response> carrying a timeline section's calendar-data (ts- href). */
function timelineDataResponse(base: string, token: string, r: UserCalendarRow, tz: string): string {
  const ical = wrapVCalendar(buildTimelineVevent(r, tz), tz)
  const etag = makeETag(TS_PREFIX + r.id, r.updated_at)
  return `<D:response>
    <D:href>${base}/calendars/${escXml(token)}/bookings/${TS_PREFIX}${r.id}.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>${escXml(etag)}</D:getetag>
        <C:calendar-data>${escXml(ical)}</C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`
}

// OPTIONS
caldav.on('OPTIONS', '*', (c) => {
  return new Response(null, { status: 204, headers: CALDAV_HEADERS })
})

// Block writes
for (const method of ['PUT', 'DELETE', 'PATCH', 'MKCOL'] as const) {
  caldav.on(method, '*', () => forbiddenResponse(CALDAV_HEADERS))
}

// PROPFIND / — root discovery (Apple Calendar follows 301 here)
caldav.on('PROPFIND', '/', async (c) => {
  const vendor = await auth(c)
  if (!vendor || !vendor.ical_token) {
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/caldav/</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal><D:href>/caldav/principals/user/</D:href></D:current-user-principal>
        <D:resourcetype><D:collection/></D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`, 207, { ...CALDAV_HEADERS, 'WWW-Authenticate': 'Basic realm="CalDAV"' })
  }
  const token = reqToken(c)
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/caldav/</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal><D:href>/caldav/principals/${escXml(token)}/</D:href></D:current-user-principal>
        <C:calendar-home-set><D:href>/caldav/calendars/${escXml(token)}/</D:href></C:calendar-home-set>
        <D:resourcetype><D:collection/></D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`, 207, CALDAV_HEADERS)
})

// PROPFIND /principals/:token/
caldav.on('PROPFIND', '/principals/:token/', async (c) => {
  const vendor = await auth(c)
  if (!vendor) return unauth()
  const token = reqToken(c)
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
  const token = reqToken(c)
  const base = `/caldav`
  const ctag = await combinedCTag(c.env.DB, vendor.id)

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
  const token = reqToken(c)
  const base = `/caldav`
  const depth = getDepth(c.req.raw)
  const ctag = await combinedCTag(c.env.DB, vendor.id)

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

  // Depth 1: list events (only need etags, no enrichment needed)
  const rows = await c.env.DB
    .prepare(`SELECT * FROM calendar_events WHERE vendor_id = ? AND ${CALENDAR_WINDOW} AND (notes IS NULL OR notes NOT LIKE 'wc:%')`)
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

  // Plus the vendor's assigned + opted-in timeline sections (ts- prefixed hrefs).
  const tlRows = await windowedTimelineRows(c.env.DB, vendor.id)
  const timelineResponses = tlRows.map(r => {
    const etag = makeETag(TS_PREFIX + r.id, r.updated_at)
    return `<D:response>
    <D:href>${base}/calendars/${escXml(token)}/bookings/${TS_PREFIX}${r.id}.ics</D:href>
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
  ${timelineResponses.join('\n  ')}
</D:multistatus>`, 207, CALDAV_HEADERS)
})

// REPORT /calendars/:token/bookings/
caldav.on('REPORT', '/calendars/:token/bookings/', async (c) => {
  const vendor = await auth(c)
  if (!vendor) return unauth()
  const token = reqToken(c)
  const base = `/caldav`
  const body = await c.req.text()
  const tz = vendor.timezone || 'Australia/Sydney'

  if (isMultiget(body)) {
    const hrefs = parseHrefsFromBody(body)
    const ids = hrefs.map(h => {
      const match = h.match(/\/([^/]+)\.ics$/)
      return match ? match[1] : null
    }).filter((id): id is string => id !== null)

    // Bookings vs timeline sections (ts- prefixed) live in one id space here.
    const tsIds = ids.filter(id => id.startsWith(TS_PREFIX)).map(id => id.slice(TS_PREFIX.length))
    const eventIds = ids.filter(id => !id.startsWith(TS_PREFIX))

    const rows = eventIds.length
      ? (await listEnrichedEventsByIds(c.env.DB, vendor.id, eventIds)).filter((r) => !(r.notes ?? '').startsWith('wc:'))
      : []

    const responses = rows.map(row => {
      const ical = wrapVCalendar(buildVevent(row, tz), tz)
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

    const tlRows = tsIds.length ? await getVendorCalendarRowsByIds(c.env.DB, vendor.id, tsIds) : []
    const tlResponses = tlRows.map(r => timelineDataResponse(base, token, r, tz))

    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  ${[...responses, ...tlResponses].join('\n  ')}
</D:multistatus>`, 207, CALDAV_HEADERS)
  }

  // Full query. Legacy wc:<slot> booking events are excluded — the run sheet
  // (timeline_items) drives the calendar now.
  const rows = (await listAllEnrichedEvents(c.env.DB, vendor.id, CALENDAR_WINDOW_CE)).filter(
    (r) => !(r.notes ?? '').startsWith('wc:')
  )

  const responses = rows.map(row => {
    const ical = wrapVCalendar(buildVevent(row, tz), tz)
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

  const tlRows = await windowedTimelineRows(c.env.DB, vendor.id)
  const tlResponses = tlRows.map(r => timelineDataResponse(base, token, r, tz))

  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  ${[...responses, ...tlResponses].join('\n  ')}
</D:multistatus>`, 207, CALDAV_HEADERS)
})

// GET /calendars/:token/bookings/:uid.ics
caldav.get('/calendars/:token/bookings/:uid', async (c) => {
  const vendor = await auth(c)
  if (!vendor) return unauth()
  let uid = c.req.param('uid')
  if (uid.endsWith('.ics')) uid = uid.slice(0, -4)
  const tz = vendor.timezone || 'Australia/Sydney'

  // A timeline section (bump in/out, call time) rather than a booking.
  if (uid.startsWith(TS_PREFIX)) {
    const r = await getVendorCalendarRow(c.env.DB, vendor.id, uid.slice(TS_PREFIX.length))
    if (!r) return c.text('Not found', 404)
    const tlIcal = wrapVCalendar(buildTimelineVevent(r, tz), tz)
    return new Response(tlIcal, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        ETag: makeETag(TS_PREFIX + r.id, r.updated_at),
        ...CALDAV_HEADERS,
      },
    })
  }

  const row = await getEnrichedEvent(c.env.DB, vendor.id, uid)
  // Legacy wc:<slot> bookings aren't served — the run sheet drives the calendar.
  if (!row || (row.notes ?? '').startsWith('wc:')) return c.text('Not found', 404)

  const ical = wrapVCalendar(buildVevent(row, tz), tz)
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
  const ctag = await combinedCTag(c.env.DB, vendor.id)
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

export default caldav
