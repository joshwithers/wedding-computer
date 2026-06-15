// Shared request handlers for the collaborative scoped docs, used by BOTH the
// vendor route (/app/weddings/:id/docs/*) and the couple route
// (/wedding/:id/docs/*). The permission gate (doc-permissions) is applied here
// so every door enforces the same rule; the route files only resolve the
// caller's membership and (vendor side) trigger the storage push.

import type { Context } from 'hono'
import type { Env, User, WeddingMember } from '../types'
import type { DocScope } from '../services/doc-permissions'
import { canReadDoc, canWriteDoc, isSoloScope } from '../services/doc-permissions'
import { saveDoc, heartbeatPresence, claimLock, releaseLock } from '../db/wedding-docs'

/** Presence summary for a solo (private) scope — you're the only participant. */
const SOLO_SUMMARY = { viewers: [], lockedBy: null, youHoldLock: true }

type Ctx = Context<Env>

/** Save a doc (version-guarded). `onSaved` runs side effects (e.g. file push). */
export async function docSave(
  c: Ctx,
  weddingId: string,
  scope: DocScope,
  member: WeddingMember,
  user: User,
  onSaved?: (scope: DocScope) => void
): Promise<Response> {
  if (!canWriteDoc(member, scope)) return c.json({ error: 'forbidden' }, 403)

  let body: { content?: unknown; token?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'bad request' }, 400)
  }
  const content = typeof body.content === 'string' ? body.content : ''
  const token = typeof body.token === 'string' ? body.token : ''

  const result = await saveDoc(c.env.DB, weddingId, scope, content, token, user.id)
  if (!result.ok) {
    return c.json({ conflict: true, content: result.content, token: result.token }, 409)
  }
  if (onSaved) onSaved(scope)
  return c.json({ saved: true, token: result.token })
}

export async function docHeartbeat(
  c: Ctx,
  weddingId: string,
  scope: DocScope,
  member: WeddingMember,
  user: User
): Promise<Response> {
  if (!canReadDoc(member, scope)) return c.json({ error: 'forbidden' }, 403)
  if (isSoloScope(scope)) return c.json(SOLO_SUMMARY)
  const summary = await heartbeatPresence(
    c.env.DB,
    weddingId,
    scope,
    { id: user.id, name: user.name },
    member.role
  )
  return c.json(summary)
}

export async function docClaim(
  c: Ctx,
  weddingId: string,
  scope: DocScope,
  member: WeddingMember,
  user: User
): Promise<Response> {
  if (!canWriteDoc(member, scope)) return c.json({ error: 'forbidden' }, 403)
  if (isSoloScope(scope)) return c.json(SOLO_SUMMARY)
  const summary = await claimLock(
    c.env.DB,
    weddingId,
    scope,
    { id: user.id, name: user.name },
    member.role
  )
  return c.json(summary)
}

export async function docRelease(
  c: Ctx,
  weddingId: string,
  scope: DocScope,
  member: WeddingMember,
  user: User
): Promise<Response> {
  if (!canReadDoc(member, scope)) return c.json({ error: 'forbidden' }, 403)
  await releaseLock(c.env.DB, weddingId, scope, user.id)
  return c.json({ ok: true })
}
