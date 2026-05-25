import { Hono } from 'hono'
import type { Env, Contact, VendorProfile } from '../types'
import {
  CARDDAV_HEADERS, authenticateVendor, unauthorizedResponse, forbiddenResponse,
  xmlResponse, escXml, escVCard, foldLine, toVCardRev, makeCTag, makeETag,
  getDepth, parseHrefsFromBody, isMultiget,
} from '../lib/dav'

const carddav = new Hono<Env>()

const ACTIVE_WHERE = `status NOT IN ('archived', 'lost')`
const CONTACT_COLS = 'id, first_name, last_name, email, phone, partner_first_name, partner_last_name, partner_email, partner_phone, status, wedding_date, wedding_location, notes, updated_at'
const DB_BATCH = 99

const PRIVILEGE_SET = `<D:current-user-privilege-set>
  <D:privilege><D:read/></D:privilege>
  <D:privilege><D:read-current-user-privilege-set/></D:privilege>
</D:current-user-privilege-set>`

const SUPPORTED_REPORT_SET = `<D:supported-report-set>
  <D:supported-report><D:report><C:addressbook-multiget/></D:report></D:supported-report>
  <D:supported-report><D:report><C:addressbook-query/></D:report></D:supported-report>
</D:supported-report-set>`

function auth(c: { req: { raw: Request }; env: { DB: D1Database } }) {
  return authenticateVendor(c.env.DB, c.req.raw.headers.get('Authorization') ?? undefined)
}

function unauth() {
  return unauthorizedResponse('CardDAV', CARDDAV_HEADERS)
}

// OPTIONS
carddav.on('OPTIONS', '*', (c) => {
  return new Response(null, { status: 204, headers: CARDDAV_HEADERS })
})

// Block writes
for (const method of ['PUT', 'DELETE', 'PATCH', 'MKCOL'] as const) {
  carddav.on(method, '*', () => forbiddenResponse(CARDDAV_HEADERS))
}

// PROPFIND /principals/:token/
carddav.on('PROPFIND', '/principals/:token/', async (c) => {
  const vendor = await auth(c)
  if (!vendor) return unauth()
  const token = vendor.ical_token!
  const base = `/carddav`
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>${base}/principals/${escXml(token)}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><D:principal/></D:resourcetype>
        <D:current-user-principal><D:href>${base}/principals/${escXml(token)}/</D:href></D:current-user-principal>
        <D:principal-URL><D:href>${base}/principals/${escXml(token)}/</D:href></D:principal-URL>
        <C:addressbook-home-set><D:href>${base}/addressbooks/${escXml(token)}/</D:href></C:addressbook-home-set>
        <D:displayname>${escXml(vendor.business_name)}</D:displayname>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`, 207, CARDDAV_HEADERS)
})

// PROPFIND /addressbooks/:token/
carddav.on('PROPFIND', '/addressbooks/:token/', async (c) => {
  const vendor = await auth(c)
  if (!vendor) return unauth()
  const token = vendor.ical_token!
  const base = `/carddav`
  const ctag = await makeCTag(c.env.DB, 'contacts', 'vendor_id', vendor.id, ACTIVE_WHERE)

  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>${base}/addressbooks/${escXml(token)}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:displayname>Address Books</D:displayname>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>${base}/addressbooks/${escXml(token)}/contacts/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:addressbook/></D:resourcetype>
        <D:displayname>CRM Contacts</D:displayname>
        <CS:getctag>${escXml(ctag)}</CS:getctag>
        <C:supported-address-data><C:address-data-type content-type="text/vcard" version="3.0"/></C:supported-address-data>
        ${SUPPORTED_REPORT_SET}
        ${PRIVILEGE_SET}
        <D:owner><D:href>${base}/principals/${escXml(token)}/</D:href></D:owner>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`, 207, CARDDAV_HEADERS)
})

// PROPFIND /addressbooks/:token/contacts/
carddav.on('PROPFIND', '/addressbooks/:token/contacts/', async (c) => {
  const vendor = await auth(c)
  if (!vendor) return unauth()
  const token = vendor.ical_token!
  const base = `/carddav`
  const depth = getDepth(c.req.raw)
  const ctag = await makeCTag(c.env.DB, 'contacts', 'vendor_id', vendor.id, ACTIVE_WHERE)

  const collectionResponse = `<D:response>
    <D:href>${base}/addressbooks/${escXml(token)}/contacts/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:addressbook/></D:resourcetype>
        <D:displayname>CRM Contacts</D:displayname>
        <CS:getctag>${escXml(ctag)}</CS:getctag>
        <C:supported-address-data><C:address-data-type content-type="text/vcard" version="3.0"/></C:supported-address-data>
        ${SUPPORTED_REPORT_SET}
        ${PRIVILEGE_SET}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`

  if (depth === '0') {
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:CS="http://calendarserver.org/ns/">
  ${collectionResponse}
</D:multistatus>`, 207, CARDDAV_HEADERS)
  }

  const rows = await c.env.DB
    .prepare(`SELECT ${CONTACT_COLS} FROM contacts WHERE vendor_id = ? AND ${ACTIVE_WHERE}`)
    .bind(vendor.id)
    .all<Contact>()
    .then(r => r.results)

  const cardResponses = rows.map(row => {
    const etag = makeETag(row.id, row.updated_at)
    return `<D:response>
    <D:href>${base}/addressbooks/${escXml(token)}/contacts/${row.id}.vcf</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>${escXml(etag)}</D:getetag>
        <D:getcontenttype>text/vcard; charset=utf-8</D:getcontenttype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`
  })

  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:CS="http://calendarserver.org/ns/">
  ${collectionResponse}
  ${cardResponses.join('\n  ')}
</D:multistatus>`, 207, CARDDAV_HEADERS)
})

