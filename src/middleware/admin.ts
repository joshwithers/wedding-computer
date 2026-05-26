import { createMiddleware } from 'hono/factory'
import type { Env } from '../types'

export const requireAdmin = createMiddleware<Env>(async (c, next) => {
  const user = c.get('user')
  if (!user.is_admin) {
    return c.text('Not found', 404)
  }
  await next()
})
