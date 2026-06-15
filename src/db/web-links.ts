import type { WebLink } from '../types'

/**
 * Links for a wedding, newest-first, with pinned links floated to the top
 * (most recently pinned first).
 */
export async function listWebLinks(db: D1Database, weddingId: string): Promise<WebLink[]> {
  return db
    .prepare(
      `SELECT * FROM web_links
       WHERE wedding_id = ?
       ORDER BY pinned DESC,
         CASE WHEN pinned = 1 THEN pinned_at ELSE created_at END DESC,
         created_at DESC`
    )
    .bind(weddingId)
    .all<WebLink>()
    .then((r) => r.results)
}

export async function getWebLink(
  db: D1Database,
  weddingId: string,
  id: string
): Promise<WebLink | null> {
  return db
    .prepare('SELECT * FROM web_links WHERE id = ? AND wedding_id = ?')
    .bind(id, weddingId)
    .first<WebLink>()
}

export async function addWebLink(
  db: D1Database,
  data: {
    wedding_id: string
    url: string
    title: string
    site_name?: string | null
    image_url?: string | null
    added_by_user_id: string | null
    added_by_name: string
    added_by_role: string
  }
): Promise<WebLink> {
  const row = await db
    .prepare(
      `INSERT INTO web_links
         (wedding_id, url, title, site_name, image_url, added_by_user_id, added_by_name, added_by_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      data.wedding_id,
      data.url,
      data.title,
      data.site_name ?? null,
      data.image_url ?? null,
      data.added_by_user_id,
      data.added_by_name,
      data.added_by_role
    )
    .first<WebLink>()
  return row!
}

export async function setWebLinkPinned(
  db: D1Database,
  weddingId: string,
  id: string,
  pinned: boolean
): Promise<void> {
  await db
    .prepare(
      `UPDATE web_links
       SET pinned = ?, pinned_at = ${pinned ? "datetime('now')" : 'NULL'}, updated_at = datetime('now')
       WHERE id = ? AND wedding_id = ?`
    )
    .bind(pinned ? 1 : 0, id, weddingId)
    .run()
}

export async function deleteWebLink(
  db: D1Database,
  weddingId: string,
  id: string
): Promise<void> {
  await db
    .prepare('DELETE FROM web_links WHERE id = ? AND wedding_id = ?')
    .bind(id, weddingId)
    .run()
}
