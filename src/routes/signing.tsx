// Collaborative PDF signing routes (celebrant + couple). This is the feature hub:
// it owns both the couple surface (/wedding/:id/sign/*) and the celebrant surface
// (/app/weddings/:id/sign/*), the per-turn burn-in, and the final private document.
// Full architecture, flow, state machine, R2 layout, and a debugging playbook live in
// SIGNING.md at the repo root — read that first when changing this feature.
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env, VendorProfile, DocumentSigningSession } from '../types'
import { requireAuth } from '../middleware/auth'
import { csrf } from '../middleware/csrf'
import { requireVendor } from '../middleware/tenant'
import { auditLog } from '../middleware/audit'
import { getMembership } from '../db/weddings'
import { hasCategory } from '../lib/categories'
import { createDocument } from '../db/documents'
import {
  createSigningSession,
  getSigningSessionForMember,
  recordCoupleSigned,
  recordCelebrantSigned,
  setCoupleReleased,
} from '../db/signing'
import { burnStrokes, type StrokesByPage } from '../forms/signing/burn'
import { SignPdfAnnotator, SigningStatusPage } from '../views/sign-pdf'
import { t } from '../i18n'

const signing = new Hono<Env>()

signing.use('/wedding/:weddingId/sign/*', requireAuth, csrf)
signing.use('/app/weddings/:weddingId/sign/*', requireAuth, csrf, requireVendor)

// ─── Helpers ───

function clientIp(c: Context<Env>): string | null {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null
}

// Derive couple.pdf / final.pdf from source.pdf by replacing only the trailing
// 'source.pdf'. Relies on the strict key layout weddings/{id}/signing/{uuid}/{name}.pdf;
// R2 has no rename, so the {uuid} prefix is fixed for the session's whole life.
function siblingKey(sourceKey: string, name: 'couple.pdf' | 'final.pdf'): string {
  return sourceKey.replace(/source\.pdf$/, name)
}

function safePdfName(title: string): string {
  const base = title.replace(/[\/\\]+/g, ' ').replace(/[^\w .()&-]+/g, '').trim().slice(0, 80) || 'Signed document'
  return base.toLowerCase().endsWith('.pdf') ? base : base + '.pdf'
}

async function readStrokes(c: Context<Env>): Promise<StrokesByPage | null> {
  try {
    const body = (await c.req.json()) as { strokes?: unknown }
    const s = body?.strokes
    if (!s || typeof s !== 'object') return null
    return s as StrokesByPage
  } catch {
    return null
  }
}

async function loadPdf(c: Context<Env>, key: string): Promise<ArrayBuffer | null> {
  if (!c.env.STORAGE) return null
  const obj = await c.env.STORAGE.get(key)
  return obj ? await obj.arrayBuffer() : null
}

async function putPdf(c: Context<Env>, key: string, bytes: Uint8Array): Promise<void> {
  await c.env.STORAGE!.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } })
}

function servePdf(object: R2ObjectBody, filename: string, disposition: 'inline' | 'attachment'): Response {
  const headers = new Headers()
  headers.set('Content-Type', 'application/pdf')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Content-Disposition', `${disposition}; filename="${filename.replace(/"/g, '')}"`)
  headers.set('Cache-Control', 'private, no-store')
  return new Response(object.body, { headers })
}

