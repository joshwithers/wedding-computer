// Data access for collaborative PDF signing sessions. See SIGNING.md (repo root) for
// the table schema, state machine, and how the status-guarded transitions below work.
import type { DocumentSigningSession } from '../types'

// ─── Create ───

export async function createSigningSession(
  db: D1Database,
  data: {
    wedding_id: string
    vendor_id: string
    created_by_user_id: string
    source_kind: 'upload' | 'noim'
    source_ref?: string | null
    title: string
    source_r2_key: string
  }
): Promise<DocumentSigningSession> {
  const result = await db
    .prepare(
      `INSERT INTO document_signing_sessions
        (wedding_id, vendor_id, created_by_user_id, source_kind, source_ref, title, source_r2_key, current_r2_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      data.wedding_id,
      data.vendor_id,
      data.created_by_user_id,
      data.source_kind,
      data.source_ref ?? null,
      data.title,
      data.source_r2_key,
      data.source_r2_key // current starts equal to source
    )
    .first<DocumentSigningSession>()
  return result!
}

// ─── Reads ───

// Fetch a session only if the user is an ACTIVE member of its wedding. Mirrors
// db/documents.ts getDocument — avoids a 403-vs-404 oracle on unrelated weddings.
// The caller still applies the turn / owning-celebrant checks.
export async function getSigningSessionForMember(
  db: D1Database,
  sessionId: string,
  userId: string
): Promise<DocumentSigningSession | null> {
  return db
    .prepare(
      `SELECT s.* FROM document_signing_sessions s
       JOIN wedding_members wm ON wm.wedding_id = s.wedding_id
       WHERE s.id = ? AND wm.user_id = ? AND wm.status = 'active'
       LIMIT 1`
    )
    .bind(sessionId, userId)
    .first<DocumentSigningSession>()
}

// Unscoped fetch by id — for server-side jobs (notifications) that have already
// established trust. Never call from a request handler without an auth check.
export async function getSigningSessionById(
  db: D1Database,
  sessionId: string
): Promise<DocumentSigningSession | null> {
  return db
    .prepare('SELECT * FROM document_signing_sessions WHERE id = ?')
    .bind(sessionId)
    .first<DocumentSigningSession>()
}

export async function listSigningSessionsForWedding(
  db: D1Database,
  weddingId: string
): Promise<DocumentSigningSession[]> {
  return db
    .prepare(
      `SELECT * FROM document_signing_sessions
       WHERE wedding_id = ? AND status != 'cancelled'
       ORDER BY created_at DESC`
    )
    .bind(weddingId)
    .all<DocumentSigningSession>()
    .then((r) => r.results)
}

// ─── Turn transitions (status-guarded so a concurrent double-save no-ops) ───

// Status-guarded transition awaiting_couple → awaiting_celebrant. Returns true only if
// THIS call flipped the row. Concurrent double-saves no-op: the loser matches 0 rows and
// the route must return 409. No locks/transactions needed — SQLite applies the WHERE guard
// atomically. Callers MUST check the return value.
export async function recordCoupleSigned(
  db: D1Database,
  sessionId: string,
  data: { currentR2Key: string; coupleSignedR2Key: string; signedByUserId: string; inPerson: boolean; ip: string | null }
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE document_signing_sessions
       SET status = 'awaiting_celebrant',
           current_r2_key = ?,
           couple_signed_r2_key = ?,
           couple_signed_at = datetime('now'),
           couple_signed_by_user_id = ?,
           couple_signed_in_person = ?,
           couple_signed_ip = ?
       WHERE id = ? AND status = 'awaiting_couple'`
    )
    .bind(data.currentR2Key, data.coupleSignedR2Key, data.signedByUserId, data.inPerson ? 1 : 0, data.ip, sessionId)
    .run()
  return ((res.meta as { changes?: number })?.changes ?? 0) > 0
}

// Like recordCoupleSigned but awaiting_celebrant → complete, atomically linking
// final_document_id. Returns false if another request already finalised. Note: the
// documents row + final.pdf are written by the route BEFORE this UPDATE, so a lost race
// can leave an orphaned final document — acceptable today; harden here if that changes.
export async function recordCelebrantSigned(
  db: D1Database,
  sessionId: string,
  data: { currentR2Key: string; finalDocumentId: string; ip: string | null }
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE document_signing_sessions
       SET status = 'complete',
           current_r2_key = ?,
           final_document_id = ?,
           celebrant_signed_at = datetime('now'),
           celebrant_signed_ip = ?
       WHERE id = ? AND status = 'awaiting_celebrant'`
    )
    .bind(data.currentR2Key, data.finalDocumentId, data.ip, sessionId)
    .run()
  return ((res.meta as { changes?: number })?.changes ?? 0) > 0
}

export async function cancelSigningSession(
  db: D1Database,
  sessionId: string,
  vendorId: string
): Promise<void> {
  await db
    .prepare(`UPDATE document_signing_sessions SET status = 'cancelled' WHERE id = ? AND vendor_id = ?`)
    .bind(sessionId, vendorId)
    .run()
}

// Live release gate: the couple can only sign while couple_released=1. Only the owning
// celebrant (vendor-scoped) can flip it, and only while the session is still awaiting the
// couple. Releasing stamps couple_released_at (when the celebrant began witnessing).
export async function setCoupleReleased(
  db: D1Database,
  sessionId: string,
  vendorId: string,
  released: boolean
): Promise<void> {
  await db
    .prepare(
      `UPDATE document_signing_sessions
       SET couple_released = ?, couple_released_at = ${released ? "datetime('now')" : 'couple_released_at'}
       WHERE id = ? AND vendor_id = ? AND status = 'awaiting_couple'`
    )
    .bind(released ? 1 : 0, sessionId, vendorId)
    .run()
}
