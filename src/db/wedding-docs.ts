// Data layer for the collaborative scoped wedding docs + their live presence.
//
// One interface over two physical stores so callers never branch on scope:
//   • shared  → weddings.notes (kept as the wedding.md body — unchanged round-trip)
//   • vendors/couple → wedding_docs rows
//
// Concurrency uses an opaque content TOKEN (a hash of the stored content).
// Saves carry the token they loaded; if the stored content moved underneath
// (another web editor, or an Obsidian edit to wedding.md), the token mismatches
// and the save is rejected with the latest content so the client reloads
// instead of clobbering. This is the live-edit complement to the file-level
// etag conflict detection in the storage layer.

import { updateWedding } from './weddings'
import type { DocScope, DocMembership } from '../services/doc-permissions'
import { readableScopes, canWriteDoc, isSoloScope } from '../services/doc-permissions'

export type DocState = {
  scope: DocScope
  content: string
  token: string
}

export type DocSaveResult =
  | { ok: true; token: string }
  | { ok: false; conflict: true; content: string; token: string }

export type PresenceViewer = {
  userId: string
  name: string
  role: string
  isEditing: boolean
}

export type PresenceSummary = {
  viewers: PresenceViewer[]
  /** The current soft-lock holder, if anyone is actively editing. */
  lockedBy: { userId: string; name: string } | null
  youHoldLock: boolean
}

// A presence row is "live" within this window; the client polls every ~5s.
const PRESENCE_FRESH_SECONDS = 25
// Rows older than this are pruned opportunistically on each poll.
const PRESENCE_STALE_SECONDS = 60

/** Deterministic, synchronous content token (FNV-1a, 32-bit hex). */
export function contentToken(content: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  // length guards against a few pathological collisions on same-hash strings
  return (hash >>> 0).toString(16).padStart(8, '0') + '-' + content.length.toString(16)
}

async function readSharedContent(db: D1Database, weddingId: string): Promise<string> {
  const row = await db
    .prepare('SELECT notes FROM weddings WHERE id = ?')
    .bind(weddingId)
    .first<{ notes: string | null }>()
  return row?.notes ?? ''
}

async function readPrivateContent(
  db: D1Database,
  weddingId: string,
  userId: string
): Promise<string> {
  const row = await db
    .prepare('SELECT vendor_notes FROM wedding_members WHERE wedding_id = ? AND user_id = ?')
    .bind(weddingId, userId)
    .first<{ vendor_notes: string | null }>()
  return row?.vendor_notes ?? ''
}

async function readScopedContent(
  db: D1Database,
  weddingId: string,
  scope: DocScope
): Promise<string> {
  const row = await db
    .prepare('SELECT content FROM wedding_docs WHERE wedding_id = ? AND scope = ?')
    .bind(weddingId, scope)
    .first<{ content: string }>()
  return row?.content ?? ''
}

/**
 * Read a scope's current content. `userId` is required for the per-user
 * `private` scope (each vendor's own note); ignored for the others.
 */
async function readScope(
  db: D1Database,
  weddingId: string,
  scope: DocScope,
  userId?: string
): Promise<string> {
  if (scope === 'shared') return readSharedContent(db, weddingId)
  if (scope === 'private') return userId ? readPrivateContent(db, weddingId, userId) : ''
  return readScopedContent(db, weddingId, scope) // vendors | couple
}

