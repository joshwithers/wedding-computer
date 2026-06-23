/**
 * OAuth 2.1 Authorization Server for the MCP endpoint.
 *
 * Implements the base MCP authorization spec so interactive clients
 * (claude.ai, Claude Desktop connectors) can connect with a sign-in + consent
 * flow: Authorization Code + PKCE (S256) + Dynamic Client Registration.
 *
 *   POST /oauth/register   — DCR (RFC 7591); clients self-register a redirect URI
 *   GET  /oauth/authorize  — login + consent; issues a single-use auth code
 *   POST /oauth/authorize  — the consent decision (CSRF-protected)
 *   POST /oauth/token      — code → access+refresh token; refresh → rotate
 *   POST /oauth/revoke     — revoke a refresh token (RFC 7009)
 *
 * Access tokens map to one vendor_id, exactly like the legacy sync token, so the
 * MCP handler's tenant scoping is unchanged. The sync token keeps working too.
 */
import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Env } from '../types'
import { AuthLayout } from '../views/layouts/auth'
import { csrf, csrfField } from '../middleware/csrf'
import { rateLimit } from '../middleware/rate-limit'
import { auditLog } from '../middleware/audit'
import { resolveSession } from '../services/auth'
import { getVendorByUserId } from '../db/vendors'
import { isProVendor } from '../db/subscriptions'
import { generateToken, sha256Hex } from '../lib/crypto'
import {
  MCP_SCOPE,
  ACCESS_TTL,
  CODE_TTL,
  RT_PREFIX,
  isOAuthAccessToken,
  newAccessToken,
  newRefreshToken,
  newAuthCode,
  accessTokenKey,
  authCodeKey,
  grantRevokedKey,
  verifyPkce,
  redirectUriAllowed,
  isValidRedirectUri,
  type AccessTokenRecord,
  type AuthCodeRecord,
} from '../lib/oauth'
import {
  createOAuthClient,
  upsertOAuthGrant,
  getActiveGrantByRefreshHash,
  rotateRefreshHash,
} from '../db/oauth'
import { resolveClient, revokeGrantImmediately } from '../services/oauth-client'

const oauth = new Hono<Env>()

// ─── CORS (for browser-based MCP clients / inspectors hitting the API) ───

function cors(c: any) {
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version')
  c.header('Access-Control-Max-Age', '86400')
}
oauth.options('/oauth/register', (c) => {
  cors(c)
  return c.body(null, 204)
})
oauth.options('/oauth/token', (c) => {
  cors(c)
  return c.body(null, 204)
})
oauth.options('/oauth/revoke', (c) => {
  cors(c)
  return c.body(null, 204)
})

// ─── Pages ───

function Shell({ title, children }: { title: string; children: any }) {
  return (
    <AuthLayout title={title}>
      <div class="max-w-md mx-auto px-4 py-12">{children}</div>
    </AuthLayout>
  )
}

function ErrorPage({ title, message }: { title: string; message: string }) {
  return (
    <Shell title={title}>
      <h1 class="text-xl font-bold text-gray-900 mb-2">{title}</h1>
      <p class="text-sm text-gray-600">{message}</p>
    </Shell>
  )
}

function UpgradePage() {
  return (
    <Shell title="Pro required">
      <h1 class="text-xl font-bold text-gray-900 mb-2">Connecting an AI is a Pro feature</h1>
      <p class="text-sm text-gray-600 mb-5">
        The Wedding Computer MCP server is part of Pro. Upgrade and you can connect Claude and other AI
        assistants to your weddings, contacts, and run sheets.
      </p>
      <a href="/pricing" class="inline-block bg-horizon-600 text-white font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-horizon-700">
        See Pro pricing →
      </a>
    </Shell>
  )
}

