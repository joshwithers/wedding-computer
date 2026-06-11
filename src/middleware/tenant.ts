import { createMiddleware } from 'hono/factory'
import type { Env } from '../types'
import { getVendorByUserId } from '../db/vendors'
import { getFirstCoupleWedding } from '../db/weddings'
import { updateI18n } from '../i18n'

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
  // The business timezone applies when the user hasn't set a personal one.
  if (!user.timezone && vendor.timezone) updateI18n({ timezone: vendor.timezone })
  await next()
})
