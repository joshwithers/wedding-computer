/**
 * Sync engine — reconciles D1 index with actual files in storage.
 *
 * The markdown files in R2/Git are the source of truth for contacts.
 * This engine scans storage and updates the D1 index to match.
 *
 * Three cases:
 * 1. File in storage but NOT in index → new external file, index it
 * 2. File in storage AND in index, etags match → no change, skip
 * 3. File in storage AND in index, etags differ → re-parse, update index
 * 4. Index entry but NO file in storage → deleted externally, remove from index
 *
 * The weddings/ directory holds one folder per wedding:
 *   weddings/2026-07-12-sarah-james/wedding.md   → weddings table
 *   weddings/2026-07-12-sarah-james/todo.md      → wedding_todos table
 *   weddings/2026-07-12-sarah-james/timeline.md  → run_sheet_items (own rows two-way)
 *   weddings/2026-07-12-sarah-james/notes.md     → wedding_members.vendor_notes (private)
 *   weddings/2026-07-12-sarah-james/vendors.md   → push-only (derived team list, never pulled)
 *   weddings/2026-07-12-sarah-james/log.md       → push-only (derived changelog, never pulled)
 *   weddings/<flat>.md                           → legacy format, ignored
 *
 * Conflict detection happens at write time: if we try to write and
 * the file's etag doesn't match what we last saw, we record a conflict
 * instead of overwriting.
 */

import type { Contact, Wedding } from '../types'
import type { StorageBackend, FileMeta } from './types'
import { parseMarkdown, ParseError } from './markdown'
import { markdownToContact, contactCachedData, syncToContactsTable } from './contacts'
import { markdownToWedding, weddingCachedData } from './weddings'
import { parseTimelineMarkdown, diffRunSheetRows } from './run-sheet-md'
import { isIgnoredPath } from './github'
import { getWeddingTodo } from '../db/todos'
import { listRunSheetItems, applyRunSheetDiff } from '../db/run-sheet'
import { setVendorsDocContent } from '../db/wedding-docs'
import { listOwnedItemsAsRows, applyTimelineRowDiff, applyWeddingUpdate, pickHeadlineFields } from '../db/timeline'
import {
  partitionVendorWeddingUpdate,
  getTimelineControl,
  summarizeTimelineChanges,
  queueTimelineChangeRequest,
  changedTimelineFields,
} from '../services/timeline-edit'
import { resyncWeddingCalendars } from '../services/wedding-calendar'
export { checkForExternalChange, recordConflict } from './conflicts'

export type SyncResult = {
  indexed: number    // new files found and indexed
  updated: number    // existing files with changed content
  removed: number    // index entries for deleted files
  errors: number     // files that failed to parse
  skipped: number    // unchanged files (etag match)
}

function emptyResult(): SyncResult {
  return { indexed: 0, updated: 0, removed: 0, errors: 0, skipped: 0 }
}

function mergeInto(target: SyncResult, source: SyncResult): void {
  target.indexed += source.indexed
  target.updated += source.updated
  target.removed += source.removed
  target.errors += source.errors
  target.skipped += source.skipped
}

/**
 * Classify a path under weddings/ so the engine knows how to treat it.
 */
export function classifyWeddingPath(
  path: string
): 'wedding' | 'todo' | 'timeline' | 'notes' | 'doc' | 'vendors' | 'log' | 'legacy' | 'other' {
  if (!path.startsWith('weddings/')) return 'other'
  const parts = path.slice('weddings/'.length).split('/')
  if (parts.length === 1) {
    // Flat file directly under weddings/ — pre-folder legacy format
    return parts[0].endsWith('.md') ? 'legacy' : 'other'
  }
  if (parts.length === 2) {
    if (parts[1] === 'wedding.md') return 'wedding'
    if (parts[1] === 'todo.md') return 'todo'
    if (parts[1] === 'timeline.md') return 'timeline'
    if (parts[1] === 'notes.md') return 'notes'
    if (parts[1] === 'team.md') return 'doc'
    if (parts[1] === 'vendors.md') return 'vendors'
    if (parts[1] === 'log.md') return 'log'
  }
  return 'other' // files/ uploads, deeper nesting
}

/**
 * Full sync: scan all files in a vendor's storage and
 * reconcile the D1 index. Safe to run on a schedule or
 * triggered by webhook.
 */
export async function syncVendor(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string,
  opts: Pick<ApplyOptions, 'queue' | 'requestedByLabel'> = {}
): Promise<SyncResult> {
  const result = emptyResult()

  // Run contact and wedding syncs independently — one failing
  // should not prevent the other from completing.
  const results = await Promise.allSettled([
    syncContacts(storage, db, vendorId),
    syncWeddingsDir(storage, db, vendorId, opts),
  ])

  for (const r of results) {
    if (r.status === 'fulfilled') {
      mergeInto(result, r.value)
    } else {
      console.error('[sync] Entity type sync failed:', r.reason)
      result.errors++
    }
  }

  return result
}