function ConsentPage({
  clientName,
  businessName,
  params,
  csrfToken,
}: {
  clientName: string
  businessName: string
  params: Record<string, string>
  csrfToken: string
}) {
  return (
    <Shell title="Connect your AI">
      <div class="text-center mb-6">
        <p class="text-xs font-bold uppercase tracking-wide text-horizon-700 mb-1">Authorize access</p>
        <h1 class="text-xl font-bold text-gray-900">
          Allow <span class="text-horizon-700">{clientName}</span> to access your Wedding Computer data?
        </h1>
        <p class="text-sm text-gray-500 mt-2">Signed in as {businessName}</p>
      </div>

      <div class="bg-gray-50 border border-gray-200 rounded-2xl p-5 mb-6 text-sm text-gray-600">
        <p class="font-bold text-gray-900 mb-2">This will let it:</p>
        <ul class="space-y-1.5 list-disc pl-5">
          <li>Read your contacts, weddings, run sheets, checklists, and notes</li>
          <li>Add and update timeline items, notes, and checklist items</li>
        </ul>
        <p class="mt-3 text-xs text-gray-400">
          Access is scoped to your account and the weddings you’re a member of. You can revoke it any time
          in Settings → Calendar &amp; Sync.
        </p>
      </div>

      <form method="post" action="/oauth/authorize" class="flex gap-3">
        <input type="hidden" name="_csrf" value={csrfToken} />
        {Object.entries(params).map(([k, v]) => (
          <input type="hidden" name={k} value={v} />
        ))}
        <button
          type="submit"
          name="decision"
          value="deny"
          class="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-50"
        >
          Deny
        </button>
        <button
          type="submit"
          name="decision"
          value="allow"
          class="flex-1 bg-horizon-600 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700"
        >
          Allow
        </button>
      </form>
    </Shell>
  )
}

// ─── Dynamic Client Registration (RFC 7591) ───

oauth.post('/oauth/register', rateLimit(20, 3600), async (c) => {
  cors(c)
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_client_metadata', error_description: 'Body must be JSON' }, 400)
  }

  const redirectUris: unknown = body?.redirect_uris
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 10) {
    return c.json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must be a non-empty array' }, 400)
  }
  const uris = redirectUris.filter((u): u is string => typeof u === 'string')
  if (uris.length !== redirectUris.length || !uris.every(isValidRedirectUri)) {
    return c.json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must be absolute https (or http://localhost)' }, 400)
  }

  const authMethod = typeof body?.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'none'
  const confidential = authMethod === 'client_secret_post' || authMethod === 'client_secret_basic'
  const clientName = typeof body?.client_name === 'string' ? body.client_name.slice(0, 200) : null

  const clientId = `wc_client_${await generateToken(16)}`
  let clientSecret: string | null = null
  let clientSecretHash: string | null = null
  if (confidential) {
    clientSecret = await generateToken(32)
    clientSecretHash = await sha256Hex(clientSecret)
  }

  await createOAuthClient(c.env.DB, {
    client_id: clientId,
    client_secret_hash: clientSecretHash,
    redirect_uris: uris,
    client_name: clientName,
  })

  const resp: Record<string, unknown> = {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: uris,
    token_endpoint_auth_method: confidential ? authMethod : 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_name: clientName ?? undefined,
    scope: MCP_SCOPE,
  }
  if (clientSecret) {
    resp.client_secret = clientSecret
    resp.client_secret_expires_at = 0 // never expires
  }
  return c.json(resp, 201)
})

// ─── Authorization endpoint (login + consent) ───

oauth.use('/oauth/authorize', csrf)

type AuthorizeParams = {
  client_id: string
  redirect_uri: string
  response_type: string
  code_challenge: string
  code_challenge_method: string
  scope: string
  state: string
}

function readAuthorizeParams(src: Record<string, string>): AuthorizeParams {
  return {
    client_id: src.client_id ?? '',
    redirect_uri: src.redirect_uri ?? '',
    response_type: src.response_type ?? '',
    code_challenge: src.code_challenge ?? '',
    code_challenge_method: src.code_challenge_method ?? '',
    scope: src.scope ?? MCP_SCOPE,
    state: src.state ?? '',
  }
}

