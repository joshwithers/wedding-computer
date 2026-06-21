// Vendor-side endpoints for the unified wedding timeline. Mounted under /app
// with the standard vendor guard chain. Thin wrappers over the shared handlers.

import { Hono } from 'hono'
import type { Env } from '../../types'
import { requireAuth } from '../../middleware/auth'
import { csrf } from '../../middleware/csrf'
import { requireVendor } from '../../middleware/tenant'
import { getMembership } from '../../db/weddings'
import {
  renderTimeline,
  renderEdit,
  addTimelineItem,
  addSunTimes,
  updateTimelineItem,
  deleteTimelineItem,
  startTimelineItem,
  endLiveTimeline,
  addTimelineAssignee,
  removeTimelineAssignee,
  toggleAssigneeCalendar,
  approveTimelineRequest,
  declineTimelineRequest,
} from '../timeline-handlers'

const timeline = new Hono<Env>()

timeline.use('/app/weddings/:id/timeline', requireAuth, csrf, requireVendor)
timeline.use('/app/weddings/:id/timeline/*', requireAuth, csrf, requireVendor)

const base = (id: string) => `/app/weddings/${id}`

async function ctx(c: any) {
  const user = c.get('user')
  const weddingId = c.req.param('id')
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  return membership ? { user, weddingId, membership } : null
}

timeline.get('/app/weddings/:id/timeline', async (c) => {
  const x = await ctx(c)
  if (!x) return c.text('Not found', 404)
  return renderTimeline(c, x.weddingId, x.membership, x.user, base(x.weddingId))
})

timeline.post('/app/weddings/:id/timeline', async (c) => {
  const x = await ctx(c)
  if (!x) return c.text('Not found', 404)
  return addTimelineItem(c, x.weddingId, x.membership, x.user, base(x.weddingId))
})

// Registered before /timeline/:itemId so the static "sun" segment wins.
timeline.post('/app/weddings/:id/timeline/sun', async (c) => {
  const x = await ctx(c)
  if (!x) return c.text('Not found', 404)
  return addSunTimes(c, x.weddingId, x.membership, x.user, base(x.weddingId))
})

timeline.get('/app/weddings/:id/timeline/:itemId/edit', async (c) => {
  const x = await ctx(c)
  if (!x) return c.text('Not found', 404)
  return renderEdit(c, x.weddingId, x.membership, x.user, base(x.weddingId), c.req.param('itemId'))
})

timeline.post('/app/weddings/:id/timeline/:itemId', async (c) => {
  const x = await ctx(c)
  if (!x) return c.text('Not found', 404)
  return updateTimelineItem(c, x.weddingId, x.membership, x.user, base(x.weddingId), c.req.param('itemId'))
})

timeline.post('/app/weddings/:id/timeline/:itemId/delete', async (c) => {
  const x = await ctx(c)
  if (!x) return c.text('Not found', 404)
  return deleteTimelineItem(c, x.weddingId, x.membership, x.user, base(x.weddingId), c.req.param('itemId'))
})

timeline.post('/app/weddings/:id/timeline/end-live', async (c) => {
  const x = await ctx(c)
  if (!x) return c.text('Not found', 404)
  return endLiveTimeline(c, x.weddingId, x.membership, x.user, base(x.weddingId))
})

timeline.post('/app/weddings/:id/timeline/:itemId/start', async (c) => {
  const x = await ctx(c)
  if (!x) return c.text('Not found', 404)
  return startTimelineItem(c, x.weddingId, x.membership, x.user, base(x.weddingId), c.req.param('itemId'), true)
})

timeline.post('/app/weddings/:id/timeline/:itemId/unstart', async (c) => {
  const x = await ctx(c)
  if (!x) return c.text('Not found', 404)
  return startTimelineItem(c, x.weddingId, x.membership, x.user, base(x.weddingId), c.req.param('itemId'), false)
})

timeline.post('/app/weddings/:id/timeline/:itemId/assignees', async (c) => {
  const x = await ctx(c)
  if (!x) return c.text('Not found', 404)
  return addTimelineAssignee(c, x.weddingId, x.membership, x.user, base(x.weddingId), c.req.param('itemId'))
})

timeline.post('/app/weddings/:id/timeline/:itemId/assignees/:assigneeId/remove', async (c) => {
  const x = await ctx(c)
  if (!x) return c.text('Not found', 404)
  return removeTimelineAssignee(c, x.weddingId, x.membership, x.user, base(x.weddingId), c.req.param('itemId'), c.req.param('assigneeId'))
})

timeline.post('/app/weddings/:id/timeline/:itemId/assignees/:assigneeId/calendar', async (c) => {
  const x = await ctx(c)
  if (!x) return c.text('Not found', 404)
  return toggleAssigneeCalendar(c, x.weddingId, x.membership, x.user, base(x.weddingId), c.req.param('itemId'), c.req.param('assigneeId'))
})

timeline.post('/app/weddings/:id/timeline/requests/:reqId/approve', async (c) => {
  const x = await ctx(c)
  if (!x) return c.text('Not found', 404)
  return approveTimelineRequest(c, x.weddingId, x.membership, x.user, base(x.weddingId), c.req.param('reqId'))
})

timeline.post('/app/weddings/:id/timeline/requests/:reqId/decline', async (c) => {
  const x = await ctx(c)
  if (!x) return c.text('Not found', 404)
  return declineTimelineRequest(c, x.weddingId, x.membership, x.user, base(x.weddingId), c.req.param('reqId'))
})

export default timeline
