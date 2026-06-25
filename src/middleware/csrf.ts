import { createMiddleware } from 'hono/factory'
import type { Env } from '../types'
import { generateToken, hmacSign, hmacVerify } from '../lib/crypto'
import { getSessionCookie } from '../lib/session-cookie'

export const csrf = createMiddleware<Env>(async (c, next) => {
  const secret = c.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is not configured')
  const sessionId = getSessionCookie(c) ?? 'anon'
  const token = await hmacSign(secret, `csrf:${sessionId}`)
  c.set('csrfToken', token)

  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(c.req.method)) {
    const contentType = c.req.header('content-type') ?? ''

    let submitted: string | null = c.req.header('x-csrf-token') ?? null
    if (!submitted && (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data'))) {
      const body = await c.req.parseBody()
      submitted = (body['_csrf'] as string) ?? null
    }

    if (!submitted || !(await hmacVerify(c.env.SESSION_SECRET, `csrf:${sessionId}`, submitted))) {
      return c.text('Invalid CSRF token', 403)
    }
  }

  await next()
})

export function csrfField(token: string): string {
  return `<input type="hidden" name="_csrf" value="${token}" />`
}