oauth.get('/oauth/authorize', async (c) => {
  const p = readAuthorizeParams(c.req.query())

  // 1. Require a session first: a URL client_id triggers a CIMD document fetch,
  //    so only authenticated vendors should be able to drive it (and the fetch
  //    cache is then scoped to that vendor).
  const sessionId = getCookie(c, 'wc_session')
  const session = sessionId ? await resolveSession(c.env.KV, sessionId) : null
  if (!session) {
    const returnTo = '/oauth/authorize?' + new URLSearchParams(c.req.query()).toString()
    setCookie(c, 'wc_oauth_return', returnTo, { path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 600 })
    return c.redirect('/login')
  }
  const vendor = await getVendorByUserId(c.env.DB, session.userId)
  if (!vendor) {
    return c.html(<ErrorPage title="Vendor account needed" message="The MCP server is for vendor accounts. Finish setting up your business, then reconnect." />, 403)
  }

  // 2. Validate client + redirect_uri BEFORE trusting redirect_uri for error bounces.
  const client = p.client_id ? await resolveClient(c.env, p.client_id, vendor.id) : null
  if (!client) {
    console.log('[oauth-authorize] client not resolved', { client_id: p.client_id, redirect_uri: p.redirect_uri })
    return c.html(<ErrorPage title="Unknown application" message="This app isn’t registered. Try reconnecting from your AI client." />, 400)
  }
  if (!redirectUriAllowed(p.redirect_uri, client.redirect_uris)) {
    console.log('[oauth-authorize] redirect_uri mismatch', { redirect_uri: p.redirect_uri, allowed: client.redirect_uris })
    return c.html(<ErrorPage title="Invalid redirect" message="The redirect address doesn’t match this app’s registration." />, 400)
  }

  // redirect_uri is now trusted — protocol errors go back to the client.
  const bounce = (params: Record<string, string>) => {
    const u = new URL(p.redirect_uri)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    if (p.state) u.searchParams.set('state', p.state)
    return c.redirect(u.toString())
  }
  if (p.response_type !== 'code') return bounce({ error: 'unsupported_response_type' })
  if (p.code_challenge_method !== 'S256' || !p.code_challenge) {
    return bounce({ error: 'invalid_request', error_description: 'PKCE with S256 is required' })
  }
  if (p.scope && p.scope !== MCP_SCOPE) return bounce({ error: 'invalid_scope' })

  // 3. MCP is a Pro vendor feature.
  if (!(await isProVendor(c.env.DB, vendor.id))) {
    return c.html(<UpgradePage />, 403)
  }

  // 4. Consent.
  return c.html(
    <ConsentPage
      clientName={client.client_name || 'this application'}
      businessName={vendor.business_name || 'your account'}
      params={{
        client_id: p.client_id,
        redirect_uri: p.redirect_uri,
        code_challenge: p.code_challenge,
        code_challenge_method: p.code_challenge_method,
        scope: p.scope,
        state: p.state,
      }}
      csrfToken={c.get('csrfToken')}
    />
  )
})

