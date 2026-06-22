/**
 * D1 access for the OAuth 2.1 Authorization Server.
 * Clients are created via Dynamic Client Registration; grants are one row per
 * (vendor, client) authorization — a "connected app" — holding the hashed
 * refresh token. Everything is scoped by vendor_id where it matters.
 */

export type OAuthClient = {
  client_id: string
  client_secret_hash: string | null
  redirect_uris: string[]
  client_name: string | null
}

export type OAuthGrant = {
  id: string
  vendor_id: string
  client_id: string
  client_name: string | null
  scope: string
  refresh_token_hash: string | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export async function createOAuthClient(
  db: D1Database,
  client: { client_id: string; client_secret_hash: string | null; redirect_uris: string[]; client_name: string | null }
): Promise<void> {
  await db
    .prepare('INSERT INTO oauth_clients (client_id, client_secret_hash, redirect_uris, client_name) VALUES (?, ?, ?, ?)')
    .bind(client.client_id, client.client_secret_hash, JSON.stringify(client.redirect_uris), client.client_name)
    .run()
}

export async function getOAuthClient(db: D1Database, clientId: string): Promise<OAuthClient | null> {
  const row = await db
    .prepare('SELECT client_id, client_secret_hash, redirect_uris, client_name FROM oauth_clients WHERE client_id = ?')
    .bind(clientId)
    .first<{ client_id: string; client_secret_hash: string | null; redirect_uris: string; client_name: string | null }>()
  if (!row) return null
  let uris: string[] = []
  try {
    const parsed = JSON.parse(row.redirect_uris)
    if (Array.isArray(parsed)) uris = parsed.filter((u) => typeof u === 'string')
  } catch {
    /* ignore */
  }
  return { client_id: row.client_id, client_secret_hash: row.client_secret_hash, redirect_uris: uris, client_name: row.client_name }
}

/** Create or refresh the (vendor, client) grant on consent. Returns the grant id. */
export async function upsertOAuthGrant(
  db: D1Database,
  grant: { vendor_id: string; client_id: string; client_name: string | null; scope: string; refresh_token_hash: string }
): Promise<string> {
  await db
    .prepare(
      `INSERT INTO oauth_grants (vendor_id, client_id, client_name, scope, refresh_token_hash, last_used_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(vendor_id, client_id) DO UPDATE SET
         client_name = excluded.client_name,
         scope = excluded.scope,
         refresh_token_hash = excluded.refresh_token_hash,
         revoked_at = NULL,
         last_used_at = datetime('now')`
    )
    .bind(grant.vendor_id, grant.client_id, grant.client_name, grant.scope, grant.refresh_token_hash)
    .run()
  const row = await db
    .prepare('SELECT id FROM oauth_grants WHERE vendor_id = ? AND client_id = ?')
    .bind(grant.vendor_id, grant.client_id)
    .first<{ id: string }>()
  return row!.id
}

export async function getOAuthGrant(db: D1Database, grantId: string): Promise<OAuthGrant | null> {
  return db.prepare('SELECT * FROM oauth_grants WHERE id = ?').bind(grantId).first<OAuthGrant>()
}

/** Look up an active grant by its refresh token hash (for the refresh_token grant). */
export async function getActiveGrantByRefreshHash(db: D1Database, refreshHash: string): Promise<OAuthGrant | null> {
  return db
    .prepare('SELECT * FROM oauth_grants WHERE refresh_token_hash = ? AND revoked_at IS NULL')
    .bind(refreshHash)
    .first<OAuthGrant>()
}

/** Rotate the refresh token on a grant (refresh-token rotation). */
export async function rotateRefreshHash(db: D1Database, grantId: string, newHash: string): Promise<void> {
  await db
    .prepare("UPDATE oauth_grants SET refresh_token_hash = ?, last_used_at = datetime('now') WHERE id = ?")
    .bind(newHash, grantId)
    .run()
}

export async function listOAuthGrantsForVendor(db: D1Database, vendorId: string): Promise<OAuthGrant[]> {
  const { results } = await db
    .prepare('SELECT * FROM oauth_grants WHERE vendor_id = ? AND revoked_at IS NULL ORDER BY created_at DESC')
    .bind(vendorId)
    .all<OAuthGrant>()
  return results ?? []
}

/** Revoke a grant. Scoped by vendor so one vendor can't revoke another's. */
export async function revokeOAuthGrant(db: D1Database, vendorId: string, grantId: string): Promise<void> {
  await db
    .prepare("UPDATE oauth_grants SET revoked_at = datetime('now'), refresh_token_hash = NULL WHERE id = ? AND vendor_id = ?")
    .bind(grantId, vendorId)
    .run()
}
