import type { Document } from '../types'

// ─── Document with uploader info (for display) ───

export type DocumentWithUploader = Document & {
  uploader_name: string
  uploader_email: string
  shared_with: string | null  // JSON array of user_ids, or null
}

// ─── Create ───

export async function createDocument(
  db: D1Database,
  doc: {
    wedding_id: string
    vendor_id?: string | null
    uploaded_by_user_id: string
    r2_key: string
    filename: string
    mime_type: string
    size_bytes: number
    category?: string | null
    description?: string | null
    visibility: 'private' | 'wedding'
  }
): Promise<Document> {
  const result = await db
    .prepare(
      `INSERT INTO documents (wedding_id, vendor_id, uploaded_by_user_id, r2_key, filename, mime_type, size_bytes, category, description, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      doc.wedding_id,
      doc.vendor_id ?? null,
      doc.uploaded_by_user_id,
      doc.r2_key,
      doc.filename,
      doc.mime_type,
      doc.size_bytes,
      doc.category ?? null,
      doc.description ?? null,
      doc.visibility
    )
    .first<Document>()

  return result!
}

// ─── Add shares (specific users who can see a private doc) ───

export async function addDocumentShares(
  db: D1Database,
  documentId: string,
  userIds: string[]
): Promise<void> {
  if (userIds.length === 0) return
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO document_shares (document_id, user_id) VALUES (?, ?)`
  )
  await db.batch(userIds.map((uid) => stmt.bind(documentId, uid)))
}

// ─── Remove all shares for a document (for re-setting) ───

export async function clearDocumentShares(
  db: D1Database,
  documentId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM document_shares WHERE document_id = ?')
    .bind(documentId)
    .run()
}

// ─── Get a single document by ID ───

export async function getDocument(
  db: D1Database,
  documentId: string
): Promise<Document | null> {
  return db
    .prepare('SELECT * FROM documents WHERE id = ?')
    .bind(documentId)
    .first<Document>()
}

// ─── List documents visible to a user on a wedding ───
// A user can see a document if:
//   1. They uploaded it (uploaded_by_user_id = userId)
//   2. Visibility is 'wedding' (everyone on the wedding sees it)
//   3. They're in document_shares for that document

export async function listDocumentsForWedding(
  db: D1Database,
  weddingId: string,
  userId: string
): Promise<DocumentWithUploader[]> {
  const results = await db
    .prepare(
      `SELECT d.*,
              u.name AS uploader_name,
              u.email AS uploader_email,
              (SELECT json_group_array(ds.user_id)
               FROM document_shares ds WHERE ds.document_id = d.id) AS shared_with
       FROM documents d
       JOIN users u ON u.id = d.uploaded_by_user_id
       WHERE d.wedding_id = ?
         AND (
           d.uploaded_by_user_id = ?
           OR d.visibility = 'wedding'
           OR EXISTS (SELECT 1 FROM document_shares ds WHERE ds.document_id = d.id AND ds.user_id = ?)
         )
       ORDER BY d.created_at DESC`
    )
    .bind(weddingId, userId, userId)
    .all<DocumentWithUploader>()

  return results.results
}

// ─── Check if a user can access a specific document ───

export async function canUserAccessDocument(
  db: D1Database,
  documentId: string,
  userId: string,
  weddingId: string
): Promise<boolean> {
  // Must be a member of the wedding
  const member = await db
    .prepare(
      `SELECT 1 FROM wedding_members WHERE wedding_id = ? AND user_id = ? AND status = 'active'`
    )
    .bind(weddingId, userId)
    .first()
  if (!member) return false

  const doc = await db
    .prepare(
      `SELECT 1 FROM documents
       WHERE id = ? AND wedding_id = ?
         AND (
           uploaded_by_user_id = ?
           OR visibility = 'wedding'
           OR EXISTS (SELECT 1 FROM document_shares ds WHERE ds.document_id = ? AND ds.user_id = ?)
         )`
    )
    .bind(documentId, weddingId, userId, documentId, userId)
    .first()

  return !!doc
}

// ─── Delete ───

export async function deleteDocument(
  db: D1Database,
  documentId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM documents WHERE id = ?')
    .bind(documentId)
    .run()
}

// ─── Get share user IDs for a document ───

export async function getDocumentShareUserIds(
  db: D1Database,
  documentId: string
): Promise<string[]> {
  const results = await db
    .prepare('SELECT user_id FROM document_shares WHERE document_id = ?')
    .bind(documentId)
    .all<{ user_id: string }>()
  return results.results.map((r) => r.user_id)
}
