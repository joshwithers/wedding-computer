// Vendor-side endpoints for wedding web links. Mounted under /app with the
// standard vendor guard chain. Thin wrappers over the shared handlers.

import { Hono } from 'hono'
import type { Env } from '../../types'
import { requireAuth } from '../../middleware/auth'
import { csrf } from '../../middleware/csrf'
import { requireVendor } from '../../middleware/tenant'
import { getMembership } from '../../db/weddings'
import { addLink, togglePin, removeLink } from '../web-links-handlers'

const webLinks = new Hono<Env>()

webLinks.use('/app/weddings/:id/links', requireAuth, csrf, requireVendor)
webLinks.use('/app/weddings/:id/links/*', requireAuth, csrf, requireVendor)

const base = (id: string) => `/app/weddings/${id}`

webLinks.post('/app/weddings/:id/links', async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('id')
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.text('Not found', 404)
  return addLink(c, weddingId, membership, user, base(weddingId))
})

webLinks.post('/app/weddings/:id/links/:linkId/pin', async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('id')
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.text('Not found', 404)
  return togglePin(c, weddingId, membership, user, base(weddingId), c.req.param('linkId'))
})

webLinks.post('/app/weddings/:id/links/:linkId/delete', async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('id')
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.text('Not found', 404)
  return removeLink(c, weddingId, membership, user, base(weddingId), c.req.param('linkId'))
})

export default webLinks
