import type { VendorProfile } from '../types'
import { getVendorByIcalToken } from '../db/vendors'

export const DAV_HEADERS = {
  'MS-Author-Via': 'DAV',
}

export const CARDDAV_HEADERS = {
  ...DAV_HEADERS,
  DAV: '1, 3, addressbook',
  Allow: 'OPTIONS, GET, HEAD, PROPFIND, REPORT',
}

export const CALDAV_HEADERS = {
  ...DAV_HEADERS,
  DAV: '1, 3, calendar-access',
  Allow: 'OPTIONS, GET, HEAD, PROPFIND, REPORT',
}

export async function authenticateVendor(
  db: D1Database,
  authHeader: string | undefined
): Promise<VendorProfile | null> {
  if (!authHeader?.startsWith('Basic ')) return null
  try {
    const decoded = atob(authHeader.slice(6))
    const colonIdx = decoded.indexOf(':')
    if (colonIdx < 0) return null
    const token = decoded.slice(colonIdx + 1)
    if (!token || token.length < 32) return null
    const vendor = await getVendorByIcalToken(db, token)
    if (!vendor) return null
    if (decoded.slice(0, colonIdx) !== token) return null
    return vendor
  } catch (e: any) {
    console.error('[DAV AUTH]', e.message)
    return null
  }
}

export function unauthorizedResponse(realm: string, headers: Record<string, string>): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${realm}"`, ...headers },
  })
}

export function forbiddenResponse(headers: Record<string, string>): Response {
  return new Response('Read-only', {
    status: 403,
    headers,
  })
}

export function xmlResponse(xml: string, status: number, headers: Record<string, string>): Response {
  const body = new TextEncoder().encode(xml)
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Content-Length': String(body.byteLength),
      ...headers,
    },
  })
}

export function escXml(str: string | null | undefined): string {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function escVCard(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

export function foldLine(line: string): string {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(line)
  if (bytes.length <= 75) return line

  const chunks: string[] = []
  let offset = 0
  let isFirst = true

  while (offset < bytes.length) {
    const maxBytes = isFirst ? 75 : 74
    let end = Math.min(offset + maxBytes, bytes.length)
    while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end--
    }
    const chunk = new TextDecoder().decode(bytes.slice(offset, end))
    chunks.push(isFirst ? chunk : ' ' + chunk)
    offset = end
    isFirst = false
  }
  return chunks.join('\r\n')
}

export function toVCardRev(sqliteDate: string): string {
  return sqliteDate.replace(/[-:]/g, '').replace(' ', 'T') + 'Z'
}

export function toICalTimestamp(sqliteDate: string): string {
  return sqliteDate.replace(/[-:]/g, '').replace(' ', 'T') + 'Z'
}

export async function makeCTag(
  db: D1Database,
  table: string,
  vendorIdCol: string,
  vendorId: string,
  whereExtra?: string
): Promise<string> {
  const where = whereExtra
    ? `${vendorIdCol} = ? AND ${whereExtra}`
    : `${vendorIdCol} = ?`
  const row = await db
    .prepare(`SELECT COUNT(*) as cnt, MAX(updated_at) as ts FROM ${table} WHERE ${where}`)
    .bind(vendorId)
    .first<{ cnt: number; ts: string | null }>()
  const raw = `${row?.cnt ?? 0}:${row?.ts ?? ''}`
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(hash)).slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

export function makeETag(id: string, updatedAt: string, suffix = ''): string {
  const ts = updatedAt.replace(/[ :]/g, '_')
  return `"${id}${suffix}-${ts}"`
}

export function getDepth(req: Request): string {
  return req.headers.get('Depth') ?? '0'
}

export function parseHrefsFromBody(body: string): string[] {
  const hrefs: string[] = []
  const re = /<(?:D:|DAV:)?href>([^<]+)<\/(?:D:|DAV:)?href>/gi
  let m
  while ((m = re.exec(body)) !== null) {
    hrefs.push(m[1])
  }
  return hrefs
}

export function isMultiget(body: string): boolean {
  return body.includes('addressbook-multiget') || body.includes('calendar-multiget')
}
