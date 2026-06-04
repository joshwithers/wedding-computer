import type { WeddingLogEntry } from '../types'

/** Append an entry to the wedding log. */
export async function appendWeddingLog(
  db: D1Database,
  weddingId: string,
  userId: string | null,
  action: string,
  detail?: string | null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO wedding_log (wedding_id, user_id, action, detail)
       VALUES (?, ?, ?, ?)`
    )
    .bind(weddingId, userId, action, detail ?? null)
    .run()
}

/** List log entries for a wedding, newest first. */
export async function listWeddingLog(
  db: D1Database,
  weddingId: string,
  limit = 50
): Promise<(WeddingLogEntry & { user_name: string | null })[]> {
  return db
    .prepare(
      `SELECT wl.*, u.name as user_name
       FROM wedding_log wl
       LEFT JOIN users u ON u.id = wl.user_id
       WHERE wl.wedding_id = ?
       ORDER BY wl.created_at DESC
       LIMIT ?`
    )
    .bind(weddingId, limit)
    .all<WeddingLogEntry & { user_name: string | null }>()
    .then((r) => r.results)
}

/** Export the full log as a markdown string for storage sync. */
export async function exportWeddingLogMarkdown(
  db: D1Database,
  weddingId: string,
  weddingTitle: string
): Promise<string> {
  const entries = await db
    .prepare(
      `SELECT wl.*, u.name as user_name
       FROM wedding_log wl
       LEFT JOIN users u ON u.id = wl.user_id
       WHERE wl.wedding_id = ?
       ORDER BY wl.created_at ASC`
    )
    .bind(weddingId)
    .all<WeddingLogEntry & { user_name: string | null }>()
    .then((r) => r.results)

  const lines: string[] = [
    `# ${weddingTitle} — Log`,
    '',
  ]

  for (const e of entries) {
    const ts = e.created_at.replace('T', ' ').slice(0, 16)
    const who = e.user_name ?? 'System'
    const detail = e.detail ? ` — ${e.detail}` : ''
    lines.push(`- **${ts}** ${who}: ${e.action}${detail}`)
  }

  lines.push('')
  return lines.join('\n')
}
