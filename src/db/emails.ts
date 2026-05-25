import type { Email } from '../types'

export async function listEmails(
  db: D1Database,
  vendorId: string,
  direction?: 'inbound' | 'outbound',
  opts?: { limit?: number; offset?: number; contactId?: string }
): Promise<Email[]> {
  let query = 'SELECT * FROM emails WHERE vendor_id = ? AND is_system = 0'
  const params: unknown[] = [vendorId]

  if (direction) {
    query += ' AND direction = ?'
    params.push(direction)
  }
  if (opts?.contactId) {
    query += ' AND contact_id = ?'
    params.push(opts.contactId)
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
  params.push(opts?.limit ?? 50, opts?.offset ?? 0)

  return db
    .prepare(query)
    .bind(...params)
    .all<Email>()
    .then((r) => r.results)
}

export async function getEmail(
  db: D1Database,
  vendorId: string,
  id: string
): Promise<Email | null> {
  return db
    .prepare('SELECT * FROM emails WHERE id = ? AND vendor_id = ?')
    .bind(id, vendorId)
    .first<Email>()
}

export async function getEmailByMessageId(
  db: D1Database,
  messageId: string
): Promise<Email | null> {
  return db
    .prepare('SELECT * FROM emails WHERE message_id = ?')
    .bind(messageId)
    .first<Email>()
}

export async function createEmail(
  db: D1Database,
  email: {
    vendor_id: string | null
    contact_id?: string | null
    direction: 'inbound' | 'outbound'
    from_email: string
    from_name?: string | null
    to_email: string
    to_name?: string | null
    reply_to?: string | null
    subject: string
    body_text?: string | null
    body_html?: string | null
    message_id?: string | null
    in_reply_to?: string | null
    thread_id?: string | null
    status?: string
    is_system?: number
  }
): Promise<Email> {
  const result = await db
    .prepare(
      `INSERT INTO emails (vendor_id, contact_id, direction, from_email, from_name, to_email, to_name, reply_to, subject, body_text, body_html, message_id, in_reply_to, thread_id, status, is_system)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      email.vendor_id,
      email.contact_id ?? null,
      email.direction,
      email.from_email,
      email.from_name ?? null,
      email.to_email,
      email.to_name ?? null,
      email.reply_to ?? null,
      email.subject,
      email.body_text ?? null,
      email.body_html ?? null,
      email.message_id ?? null,
      email.in_reply_to ?? null,
      email.thread_id ?? null,
      email.status ?? 'sent',
      email.is_system ?? 0
    )
    .first<Email>()
  return result!
}

export async function markEmailRead(
  db: D1Database,
  vendorId: string,
  id: string
): Promise<void> {
  await db
    .prepare('UPDATE emails SET is_read = 1 WHERE id = ? AND vendor_id = ?')
    .bind(id, vendorId)
    .run()
}

export async function updateEmailStatus(
  db: D1Database,
  id: string,
  status: string,
  error?: string | null
): Promise<void> {
  await db
    .prepare('UPDATE emails SET status = ?, error = ? WHERE id = ?')
    .bind(status, error ?? null, id)
    .run()
}

export async function countUnread(
  db: D1Database,
  vendorId: string
): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COUNT(*) as count FROM emails WHERE vendor_id = ? AND direction = ? AND is_read = 0 AND is_system = 0'
    )
    .bind(vendorId, 'inbound')
    .first<{ count: number }>()
  return row?.count ?? 0
}

export async function getEmailThread(
  db: D1Database,
  vendorId: string,
  threadId: string
): Promise<Email[]> {
  return db
    .prepare(
      `SELECT * FROM emails
       WHERE vendor_id = ? AND (thread_id = ? OR message_id = ?) AND is_system = 0
       ORDER BY created_at ASC`
    )
    .bind(vendorId, threadId, threadId)
    .all<Email>()
    .then((r) => r.results)
}

export async function findVendorByEmailHandle(
  db: D1Database,
  handle: string
): Promise<{ id: string; user_id: string; business_name: string; email_handle: string } | null> {
  return db
    .prepare('SELECT id, user_id, business_name, email_handle FROM vendor_profiles WHERE email_handle = ?')
    .bind(handle.toLowerCase())
    .first()
}

export async function findContactByEmail(
  db: D1Database,
  vendorId: string,
  email: string
): Promise<{ id: string } | null> {
  return db
    .prepare(
      `SELECT id FROM contacts WHERE vendor_id = ? AND (email = ? OR partner_email = ?) LIMIT 1`
    )
    .bind(vendorId, email.toLowerCase(), email.toLowerCase())
    .first()
}
