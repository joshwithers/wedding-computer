import { Hono } from 'hono'
import type { Env, VendorProfile } from '../types'
import { requireAuth } from '../middleware/auth'
import { csrf } from '../middleware/csrf'
import {
  createDocument,
  addDocumentShares,
  getDocument,
  canUserAccessDocument,
  deleteDocument,
  clearDocumentShares,
} from '../db/documents'
import { getMembership, getWedding } from '../db/weddings'
import { getStorageWithSecrets } from '../storage'

const files = new Hono<Env>()

files.use('/files/*', requireAuth)

// Allowed MIME types for uploads
const ALLOWED_TYPES = new Set([
  // Images
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/heic',
  'image/heif',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text
  'text/plain',
  'text/csv',
  'text/markdown',
  // Archives (for bundles of files)
  'application/zip',
])

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB — kept low for git sync compatibility

function parseShareIds(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : [input]
  return [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

async function validateShareTargets(
  db: D1Database,
  weddingId: string,
  userIds: string[]
): Promise<string[]> {
  if (userIds.length === 0) return []

  const placeholders = userIds.map(() => '?').join(',')
  const rows = await db
    .prepare(
      `SELECT user_id FROM wedding_members
       WHERE wedding_id = ? AND status = 'active' AND user_id IN (${placeholders})`
    )
    .bind(weddingId, ...userIds)
    .all<{ user_id: string }>()

  const valid = new Set(rows.results.map((row) => row.user_id))
  if (userIds.some((id) => !valid.has(id))) {
    throw new Error('Invalid document share target')
  }

  return userIds
}

// ─── Upload a file to a wedding ───

files.post('/files/upload/:weddingId', csrf, async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('weddingId')

  // Check membership
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.text('Forbidden', 403)

  if (!c.env.STORAGE) {
    // Redirect back with error — figure out where to go based on role
    const redirect = membership.role === 'couple'
      ? `/wedding/${weddingId}?error=File+storage+not+configured`
      : `/app/weddings/${weddingId}?error=File+storage+not+configured`
    return c.redirect(redirect)
  }

  const body = await c.req.parseBody()
  const file = body.file

  if (!file || !(file instanceof File) || file.size === 0) {
    const redirect = membership.role === 'couple'
      ? `/wedding/${weddingId}?error=No+file+selected`
      : `/app/weddings/${weddingId}?error=No+file+selected`
    return c.redirect(redirect)
  }

  if (file.size > MAX_FILE_SIZE) {
    const redirect = membership.role === 'couple'
      ? `/wedding/${weddingId}?error=File+too+large+(max+10MB)`
      : `/app/weddings/${weddingId}?error=File+too+large+(max+10MB)`
    return c.redirect(redirect)
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    const redirect = membership.role === 'couple'
      ? `/wedding/${weddingId}?error=File+type+not+allowed`
      : `/app/weddings/${weddingId}?error=File+type+not+allowed`
    return c.redirect(redirect)
  }

  // Parse form fields
  const visibility = body.visibility === 'wedding' ? 'wedding' as const : 'private' as const
  const description = typeof body.description === 'string' ? body.description.trim() : null
  const shareWith = body.share_with // may be string or string[]
  const shareIds = visibility === 'private'
    ? await validateShareTargets(c.env.DB, weddingId, parseShareIds(shareWith)).catch(() => null)
    : []

  if (!shareIds) return c.text('Invalid document share target', 403)

  // Upload to R2
  const ext = file.name.split('.').pop() ?? 'bin'
  const r2Key = `weddings/${weddingId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`

  await c.env.STORAGE.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name },
  })

  // Create document record
  const doc = await createDocument(c.env.DB, {
    wedding_id: weddingId,
    vendor_id: membership.vendor_profile_id ?? null,
    uploaded_by_user_id: user.id,
    r2_key: r2Key,
    filename: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    description,
    visibility,
  })

  // Add specific shares if visibility is private and share_with provided
  if (visibility === 'private' && shareIds.length > 0) {
    await addDocumentShares(c.env.DB, doc.id, shareIds)
  }

  // Best-effort: sync file to vendor's git storage
  try {
    const wedding = await getWedding(c.env.DB, weddingId)
    if (wedding) {
      // Find the managing vendor on this wedding to get their storage
      const managingVendor = await c.env.DB
        .prepare(
          `SELECT vp.* FROM vendor_profiles vp
           JOIN wedding_members wm ON wm.vendor_profile_id = vp.id
           WHERE wm.wedding_id = ? AND wm.can_manage = 1
           LIMIT 1`
        )
        .bind(weddingId)
        .first<VendorProfile>()

      if (managingVendor) {
        const storage = await getStorageWithSecrets(c.env, managingVendor)
        const { weddingFolder } = await import('../storage/weddings')
        const folder = weddingFolder(wedding.title, wedding.date)
        const storagePath = `${folder}files/${file.name}`
        const arrayBuf = await c.env.STORAGE.get(r2Key).then((obj) => obj?.arrayBuffer())
        if (arrayBuf) {
          await storage.writeBinary(storagePath, arrayBuf, file.type)
        }
      }
    }
  } catch (err) {
    console.error('[files] git sync failed (non-blocking):', err)
  }

  const redirect = membership.role === 'couple'
    ? `/wedding/${weddingId}?uploaded=1`
    : `/app/weddings/${weddingId}?uploaded=1`
  return c.redirect(redirect)
})

