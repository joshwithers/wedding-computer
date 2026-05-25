import { createMiddleware } from 'hono/factory'
import type { Env } from '../types'
import { getVendorByUserId } from '../db/vendors'

export const requireVendor = createMiddleware<Env>(async (c, next) => {
  const user = c.get('user')
  const vendor = await getVendorByUserId(c.env.DB, user.id)

  if (!vendor) {
    return c.redirect('/onboarding')
  }

  c.set('vendor', vendor)
  await next()
})
