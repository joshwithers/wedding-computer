import { createMiddleware } from 'hono/factory'
import type { Env } from '../types'
import { resolveSession } from '../services/auth'
import { getUserById } from '../db/users'
import { getCookie } from 'hono/cookie'

export const requireAuth = createMiddleware<Env>(async (c, next) => {
  const sessionId = getCookie(c, 'wc_session')
  if (!sessionId) {
    return c.redirect('/login')
  }

  const session = await resolveSession(c.env.KV, sessionId)
  if (!session) {
    return c.redirect('/login')
  }

  const user = await getUserById(c.env.DB, session.userId)
  if (!user) {
    return c.redirect('/login')
  }

  c.set('user', user)
  await next()
})
