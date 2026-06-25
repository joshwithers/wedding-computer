import { createMiddleware } from 'hono/factory'
import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { Env, D1Like } from '../types'

/**
 * D1 read-replica session, per request.
 *
 * D1 has a single write primary plus optional read replicas (the account has
 * `read_replication.mode = auto`). The native binding always talks to the
 * primary, so every read — including ones that only need eventually-consistent
 * data — hits the single primary region. This middleware opens a D1 *session*
 * per request; heavy read-only queries that opt in via `dbOf(c)` can then be
 * served by a replica, taking read load off the primary as traffic grows.
 *
 * Correctness — read-your-writes without per-call-site plumbing:
 *   - Mutating requests (POST/PUT/PATCH/DELETE) use `first-primary`, so the
 *     write and any reads in the same request are fully consistent.
 *   - After a mutation we set a short-lived `wc_rw` cookie; the user's reads for
 *     the next few seconds also use `first-primary`, so they always see their
 *     own change even on a fresh page load.
 *   - Everyone else's GETs use `first-unconstrained` (a replica may answer).
 *
 * Auth/identity reads deliberately do NOT use this (they stay on `c.env.DB`):
 * they're cheap point-reads, and a brand-new user's row could lag a replica and
 * bounce them to /login. Only bulk read-only data queries route through here.
 *
 * Replicas are opportunistic: with no remote read traffic yet,
 * `first-unconstrained` simply resolves to the primary region, so this is a
 * no-op today that starts paying off as the user base spreads.
 */

const WROTE_COOKIE = 'wc_rw'
const WRITE_WINDOW_SECONDS = 10

export const d1Session = createMiddleware<Env>(async (c, next) => {
  const method = c.req.method
  const mutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
  const recentlyWrote = getCookie(c, WROTE_COOKIE) === '1'
  const constraint = mutating || recentlyWrote ? 'first-primary' : 'first-unconstrained'
  // withSession is absent on older runtimes / some local Miniflare builds —
  // fall back to the primary binding (dbOf returns c.env.DB when unset).
  if (typeof c.env.DB.withSession === 'function') {
    c.set('db', c.env.DB.withSession(constraint))
  }

  await next()

  if (mutating && c.res.ok) {
    setCookie(c, WROTE_COOKIE, '1', {
      maxAge: WRITE_WINDOW_SECONDS,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
    })
  }
})

/**
 * The DB handle a read-only query should use: the per-request replica session
 * when present, else the primary binding. Always safe — falls back to primary.
 */
export function dbOf(c: Context<Env>): D1Like {
  return c.get('db') ?? c.env.DB
}
