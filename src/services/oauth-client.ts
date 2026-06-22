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
import { getOAuthClient, type OAuthClient } from '../db/oauth'
import { isFetchableHost } from './link-metadata'
import { sha256Hex } from '../lib/crypto'

const CIMD_CACHE_TTL = 60 * 60 * 24 // 24h
const CIMD_MAX_BYTES = 10 * 1024 // spec: documents must be < 10KB
const CIMD_TIMEOUT_MS = 5000

export async function resolveClient(env: Bindings, clientId: string): Promise<OAuthClient | null> {
  if (!clientId) return null
  const local = await getOAuthClient(env.DB, clientId)
  if (local) return local
  if (/^https:\/\//i.test(clientId)) return resolveCimdClient(env, clientId)
  return null
}

async function resolveCimdClient(env: Bindings, clientId: string): Promise<OAuthClient | null> {
  let url: URL
  try {
    url = new URL(clientId)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !isFetchableHost(url.hostname)) return null

  const cacheKey = `oauth:cimd:${await sha256Hex(clientId)}`
  const cached = await env.KV.get(cacheKey)
  if (cached) {
    try {
      const c = JSON.parse(cached)
      return { client_id: clientId, client_secret_hash: null, redirect_uris: c.redirect_uris, client_name: c.client_name ?? null }
    } catch {
      /* fall through to refetch */
    }
  }

  let res: Response
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CIMD_TIMEOUT_MS)
  try {
    // No redirects: the SSRF host check only covers the initial host, so a
    // redirect could otherwise reach an internal address.
    res = await fetch(clientId, { signal: ctrl.signal, redirect: 'error', headers: { Accept: 'application/json' } })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) return null
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