// Create a session from raw PDF bytes (used by the upload route here and the
// NOIM "send for signing" shortcut in vendor/forms.tsx). The caller has already
// authorised the celebrant + their membership of the wedding.
export async function startSigningSessionFromBytes(
  c: Context<Env>,
  opts: {
    weddingId: string
    vendor: VendorProfile
    userId: string
    bytes: Uint8Array | ArrayBuffer
    title: string
    sourceKind: 'upload' | 'noim'
    sourceRef?: string | null
  }
): Promise<DocumentSigningSession> {
  const prefix = crypto.randomUUID()
  const sourceKey = `weddings/${opts.weddingId}/signing/${prefix}/source.pdf`
  await putPdf(c, sourceKey, opts.bytes instanceof Uint8Array ? opts.bytes : new Uint8Array(opts.bytes))
  const session = await createSigningSession(c.env.DB, {
    wedding_id: opts.weddingId,
    vendor_id: opts.vendor.id,
    created_by_user_id: opts.userId,
    source_kind: opts.sourceKind,
    source_ref: opts.sourceRef ?? null,
    title: opts.title,
    source_r2_key: sourceKey,
  })
  await auditLog(c, 'signing_session_created', 'signing_session', session.id, {
    wedding_id: opts.weddingId,
    source_kind: opts.sourceKind,
  })
  return session
}

// ─── Couple surface ───

signing.get('/wedding/:weddingId/sign/:sessionId', async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('weddingId')
  const sessionId = c.req.param('sessionId')
  const session = await getSigningSessionForMember(c.env.DB, sessionId, user.id)
  if (!session || session.wedding_id !== weddingId) return c.notFound()
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  const backUrl = `/wedding/${weddingId}`

  if (!membership || membership.role !== 'couple') {
    return c.html(
      SigningStatusPage({
        title: session.title,
        backUrl,
        heading: t('signing.status.notCouple.title'),
        body: t('signing.status.notCouple.body'),
      })
    )
  }

  if (session.status === 'awaiting_couple') {
    // The couple can only sign once the celebrant releases the session (and
    // witnesses them). Until then, show a locked screen that polls for release.
    if (session.couple_released) {
      return c.html(
        SignPdfAnnotator({
          title: session.title,
          mode: 'couple',
          signerName: user.name ?? 'You',
          pdfUrl: `/wedding/${weddingId}/sign/${sessionId}/pdf`,
          saveUrl: `/wedding/${weddingId}/sign/${sessionId}/save`,
          backUrl,
          csrfToken: c.get('csrfToken'),
        })
      )
    }
    return c.html(
      SigningStatusPage({
        title: session.title,
        backUrl,
        heading: t('signing.status.locked.title'),
        body: t('signing.status.locked.body'),
        autoRefreshSeconds: 5,
      })
    )
  }

  if (session.status === 'awaiting_celebrant') {
    return c.html(
      SigningStatusPage({
        title: session.title,
        backUrl,
        heading: t('signing.status.coupleSigned.title'),
        body: t('signing.status.coupleSigned.body'),
      })
    )
  }
  if (session.status === 'complete') {
    return c.html(
      SigningStatusPage({
        title: session.title,
        backUrl,
        heading: t('signing.status.coupleDone.title'),
        body: t('signing.status.coupleDone.body'),
      })
    )
  }
  return c.html(
    SigningStatusPage({ title: session.title, backUrl, heading: t('signing.status.cancelled.title'), body: t('signing.status.cancelled.body') })
  )
})

signing.post('/wedding/:weddingId/sign/:sessionId/save', async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('weddingId')
  const sessionId = c.req.param('sessionId')
  const session = await getSigningSessionForMember(c.env.DB, sessionId, user.id)
  if (!session || session.wedding_id !== weddingId) return c.json({ error: 'Not found' }, 404)
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || membership.role !== 'couple') return c.json({ error: 'Not allowed' }, 403)
  if (session.status !== 'awaiting_couple') return c.json({ error: 'This document has already been signed.' }, 409)
  // Witness gate: the celebrant must have released the session for signing.
  if (!session.couple_released) return c.json({ error: "Your celebrant hasn't started the signing yet." }, 403)

  const strokes = await readStrokes(c)
  if (!strokes) return c.json({ error: 'Invalid request' }, 400)
  const pdf = await loadPdf(c, session.current_r2_key)
  if (!pdf) return c.json({ error: 'Document unavailable' }, 500)

  const burned = await burnStrokes(pdf, strokes)
  const coupleKey = siblingKey(session.source_r2_key, 'couple.pdf')
  await putPdf(c, coupleKey, burned)
  const ok = await recordCoupleSigned(c.env.DB, sessionId, {
    currentR2Key: coupleKey,
    coupleSignedR2Key: coupleKey,
    signedByUserId: user.id,
    inPerson: false,
    ip: clientIp(c),
  })
  if (!ok) return c.json({ error: 'This document has already been signed.' }, 409)

  await c.env.EMAIL_QUEUE.send({ type: 'notify_document_ready', payload: JSON.stringify({ sessionId, event: 'awaiting_celebrant' }) })
  await auditLog(c, 'signing_couple_signed', 'signing_session', sessionId, { wedding_id: weddingId, in_person: false })
  return c.json({ redirect: `/wedding/${weddingId}/sign/${sessionId}` })
})