oauth.post('/oauth/authorize', async (c) => {
  const body = await c.req.parseBody()
  const src: Record<string, string> = {}
  for (const [k, v] of Object.entries(body)) src[k] = typeof v === 'string' ? v : ''
  const p = readAuthorizeParams(src)
  const decision = src.decision ?? ''

  // Must be a logged-in Pro vendor (this POST is CSRF-bound to the session).
  // Resolve them first so the CIMD client fetch is scoped to this vendor.
  const sessionId = getCookie(c, 'wc_session')
  const session = sessionId ? await resolveSession(c.env.KV, sessionId) : null
  const vendor = session ? await getVendorByUserId(c.env.DB, session.userId) : null
  if (!vendor || !(await isProVendor(c.env.DB, vendor.id))) {
    return c.html(<ErrorPage title="Sign in required" message="Please start the connection again from your AI client." />, 401)
  }

  // Re-validate client + redirect (never trust the posted redirect blindly).
  const client = p.client_id ? await resolveClient(c.env, p.client_id, vendor.id) : null
  if (!client || !redirectUriAllowed(p.redirect_uri, client.redirect_uris)) {
    return c.html(<ErrorPage title="Invalid request" message="The authorization request is no longer valid. Please start again from your AI client." />, 400)
  }
  const bounce = (params: Record<string, string>) => {
    const u = new URL(p.redirect_uri)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    if (p.state) u.searchParams.set('state', p.state)
    return c.redirect(u.toString())
  }
  if (p.code_challenge_method !== 'S256' || !p.code_challenge) return bounce({ error: 'invalid_request' })
  if (decision !== 'allow') return bounce({ error: 'access_denied' })

  // Issue a single-use authorization code bound to the client, redirect, PKCE
  // challenge, vendor, and scope.
  const code = await newAuthCode()
  const record: AuthCodeRecord = {
    client_id: p.client_id,
    redirect_uri: p.redirect_uri,
    code_challenge: p.code_challenge,
    vendor_id: vendor.id,
    scope: MCP_SCOPE,
  }
  await c.env.KV.put(await authCodeKey(code), JSON.stringify(record), { expirationTtl: CODE_TTL })
  await auditLog(c, 'oauth_consent_granted', 'vendor', vendor.id, { client_id: p.client_id }).catch(() => {})

  return bounce({ code })
})

// ─── Token endpoint ───

oauth.post('/oauth/token', rateLimit(30, 60), async (c) => {
  cors(c)
  const body = await c.req.parseBody()
  const grantType = typeof body.grant_type === 'string' ? body.grant_type : ''

  if (grantType === 'authorization_code') {
    return handleAuthorizationCode(c, body)
  }
  if (grantType === 'refresh_token') {
    return handleRefreshToken(c, body)
  }
  return c.json({ error: 'unsupported_grant_type' }, 400)
})

async function issueTokens(
  c: any,
  grant: { vendor_id: string; client_id: string; client_name: string | null; scope: string }
) {
  const accessToken = await newAccessToken()
  const refreshToken = await newRefreshToken()
  const refreshHash = await sha256Hex(refreshToken)

  // Persist the grant (connected app) with the new refresh hash; access token
  // lives in KV with a short TTL for fast per-call validation.
  const grantId = await upsertOAuthGrant(c.env.DB, {
    vendor_id: grant.vendor_id,
    client_id: grant.client_id,
    client_name: grant.client_name,
    scope: grant.scope,
    refresh_token_hash: refreshHash,
  })
  // Clear any stale revocation tombstone — re-authorizing reuses the grant row.
  await c.env.KV.delete(grantRevokedKey(grantId))
  const record: AccessTokenRecord = { vendor_id: grant.vendor_id, client_id: grant.client_id, scope: grant.scope, grant_id: grantId }
  await c.env.KV.put(await accessTokenKey(accessToken), JSON.stringify(record), { expirationTtl: ACCESS_TTL })

  return c.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: refreshToken,
    scope: grant.scope,
  })
}

