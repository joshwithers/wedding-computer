// Vendor-side endpoints for the collaborative scoped docs. Mounted under /app
// with the standard vendor guard chain. Thin wrappers over the shared handlers
// — the only vendor-specific bit is pushing wedding.md / team.md after a save.

import { Hono } from 'hono'
import type { Env } from '../../types'
import { requireAuth } from '../../middleware/auth'
import { csrf } from '../../middleware/csrf'
import { requireVendor } from '../../middleware/tenant'
import { getMembership } from '../../db/weddings'
import { isDocScope } from '../../services/doc-permissions'
import { pushAllWeddingFiles } from '../../services/storage-push'
import { docSave, docHeartbeat, docClaim, docRelease } from '../wedding-docs-handlers'

const weddingDocs = new Hono<Env>()

weddingDocs.use('/app/weddings/:id/docs/*', requireAuth, csrf, requireVendor)

weddingDocs.post('/app/weddings/:id/docs/:scope', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')
  const weddingId = c.req.param('id')
  const scope = c.req.param('scope')
  if (!isDocScope(scope)) return c.json({ error: 'bad scope' }, 400)

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.json({ error: 'forbidden' }, 403)

  return docSave(c, weddingId, scope, membership, user, () => {
    // Refresh the vault: shared → wedding.md, vendors → team.md, private →
    // notes.md. Couple scope never reaches the vendor route (gate blocks it).
    if (vendor) {
      c.executionCtx.waitUntil(pushAllWeddingFiles(c.env, vendor, weddingId))
    }
  })
})

weddingDocs.post('/app/weddings/:id/docs/:scope/heartbeat', async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('id')
  const scope = c.req.param('scope')
  if (!isDocScope(scope)) return c.json({ error: 'bad scope' }, 400)
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.json({ error: 'forbidden' }, 403)
  return docHeartbeat(c, weddingId, scope, membership, user)
})

weddingDocs.post('/app/weddings/:id/docs/:scope/claim', async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('id')
  const scope = c.req.param('scope')
  if (!isDocScope(scope)) return c.json({ error: 'bad scope' }, 400)
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.json({ error: 'forbidden' }, 403)
  return docClaim(c, weddingId, scope, membership, user)
})

weddingDocs.post('/app/weddings/:id/docs/:scope/release', async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('id')
  const scope = c.req.param('scope')
  if (!isDocScope(scope)) return c.json({ error: 'bad scope' }, 400)
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.json({ error: 'forbidden' }, 403)
  return docRelease(c, weddingId, scope, membership, user)
})

export default weddingDocs
