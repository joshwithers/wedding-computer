import { createMiddleware } from 'hono/factory'
import type { Env } from '../types'
import { resolveSession } from '../services/auth'
import { getUserById } from '../db/users'
import { getSessionCookie } from '../lib/session-cookie'
import { updateI18n } from '../i18n'

export const requireAuth = createMiddleware<Env>(async (c, next) => {
  const sessionId = getSessionCookie(c)
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
  // The signed-in user's saved preferences beat the Accept-Language seed.
  updateI18n({ locale: user.locale, timezone: user.timezone })
  await next()
})
