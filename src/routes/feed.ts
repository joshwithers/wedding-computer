import { Hono } from 'hono'
import type { Env } from '../types'
import { getVendorByIcalToken } from '../db/vendors'
import { getUserByFeedToken } from '../db/users'
import { clientIp, isAuthThrottled, recordAuthFailure } from '../middleware/rate-limit'
import { isProVendor } from '../db/subscriptions'
import { listEnrichedEventsByRange } from '../db/calendar'
import { listUserCalendarRows, listVendorCalendarRows } from '../db/timeline'
import { listUserWeddingDays, listVendorWeddingDays } from '../db/weddings'
import { getUserById } from '../db/users'
import { buildIcalFeed, buildTimelineFeed } from '../services/ical'
import { DEFAULT_TIMEZONE, runWithI18n } from '../i18n'

const feed = new Hono<Env>()

// Personal calendar feed — the timeline sections this user is assigned to and
// has opted into, across all their weddings. Works for EVERY member (incl. the
// couple) — not Pro-gated. Token is stored hashed and shown once.
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
  const weddingDays = await listUserWeddingDays(c.env.DB, user.id)
  const calName = `${user.name} — wedding day`
  // Render the feed text (e.g. the all-day "Wedding day" marker) in the
  // subscriber's own language — this token route bypasses requireAuth, so the
  // i18n context isn't seeded otherwise.
  const ical = runWithI18n(
    { locale: user.locale ?? undefined, timezone: user.timezone ?? undefined },
    () => buildTimelineFeed(rows, calName, user.timezone ?? DEFAULT_TIMEZONE, weddingDays)
  )

  return c.body(ical, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `inline; filename="${user.name.replace(/[^a-zA-Z0-9]/g, '-')}-timeline.ics"`,
    'Cache-Control': 'private, max-age=900',
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

  // The subscribed calendar is driven by the modern run sheet (timeline_items),
  // not the legacy wc:<slot> booking events — so drop those here. The vendor's
  // own manual events (blocked/personal/other) still ride along.
  const events = (await listEnrichedEventsByRange(c.env.DB, vendor.id, startDate, endDate)).filter(
    (e) => !(e.notes ?? '').startsWith('wc:')
  )

  // The wedding's run-sheet items this vendor is assigned to, within the window.
  const timelineRows = (await listVendorCalendarRows(c.env.DB, vendor.id)).filter(
    (r) => r.wedding_date >= startDate && r.wedding_date <= endDate
  )

  // The all-day wedding-day markers for the vendor's dated weddings, same window.
  const weddingDays = (await listVendorWeddingDays(c.env.DB, vendor.id)).filter(
    (w) => w.date >= startDate && w.date <= endDate
  )

  // Localise the feed text to the vendor owner's language (vendor profiles carry
  // a timezone but not a locale; the owning user does). Token route, so the i18n
  // context isn't seeded by middleware.
  const owner = await getUserById(c.env.DB, vendor.user_id)
  const ical = runWithI18n(
    { locale: owner?.locale ?? undefined, timezone: vendor.timezone },
    () => buildIcalFeed(events, vendor.business_name, vendor.timezone, timelineRows, weddingDays)
  )

  return c.body(ical, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `inline; filename="${vendor.business_name.replace(/[^a-zA-Z0-9]/g, '-')}.ics"`,
    // Token-authed feed of vendor/couple run-sheet data — never a shared-cache
    // resource. The token is the only credential, so 'private' keeps it to the
    // subscriber's own client (matches the personal feed above).
    'Cache-Control': 'private, max-age=900',
  })
})

export default feed