signing.get('/wedding/:weddingId/sign/:sessionId/pdf', async (c) => {
  const user = c.get('user')
  const weddingId = c.req.param('weddingId')
  const session = await getSigningSessionForMember(c.env.DB, c.req.param('sessionId'), user.id)
  if (!session || session.wedding_id !== weddingId) return c.notFound()
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || membership.role !== 'couple') return c.text('Forbidden', 403)
  // Same witness gate as /save — the couple sees the PDF to sign only once released.
  if (!session.couple_released) return c.text('Forbidden', 403)
  if (!c.env.STORAGE) return c.text('Storage not configured', 500)
  const object = await c.env.STORAGE.get(session.current_r2_key)
  if (!object) return c.text('Not found', 404)
  return servePdf(object, 'document.pdf', 'inline')
})

// ─── Vendor (celebrant) surface ───

// Authorization chokepoint for every celebrant route: requires
// hasCategory(vendor,'celebrant') AND session.vendor_id === vendor.id, on top of
// getSigningSessionForMember's active-membership check. All /app signing handlers
// must go through this — never getSigningSessionById (which is unscoped).
async function ownedSession(c: Context<Env>): Promise<DocumentSigningSession | null> {
  const user = c.get('user')
  const vendor = c.get('vendor') as VendorProfile
  const weddingId = c.req.param('weddingId')
  const session = await getSigningSessionForMember(c.env.DB, c.req.param('sessionId') ?? '', user.id)
  if (!session || session.wedding_id !== weddingId) return null
  if (!hasCategory(vendor, 'celebrant') || session.vendor_id !== vendor.id) return null
  return session
}