export type ApplyOutcome =
  | {
      applied: 'contact' | 'wedding' | 'todo' | 'timeline' | 'notes' | 'doc'
      entityId: string
      /** Timeline fields routed to a change request instead of written. */
      pendingApproval?: string[]
      /** The canonical file now differs from what was written — re-push it. */
      needsRepush?: boolean
    }
  | { applied: 'ignored'; reason: string }

export type ApplyOptions = {
  resolveWeddingFolder?: (folder: string) => string | undefined
  /** EMAIL_QUEUE, for notifying timeline controllers about change requests. */
  queue?: Queue
  /** Label for change requests, e.g. the vendor's business name. */
  requestedByLabel?: string
}

/**
 * Ingest a single pulled file into D1 and the file index. Shared by the
 * directory scans below and the vault API's PUT endpoint (which ingests
 * the file it just wrote so the app reflects the edit immediately).
 *
 * Throws on unparseable content — callers decide whether that is a
 * counted error (scan) or a client error (API).
 */
export async function applyPulledFile(
  db: D1Database,
  vendorId: string,
  path: string,
  content: string,
  etag: string,
  opts: ApplyOptions = {}
): Promise<ApplyOutcome> {
  if (path.startsWith('contacts/')) {
    const doc = parseMarkdown(content)
    const contact = markdownToContact(doc, vendorId)
    await syncToContactsTable(db, contact)
    await upsertIndexRow(db, vendorId, 'contact', contact.id, path, etag, contactCachedData(contact))
    return { applied: 'contact', entityId: contact.id }
  }

  const kind = classifyWeddingPath(path)

  if (kind === 'wedding') {
    const doc = parseMarkdown(content)
    const incoming = markdownToWedding(doc)

    // SECURITY: the wedding id comes from vendor-controlled frontmatter and
    // the weddings table is shared across all tenants. Without this gate a
    // crafted wedding.md could overwrite another couple's wedding and
    // self-grant a managing membership. Only allow the write when the
    // wedding is new (this vendor is creating it) or this vendor is already
    // an active member.
    const access = await weddingWriteAccess(db, vendorId, incoming.id)
    if (access === 'forbidden') {
      return { applied: 'ignored', reason: 'wedding belongs to another account' }
    }

    if (access === 'new') {
      await syncToWeddingsTable(db, incoming)
      // Materialise the headline slot rows from the wedding.md frontmatter so
      // timeline_items is the source of truth from birth (no row=null + column=set
      // drift). Pass current=null so any populated headline seeds its slot row.
      await applyWeddingUpdate(db, incoming.id, pickHeadlineFields(incoming), incoming.created_by_user_id ?? '', null)
      await ensureSyncedWeddingMembership(db, vendorId, incoming)
      await upsertIndexRow(db, vendorId, 'wedding', incoming.id, path, etag, weddingCachedData(incoming))
      return { applied: 'wedding', entityId: incoming.id }
    }

    // Existing wedding: a vendor's file edit must obey the same rules as
    // the web form. Couple-only fields are kept as-is, and timeline-field
    // changes from a non-controlling vendor become a pending change
    // request instead of a direct write.
    const current = await db
      .prepare('SELECT * FROM weddings WHERE id = ?')
      .bind(incoming.id)
      .first<Wedding>()
    if (!current) {
      return { applied: 'ignored', reason: 'wedding disappeared mid-sync' }
    }

    const vendor = await db
      .prepare('SELECT user_id, business_name FROM vendor_profiles WHERE id = ?')
      .bind(vendorId)
      .first<{ user_id: string; business_name: string | null }>()
    const control = vendor?.user_id
      ? await getTimelineControl(db, incoming.id, vendor.user_id)
      : { hasControllers: false, isController: false, controllerUserIds: [] }

    const { direct, pendingFields, pendingPayload } = partitionVendorWeddingUpdate(
      current,
      incoming,
      control
    )

    if (pendingFields.length > 0 && vendor?.user_id) {
      await queueTimelineChangeRequest(db, {
        wedding: current,
        requestedByUserId: vendor.user_id,
        requestedByLabel: opts.requestedByLabel ?? vendor.business_name ?? null,
        payload: pendingPayload,
        summary: summarizeTimelineChanges(current, incoming, pendingFields),
        controllerUserIds: control.controllerUserIds,
        queue: opts.queue,
      })
      // The file holds unapproved values — bump updated_at past the index's
      // last_synced_at so the sweep re-pushes the canonical wedding.md.
      direct.updated_at = new Date().toISOString()
    }

    // Timeline fields written directly (pending ones were reverted by the
    // partition above) must fan out to every member vendor's calendar
    // events, exactly like the web edit form — otherwise a ceremony moved
    // in Obsidian leaves stale events and CalDAV/iCal feeds behind. Title
    // and emoji count too: every derived event title embeds them, and
    // neither routes through approval, so they always apply directly.
    const appliedTimelineFields = changedTimelineFields(current, direct)
    const eventTitleChanged =
      String(current.title ?? '') !== String(direct.title ?? '') ||
      String(current.emoji ?? '') !== String(direct.emoji ?? '')

    // Snapshot the pre-sync headline values BEFORE the upsert (so only the
    // actually-changed headline fields route onto the rows; pending approval-gated
    // fields equal current and are left for the approver).
    const headlineBefore = pickHeadlineFields(current)
    await syncToWeddingsTable(db, direct)
    // Route the directly-applied headline changes onto the slot rows (the source of
    // truth) so timeline_items stays consistent with the columns Obsidian just
    // wrote. createItem materialises a row for a location/label even with no time,
    // closing the row=null + column=set drift.
    await applyWeddingUpdate(db, direct.id, pickHeadlineFields(direct), vendor?.user_id ?? direct.created_by_user_id ?? '', headlineBefore)
    await upsertIndexRow(db, vendorId, 'wedding', direct.id, path, etag, weddingCachedData(direct))

    if (appliedTimelineFields.length > 0 || eventTitleChanged) {
      try {
        await resyncWeddingCalendars(db, direct.id, vendorId)
      } catch (err) {
        console.error(`[sync] calendar resync failed for wedding ${direct.id}:`, err)
      }
    }

    return {
      applied: 'wedding',
      entityId: direct.id,
      ...(pendingFields.length > 0
        ? { pendingApproval: pendingFields, needsRepush: true }
        : {}),
    }
  }

  if (kind === 'timeline') {
    const doc = parseMarkdown(content)
    const folder = folderOf(path)
    const weddingId = await resolveCompanionWeddingId(db, vendorId, doc.frontmatter, folder, opts)
    if (!weddingId) return { applied: 'ignored', reason: 'timeline.md has no resolvable wedding' }

    if (!(await isActiveWeddingMember(db, vendorId, weddingId))) {
      return { applied: 'ignored', reason: 'not a member of that wedding' }
    }

    // The vault timeline.md is the UNIFIED timeline (timeline_items). A vendor's
    // own rows are two-way; rows they don't own are read-only (regenerated).
    const rows = parseTimelineMarkdown(content)
    const existing = await listOwnedItemsAsRows(db, weddingId, vendorId)
    const diff = diffRunSheetRows(existing, rows)
    const vendorUser = await db
      .prepare('SELECT user_id FROM vendor_profiles WHERE id = ?')
      .bind(vendorId)
      .first<{ user_id: string }>()
    await applyTimelineRowDiff(db, weddingId, vendorId, vendorUser?.user_id ?? null, diff)

    // New rows were assigned ids the file lacks — re-push the canonical file so
    // the next ingest doesn't recreate them.
    const needsRepush = diff.creates.length > 0
    await upsertIndexRow(db, vendorId, 'timeline', weddingId, path, etag, null)
    return { applied: 'timeline', entityId: weddingId, ...(needsRepush ? { needsRepush } : {}) }
  }

  if (kind === 'notes') {
    const doc = parseMarkdown(content)
    const folder = folderOf(path)
    const weddingId = await resolveCompanionWeddingId(db, vendorId, doc.frontmatter, folder, opts)
    if (!weddingId) return { applied: 'ignored', reason: 'notes.md has no resolvable wedding' }

    const vendorUser = await db
      .prepare('SELECT user_id FROM vendor_profiles WHERE id = ?')
      .bind(vendorId)
      .first<{ user_id: string }>()
    if (!vendorUser?.user_id || !(await isActiveWeddingMember(db, vendorId, weddingId))) {
      return { applied: 'ignored', reason: 'not a member of that wedding' }
    }

    await db
      .prepare('UPDATE wedding_members SET vendor_notes = ? WHERE wedding_id = ? AND user_id = ?')
      .bind(doc.body.trim() || null, weddingId, vendorUser.user_id)
      .run()
    await upsertIndexRow(db, vendorId, 'notes', weddingId, path, etag, null)
    return { applied: 'notes', entityId: weddingId }
  }

  if (kind === 'doc') {
    // team.md — the vendors-only collaborative doc (shared across vendors).
    const doc = parseMarkdown(content)
    const folder = folderOf(path)
    const weddingId = await resolveCompanionWeddingId(db, vendorId, doc.frontmatter, folder, opts)
    if (!weddingId) return { applied: 'ignored', reason: 'team.md has no resolvable wedding' }

    const vendorUser = await db
      .prepare('SELECT user_id FROM vendor_profiles WHERE id = ?')
      .bind(vendorId)
      .first<{ user_id: string }>()
    if (!vendorUser?.user_id || !(await isActiveWeddingMember(db, vendorId, weddingId))) {
      return { applied: 'ignored', reason: 'not a member of that wedding' }
    }

    await setVendorsDocContent(db, weddingId, doc.body.trim(), vendorUser.user_id)
    await upsertIndexRow(db, vendorId, 'doc', weddingId, path, etag, null)
    return { applied: 'doc', entityId: weddingId }
  }

  if (kind === 'todo') {
    const doc = parseMarkdown(content)
    const folder = folderOf(path)
    const weddingId = await resolveCompanionWeddingId(db, vendorId, doc.frontmatter, folder, opts)
    if (!weddingId) return { applied: 'ignored', reason: 'todo.md has no resolvable wedding' }

    if (!(await isActiveWeddingMember(db, vendorId, weddingId))) {
      return { applied: 'ignored', reason: 'not a member of that wedding' }
    }

    const body = doc.body.trim()
    const existing = await getWeddingTodo(db, vendorId, weddingId)
    if (!existing || existing.content.trim() !== body) {
      await db
        .prepare(
          `INSERT INTO wedding_todos (vendor_id, wedding_id, content)
           VALUES (?, ?, ?)
           ON CONFLICT(vendor_id, wedding_id) DO UPDATE SET
             content = excluded.content,
             updated_at = datetime('now')`
        )
        .bind(vendorId, weddingId, body)
        .run()
    }
    await upsertIndexRow(db, vendorId, 'todo', weddingId, path, etag, null)
    return { applied: 'todo', entityId: weddingId }
  }

  if (kind === 'log') return { applied: 'ignored', reason: 'log.md is generated by the app' }
  if (kind === 'vendors') return { applied: 'ignored', reason: 'vendors.md is generated by the app' }
  if (kind === 'legacy') return { applied: 'ignored', reason: 'legacy flat file' }
  return { applied: 'ignored', reason: 'not a syncable file' }
}

