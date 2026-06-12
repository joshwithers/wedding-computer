/**
 * Vault sync API — powers the Wedding Computer Obsidian plugin (and any
 * other client that wants the vendor's data as a folder of markdown).
 *
 *   GET /vault/v1/files          list every syncable file with its etag
 *   GET /vault/v1/file/<path>    file content, etag in the ETag header
 *   PUT /vault/v1/file/<path>    write a file; requires If-Match (update)
 *                                or If-None-Match: * (create); 412 on
 *                                etag mismatch so clients detect conflicts
 *
 * Auth: Authorization: Bearer <sync token> — the same per-vendor token
 * used for CalDAV/CardDAV device sync (Pro feature). Basic auth with the
 * token as the password also works.
 *
 * Writes go through the vendor's storage backend (R2 or GitHub) and are
 * ingested into D1 immediately, so an edit saved in Obsidian shows up in
 * the web app without waiting for the background sweep.
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env, VendorProfile } from '../types'
import { getVendorByIcalToken } from '../db/vendors'
import { isProVendor } from '../db/subscriptions'
import { getStorageWithSecrets } from '../storage'
import { applyPulledFile, validatePulledFile } from '../storage/sync'
import { pushAllWeddingFiles } from '../services/storage-push'
import { isIgnoredPath } from '../storage/github'
import { clientIp, isAuthThrottled, recordAuthFailure, rateLimitByName, consumeRateLimit } from '../middleware/rate-limit'
import { auditLog } from '../middleware/audit'

const MAX_FILE_BYTES = 1_000_000 // 1MB — markdown files are tiny; this is a safety net

const vaultApi = new Hono<Env>()

// Loose per-IP backstop for the unauthenticated surface (failed tokens are
// separately throttled). The real per-account bound is keyed on the vendor
// below, so clients sharing a NAT/proxy IP aren't lumped together.
vaultApi.use('/vault/*', rateLimitByName('vault', 1200, 60))

/**
 * Authenticate the request's sync token, with failed-attempt throttling.
 * Returns the vendor, or a ready-to-send 401/429 response.
 */
async function requireVaultVendor(c: Context<Env>): Promise<VendorProfile | Response> {
  const ip = clientIp(c)
  if (await isAuthThrottled(c.env.KV, ip)) {
    return c.json({ error: 'Too many failed attempts. Try again later.' }, 429)
  }

  const header = c.req.header('authorization')
  let token: string | null = null

  if (header?.startsWith('Bearer ')) {
    token = header.slice(7).trim()
  } else if (header?.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6))
      token = decoded.slice(decoded.indexOf(':') + 1)
    } catch {
      token = null
    }
  }

  const vendor = token && token.length >= 32 ? await getVendorByIcalToken(c.env.DB, token) : null
  // Vault sync rides on the device-sync token, which is a Pro feature
  const allowed = vendor && (await isProVendor(c.env.DB, vendor.id)) ? vendor : null

  if (!allowed) {
    if (header) await recordAuthFailure(c.env.KV, ip)
    return c.json({ error: 'Invalid or missing sync token' }, 401)
  }

  // Per-vendor budget so one token spread across many IPs can't exceed it.
  if (!(await consumeRateLimit(c.env.KV, `vault:${allowed.id}`, 600, 60))) {
    return c.json({ error: 'Too many requests' }, 429)
  }
  return allowed
}

/**
 * Extract and validate the file path from /vault/v1/file/<path>.
 * Returns null for anything outside the syncable tree.
 */
