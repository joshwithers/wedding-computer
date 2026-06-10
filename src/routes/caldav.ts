import { Hono } from 'hono'
import type { Env, CalendarEvent } from '../types'
import {
  CALDAV_HEADERS, authenticateProVendor, basicAuthToken, unauthorizedResponse, forbiddenResponse,
  xmlResponse, escXml, makeCTag, makeETag, getDepth, parseHrefsFromBody, isMultiget,
} from '../lib/dav'
import { isAuthThrottled, recordAuthFailure } from '../middleware/rate-limit'
import { listAllEnrichedEvents, listEnrichedEventsByIds, getEnrichedEvent } from '../db/calendar'
import { buildVevent } from '../services/ical'

const caldav = new Hono<Env>()

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
  const token = reqToken(c)
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

  // Depth 1: list events (only need etags, no enrichment needed)
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

    const rows = await listEnrichedEventsByIds(c.env.DB, vendor.id, ids)

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

    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  ${responses.join('\n  ')}
</D:multistatus>`, 207, CALDAV_HEADERS)
  }

  // Full query
  const rows = await listAllEnrichedEvents(c.env.DB, vendor.id)

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
  const tz = vendor.timezone || 'Australia/Sydney'

  const row = await getEnrichedEvent(c.env.DB, vendor.id, uid)
  if (!row) return c.text('Not found', 404)

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

export default caldav
