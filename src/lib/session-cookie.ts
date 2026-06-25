import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

// Single source of truth for the session cookie, so its name and attributes
// can never drift across the ~14 set/read/delete sites.
//
// We prefer the `__Host-` prefix: the browser then *enforces* Secure + Path=/ +
// no Domain, so a sibling subdomain can't shadow the session cookie. `__Host-`
// requires the Secure attribute, which browsers reject over plain http — so we
// only use the prefixed name on https and fall back to the legacy name for local
// http dev. Reads check both names so sessions issued before this change keep
// working through their 30-day TTL (read-both / write-new rollout).

const PREFIXED = '__Host-wc_session'
const LEGACY = 'wc_session'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days

function isHttps(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:'
}

/** The active session id from either the prefixed or legacy cookie. */
export function getSessionCookie(c: Context): string | undefined {
  return getCookie(c, PREFIXED) ?? getCookie(c, LEGACY)
}

/** Issue a fresh session cookie (prefixed on https, legacy on local http). */
export function setSessionCookie(c: Context, sessionId: string): void {
  const https = isHttps(c)
  setCookie(c, https ? PREFIXED : LEGACY, sessionId, {
    path: '/',
    httpOnly: true,
    secure: https,
    sameSite: 'Lax',
    maxAge: MAX_AGE,
  })
  // Retire any pre-rollout cookie so a stale legacy session can't linger.
  if (https) deleteCookie(c, LEGACY, { path: '/' })
}

/** Clear the session on logout/deletion — both names, so it always sticks. */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, PREFIXED, { path: '/' })
  deleteCookie(c, LEGACY, { path: '/' })
}
