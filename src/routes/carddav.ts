import { Hono } from 'hono'
import type { Env, Contact, VendorProfile, Wedding } from '../types'
import {
  CARDDAV_HEADERS, authenticateProVendor, basicAuthToken, unauthorizedResponse, forbiddenResponse,
  xmlResponse, escXml, escVCard, foldLine, toVCardRev, makeETag,
  getDepth, parseHrefsFromBody, isMultiget,
} from '../lib/dav'
import { isAuthThrottled, recordAuthFailure } from '../middleware/rate-limit'

const carddav = new Hono<Env>()

const ACTIVE_FILTER = `json_extract(cached_data, '$.status') NOT IN ('archived', 'lost')`
const DB_BATCH = 99

type FileIndexRow = {
  entity_id: string
  cached_data: string
  last_synced_at: string
}

async function contactsCTag(db: D1Database, vendorId: string): Promise<string> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as cnt, MAX(last_synced_at) as ts
       FROM file_index
       WHERE vendor_id = ? AND entity_type = 'contact' AND ${ACTIVE_FILTER}`
    )
    .bind(vendorId)
    .first<{ cnt: number; ts: string | null }>()
  const raw = `${row?.cnt ?? 0}:${row?.ts ?? ''}`
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(hash)).slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

function rowToContact(row: FileIndexRow, vendorId: string): Contact {
  const c = JSON.parse(row.cached_data)
  return {
    id: row.entity_id,
    vendor_id: vendorId,
    first_name: c.first_name ?? '',
    last_name: c.last_name ?? '',
    email: c.email ?? null,
    phone: c.phone ?? null,
    partner_first_name: c.partner_first_name ?? null,
    partner_last_name: c.partner_last_name ?? null,
    partner_email: c.partner_email ?? null,
    partner_phone: c.partner_phone ?? null,
    address: c.address ?? null,
    instagram: c.instagram ?? null,
    facebook: c.facebook ?? null,
    tiktok: c.tiktok ?? null,
    website: c.website ?? null,
    source: c.source ?? null,
    status: c.status ?? 'new',
    wedding_id: c.wedding_id ?? null,
    wedding_date: c.wedding_date ?? null,
    wedding_location: c.wedding_location ?? null,
    notes: null,
    tags: null,
    form_data: null,
    last_contacted_at: c.last_contacted_at ?? null,
    created_at: c.created_at ?? '',
    updated_at: c.updated_at ?? '',
  }
}

/** Batch-fetch weddings by IDs and return a map. */
async function fetchWeddingsMap(db: D1Database, weddingIds: string[]): Promise<Record<string, Wedding>> {
  const map: Record<string, Wedding> = {}
  if (weddingIds.length === 0) return map
  for (let i = 0; i < weddingIds.length; i += DB_BATCH) {
    const batch = weddingIds.slice(i, i + DB_BATCH)
    const placeholders = batch.map(() => '?').join(',')
    const rows = await db
      .prepare(`SELECT * FROM weddings WHERE id IN (${placeholders})`)
      .bind(...batch)
      .all<Wedding>()
    for (const w of rows.results) {
      map[w.id] = w
    }
  }
  return map
}

const PRIVILEGE_SET = `<D:current-user-privilege-set>
  <D:privilege><D:read/></D:privilege>
  <D:privilege><D:read-current-user-privilege-set/></D:privilege>
</D:current-user-privilege-set>`

const SUPPORTED_REPORT_SET = `<D:supported-report-set>
  <D:supported-report><D:report><C:addressbook-multiget/></D:report></D:supported-report>
  <D:supported-report><D:report><C:addressbook-query/></D:report></D:supported-report>
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

