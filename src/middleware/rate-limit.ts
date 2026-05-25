import { createMiddleware } from 'hono/factory'
import type { Env } from '../types'

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
