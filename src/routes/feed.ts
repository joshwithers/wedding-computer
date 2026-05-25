import { Hono } from 'hono'
import type { Env } from '../types'
import { getVendorByIcalToken } from '../db/vendors'
import { listEventsByRange } from '../db/calendar'
import { buildIcalFeed } from '../services/ical'

const feed = new Hono<Env>()

feed.get('/cal/:token', async (c) => {
  let token = c.req.param('token')
  if (token.endsWith('.ics')) token = token.slice(0, -4)
  if (!token || token.length < 32) return c.text('Not found', 404)

  const vendor = await getVendorByIcalToken(c.env.DB, token)
  if (!vendor) return c.text('Not found', 404)

  const now = new Date()
  const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const futureYear = now.getFullYear() + 2
  const endDate = `${futureYear}-12-31`

  const events = await listEventsByRange(c.env.DB, vendor.id, startDate, endDate)

  const ical = buildIcalFeed(events, vendor.business_name, vendor.timezone)

  return c.body(ical, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `inline; filename="${vendor.business_name.replace(/[^a-zA-Z0-9]/g, '-')}.ics"`,
    'Cache-Control': 'public, max-age=900',
  })
})

export default feed
