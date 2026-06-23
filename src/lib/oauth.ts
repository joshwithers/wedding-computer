/**
 * OAuth 2.1 primitives for the MCP Authorization Server.
 *
 * Tokens are opaque random strings with a type prefix so the MCP auth layer can
 * tell an OAuth access token from a legacy sync token at a glance. They are
 * stored only by SHA-256 hash (KV for codes + access tokens; D1 for refresh
 * tokens), mirroring how sync tokens are stored.
 */
import { generateToken, sha256Hex } from './crypto'

export const MCP_SCOPE = 'mcp'

export const ACCESS_TTL = 60 * 60 // 1 hour
export const CODE_TTL = 60 // 60 seconds — single-use authorization code

export const AT_PREFIX = 'wc_at_' // access token
export const RT_PREFIX = 'wc_rt_' // refresh token
export const CODE_PREFIX = 'wc_code_' // authorization code

export async function newAccessToken(): Promise<string> {
  return AT_PREFIX + (await generateToken(32))
}
export async function newRefreshToken(): Promise<string> {
  return RT_PREFIX + (await generateToken(32))
}
export async function newAuthCode(): Promise<string> {
  return CODE_PREFIX + (await generateToken(32))
}

/** A bearer token that belongs to this OAuth server (vs. a legacy sync token). */
export function isOAuthAccessToken(token: string): boolean {
  return token.startsWith(AT_PREFIX)
}

export const accessTokenKey = async (token: string): Promise<string> => `oauth:at:${await sha256Hex(token)}`
export const authCodeKey = async (code: string): Promise<string> => `oauth:code:${await sha256Hex(code)}`

/**
 * Tombstone key: when a grant is revoked we set this (TTL = access-token
 * lifetime) so any access token still cached in KV for that grant is rejected
 * immediately, rather than lingering until its own TTL expires.
 */
export const grantRevokedKey = (grantId: string): string => `oauth:grant-revoked:${grantId}`

export type AccessTokenRecord = {
  vendor_id: string
  client_id: string
  scope: string
  grant_id: string
}

export type AuthCodeRecord = {
  client_id: string
  redirect_uri: string
  code_challenge: string
  vendor_id: string
  scope: string
}

// ─── PKCE (RFC 7636), S256 only ───

function base64UrlEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url(SHA-256(input)) — the S256 transform of a PKCE verifier. */
export async function s256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return base64UrlEncode(new Uint8Array(digest))
}

/** Verify a PKCE code_verifier against the stored S256 code_challenge. */
export async function verifyPkce(verifier: string | undefined, challenge: string): Promise<boolean> {
  // RFC 7636: verifier is 43–128 chars of the unreserved set.
  if (!verifier || verifier.length < 43 || verifier.length > 128 || !challenge) return false
  return (await s256(verifier)) === challenge
}

/** A redirect_uri is acceptable only if it exactly matches a registered one. */
export function redirectUriAllowed(uri: string, registered: string[]): boolean {
  return registered.includes(uri)
}

/** DCR redirect URIs must be absolute https (or http://localhost for native/dev loopback). */
export function isValidRedirectUri(uri: string): boolean {
  let u: URL
  try {
    u = new URL(uri)
  } catch {
    return false
  }
  if (u.hash) return false
  if (u.protocol === 'https:') return true
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true
  return false
}
