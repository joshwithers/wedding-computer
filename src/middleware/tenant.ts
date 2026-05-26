import { createMiddleware } from 'hono/factory'
import type { Env } from '../types'
import { getVendorByUserId } from '../db/vendors'
import { getFirstCoupleWedding } from '../db/weddings'

export const requireVendor = createMiddleware<Env>(async (c, next) => {
  const user = c.get('user')
  const vendor = await getVendorByUserId(c.env.DB, user.id)

  if (!vendor) {
    // If they have a wedding as a couple, send them there instead of onboarding
    const coupleWedding = await getFirstCoupleWedding(c.env.DB, user.id)
    if (coupleWedding) {
      return c.redirect(`/wedding/${coupleWedding.wedding_id}`)
    }
    return c.redirect('/onboarding')
  }

  c.set('vendor', vendor)
  await next()
})