/**
 * Resolve which wedding a companion file (todo.md, timeline.md, notes.md)
 * belongs to: frontmatter wedding_id, then the folder map built during the
 * scan, then the indexed wedding.md in the same folder.
 */
async function resolveCompanionWeddingId(
  db: D1Database,
  vendorId: string,
  frontmatter: Record<string, unknown>,
  folder: string,
  opts: ApplyOptions
): Promise<string | null> {
  const fmWeddingId =
    typeof frontmatter.wedding_id === 'string' ? frontmatter.wedding_id : null
  const weddingId = fmWeddingId ?? opts.resolveWeddingFolder?.(folder) ?? null
  if (weddingId) return weddingId

  const row = await db
    .prepare('SELECT entity_id FROM file_index WHERE vendor_id = ? AND file_path = ?')
    .bind(vendorId, folder + 'wedding.md')
    .first<{ entity_id: string }>()
  return row?.entity_id ?? null
}

/** Is this vendor's user an active member of the wedding? */
async function isActiveWeddingMember(
  db: D1Database,
  vendorId: string,
  weddingId: string
): Promise<boolean> {
  const vendorUser = await db
    .prepare('SELECT user_id FROM vendor_profiles WHERE id = ?')
    .bind(vendorId)
    .first<{ user_id: string }>()
  if (!vendorUser?.user_id) return false
  const member = await db
    .prepare(
      "SELECT id FROM wedding_members WHERE wedding_id = ? AND user_id = ? AND status = 'active'"
    )
    .bind(weddingId, vendorUser.user_id)
    .first()
  return !!member
}