// ─── Download / serve a file ───

files.get('/files/:id', async (c) => {
  const user = c.get('user')
  const docId = c.req.param('id')

  const doc = await getDocument(c.env.DB, docId)
  if (!doc || !doc.wedding_id) return c.text('Not found', 404)

  // Check access
  const hasAccess = await canUserAccessDocument(c.env.DB, docId, user.id, doc.wedding_id)
  if (!hasAccess) return c.text('Forbidden', 403)

  if (!c.env.STORAGE) return c.text('Storage not configured', 500)

  const object = await c.env.STORAGE.get(doc.r2_key)
  if (!object) return c.text('File not found', 404)

  const headers = new Headers()
  headers.set('Content-Type', doc.mime_type)
  headers.set('Content-Disposition', `inline; filename="${doc.filename}"`)
  headers.set('Content-Length', String(doc.size_bytes))
  headers.set('Cache-Control', 'private, max-age=3600')

  return new Response(object.body, { headers })
})

// ─── Download (force download) ───

files.get('/files/:id/download', async (c) => {
  const user = c.get('user')
  const docId = c.req.param('id')

  const doc = await getDocument(c.env.DB, docId)
  if (!doc || !doc.wedding_id) return c.text('Not found', 404)

  const hasAccess = await canUserAccessDocument(c.env.DB, docId, user.id, doc.wedding_id)
  if (!hasAccess) return c.text('Forbidden', 403)

  if (!c.env.STORAGE) return c.text('Storage not configured', 500)

  const object = await c.env.STORAGE.get(doc.r2_key)
  if (!object) return c.text('File not found', 404)

  const headers = new Headers()
  headers.set('Content-Type', 'application/octet-stream')
  headers.set('Content-Disposition', `attachment; filename="${doc.filename}"`)
  headers.set('Content-Length', String(doc.size_bytes))

  return new Response(object.body, { headers })
})

// ─── Delete a file (only uploader can delete) ───

files.post('/files/:id/delete', csrf, async (c) => {
  const user = c.get('user')
  const docId = c.req.param('id')

  const doc = await getDocument(c.env.DB, docId)
  if (!doc || !doc.wedding_id) return c.text('Not found', 404)

  // Only the uploader can delete
  if (doc.uploaded_by_user_id !== user.id) return c.text('Forbidden', 403)

  // Delete from R2
  if (c.env.STORAGE) {
    await c.env.STORAGE.delete(doc.r2_key).catch(() => {})
  }

  // Best-effort: delete from git storage too
  try {
    const wedding = await getWedding(c.env.DB, doc.wedding_id)
    if (wedding) {
      const managingVendor = await c.env.DB
        .prepare(
          `SELECT vp.* FROM vendor_profiles vp
           JOIN wedding_members wm ON wm.vendor_profile_id = vp.id
           WHERE wm.wedding_id = ? AND wm.can_manage = 1
           LIMIT 1`
        )
        .bind(doc.wedding_id)
        .first<VendorProfile>()

      if (managingVendor) {
        const storage = await getStorageWithSecrets(c.env, managingVendor)
        const { weddingFolder } = await import('../storage/weddings')
        const folder = weddingFolder(wedding.title, wedding.date)
        const storagePath = `${folder}files/${doc.filename}`
        await storage.delete(storagePath)
      }
    }
  } catch (err) {
    console.error('[files] git delete failed (non-blocking):', err)
  }

  // Delete from DB (cascades to document_shares)
  await deleteDocument(c.env.DB, docId)

  // Figure out redirect
  const membership = await getMembership(c.env.DB, doc.wedding_id, user.id)
  const redirect = membership?.role === 'couple'
    ? `/wedding/${doc.wedding_id}?deleted=1`
    : `/app/weddings/${doc.wedding_id}?deleted=1`
  return c.redirect(redirect)
})

// ─── Update sharing on an existing file ───

files.post('/files/:id/share', csrf, async (c) => {
  const user = c.get('user')
  const docId = c.req.param('id')

  const doc = await getDocument(c.env.DB, docId)
  if (!doc || !doc.wedding_id) return c.text('Not found', 404)

  // Only the uploader can change sharing
  if (doc.uploaded_by_user_id !== user.id) return c.text('Forbidden', 403)

  const body = await c.req.parseBody()
  const visibility = body.visibility === 'wedding' ? 'wedding' as const : 'private' as const
  const shareWith = body.share_with
  const shareIds = visibility === 'private'
    ? await validateShareTargets(c.env.DB, doc.wedding_id, parseShareIds(shareWith)).catch(() => null)
    : []

  if (!shareIds) return c.text('Invalid document share target', 403)

  // Update visibility
  await c.env.DB
    .prepare('UPDATE documents SET visibility = ? WHERE id = ?')
    .bind(visibility, docId)
    .run()

  // Reset and re-add shares
  await clearDocumentShares(c.env.DB, docId)
  if (visibility === 'private' && shareIds.length > 0) {
    await addDocumentShares(c.env.DB, docId, shareIds)
  }

  const membership = await getMembership(c.env.DB, doc.wedding_id, user.id)
  const redirect = membership?.role === 'couple'
    ? `/wedding/${doc.wedding_id}`
    : `/app/weddings/${doc.wedding_id}`
  return c.redirect(redirect)
})

export default files
