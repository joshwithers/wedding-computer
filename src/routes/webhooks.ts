/**
 * External webhooks (non-Stripe).
 *
 * POST /webhooks/github — GitHub push events for vendors with git
 * storage. Registered automatically when a vendor connects GitHub
 * (token permitting). Verifies the per-vendor HMAC secret, then pulls
 * external edits into D1 immediately instead of waiting for the
 * 5-minute background sweep.
 *
 * Note: our own API writes also fire this webhook. That's fine — the
 * pull engine compares etags against file_index and no-ops on files we
 * wrote ourselves.
 */

import { Hono } from 'hono'
import type { Env, VendorProfile } from '../types'
import { vendorSecretKey } from '../services/secrets'
import { syncVendorStorage } from '../services/storage-sync'
import { suppressEmail } from '../db/emails'

const webhooks = new Hono<Env>()

webhooks.post('/webhooks/github', async (c) => {
  const signature = c.req.header('x-hub-signature-256')
  const event = c.req.header('x-github-event')
  const body = await c.req.text()

  if (!signature) return c.json({ error: 'Missing signature' }, 401)

  let payload: { ref?: string; repository?: { full_name?: string } }
  try {
    payload = JSON.parse(body)
  } catch {
    return c.json({ error: 'Invalid payload' }, 400)
  }

  const repo = payload.repository?.full_name
  if (!repo) return c.json({ error: 'Missing repository' }, 400)

  // A repo can in principle back more than one vendor profile
  const vendors = await c.env.DB
    .prepare(
      `SELECT * FROM vendor_profiles
       WHERE storage_type = 'git' AND json_extract(storage_config, '$.git_repo') = ?`
    )
    .bind(repo)
    .all<VendorProfile>()
    .then((r) => r.results)

  if (vendors.length === 0) return c.json({ ok: true })

  const verified: VendorProfile[] = []
  for (const vendor of vendors) {
    const secret = await c.env.KV.get(vendorSecretKey(vendor.id, 'github_webhook_secret'))
    if (secret && (await verifyGitHubSignature(body, signature, secret))) {
      verified.push(vendor)
    }
  }
  if (verified.length === 0) return c.json({ error: 'Invalid signature' }, 401)

  // GitHub sends a "ping" on hook creation; only pushes need a sync
  if (event !== 'push') return c.json({ ok: true })

  for (const vendor of verified) {
    let branch = 'main'
    try {
      branch = JSON.parse(vendor.storage_config ?? '{}').git_branch ?? 'main'
    } catch { /* default */ }
    if (payload.ref && payload.ref !== `refs/heads/${branch}`) continue

    // Respond to GitHub fast; sync in the background
    c.executionCtx.waitUntil(
      syncVendorStorage(c.env, vendor)
        .then((r) => {
          if (r.pulled > 0 || r.errors > 0) {
            console.log(`[webhook] github sync vendor ${vendor.id}: ${r.pulled} pulled, ${r.weddingsSynced} pushed, ${r.errors} errors`)
          }
        })
        .catch((err) => console.error(`[webhook] github sync failed for vendor ${vendor.id}:`, err))
    )
  }

  return c.json({ ok: true })
})

/**
 * POST /webhooks/resend — delivery events from Resend (Svix-signed).
 *
 * On a hard bounce or spam complaint we add the recipient to the suppression
 * list so we stop emailing them, protecting the shared domain's reputation.
 * Soft/transient bounces are ignored.
 */
webhooks.post('/webhooks/resend', async (c) => {
  const body = await c.req.text()
  const secret = c.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    console.error('[webhook] RESEND_WEBHOOK_SECRET not configured')
    return c.json({ error: 'Not configured' }, 503)
  }

  const ok = await verifySvixSignature(
    body,
    {
      id: c.req.header('svix-id'),
      timestamp: c.req.header('svix-timestamp'),
      signature: c.req.header('svix-signature'),
    },
    secret
  )
  if (!ok) return c.json({ error: 'Invalid signature' }, 401)

  let event: {
    type?: string
    data?: { to?: string[] | string; bounce?: { type?: string }; email_id?: string }
  }
  try {
    event = JSON.parse(body)
  } catch {
    return c.json({ error: 'Invalid payload' }, 400)
  }

  const recipients = Array.isArray(event.data?.to)
    ? event.data!.to
    : event.data?.to
      ? [event.data.to]
      : []

  if (event.type === 'email.bounced') {
    // Resend emits email.bounced for hard bounces; skip anything explicitly
    // flagged transient.
    if (event.data?.bounce?.type !== 'Transient') {
      for (const to of recipients) {
        await suppressEmail(c.env.DB, to, 'bounce', event.data?.email_id ?? null)
      }
    }
  } else if (event.type === 'email.complained') {
    for (const to of recipients) {
      await suppressEmail(c.env.DB, to, 'complaint', event.data?.email_id ?? null)
    }
  }

  return c.json({ ok: true })
})

/**
 * Verify a Svix/Resend webhook signature. The signed content is
 * `${id}.${timestamp}.${body}`, HMAC-SHA256 with the base64 secret (after the
 * `whsec_` prefix), base64-encoded. The svix-signature header is a
 * space-separated list of `v1,<sig>` entries; any match passes. Exported for
 * tests.
 */
export async function verifySvixSignature(
  body: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  secret: string
): Promise<boolean> {
  if (!headers.id || !headers.timestamp || !headers.signature) return false

  const secretBytes = base64ToBytes(secret.replace(/^whsec_/, ''))
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signed = new TextEncoder().encode(`${headers.id}.${headers.timestamp}.${body}`)
  const mac = await crypto.subtle.sign('HMAC', key, signed)
  const expected = bytesToBase64(new Uint8Array(mac))

  // Header is space-separated "v1,<base64sig>" entries — match any.
  for (const part of headers.signature.split(' ')) {
    const sig = part.includes(',') ? part.split(',')[1] : part
    if (timingSafeEqual(sig, expected)) return true
  }
  return false
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

/**
 * Verify GitHub's X-Hub-Signature-256 header: "sha256=" + HMAC-SHA256
 * of the raw body, hex encoded. Constant-time comparison.
 * Exported for tests.
 */
export async function verifyGitHubSignature(
  body: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  const expected =
    'sha256=' +
    [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')

  if (expected.length !== signature.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return mismatch === 0
}

export default webhooks
