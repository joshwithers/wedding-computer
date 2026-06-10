import { createMiddleware } from 'hono/factory'
import type { Context } from 'hono'
import type { Env } from '../types'

export function clientIp(c: Context<Env>): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown'
}

// ── Token auth-failure throttling ──
// Shared across the token-authenticated surfaces (vault API, CalDAV,
// CardDAV, iCal feed). The 128-bit tokens can't be brute-forced, but
// throttling makes failures visible and keeps abuse cheapness-bounded.
// KV counters are eventually consistent — treat the limit as approximate.

const AUTH_FAIL_LIMIT = 20
const AUTH_FAIL_WINDOW_SECONDS = 900

export async function isAuthThrottled(kv: KVNamespace, ip: string): Promise<boolean> {
  const count = await kv.get(`authfail:${ip}`)
  return count !== null && parseInt(count, 10) >= AUTH_FAIL_LIMIT
}

export async function recordAuthFailure(kv: KVNamespace, ip: string): Promise<void> {
  const key = `authfail:${ip}`
  try {
    const current = await kv.get(key)
    const count = current ? parseInt(current, 10) + 1 : 1
    await kv.put(key, String(count), { expirationTtl: AUTH_FAIL_WINDOW_SECONDS })
    if (count === AUTH_FAIL_LIMIT) {
      console.warn(`[auth] IP ${ip} throttled after ${count} failed token attempts`)
    }
  } catch (err) {
    console.error('[auth] Failed to record auth failure:', err)
  }
}

/**
 * Rate limit with a single counter per IP for a named surface
 * (the plain rateLimit() keys per-path, which is useless for APIs
 * with per-file paths like the vault API).
 */
export function rateLimitByName(name: string, maxRequests: number, windowSeconds: number) {
  return createMiddleware<Env>(async (c, next) => {
    const key = `rl:${name}:${clientIp(c)}`
    const current = await c.env.KV.get(key)
    const count = current ? parseInt(current, 10) : 0

    if (count >= maxRequests) {
      return c.json({ error: 'Too many requests' }, 429)
    }

    await c.env.KV.put(key, String(count + 1), { expirationTtl: windowSeconds })
    await next()
  })
}

/**
 * Increment-and-check a counter keyed by an arbitrary id (e.g. a vendor id
 * rather than an IP), returning true when the request is within the limit.
 * Use for per-account abuse/cost quotas. Like the IP limiters above, the KV
 * counter is eventually consistent, so the limit is approximate — fine for
 * bounding abuse, not a hard security boundary.
 */
export async function consumeRateLimit(
  kv: KVNamespace,
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  const k = `rl:${key}`
  const current = await kv.get(k)
  const count = current ? parseInt(current, 10) : 0
  if (count >= maxRequests) return false
  await kv.put(k, String(count + 1), { expirationTtl: windowSeconds })
  return true
}

export function rateLimit(maxRequests: number, windowSeconds: number) {
  return createMiddleware<Env>(async (c, next) => {
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown'
    const key = `rl:${ip}:${c.req.path}`

    const current = await c.env.KV.get(key)
    const count = current ? parseInt(current, 10) : 0

    if (count >= maxRequests) {
      return c.text('Too many requests', 429)
    }

    await c.env.KV.put(key, String(count + 1), {
      expirationTtl: windowSeconds,
    })

    await next()
  })
}