/**
 * Snapshot of everything timeline.md renders from, stored in the index
 * row's cached_data. The push sweep compares this against the live tables
 * to decide whether the file needs regenerating.
 */
export async function timelineCachedData(
  db: D1Database,
  weddingId: string
): Promise<string> {
  const items = await db
    .prepare(
      'SELECT COUNT(*) AS c, MAX(updated_at) AS l FROM run_sheet_items WHERE wedding_id = ?'
    )
    .bind(weddingId)
    .first<{ c: number; l: string | null }>()
  const pending = await db
    .prepare(
      "SELECT COUNT(*) AS p, MAX(created_at) AS pl FROM timeline_change_requests WHERE wedding_id = ? AND status = 'pending'"
    )
    .bind(weddingId)
    .first<{ p: number; pl: string | null }>()
  return JSON.stringify({
    c: items?.c ?? 0,
    l: items?.l ?? null,
    p: pending?.p ?? 0,
    pl: pending?.pl ?? null,
  })
}

/**
 * Check whether a file would be accepted by applyPulledFile, without
 * writing anything. Used by the vault API to reject junk before it
 * lands in storage.
 */
export function validatePulledFile(
  path: string,
  content: string
): { ok: true } | { ok: false; error: string } {
  try {
    if (path.startsWith('contacts/')) {
      markdownToContact(parseMarkdown(content), 'validation')
      return { ok: true }
    }
    const kind = classifyWeddingPath(path)
    if (kind === 'wedding') {
      markdownToWedding(parseMarkdown(content))
      return { ok: true }
    }
    if (kind === 'todo' || kind === 'notes' || kind === 'doc') {
      parseMarkdown(content)
      return { ok: true }
    }
    if (kind === 'timeline') {
      parseTimelineMarkdown(content)
      return { ok: true }
    }
    if (kind === 'log') {
      return { ok: false, error: 'log.md is generated by Wedding Computer and is read-only' }
    }
    if (kind === 'vendors') {
      return { ok: false, error: 'vendors.md is generated by Wedding Computer and is read-only — manage the wedding team in the app' }
    }
    return { ok: false, error: 'Not a syncable path. Files live under contacts/ or weddings/<folder>/.' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not parse file' }
  }
}

/**
 * Sync the contacts/ directory.
 */
async function syncContacts(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string
): Promise<SyncResult> {
  const result = emptyResult()

  const storageFiles = await listAllFiles(storage, 'contacts/')
  const storageByPath = new Map(storageFiles.map((f) => [f.path, f]))

  const indexRows = await db
    .prepare(
      "SELECT entity_id, file_path, etag, last_synced_at FROM file_index WHERE vendor_id = ? AND entity_type = 'contact'"
    )
    .bind(vendorId)
    .all<{ entity_id: string; file_path: string; etag: string; last_synced_at: string }>()
  const indexByPath = new Map(indexRows.results.map((r) => [r.file_path, r]))

  for (const [path, fileMeta] of storageByPath) {
    const indexEntry = indexByPath.get(path)
    if (indexEntry && indexEntry.etag === fileMeta.etag) {
      result.skipped++
      continue
    }

    // The file changed externally. If D1 has its own unpushed edit since
    // the last sync, applying the file would silently destroy it — defer
    // and let the push-side conflict detection surface the divergence.
    if (
      indexEntry &&
      (await localDiverged(db, 'contacts', indexEntry.entity_id, indexEntry.last_synced_at))
    ) {
      console.warn(`[sync] Deferring external change to ${path} for vendor ${vendorId} — unpushed local edit pending`)
      result.skipped++
      continue
    }

    try {
      const file = await storage.read(path)
      if (!file) continue

      await applyPulledFile(db, vendorId, path, file.content, file.meta.etag)

      if (indexEntry) result.updated++
      else result.indexed++
    } catch (err) {
      logFileError(path, err)
      result.errors++
    }
  }

  // Remove index entries for files that no longer exist in storage
  const toRemove = [...indexByPath.keys()].filter((path) => !storageByPath.has(path))
  if (safeToPruneIndex(storageByPath.size, toRemove.length, indexByPath.size)) {
    for (const path of toRemove) {
      await db
        .prepare(
          "DELETE FROM file_index WHERE vendor_id = ? AND entity_type = 'contact' AND file_path = ?"
        )
        .bind(vendorId, path)
        .run()
      result.removed++
    }
  } else if (toRemove.length > 0) {
    console.error(
      `[sync] Refusing to prune ${toRemove.length}/${indexByPath.size} contact index rows for vendor ${vendorId} — storage listing looks incomplete`
    )
    result.errors++
  }

  return result
}

/**
 * Sync the weddings/ directory: wedding.md and todo.md files are pulled
 * into D1; log.md is push-only bookkeeping; legacy flat files are ignored.
 */
async function syncWeddingsDir(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string,
  opts: Pick<ApplyOptions, 'queue' | 'requestedByLabel'> = {}
): Promise<SyncResult> {
  const result = emptyResult()

  const storageFiles = await listAllFiles(storage, 'weddings/')
  const storageByPath = new Map(storageFiles.map((f) => [f.path, f]))

  const allIndexRows = await db
    .prepare(
      'SELECT entity_id, entity_type, file_path, etag, last_synced_at FROM file_index WHERE vendor_id = ?'
    )
    .bind(vendorId)
    .all<{ entity_id: string; entity_type: string; file_path: string; etag: string; last_synced_at: string }>()
  const WEDDING_ENTITY_TYPES = ['wedding', 'todo', 'timeline', 'notes', 'doc', 'vendors', 'log']
  const weddingScoped = allIndexRows.results.filter((r) =>
    WEDDING_ENTITY_TYPES.includes(r.entity_type)
  )
  const indexByPath = new Map(weddingScoped.map((r) => [r.file_path, r]))

  // Folder → wedding id map, for resolving todo.md files. Seed it from
  // already-indexed wedding files; pass 1 adds newly discovered ones.
  const folderToWeddingId = new Map<string, string>()
  for (const row of weddingScoped) {
    if (row.entity_type === 'wedding') {
      folderToWeddingId.set(folderOf(row.file_path), row.entity_id)
    }
  }

  // ── Pass 1: wedding.md files ──
  for (const [path, fileMeta] of storageByPath) {
    if (classifyWeddingPath(path) !== 'wedding') continue

    const indexEntry = indexByPath.get(path)
    if (indexEntry && indexEntry.etag === fileMeta.etag) {
      result.skipped++
      continue
    }

    // External change to a wedding we already track. If the D1 row has an
    // unpushed local edit, defer rather than overwrite it — the push phase
    // will detect the divergence and record a conflict to resolve.
    if (
      indexEntry &&
      (await localDiverged(db, 'weddings', indexEntry.entity_id, indexEntry.last_synced_at))
    ) {
      console.warn(`[sync] Deferring external change to ${path} for vendor ${vendorId} — unpushed local wedding edit pending`)
      result.skipped++
      continue
    }

    try {
      const file = await storage.read(path)
      if (!file) continue

      const outcome = await applyPulledFile(db, vendorId, path, file.content, file.meta.etag, opts)
      if (outcome.applied === 'wedding') {
        folderToWeddingId.set(folderOf(path), outcome.entityId)
      }

      if (indexEntry) result.updated++
      else result.indexed++
    } catch (err) {
      logFileError(path, err)
      result.errors++
    }
  }

  // ── Pass 2: companion files (todo.md, timeline.md, notes.md, team.md) ──
  for (const [path, fileMeta] of storageByPath) {
    const kind = classifyWeddingPath(path)
    if (kind !== 'todo' && kind !== 'timeline' && kind !== 'notes' && kind !== 'doc') continue

    const indexEntry = indexByPath.get(path)
    if (indexEntry && indexEntry.etag === fileMeta.etag) {
      result.skipped++
      continue
    }

    try {
      const file = await storage.read(path)
      if (!file) continue

      const outcome = await applyPulledFile(db, vendorId, path, file.content, file.meta.etag, {
        ...opts,
        resolveWeddingFolder: (folder) => folderToWeddingId.get(folder),
      })

      if (outcome.applied === 'ignored') {
        result.skipped++
      } else if (indexEntry) {
        result.updated++
      } else {
        result.indexed++
      }
    } catch (err) {
      logFileError(path, err)
      result.errors++
    }
  }

  // ── Pass 3: remove index entries for deleted files ──
  const toRemove = [...indexByPath.entries()].filter(([path]) => !storageByPath.has(path))
  if (safeToPruneIndex(storageByPath.size, toRemove.length, indexByPath.size)) {
    for (const [path, indexEntry] of toRemove) {
      await db
        .prepare(
          'DELETE FROM file_index WHERE vendor_id = ? AND entity_type = ? AND file_path = ?'
        )
        .bind(vendorId, indexEntry.entity_type, path)
        .run()
      result.removed++
    }
  } else if (toRemove.length > 0) {
    console.error(
      `[sync] Refusing to prune ${toRemove.length}/${indexByPath.size} wedding index rows for vendor ${vendorId} — storage listing looks incomplete`
    )
    result.errors++
  }

  return result
}

function folderOf(path: string): string {
  return path.substring(0, path.lastIndexOf('/') + 1)
}

/**
 * Guard against a transient or partial storage listing wiping the index.
 * The deletion passes infer "file was deleted externally" from absence in
 * the listing — but an empty or truncated listing (network blip, backend
 * error, GitHub tree truncation) would then purge real data. Returns true
 * only when the prune looks like a genuine, bounded deletion.
 */
export function safeToPruneIndex(
  storageCount: number,
  removeCount: number,
  indexCount: number
): boolean {
  if (removeCount === 0) return true
  // An empty listing against a sizable index is almost always a failed list
  // call rather than a real mass-deletion. (A small index legitimately
  // emptying — e.g. a vendor deleting their last file — is allowed; the
  // index is a cache and re-indexes on the next successful sync anyway.)
  if (storageCount === 0 && indexCount > 10) return false
  // Refuse to prune a large fraction of a sizable index in one pass. A real
  // bulk deletion can still be reconciled with an explicit rebuildIndex().
  if (removeCount > 10 && removeCount >= indexCount * 0.5) return false
  return true
}

/**
 * Has the D1 entity been edited since we last synced its file? Used to
 * detect the case where an external file edit and an unpushed local edit
 * race, so the pull can defer instead of silently overwriting local work.
 *
 * `table` is a fixed internal literal ('contacts' | 'weddings'), never user
 * input, so interpolating it into the query is safe.
 */
async function localDiverged(
  db: D1Database,
  table: 'contacts' | 'weddings',
  entityId: string,
  lastSyncedAt: string | null
): Promise<boolean> {
  if (!lastSyncedAt) return false
  const row = await db
    .prepare(`SELECT updated_at FROM ${table} WHERE id = ?`)
    .bind(entityId)
    .first<{ updated_at: string }>()
  if (!row?.updated_at) return false
  return row.updated_at > lastSyncedAt
}

function logFileError(path: string, err: unknown): void {
  if (err instanceof ParseError) {
    console.error(`[sync] Failed to parse ${path}: ${err.message}`)
  } else {
    console.error(`[sync] Error processing ${path}:`, err)
  }
}

async function upsertIndexRow(
  db: D1Database,
  vendorId: string,
  entityType: 'contact' | 'wedding' | 'todo' | 'log' | 'timeline' | 'notes' | 'vendors' | 'doc',
  entityId: string,
  filePath: string,
  etag: string,
  cachedData: string | null
): Promise<void> {
  // Keep exactly one index row per entity: if the file moved (e.g. an external
  // folder rename), drop the stale-path row before inserting the new one.
  // Atomic batch so we never leave the entity with two rows (which the
  // UNIQUE(vendor_id, entity_type, entity_id) constraint forbids) or zero.
  await db.batch([
    db
      .prepare(
        'DELETE FROM file_index WHERE vendor_id = ? AND entity_type = ? AND entity_id = ? AND file_path != ?'
      )
      .bind(vendorId, entityType, entityId, filePath),
    db
      .prepare(
        `INSERT INTO file_index (vendor_id, entity_type, entity_id, file_path, etag, cached_data, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(vendor_id, file_path) DO UPDATE SET
           entity_type = excluded.entity_type,
           entity_id = excluded.entity_id,
           etag = excluded.etag,
           cached_data = excluded.cached_data,
           last_synced_at = datetime('now')`
      )
      .bind(vendorId, entityType, entityId, filePath, etag, cachedData),
  ])
}

/**
 * List all .md files under a prefix, handling pagination and
 * skipping editor/config junk.
 */
async function listAllFiles(
  storage: StorageBackend,
  prefix: string
): Promise<FileMeta[]> {
  const allFiles: FileMeta[] = []
  let cursor: string | undefined

  do {
    const result = await storage.list(prefix, cursor)
    allFiles.push(...result.files)
    cursor = result.cursor
  } while (cursor)

  return allFiles.filter((f) => f.path.endsWith('.md') && !isIgnoredPath(f.path))
}

// ────────────────────────────────────────────
// Conflict detection helpers
// ────────────────────────────────────────────

/**
 * Resolve a conflict: apply the chosen resolution and clean up.
 */
export async function resolveConflict(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string,
  conflictId: string,
  resolution: 'keep_remote' | 'keep_local' | 'merge',
  mergedContent?: string
): Promise<void> {
  const conflict = await db
    .prepare('SELECT * FROM file_conflicts WHERE id = ? AND vendor_id = ?')
    .bind(conflictId, vendorId)
    .first<{
      id: string
      entity_type: string
      entity_id: string
      file_path: string
      local_content: string
      remote_content: string
    }>()

  if (!conflict) return

  let contentToWrite: string

  switch (resolution) {
    case 'keep_remote':
      // Remote version wins — just re-index from what's in storage
      contentToWrite = conflict.remote_content
      break
    case 'keep_local':
      // Local version wins — overwrite the file
      contentToWrite = conflict.local_content
      break
    case 'merge':
      // User-provided merged content
      if (!mergedContent) {
        throw new Error('Merged content is required for merge resolution')
      }
      contentToWrite = mergedContent
      break
  }

  // Write the resolved content
  const etag = await storage.write(conflict.file_path, contentToWrite)

  // Re-index the file
  const doc = parseMarkdown(contentToWrite)
  let entityId: string
  let cachedData: string

  if (conflict.entity_type === 'contact') {
    const contact = markdownToContact(doc, vendorId)
    entityId = contact.id
    cachedData = contactCachedData(contact)
  } else {
    const wedding = markdownToWedding(doc)
    entityId = wedding.id
    cachedData = weddingCachedData(wedding)
  }

  // Update index and mark conflict resolved (use batch for atomicity)
  await db.batch([
    db
      .prepare(
        `INSERT INTO file_index (vendor_id, entity_type, entity_id, file_path, etag, cached_data, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(vendor_id, file_path) DO UPDATE SET
           entity_id = excluded.entity_id,
           etag = excluded.etag,
           cached_data = excluded.cached_data,
           last_synced_at = datetime('now')`
      )
      .bind(vendorId, conflict.entity_type, entityId, conflict.file_path, etag, cachedData),
    db
      .prepare(
        `UPDATE file_conflicts SET status = 'resolved', resolved_at = datetime('now'), resolution = ?
         WHERE id = ?`
      )
      .bind(resolution, conflictId),
  ])
}

/**
 * List pending conflicts for a vendor.
 */
export async function listPendingConflicts(
  db: D1Database,
  vendorId: string
): Promise<
  {
    id: string
    entity_type: string
    entity_id: string
    file_path: string
    created_at: string
  }[]
> {
  const rows = await db
    .prepare(
      `SELECT id, entity_type, entity_id, file_path, created_at
       FROM file_conflicts
       WHERE vendor_id = ? AND status = 'pending'
       ORDER BY created_at DESC`
    )
    .bind(vendorId)
    .all<{
      id: string
      entity_type: string
      entity_id: string
      file_path: string
      created_at: string
    }>()

  return rows.results
}

/**
 * Rebuild the entire index for a vendor from scratch.
 * Deletes all existing index entries and re-scans storage.
 * Use when the index might be corrupt or after a migration.
 */
export async function rebuildIndex(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string
): Promise<SyncResult> {
  // Clear existing index
  await db
    .prepare('DELETE FROM file_index WHERE vendor_id = ?')
    .bind(vendorId)
    .run()

  // Full sync from scratch
  return syncVendor(storage, db, vendorId)
}

async function syncToWeddingsTable(
  db: D1Database,
  wedding: Wedding
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO weddings (
        id, title, date, time, duration_hours, location, location_lat, location_lng,
        status, ceremony_type, vendor_visibility, ceremony_location, reception_location,
        reception_time, getting_ready_location, getting_ready_time, getting_ready_1_label,
        getting_ready_2_location, getting_ready_2_label, getting_ready_2_time,
        portrait_location, portrait_time, emoji, reception_duration_hours,
        timeline_notes, dress_code, guest_count,
        notes, created_by_user_id, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         date = excluded.date,
         time = excluded.time,
         duration_hours = excluded.duration_hours,
         location = excluded.location,
         location_lat = excluded.location_lat,
         location_lng = excluded.location_lng,
         status = excluded.status,
         ceremony_type = excluded.ceremony_type,
         vendor_visibility = excluded.vendor_visibility,
         ceremony_location = excluded.ceremony_location,
         reception_location = excluded.reception_location,
         reception_time = excluded.reception_time,
         getting_ready_location = excluded.getting_ready_location,
         getting_ready_time = excluded.getting_ready_time,
         getting_ready_1_label = excluded.getting_ready_1_label,
         getting_ready_2_location = excluded.getting_ready_2_location,
         getting_ready_2_label = excluded.getting_ready_2_label,
         getting_ready_2_time = excluded.getting_ready_2_time,
         portrait_location = excluded.portrait_location,
         portrait_time = excluded.portrait_time,
         emoji = excluded.emoji,
         reception_duration_hours = excluded.reception_duration_hours,
         timeline_notes = excluded.timeline_notes,
         dress_code = excluded.dress_code,
         guest_count = excluded.guest_count,
         notes = excluded.notes,
         updated_at = excluded.updated_at`
    )
    .bind(
      wedding.id,
      wedding.title,
      wedding.date,
      wedding.time,
      wedding.duration_hours,
      wedding.location,
      wedding.location_lat,
      wedding.location_lng,
      wedding.status,
      wedding.ceremony_type,
      wedding.vendor_visibility,
      wedding.ceremony_location,
      wedding.reception_location,
      wedding.reception_time,
      wedding.getting_ready_location,
      wedding.getting_ready_time,
      wedding.getting_ready_1_label,
      wedding.getting_ready_2_location,
      wedding.getting_ready_2_label,
      wedding.getting_ready_2_time,
      wedding.portrait_location,
      wedding.portrait_time,
      wedding.emoji,
      wedding.reception_duration_hours,
      wedding.timeline_notes,
      wedding.dress_code,
      wedding.guest_count,
      wedding.notes,
      wedding.created_by_user_id,
      wedding.created_at,
      wedding.updated_at
    )
    .run()
}

/**
 * Decide whether a vendor-supplied wedding.md may write to the shared
 * weddings table:
 *
 *   'new'       → no such wedding exists; safe to create + grant membership
 *   'member'    → wedding exists and this vendor is already an active
 *                 member; safe to update (no new membership granted)
 *   'forbidden' → wedding exists and this vendor is not a member; reject
 *
 * This is the guard that keeps a crafted/foreign wedding id from
 * overwriting another account's wedding or self-granting access. A vendor
 * removed from a wedding falls into 'forbidden', so a stale wedding.md can
 * never re-add them.
 */
async function weddingWriteAccess(
  db: D1Database,
  vendorId: string,
  weddingId: string
): Promise<'new' | 'member' | 'forbidden'> {
  const existing = await db
    .prepare('SELECT id FROM weddings WHERE id = ?')
    .bind(weddingId)
    .first<{ id: string }>()
  if (!existing) return 'new'

  const vendor = await db
    .prepare('SELECT user_id FROM vendor_profiles WHERE id = ?')
    .bind(vendorId)
    .first<{ user_id: string }>()
  if (!vendor?.user_id) return 'forbidden'

  const member = await db
    .prepare(
      "SELECT id FROM wedding_members WHERE wedding_id = ? AND user_id = ? AND status = 'active'"
    )
    .bind(weddingId, vendor.user_id)
    .first<{ id: string }>()
  return member ? 'member' : 'forbidden'
}

async function ensureSyncedWeddingMembership(
  db: D1Database,
  vendorId: string,
  wedding: Wedding
): Promise<void> {
  const vendor = await db
    .prepare('SELECT user_id, category FROM vendor_profiles WHERE id = ?')
    .bind(vendorId)
    .first<{ user_id: string; category: string }>()

  if (!vendor?.user_id) return

  const existing = await db
    .prepare('SELECT id FROM wedding_members WHERE wedding_id = ? AND user_id = ?')
    .bind(wedding.id, vendor.user_id)
    .first<{ id: string }>()

  if (existing) return

  await db
    .prepare(
      `INSERT INTO wedding_members
        (wedding_id, user_id, role, vendor_profile_id, vendor_role, can_manage, is_financial_party, status, accepted_at)
       VALUES (?, ?, 'vendor', ?, ?, 1, 0, 'active', datetime('now'))`
    )
    .bind(wedding.id, vendor.user_id, vendorId, vendor.category ?? null)
    .run()
}
