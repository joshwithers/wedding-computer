import { Hono } from 'hono'
import type { Env } from '../types'
import { getVendorByIcalToken } from '../db/vendors'
import { getUserByFeedToken } from '../db/users'
import { clientIp, isAuthThrottled, recordAuthFailure } from '../middleware/rate-limit'
import { isProVendor } from '../db/subscriptions'
import { listEnrichedEventsByRange } from '../db/calendar'
import { listUserCalendarRows } from '../db/timeline'
import { buildIcalFeed, buildTimelineFeed } from '../services/ical'
import { DEFAULT_TIMEZONE } from '../i18n'

const feed = new Hono<Env>()

// Personal calendar feed — the timeline sections this user is assigned to and
// has opted into, across all their weddings. Works for EVERY member (incl. the
// couple) — not Pro-gated. Token stored raw (read-only capability URL).
feed.get('/cal/u/:token', async (c) => {
  let token = c.req.param('token')
  if (token.endsWith('.ics')) token = token.slice(0, -4)
  if (!token || token.length < 32) return c.text('Not found', 404)

  const ip = clientIp(c)
  if (await isAuthThrottled(c.env.KV, ip)) return c.text('Too many requests', 429)

  const user = await getUserByFeedToken(c.env.DB, token)
  if (!user) {
    await recordAuthFailure(c.env.KV, ip)
    return c.text('Not found', 404)
  }

  const rows = await listUserCalendarRows(c.env.DB, user.id)
  const calName = `${user.name} — wedding day`
  const ical = buildTimelineFeed(rows, calName, user.timezone ?? DEFAULT_TIMEZONE)

  return c.body(ical, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `inline; filename="${user.name.replace(/[^a-zA-Z0-9]/g, '-')}-timeline.ics"`,
    'Cache-Control': 'public, max-age=900',
  })
})

feed.get('/cal/:token', async (c) => {
  let token = c.req.param('token')
  if (token.endsWith('.ics')) token = token.slice(0, -4)
  if (!token || token.length < 32) return c.text('Not found', 404)

  const ip = clientIp(c)
  if (await isAuthThrottled(c.env.KV, ip)) return c.text('Too many requests', 429)

  const vendor = await getVendorByIcalToken(c.env.DB, token)
  if (!vendor) {
    await recordAuthFailure(c.env.KV, ip)
    return c.text('Not found', 404)
  }

  // Device/calendar sync is a Pro feature.
  if (!(await isProVendor(c.env.DB, vendor.id))) {
    return c.text('Calendar sync requires a Pro subscription.', 403)
  }

  const now = new Date()
  const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const futureYear = now.getFullYear() + 2
  const endDate = `${futureYear}-12-31`

  const events = await listEnrichedEventsByRange(c.env.DB, vendor.id, startDate, endDate)

  const ical = buildIcalFeed(events, vendor.business_name, vendor.timezone)

  return c.body(ical, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `inline; filename="${vendor.business_name.replace(/[^a-zA-Z0-9]/g, '-')}.ics"`,
    'Cache-Control': 'public, max-age=900',
  })
})

export default feed