async function handleAuthorizationCode(c: any, body: Record<string, any>) {
  const code = typeof body.code === 'string' ? body.code : ''
  const redirectUri = typeof body.redirect_uri === 'string' ? body.redirect_uri : ''
  const clientId = typeof body.client_id === 'string' ? body.client_id : ''
  const codeVerifier = typeof body.code_verifier === 'string' ? body.code_verifier : ''
  const clientSecret = typeof body.client_secret === 'string' ? body.client_secret : ''

  if (!code) return c.json({ error: 'invalid_request' }, 400)

  // Single-use: read then delete immediately.
  const key = await authCodeKey(code)
  const raw = await c.env.KV.get(key)
  if (!raw) return c.json({ error: 'invalid_grant' }, 400)
  await c.env.KV.delete(key)

  let record: AuthCodeRecord
  try {
    record = JSON.parse(raw)
  } catch {
    return c.json({ error: 'invalid_grant' }, 400)
  }

  if (record.client_id !== clientId || record.redirect_uri !== redirectUri) {
    return c.json({ error: 'invalid_grant' }, 400)
  }

  const client = await resolveClient(c.env, clientId, record.vendor_id)
  if (!client) return c.json({ error: 'invalid_client' }, 401)

  // Confidential clients authenticate with their secret; public clients rely on PKCE.
  if (client.client_secret_hash) {
    if (!clientSecret || (await sha256Hex(clientSecret)) !== client.client_secret_hash) {
      return c.json({ error: 'invalid_client' }, 401)
    }
  }
  if (!(await verifyPkce(codeVerifier, record.code_challenge))) {
    return c.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400)
  }

  return issueTokens(c, {
    vendor_id: record.vendor_id,
    client_id: clientId,
    client_name: client.client_name,
    scope: record.scope,
  })
}

async function handleRefreshToken(c: any, body: Record<string, any>) {
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : ''
  const clientId = typeof body.client_id === 'string' ? body.client_id : ''
  const clientSecret = typeof body.client_secret === 'string' ? body.client_secret : ''
  if (!refreshToken.startsWith(RT_PREFIX)) return c.json({ error: 'invalid_grant' }, 400)

  const grant = await getActiveGrantByRefreshHash(c.env.DB, await sha256Hex(refreshToken))
  if (!grant) return c.json({ error: 'invalid_grant' }, 400)
  if (clientId && grant.client_id !== clientId) return c.json({ error: 'invalid_grant' }, 400)

  const client = await resolveClient(c.env, grant.client_id, grant.vendor_id)
  if (!client) return c.json({ error: 'invalid_client' }, 401)
  if (client.client_secret_hash) {
    if (!clientSecret || (await sha256Hex(clientSecret)) !== client.client_secret_hash) {
      return c.json({ error: 'invalid_client' }, 401)
    }
  }

  // Rotate: new access + new refresh token, invalidating the old refresh.
  const accessToken = await newAccessToken()
  const newRefresh = await newRefreshToken()
  await rotateRefreshHash(c.env.DB, grant.id, await sha256Hex(newRefresh))
  const record: AccessTokenRecord = { vendor_id: grant.vendor_id, client_id: grant.client_id, scope: grant.scope, grant_id: grant.id }
  await c.env.KV.put(await accessTokenKey(accessToken), JSON.stringify(record), { expirationTtl: ACCESS_TTL })

  return c.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: newRefresh,
    scope: grant.scope,
  })
}

// ─── Revocation (RFC 7009) — best-effort, always 200 ───

oauth.post('/oauth/revoke', rateLimit(30, 60), async (c) => {
  cors(c)
  const body = await c.req.parseBody()
  const token = typeof body.token === 'string' ? body.token : ''
  if (token.startsWith(RT_PREFIX)) {
    // Revoking a refresh token tears down the whole grant (+ active access token).
    const grant = await getActiveGrantByRefreshHash(c.env.DB, await sha256Hex(token))
    if (grant) await revokeGrantImmediately(c.env, grant.vendor_id, grant.id)
  } else if (isOAuthAccessToken(token)) {
    // Revoking an access token deletes it from KV for immediate effect.
    await c.env.KV.delete(await accessTokenKey(token))
  }
  return c.body(null, 200)
})

export default oauth

// Re-export so /login/verify can complete an OAuth login by returning the user
// to the authorize page (validated to a local path).
export function consumeOAuthReturn(c: any): string | null {
  const ret = getCookie(c, 'wc_oauth_return')
  if (!ret) return null
  deleteCookie(c, 'wc_oauth_return', { path: '/' })
  return ret.startsWith('/oauth/authorize?') ? ret : null
}