// PROPFIND / — root discovery (Apple Contacts follows 301 here)
carddav.on('PROPFIND', '/', async (c) => {
  const vendor = await auth(c)
  if (!vendor || !vendor.ical_token) {
    // Unauthenticated: return a generic principal hint so the client prompts for credentials
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/carddav/</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal><D:href>/carddav/principals/user/</D:href></D:current-user-principal>
        <D:resourcetype><D:collection/></D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`, 207, { ...CARDDAV_HEADERS, 'WWW-Authenticate': 'Basic realm="CardDAV"' })
  }
  const token = reqToken(c)
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/carddav/</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal><D:href>/carddav/principals/${escXml(token)}/</D:href></D:current-user-principal>
        <C:addressbook-home-set><D:href>/carddav/addressbooks/${escXml(token)}/</D:href></C:addressbook-home-set>
        <D:resourcetype><D:collection/></D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`, 207, CARDDAV_HEADERS)
})

// PROPFIND /principals/:token/
carddav.on('PROPFIND', '/principals/:token/', async (c) => {
  const vendor = await auth(c)
  if (!vendor) return unauth()
  const token = reqToken(c)
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
  const token = reqToken(c)
  const base = `/carddav`
  const ctag = await contactsCTag(c.env.DB, vendor.id)

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
  const token = reqToken(c)
  const base = `/carddav`
  const depth = getDepth(c.req.raw)
  const ctag = await contactsCTag(c.env.DB, vendor.id)

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
    .prepare(`SELECT entity_id, cached_data, last_synced_at FROM file_index WHERE vendor_id = ? AND entity_type = 'contact' AND ${ACTIVE_FILTER}`)
    .bind(vendor.id)
    .all<FileIndexRow>()
    .then(r => r.results)

  const cardResponses = rows.map(row => {
    const c = JSON.parse(row.cached_data)
    const etag = makeETag(row.entity_id, c.updated_at ?? '')
    return `<D:response>
    <D:href>${base}/addressbooks/${escXml(token)}/contacts/${row.entity_id}.vcf</D:href>
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
  const token = reqToken(c)
  const base = `/carddav`
  const body = await c.req.text()

  let indexRows: FileIndexRow[]

  if (isMultiget(body)) {
    const hrefs = parseHrefsFromBody(body)
    const ids = hrefs.map(h => {
      const match = h.match(/\/([^/]+)\.vcf$/)
      return match ? match[1] : null
    }).filter((id): id is string => id !== null)

    indexRows = []
    for (let i = 0; i < ids.length; i += DB_BATCH) {
      const batch = ids.slice(i, i + DB_BATCH)
      const placeholders = batch.map(() => '?').join(',')
      const batchRows = await c.env.DB
        .prepare(`SELECT entity_id, cached_data, last_synced_at FROM file_index WHERE vendor_id = ? AND entity_type = 'contact' AND entity_id IN (${placeholders}) AND ${ACTIVE_FILTER}`)
        .bind(vendor.id, ...batch)
        .all<FileIndexRow>()
        .then(r => r.results)
      indexRows.push(...batchRows)
    }
  } else {
    indexRows = await c.env.DB
      .prepare(`SELECT entity_id, cached_data, last_synced_at FROM file_index WHERE vendor_id = ? AND entity_type = 'contact' AND ${ACTIVE_FILTER}`)
      .bind(vendor.id)
      .all<FileIndexRow>()
      .then(r => r.results)
  }

  // Fetch wedding data for all contacts that have a wedding_id
  const weddingIds = [...new Set(
    indexRows
      .map(r => { try { return JSON.parse(r.cached_data).wedding_id } catch { return null } })
      .filter((id): id is string => !!id)
  )]
  const weddingMap = await fetchWeddingsMap(c.env.DB, weddingIds)

  const responses = indexRows.map(row => {
    const contact = rowToContact(row, vendor.id)
    const wedding = contact.wedding_id ? weddingMap[contact.wedding_id] ?? null : null
    const vcard = buildVCard(contact, vendor, wedding)
    const etag = makeETag(contact.id, contact.updated_at)
    return `<D:response>
    <D:href>${base}/addressbooks/${escXml(token)}/contacts/${contact.id}.vcf</D:href>
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
    .prepare(`SELECT entity_id, cached_data, last_synced_at FROM file_index WHERE vendor_id = ? AND entity_type = 'contact' AND entity_id = ? AND ${ACTIVE_FILTER}`)
    .bind(vendor.id, uid)
    .first<FileIndexRow>()
  if (!row) return c.text('Not found', 404)

  const contact = rowToContact(row, vendor.id)

  // Fetch wedding details if this contact has a wedding
  let wedding: Wedding | null = null
  if (contact.wedding_id) {
    wedding = await c.env.DB
      .prepare('SELECT * FROM weddings WHERE id = ?')
      .bind(contact.wedding_id)
      .first<Wedding>() ?? null
  }

  const vcard = buildVCard(contact, vendor, wedding)
  const etag = makeETag(contact.id, contact.updated_at)
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
  const ctag = await contactsCTag(c.env.DB, vendor.id)
  const total = await c.env.DB
    .prepare(`SELECT COUNT(*) as cnt FROM file_index WHERE vendor_id = ? AND entity_type = 'contact'`)
    .bind(vendor.id)
    .first<{ cnt: number }>()
  const active = await c.env.DB
    .prepare(`SELECT COUNT(*) as cnt FROM file_index WHERE vendor_id = ? AND entity_type = 'contact' AND ${ACTIVE_FILTER}`)
    .bind(vendor.id)
    .first<{ cnt: number }>()
  return c.json({
    vendor: vendor.business_name,
    ctag,
    totalContacts: total?.cnt ?? 0,
    activeContacts: active?.cnt ?? 0,
    activeFilter: ACTIVE_FILTER,
  })
})

// ─── vCard builder ───

function shortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr + 'T00:00:00')
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${d.getDate()} ${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
  } catch {
    return dateStr
  }
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

function buildVCard(contact: Contact, vendor: VendorProfile, wedding: Wedding | null): string {
  const lines: string[] = [
    'BEGIN:VCARD',
    'VERSION:3.0',
  ]

  const fn = `${contact.first_name} ${contact.last_name}`
  const weddingDate = wedding?.date ?? contact.wedding_date
  const dateSuffix = weddingDate ? ` — ${shortDate(weddingDate)}` : ''
  lines.push(foldLine(`FN:💒 ${escVCard(fn)}${dateSuffix}`))
  lines.push(foldLine(`N:${escVCard(contact.last_name)};${escVCard(contact.first_name)};;;`))
  lines.push(foldLine(`ORG:${escVCard(vendor.business_name)} — CRM`))

  // Primary contact details
  if (contact.email) {
    lines.push(foldLine(`EMAIL;TYPE=INTERNET:${escVCard(contact.email)}`))
  }
  if (contact.phone) {
    lines.push(foldLine(`TEL;TYPE=CELL:${escVCard(contact.phone)}`))
  }

  // Partner as related name + separate labeled contact entries
  let itemNum = 1
  if (contact.partner_first_name) {
    const partnerName = [contact.partner_first_name, contact.partner_last_name].filter(Boolean).join(' ')
    lines.push(foldLine(`item${itemNum}.X-ABRELATEDNAMES:${escVCard(partnerName)}`))
    lines.push(foldLine(`item${itemNum}.X-ABLabel:_$!<Spouse>!$_`))
    itemNum++

    if (contact.partner_email) {
      lines.push(foldLine(`item${itemNum}.EMAIL;TYPE=INTERNET:${escVCard(contact.partner_email)}`))
      lines.push(foldLine(`item${itemNum}.X-ABLabel:Partner`))
      itemNum++
    }
    if (contact.partner_phone) {
      lines.push(foldLine(`item${itemNum}.TEL:${escVCard(contact.partner_phone)}`))
      lines.push(foldLine(`item${itemNum}.X-ABLabel:Partner`))
      itemNum++
    }
  }

  // Categories
  const categories = [capitalize(contact.status), 'Wedding Computer']
  lines.push(foldLine(`CATEGORIES:${categories.map(escVCard).join(',')}`))

  // Rich NOTE with wedding + partner details
  const noteLines: string[] = []
  noteLines.push(`Status: ${capitalize(contact.status)}`)

  // Wedding details section
  if (wedding || contact.wedding_date) {
    noteLines.push('')
    noteLines.push('💒 WEDDING')
    const wDate = wedding?.date ?? contact.wedding_date
    if (wDate) noteLines.push(formatDisplayDate(wDate))

    if (wedding) {
      // Ceremony
      if (wedding.time || wedding.ceremony_location || wedding.location) {
        if (wedding.time) noteLines.push(`⛪ Ceremony: ${wedding.time}`)
        if (wedding.ceremony_location) noteLines.push(`📍 ${wedding.ceremony_location}`)
        else if (wedding.location) noteLines.push(`📍 ${wedding.location}`)
      }
      if (wedding.ceremony_type) noteLines.push(`Type: ${capitalize(wedding.ceremony_type)}`)
      if (wedding.duration_hours) noteLines.push(`Duration: ${wedding.duration_hours}h`)

      // Getting ready (party 1)
      if (wedding.getting_ready_time || wedding.getting_ready_location) {
        noteLines.push('')
        const label1 = wedding.getting_ready_1_label ?? 'Party 1'
        if (wedding.getting_ready_time) {
          noteLines.push(`🏨 Getting Ready (${label1}): ${wedding.getting_ready_time}`)
        } else {
          noteLines.push(`🏨 Getting Ready (${label1})`)
        }
        if (wedding.getting_ready_location) noteLines.push(`📍 ${wedding.getting_ready_location}`)
      }

      // Getting ready (party 2)
      if (wedding.getting_ready_2_time || wedding.getting_ready_2_location) {
        noteLines.push('')
        const label2 = wedding.getting_ready_2_label ?? 'Party 2'
        if (wedding.getting_ready_2_time) {
          noteLines.push(`🏨 Getting Ready (${label2}): ${wedding.getting_ready_2_time}`)
        } else {
          noteLines.push(`🏨 Getting Ready (${label2})`)
        }
        if (wedding.getting_ready_2_location) noteLines.push(`📍 ${wedding.getting_ready_2_location}`)
      }

      // Portraits
      if (wedding.portrait_time || wedding.portrait_location) {
        noteLines.push('')
        if (wedding.portrait_time) {
          noteLines.push(`📸 Portraits: ${wedding.portrait_time}`)
        } else {
          noteLines.push('📸 Portraits')
        }
        if (wedding.portrait_location) noteLines.push(`📍 ${wedding.portrait_location}`)
      }

      // Reception
      if (wedding.reception_time || wedding.reception_location) {
        noteLines.push('')
        if (wedding.reception_time) {
          noteLines.push(`🥂 Reception: ${wedding.reception_time}`)
        } else {
          noteLines.push('🥂 Reception')
        }
        if (wedding.reception_location) noteLines.push(`📍 ${wedding.reception_location}`)
      }

      // Extra
      if (wedding.dress_code) noteLines.push(`\n👔 Dress Code: ${wedding.dress_code}`)
      if (wedding.guest_count) noteLines.push(`👥 Guests: ${wedding.guest_count}`)
      if (wedding.timeline_notes) noteLines.push(`\n🗓️ Timeline: ${wedding.timeline_notes}`)
      if (wedding.notes) noteLines.push(`\n💭 ${wedding.notes}`)
    } else {
      // Fallback: use cached contact fields
      if (contact.wedding_location) noteLines.push(`📍 ${contact.wedding_location}`)
    }
  }

  // Partner section in NOTE
  if (contact.partner_first_name) {
    const partnerName = [contact.partner_first_name, contact.partner_last_name].filter(Boolean).join(' ')
    noteLines.push('')
    noteLines.push('━━━━━━━━━━━━━━━━━━')
    noteLines.push(`👤 Partner: ${partnerName}`)
    if (contact.partner_email) noteLines.push(`📧 ${contact.partner_email}`)
    if (contact.partner_phone) noteLines.push(`📱 ${contact.partner_phone}`)
  }

  if (noteLines.length > 0) {
    lines.push(foldLine(`NOTE:${escVCard(noteLines.join('\n'))}`))
  }

  lines.push(`UID:${contact.id}@weddingcomputer.com`)
  lines.push(`REV:${toVCardRev(contact.updated_at)}`)
  lines.push('END:VCARD')

  return lines.join('\r\n') + '\r\n'
}

export default carddav
