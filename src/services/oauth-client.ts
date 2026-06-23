/**
 * Resolve an OAuth client by id, supporting two registration models:
 *
 *  1. Dynamic Client Registration (RFC 7591) — the client_id is one we minted
 *     and stored in oauth_clients.
 *  2. Client ID Metadata Documents (CIMD, MCP 2025-11-25) — the client_id is an
 *     HTTPS URL the client hosts; we fetch it, validate that the document's own
 *     client_id equals the URL, and read its redirect_uris. This is the default
 *     Claude (claude.ai / Claude Code) uses, so it must work without any
 *     pre-registration.
 *
 * The CIMD fetch is SSRF-guarded (https only, no private/loopback hosts, no
 * redirects, size + time capped) and cached in KV for 24h.
 */
import type { Bindings } from '../types'
import { getOAuthClient, getOAuthGrant, revokeOAuthGrant, type OAuthClient } from '../db/oauth'
import { isFetchableHost } from './link-metadata'
import { sha256Hex } from '../lib/crypto'
import { ACCESS_TTL, grantRevokedKey } from '../lib/oauth'

/**
 * Revoke a grant AND immediately invalidate any access token still cached for
 * it: clear the grant in D1 (stops refresh) and drop a KV tombstone the MCP
 * auth path checks, so access already issued stops working within seconds
 * rather than lingering for its ~1h TTL.
 */
export async function revokeGrantImmediately(env: Bindings, vendorId: string, grantId: string): Promise<void> {
  // Confirm ownership BEFORE writing the KV tombstone — otherwise one vendor
  // could disable another vendor's connected app by submitting its grant id
  // (the D1 revoke is already vendor-scoped, but the tombstone would not be).
  const grant = await getOAuthGrant(env.DB, grantId)
  if (!grant || grant.vendor_id !== vendorId) return
  await revokeOAuthGrant(env.DB, vendorId, grantId)
  await env.KV.put(grantRevokedKey(grantId), '1', { expirationTtl: ACCESS_TTL })
}

const CIMD_CACHE_TTL = 60 * 60 // 1h — short window limits cross-vendor cache staleness
const CIMD_MAX_BYTES = 10 * 1024 // spec: documents must be < 10KB
const CIMD_TIMEOUT_MS = 5000

export async function resolveClient(env: Bindings, clientId: string, vendorId?: string): Promise<OAuthClient | null> {
  if (!clientId) return null
  const local = await getOAuthClient(env.DB, clientId)
  if (local) return local
  if (/^https:\/\//i.test(clientId)) return resolveCimdClient(env, clientId, vendorId)
  return null
}

/** https + not a private/loopback/link-local host, else null. */
function fetchableHttpsUrl(raw: string): URL | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  return u.protocol === 'https:' && isFetchableHost(u.hostname) ? u : null
}

/**
 * Fetch a CIMD document, following redirects (Claude's client_id URL redirects
 * to its hosted document). The FINAL host is re-validated, and — critically —
 * on Cloudflare Workers fetch runs at the edge with no route to private,
 * loopback, or link-local addresses, so a redirect cannot be used to reach an
 * internal service regardless of which intermediate hop it points at. The 5s
 * timeout bounds redirect-chain abuse.
 */
async function fetchCimdDoc(url: string): Promise<Response | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CIMD_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { Accept: 'application/json' } })
    if (!res.ok || !fetchableHttpsUrl(res.url)) return null
    return res
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function resolveCimdClient(env: Bindings, clientId: string, vendorId?: string): Promise<OAuthClient | null> {
  if (!fetchableHttpsUrl(clientId)) return null

  // Cache per (vendor, client) so one vendor can't populate another's cache.
  const cacheKey = `oauth:cimd:${vendorId || 'anon'}:${await sha256Hex(clientId)}`
  const cached = await env.KV.get(cacheKey)
  if (cached) {
    try {
      const c = JSON.parse(cached)
      return { client_id: clientId, client_secret_hash: null, redirect_uris: c.redirect_uris, client_name: c.client_name ?? null }
    } catch {
      /* fall through to refetch */
    }
  }

  const res = await fetchCimdDoc(clientId)
  if (!res) return null
  if (Number(res.headers.get('content-length') || 0) > CIMD_MAX_BYTES) return null

  const text = await res.text()
  if (text.length > CIMD_MAX_BYTES) return null
  let doc: any
  try {
    doc = JSON.parse(text)
  } catch {
    return null
  }

  // CIMD invariant: the document's own client_id MUST equal the URL it was fetched from.
  if (doc?.client_id !== clientId) return null
  const redirectUris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter((u: unknown): u is string => typeof u === 'string') : []
  if (redirectUris.length === 0) return null
  const clientName = typeof doc.client_name === 'string' ? doc.client_name.slice(0, 200) : null

  await env.KV.put(cacheKey, JSON.stringify({ redirect_uris: redirectUris, client_name: clientName }), { expirationTtl: CIMD_CACHE_TTL })
  return { client_id: clientId, client_secret_hash: null, redirect_uris: redirectUris, client_name: clientName }
}