signing.get('/app/weddings/:weddingId/sign/:sessionId', async (c) => {
  const user = c.get('user')
  const session = await ownedSession(c)
  if (!session) return c.notFound()
  const weddingId = session.wedding_id
  const sessionId = session.id
  const base = `/app/weddings/${weddingId}/sign/${sessionId}`
  const backUrl = `/app/weddings/${weddingId}`

  if (session.status === 'awaiting_couple') {
    if (c.req.query('act') === 'handoff') {
      return c.html(
        SignPdfAnnotator({
          title: session.title,
          mode: 'couple',
          signerName: 'The couple',
          pdfUrl: `${base}/pdf`,
          saveUrl: `${base}/save-couple`,
          backUrl: base,
          csrfToken: c.get('csrfToken'),
        })
      )
    }
    // You witness the couple sign. Two ways: hand them this device (handoff), or
    // RELEASE the session so they sign on their own logged-in device while you watch.
    // The couple cannot sign until released; it re-locks once they've signed.
    if (session.couple_released) {
      return c.html(
        SigningStatusPage({
          title: session.title,
          backUrl,
          heading: t('signing.celebrant.released.title'),
          body: t('signing.celebrant.released.body'),
          autoRefreshSeconds: 5,
          actions: [
            { href: `${base}?act=handoff`, label: t('signing.celebrant.released.handoff'), primary: true },
            { href: `${base}/lock`, label: t('signing.celebrant.released.lock'), method: 'post', csrf: c.get('csrfToken') },
          ],
        })
      )
    }
    return c.html(
      SigningStatusPage({
        title: session.title,
        backUrl,
        heading: t('signing.celebrant.ready.title'),
        body: t('signing.celebrant.ready.body'),
        actions: [
          { href: `${base}?act=handoff`, label: t('signing.celebrant.ready.handoff'), primary: true },
          { href: `${base}/release`, label: t('signing.celebrant.ready.release'), method: 'post', csrf: c.get('csrfToken') },
        ],
      })
    )
  }

  if (session.status === 'awaiting_celebrant') {
    return c.html(
      SignPdfAnnotator({
        title: session.title,
        mode: 'celebrant',
        signerName: user.name ?? 'You',
        pdfUrl: `${base}/pdf`,
        saveUrl: `${base}/save-celebrant`,
        backUrl,
        csrfToken: c.get('csrfToken'),
      })
    )
  }

  if (session.status === 'complete' && session.final_document_id) {
    return c.html(
      SigningStatusPage({
        title: session.title,
        backUrl,
        heading: t('signing.celebrant.done.title'),
        body: t('signing.celebrant.done.body'),
        actions: [
          { href: `/files/${session.final_document_id}`, label: t('signing.celebrant.done.view'), primary: true },
          { href: `/files/${session.final_document_id}/download`, label: t('signing.celebrant.done.download') },
        ],
      })
    )
  }

  return c.html(
    SigningStatusPage({ title: session.title, backUrl, heading: t('signing.status.cancelled.title'), body: t('signing.status.cancelled.body') })
  )
})

signing.get('/app/weddings/:weddingId/sign/:sessionId/pdf', async (c) => {
  const session = await ownedSession(c)
  if (!session) return c.notFound()
  if (!c.env.STORAGE) return c.text('Storage not configured', 500)
  const object = await c.env.STORAGE.get(session.current_r2_key)
  if (!object) return c.text('Not found', 404)
  return servePdf(object, 'document.pdf', 'inline')
})

// In-person: the celebrant facilitates the couple's turn on their own device.
signing.post('/app/weddings/:weddingId/sign/:sessionId/save-couple', async (c) => {
  const user = c.get('user')
  const session = await ownedSession(c)
  if (!session) return c.json({ error: 'Not found' }, 404)
  if (session.status !== 'awaiting_couple') return c.json({ error: 'Already signed.' }, 409)

  const strokes = await readStrokes(c)
  if (!strokes) return c.json({ error: 'Invalid request' }, 400)
  const pdf = await loadPdf(c, session.current_r2_key)
  if (!pdf) return c.json({ error: 'Document unavailable' }, 500)

  const burned = await burnStrokes(pdf, strokes)
  const coupleKey = siblingKey(session.source_r2_key, 'couple.pdf')
  await putPdf(c, coupleKey, burned)
  const ok = await recordCoupleSigned(c.env.DB, session.id, {
    currentR2Key: coupleKey,
    coupleSignedR2Key: coupleKey,
    signedByUserId: user.id,
    inPerson: true,
    ip: clientIp(c),
  })
  if (!ok) return c.json({ error: 'Already signed.' }, 409)
  await auditLog(c, 'signing_couple_signed', 'signing_session', session.id, { wedding_id: session.wedding_id, in_person: true })
  return c.json({ redirect: `/app/weddings/${session.wedding_id}/sign/${session.id}` })
})