// REPORT /addressbooks/:token/contacts/
carddav.on('REPORT', '/addressbooks/:token/contacts/', async (c) => {
  const vendor = await auth(c)
  if (!vendor) return unauth()
  const token = vendor.ical_token!
  const base = `/carddav`
  const body = await c.req.text()

  let rows: Contact[]

  if (isMultiget(body)) {
    const hrefs = parseHrefsFromBody(body)
    const ids = hrefs.map(h => {
      const match = h.match(/\/([^/]+)\.vcf$/)
      return match ? match[1] : null
    }).filter((id): id is string => id !== null)

    rows = []
    for (let i = 0; i < ids.length; i += DB_BATCH) {
      const batch = ids.slice(i, i + DB_BATCH)
      const placeholders = batch.map(() => '?').join(',')
      const batchRows = await c.env.DB
        .prepare(`SELECT ${CONTACT_COLS} FROM contacts WHERE vendor_id = ? AND id IN (${placeholders}) AND ${ACTIVE_WHERE}`)
        .bind(vendor.id, ...batch)
        .all<Contact>()
        .then(r => r.results)
      rows.push(...batchRows)
    }
  } else {
    rows = await c.env.DB
      .prepare(`SELECT ${CONTACT_COLS} FROM contacts WHERE vendor_id = ? AND ${ACTIVE_WHERE}`)
      .bind(vendor.id)
      .all<Contact>()
      .then(r => r.results)
  }

  const responses = rows.map(row => {
    const vcard = buildVCard(row, vendor)
    const etag = makeETag(row.id, row.updated_at)
    return `<D:response>
    <D:href>${base}/addressbooks/${escXml(token)}/contacts/${row.id}.vcf</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>${escXml(etag)}</D:getetag>
        <C:address-data>${escXml(vcard)}</C:address-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`
  })

  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  ${responses.join('\n  ')}
</D:multistatus>`, 207, CARDDAV_HEADERS)
})

// GET /addressbooks/:token/contacts/:uid.vcf
carddav.get('/addressbooks/:token/contacts/:uid', async (c) => {
  const vendor = await auth(c)
  if (!vendor) return unauth()
  let uid = c.req.param('uid')
  if (uid.endsWith('.vcf')) uid = uid.slice(0, -4)

  const row = await c.env.DB
    .prepare(`SELECT ${CONTACT_COLS} FROM contacts WHERE id = ? AND vendor_id = ? AND ${ACTIVE_WHERE}`)
    .bind(uid, vendor.id)
    .first<Contact>()
  if (!row) return c.text('Not found', 404)

  const vcard = buildVCard(row, vendor)
  const etag = makeETag(row.id, row.updated_at)
  return new Response(vcard, {
    status: 200,
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      ETag: etag,
      ...CARDDAV_HEADERS,
    },
  })
})

// Debug endpoint
carddav.get('/debug/:token', async (c) => {
  const vendor = await auth(c)
  if (!vendor) return unauth()
  const ctag = await makeCTag(c.env.DB, 'contacts', 'vendor_id', vendor.id, ACTIVE_WHERE)
  const total = await c.env.DB
    .prepare('SELECT COUNT(*) as cnt FROM contacts WHERE vendor_id = ?')
    .bind(vendor.id)
    .first<{ cnt: number }>()
  const active = await c.env.DB
    .prepare(`SELECT COUNT(*) as cnt FROM contacts WHERE vendor_id = ? AND ${ACTIVE_WHERE}`)
    .bind(vendor.id)
    .first<{ cnt: number }>()
  return c.json({
    vendor: vendor.business_name,
    ctag,
    totalContacts: total?.cnt ?? 0,
    activeContacts: active?.cnt ?? 0,
    activeFilter: ACTIVE_WHERE,
  })
})

function buildVCard(contact: Contact, vendor: VendorProfile): string {
  const lines: string[] = [
    'BEGIN:VCARD',
    'VERSION:3.0',
  ]

  const fn = `${contact.first_name} ${contact.last_name}`
  lines.push(foldLine(`FN:💒 ${escVCard(fn)}`))
  lines.push(foldLine(`N:${escVCard(contact.last_name)};${escVCard(contact.first_name)};;;`))
  lines.push(foldLine(`ORG:${escVCard(vendor.business_name)} — CRM`))

  if (contact.email) {
    lines.push(foldLine(`EMAIL;TYPE=INTERNET:${escVCard(contact.email)}`))
  }
  if (contact.phone) {
    lines.push(foldLine(`TEL;TYPE=CELL:${escVCard(contact.phone)}`))
  }

  const noteLines: string[] = []
  noteLines.push(`Status: ${contact.status}`)
  if (contact.wedding_date) noteLines.push(`Date: ${contact.wedding_date}`)
  if (contact.wedding_location) noteLines.push(`Location: ${contact.wedding_location}`)
  if (contact.partner_first_name) {
    const partnerName = [contact.partner_first_name, contact.partner_last_name].filter(Boolean).join(' ')
    noteLines.push(`Partner: ${partnerName}`)
    if (contact.partner_email) noteLines.push(`Partner email: ${contact.partner_email}`)
    if (contact.partner_phone) noteLines.push(`Partner phone: ${contact.partner_phone}`)
  }
  if (contact.notes) noteLines.push(`Notes: ${contact.notes}`)

  if (noteLines.length > 0) {
    lines.push(foldLine(`NOTE:${escVCard(noteLines.join('\n'))}`))
  }

  lines.push(`UID:${contact.id}@weddingcomputer.com`)
  lines.push(`REV:${toVCardRev(contact.updated_at)}`)
  lines.push('END:VCARD')

  return lines.join('\r\n') + '\r\n'
}

export default carddav