/** Write a scope's content to its backing store. */
async function writeScope(
  db: D1Database,
  weddingId: string,
  scope: DocScope,
  content: string,
  userId: string
): Promise<void> {
  if (scope === 'shared') {
    await updateWedding(db, weddingId, { notes: content || null })
    return
  }
  if (scope === 'private') {
    await db
      .prepare('UPDATE wedding_members SET vendor_notes = ? WHERE wedding_id = ? AND user_id = ?')
      .bind(content || null, weddingId, userId)
      .run()
    return
  }
  await db
    .prepare(
      `INSERT INTO wedding_docs (wedding_id, scope, content, version, updated_by_user_id, updated_at)
       VALUES (?, ?, ?, 1, ?, datetime('now'))
       ON CONFLICT(wedding_id, scope) DO UPDATE SET
         content = excluded.content,
         version = wedding_docs.version + 1,
         updated_by_user_id = excluded.updated_by_user_id,
         updated_at = datetime('now')`
    )
    .bind(weddingId, scope, content, userId)
    .run()
}

export type DocTabState = {
  scope: DocScope
  content: string
  token: string
  canWrite: boolean
  /** Solo scope (e.g. private) — no other participant, skip presence/lock. */
  solo: boolean
}

/** The docs a member may see (in display order) with content + write flag. */
export async function loadDocTabs(
  db: D1Database,
  weddingId: string,
  member: DocMembership,
  userId: string
): Promise<DocTabState[]> {
  // Read the scopes in parallel (independent backing stores), preserving order.
  return Promise.all(
    readableScopes(member).map(async (scope) => {
      const { content, token } = await getDoc(db, weddingId, scope, userId)
      return { scope, content, token, canWrite: canWriteDoc(member, scope), solo: isSoloScope(scope) }
    })
  )
}

/** Load a doc's current content + concurrency token. */
export async function getDoc(
  db: D1Database,
  weddingId: string,
  scope: DocScope,
  userId?: string
): Promise<DocState> {
  const content = await readScope(db, weddingId, scope, userId)
  return { scope, content, token: contentToken(content) }
}

/**
 * Save a doc with optimistic concurrency. Returns a conflict (with the latest
 * content + token) when the stored content moved since `baseToken` was issued.
 */
export async function saveDoc(
  db: D1Database,
  weddingId: string,
  scope: DocScope,
  content: string,
  baseToken: string,
  userId: string
): Promise<DocSaveResult> {
  const current = await readScope(db, weddingId, scope, userId)
  const currentToken = contentToken(current)

  if (baseToken !== currentToken) {
    return { ok: false, conflict: true, content: current, token: currentToken }
  }

  await writeScope(db, weddingId, scope, content, userId)
  return { ok: true, token: contentToken(content) }
}

/**
 * Append text to the bottom of a doc (server-side, no token guard — appends to
 * the latest stored content). Returns the new full content. Used by the MCP
 * append tool. Callers enforce the permission gate first.
 */
export async function appendToDoc(
  db: D1Database,
  weddingId: string,
  scope: DocScope,
  userId: string,
  text: string
): Promise<string> {
  const current = await readScope(db, weddingId, scope, userId)
  const trimmedCurrent = current.replace(/\s+$/, '')
  const addition = text.trim()
  if (!addition) return current
  const next = trimmedCurrent ? trimmedCurrent + '\n\n' + addition : addition
  await writeScope(db, weddingId, scope, next, userId)
  return next
}

// ─── Presence + soft editing-lock (Rung 2) ───

async function pruneStalePresence(db: D1Database, weddingId: string, scope: DocScope): Promise<void> {
  await db
    .prepare(
      `DELETE FROM doc_presence
       WHERE wedding_id = ? AND scope = ?
         AND datetime(last_seen_at) < datetime('now', ?)`
    )
    .bind(weddingId, scope, `-${PRESENCE_STALE_SECONDS} seconds`)
    .run()
}

