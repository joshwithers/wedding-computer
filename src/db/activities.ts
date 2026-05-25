type Activity = {
  id: string
  contact_id: string
  type: string
  summary: string | null
  metadata: string | null
  created_at: string
}

export async function listActivities(
  db: D1Database,
  contactId: string
): Promise<Activity[]> {
  return db
    .prepare(
      'SELECT * FROM contact_activities WHERE contact_id = ? ORDER BY created_at DESC LIMIT 50'
    )
    .bind(contactId)
    .all<Activity>()
    .then((r) => r.results)
}

export async function createActivity(
  db: D1Database,
  contactId: string,
  type: string,
  summary?: string | null,
  metadata?: string | null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO contact_activities (contact_id, type, summary, metadata) VALUES (?, ?, ?, ?)`
    )
    .bind(contactId, type, summary ?? null, metadata ?? null)
    .run()
}