signing.post('/app/weddings/:weddingId/sign/:sessionId/save-celebrant', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor') as VendorProfile
  const session = await ownedSession(c)
  if (!session) return c.json({ error: 'Not found' }, 404)
  if (session.status !== 'awaiting_celebrant') return c.json({ error: 'Not ready to finalise.' }, 409)

  const strokes = await readStrokes(c)
  if (!strokes) return c.json({ error: 'Invalid request' }, 400)
  const pdf = await loadPdf(c, session.current_r2_key)
  if (!pdf) return c.json({ error: 'Document unavailable' }, 500)

  const burned = await burnStrokes(pdf, strokes)
  const finalKey = siblingKey(session.source_r2_key, 'final.pdf')
  await putPdf(c, finalKey, burned)
  const filename = safePdfName(session.title)
  const doc = await createDocument(c.env.DB, {
    wedding_id: session.wedding_id,
    vendor_id: vendor.id,
    uploaded_by_user_id: user.id,
    r2_key: finalKey,
    filename,
    mime_type: 'application/pdf',
    size_bytes: burned.length,
    category: 'signed',
    description: null,
    visibility: 'private',
  })
  const ok = await recordCelebrantSigned(c.env.DB, session.id, {
    currentR2Key: finalKey,
    finalDocumentId: doc.id,
    ip: clientIp(c),
  })
  if (!ok) return c.json({ error: 'Not ready to finalise.' }, 409)

  await c.env.EMAIL_QUEUE.send({ type: 'notify_document_ready', payload: JSON.stringify({ sessionId: session.id, event: 'completed' }) })
  await auditLog(c, 'signing_celebrant_signed', 'signing_session', session.id, { wedding_id: session.wedding_id, document_id: doc.id })
  await auditLog(c, 'signing_completed', 'signing_session', session.id, { wedding_id: session.wedding_id, document_id: doc.id })
  return c.json({ redirect: `/app/weddings/${session.wedding_id}/sign/${session.id}` })
})

// Release the session so the couple can sign on their own device (the celebrant
// witnesses). Re-lock with /lock before they sign if needed.
signing.post('/app/weddings/:weddingId/sign/:sessionId/release', async (c) => {
  const session = await ownedSession(c)
  if (!session) return c.notFound()
  const vendor = c.get('vendor') as VendorProfile
  if (session.status === 'awaiting_couple' && !session.couple_released) {
    await setCoupleReleased(c.env.DB, session.id, vendor.id, true)
    await auditLog(c, 'signing_released', 'signing_session', session.id, { wedding_id: session.wedding_id })
  }
  return c.redirect(`/app/weddings/${session.wedding_id}/sign/${session.id}`)
})

signing.post('/app/weddings/:weddingId/sign/:sessionId/lock', async (c) => {
  const session = await ownedSession(c)
  if (!session) return c.notFound()
  const vendor = c.get('vendor') as VendorProfile
  if (session.status === 'awaiting_couple' && session.couple_released) {
    await setCoupleReleased(c.env.DB, session.id, vendor.id, false)
    await auditLog(c, 'signing_locked', 'signing_session', session.id, { wedding_id: session.wedding_id })
  }
  return c.redirect(`/app/weddings/${session.wedding_id}/sign/${session.id}`)
})

// Celebrant uploads any PDF to start a signing session on a wedding they're on.
signing.post('/app/weddings/:weddingId/sign/new', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor') as VendorProfile
  const weddingId = c.req.param('weddingId')
  if (!hasCategory(vendor, 'celebrant')) return c.notFound()
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership || membership.vendor_profile_id !== vendor.id) return c.text('Not allowed', 403)

  const body = await c.req.parseBody()
  const file = body['file']
  if (!(file instanceof File) || file.type !== 'application/pdf' || file.size <= 0 || file.size > 10 * 1024 * 1024) {
    return c.text('Please choose a PDF up to 10 MB.', 400)
  }
  const title = typeof body['title'] === 'string' && body['title'].trim() ? (body['title'] as string).trim() : file.name.replace(/\.pdf$/i, '')

  const session = await startSigningSessionFromBytes(c, {
    weddingId,
    vendor,
    userId: user.id,
    bytes: await file.arrayBuffer(),
    title,
    sourceKind: 'upload',
  })
  return c.redirect(`/app/weddings/${weddingId}/sign/${session.id}`)
})

export default signing