function parseFilePath(c: Context<Env>): string | null {
  const raw = c.req.path.replace(/^\/vault\/v1\/file\//, '')
  let path: string
  try {
    path = decodeURIComponent(raw)
  } catch {
    return null
  }

  if (!path || path.length > 512) return null
  if (path.includes('..') || path.includes('//') || path.startsWith('/')) return null
  if (!/^[\p{L}\p{N} \-_'().,&/]+\.md$/u.test(path)) return null
  if (!path.startsWith('contacts/') && !path.startsWith('weddings/')) return null
  if (isIgnoredPath(path)) return null
  return path
}

/** Strip surrounding quotes and weak-validator prefix from an etag header. */
function normalizeEtag(value: string | undefined): string | null {
  if (!value) return null
  return value.replace(/^W\//, '').replace(/^"|"$/g, '').trim() || null
}

vaultApi.get('/vault/v1/files', async (c) => {
  const vendor = await requireVaultVendor(c)
  if (vendor instanceof Response) return vendor

  let storage
  try {
    storage = await getStorageWithSecrets(c.env, vendor)
  } catch {
    return c.json({ error: 'Storage is not configured for this account' }, 503)
  }

  const files: { path: string; etag: string; size: number }[] = []
  for (const prefix of ['contacts/', 'weddings/']) {
    let cursor: string | undefined
    do {
      const result = await storage.list(prefix, cursor)
      for (const f of result.files) {
        if (f.path.endsWith('.md') && !isIgnoredPath(f.path)) {
          files.push({ path: f.path, etag: f.etag, size: f.size })
        }
      }
      cursor = result.cursor
    } while (cursor)
  }

  return c.json({
    vendor: vendor.business_name,
    files,
  })
})

vaultApi.get('/vault/v1/file/*', async (c) => {
  const vendor = await requireVaultVendor(c)
  if (vendor instanceof Response) return vendor

  const path = parseFilePath(c)
  if (!path) return c.json({ error: 'Invalid path' }, 400)

  let storage
  try {
    storage = await getStorageWithSecrets(c.env, vendor)
  } catch {
    return c.json({ error: 'Storage is not configured for this account' }, 503)
  }

  const file = await storage.read(path)
  if (!file) return c.json({ error: 'Not found' }, 404)

  return c.body(file.content, 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    ETag: `"${file.meta.etag}"`,
  })
})

vaultApi.put('/vault/v1/file/*', async (c) => {
  const vendor = await requireVaultVendor(c)
  if (vendor instanceof Response) return vendor

  const path = parseFilePath(c)
  if (!path) return c.json({ error: 'Invalid path' }, 400)

  const content = await c.req.text()
  if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) {
    return c.json({ error: 'File too large' }, 413)
  }

  // Reject content the app could never ingest, before it lands in storage
  const valid = validatePulledFile(path, content)
  if (!valid.ok) return c.json({ error: valid.error }, 422)

  let storage
  try {
    storage = await getStorageWithSecrets(c.env, vendor)
  } catch {
    return c.json({ error: 'Storage is not configured for this account' }, 503)
  }

  // Optimistic concurrency: the client must say what it thinks is there
  const ifMatch = normalizeEtag(c.req.header('if-match'))
  const ifNoneMatch = c.req.header('if-none-match')?.trim()
  if (!ifMatch && ifNoneMatch !== '*') {
    return c.json({ error: 'Provide If-Match: "<etag>" to update or If-None-Match: * to create' }, 428)
  }

  const current = await storage.head(path)
  if (ifNoneMatch === '*' && current) {
    return c.body(JSON.stringify({ error: 'File already exists' }), 412, {
      'Content-Type': 'application/json',
      ETag: `"${current.etag}"`,
    })
  }
  if (ifMatch) {
    if (!current) return c.json({ error: 'File no longer exists' }, 412)
    if (current.etag !== ifMatch) {
      return c.body(JSON.stringify({ error: 'File changed on the server' }), 412, {
        'Content-Type': 'application/json',
        ETag: `"${current.etag}"`,
      })
    }
  }

  const etag = await storage.write(path, content)

  await auditLog(c, 'vault_file_write', 'vault_file', path, {
    vendor_id: vendor.id,
    bytes: content.length,
  }).catch((e: any) => console.error('[AUDIT]', e.message))

  // Ingest into D1 so the web app reflects the edit immediately
  let ingested = false
  let pendingApproval: string[] | undefined
  let revised = false
  try {
    const outcome = await applyPulledFile(c.env.DB, vendor.id, path, content, etag, {
      queue: c.env.EMAIL_QUEUE,
      requestedByLabel: vendor.business_name,
    })
    ingested = outcome.applied !== 'ignored'
    if (outcome.applied !== 'ignored') {
      pendingApproval = outcome.pendingApproval
      // Parts of the write were routed elsewhere (timeline approval) or
      // assigned server-side ids (new run sheet rows): the canonical file
      // differs from what the client sent, so regenerate it. Clients see
      // a changed etag on their next sync and pull the revision.
      if (outcome.needsRepush) {
        revised = true
        c.executionCtx.waitUntil(pushAllWeddingFiles(c.env, vendor, outcome.entityId))
      }
    }
  } catch (err: any) {
    // Validation passed but ingest failed — file is in storage, the
    // background sweep will retry. Don't fail the client write.
    console.error(`[vault-api] ingest failed for ${path}:`, err.message)
  }

  return c.body(
    JSON.stringify({
      etag,
      ingested,
      ...(pendingApproval ? { pending_approval: pendingApproval } : {}),
      ...(revised ? { revised: true } : {}),
    }),
    200,
    {
      'Content-Type': 'application/json',
      ETag: `"${etag}"`,
    }
  )
})

export default vaultApi