async function presenceSummary(
  db: D1Database,
  weddingId: string,
  scope: DocScope,
  userId: string
): Promise<PresenceSummary> {
  const rows = await db
    .prepare(
      `SELECT user_id, user_name, role, is_editing FROM doc_presence
       WHERE wedding_id = ? AND scope = ?
         AND datetime(last_seen_at) > datetime('now', ?)
       ORDER BY last_seen_at DESC`
    )
    .bind(weddingId, scope, `-${PRESENCE_FRESH_SECONDS} seconds`)
    .all<{ user_id: string; user_name: string; role: string; is_editing: number }>()
    .then((r) => r.results)

  const viewers: PresenceViewer[] = rows.map((r) => ({
    userId: r.user_id,
    name: r.user_name,
    role: r.role,
    isEditing: r.is_editing === 1,
  }))
  const holder = viewers.find((v) => v.isEditing) ?? null
  return {
    viewers,
    lockedBy: holder ? { userId: holder.userId, name: holder.name } : null,
    youHoldLock: holder?.userId === userId,
  }
}

/** Refresh this user's presence (does NOT change lock ownership). */
export async function heartbeatPresence(
  db: D1Database,
  weddingId: string,
  scope: DocScope,
  user: { id: string; name: string },
  role: string
): Promise<PresenceSummary> {
  await db
    .prepare(
      `INSERT INTO doc_presence (wedding_id, scope, user_id, user_name, role, is_editing, last_seen_at)
       VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
       ON CONFLICT(wedding_id, scope, user_id) DO UPDATE SET
         user_name = excluded.user_name,
         role = excluded.role,
         last_seen_at = datetime('now')`
    )
    .bind(weddingId, scope, user.id, user.name, role)
    .run()
  await pruneStalePresence(db, weddingId, scope)
  return presenceSummary(db, weddingId, scope, user.id)
}

/** Take the soft editing-lock (clears any other holder — soft takeover). */
export async function claimLock(
  db: D1Database,
  weddingId: string,
  scope: DocScope,
  user: { id: string; name: string },
  role: string
): Promise<PresenceSummary> {
  await db
    .prepare(
      `UPDATE doc_presence SET is_editing = 0
       WHERE wedding_id = ? AND scope = ? AND user_id != ?`
    )
    .bind(weddingId, scope, user.id)
    .run()
  await db
    .prepare(
      `INSERT INTO doc_presence (wedding_id, scope, user_id, user_name, role, is_editing, last_seen_at)
       VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
       ON CONFLICT(wedding_id, scope, user_id) DO UPDATE SET
         is_editing = 1,
         user_name = excluded.user_name,
         role = excluded.role,
         last_seen_at = datetime('now')`
    )
    .bind(weddingId, scope, user.id, user.name, role)
    .run()
  await pruneStalePresence(db, weddingId, scope)
  return presenceSummary(db, weddingId, scope, user.id)
}

/** Release this user's lock (best-effort, e.g. on unload/blur). */
export async function releaseLock(
  db: D1Database,
  weddingId: string,
  scope: DocScope,
  userId: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE doc_presence SET is_editing = 0
       WHERE wedding_id = ? AND scope = ? AND user_id = ?`
    )
    .bind(weddingId, scope, userId)
    .run()
}

/** Markdown body for the vendors-scope team.md companion (empty → null). */
export async function getVendorsDocContent(
  db: D1Database,
  weddingId: string
): Promise<string | null> {
  const row = await db
    .prepare("SELECT content FROM wedding_docs WHERE wedding_id = ? AND scope = 'vendors'")
    .bind(weddingId)
    .first<{ content: string }>()
  const content = row?.content ?? ''
  return content.trim() ? content : null
}

/** Ingest an external edit to team.md back into the vendors-scope doc. */
export async function setVendorsDocContent(
  db: D1Database,
  weddingId: string,
  content: string,
  userId: string | null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO wedding_docs (wedding_id, scope, content, version, updated_by_user_id, updated_at)
       VALUES (?, 'vendors', ?, 1, ?, datetime('now'))
       ON CONFLICT(wedding_id, scope) DO UPDATE SET
         content = excluded.content,
         version = wedding_docs.version + 1,
         updated_by_user_id = excluded.updated_by_user_id,
         updated_at = datetime('now')`
    )
    .bind(weddingId, content, userId)
    .run()
}
