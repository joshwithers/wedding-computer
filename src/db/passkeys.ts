import type { PasskeyCredential } from '../types'

export async function listPasskeys(
  db: D1Database,
  userId: string
): Promise<PasskeyCredential[]> {
  return db
    .prepare('SELECT * FROM passkey_credentials WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all<PasskeyCredential>()
    .then((r) => r.results)
}

export async function getPasskeyByCredentialId(
  db: D1Database,
  credentialId: string
): Promise<PasskeyCredential | null> {
  return db
    .prepare('SELECT * FROM passkey_credentials WHERE credential_id = ?')
    .bind(credentialId)
    .first<PasskeyCredential>()
}

export async function createPasskey(
  db: D1Database,
  data: {
    user_id: string
    credential_id: string
    public_key: string
    counter: number
    device_name?: string
    transports?: string
    backed_up?: boolean
  }
): Promise<PasskeyCredential> {
  const result = await db
    .prepare(
      `INSERT INTO passkey_credentials (user_id, credential_id, public_key, counter, device_name, transports, backed_up)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      data.user_id,
      data.credential_id,
      data.public_key,
      data.counter,
      data.device_name ?? null,
      data.transports ?? null,
      data.backed_up ? 1 : 0
    )
    .first<PasskeyCredential>()
  return result!
}

export async function updatePasskeyCounter(
  db: D1Database,
  credentialId: string,
  counter: number
): Promise<void> {
  await db
    .prepare(
      `UPDATE passkey_credentials SET counter = ?, last_used_at = datetime('now') WHERE credential_id = ?`
    )
    .bind(counter, credentialId)
    .run()
}

export async function deletePasskey(
  db: D1Database,
  id: string,
  userId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM passkey_credentials WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run()
}

export async function hasPasskeys(
  db: D1Database,
  userId: string
): Promise<boolean> {
  const row = await db
    .prepare('SELECT COUNT(*) as count FROM passkey_credentials WHERE user_id = ?')
    .bind(userId)
    .first<{ count: number }>()
  return (row?.count ?? 0) > 0
}

export async function getCredentialIdsForUser(
  db: D1Database,
  userId: string
): Promise<string[]> {
  const rows = await db
    .prepare('SELECT credential_id FROM passkey_credentials WHERE user_id = ?')
    .bind(userId)
    .all<{ credential_id: string }>()
  return rows.results.map((r) => r.credential_id)
}
