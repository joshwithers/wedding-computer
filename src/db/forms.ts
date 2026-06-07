import type { Form, FormSubmission } from '../types'

export async function createForm(
  db: D1Database,
  vendorId: string,
  data: {
    title: string
    slug?: string | null
    type?: 'custom' | 'noim' | 'contact'
    config: string
    wedding_id?: string | null
    contact_id?: string | null
  }
): Promise<Form> {
  const result = await db
    .prepare(
      `INSERT INTO forms (vendor_id, title, slug, type, config, wedding_id, contact_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      vendorId,
      data.title,
      data.slug ?? null,
      data.type ?? 'custom',
      data.config,
      data.wedding_id ?? null,
      data.contact_id ?? null
    )
    .first<Form>()
  return result!
}

export async function getForm(
  db: D1Database,
  vendorId: string,
  formId: string
): Promise<Form | null> {
  return db
    .prepare('SELECT * FROM forms WHERE id = ? AND vendor_id = ?')
    .bind(formId, vendorId)
    .first<Form>()
}

export async function getFormByToken(
  db: D1Database,
  token: string
): Promise<Form | null> {
  return db
    .prepare('SELECT * FROM forms WHERE public_token = ? AND is_active = 1')
    .bind(token)
    .first<Form>()
}

export async function listForms(
  db: D1Database,
  vendorId: string
): Promise<Form[]> {
  return db
    .prepare('SELECT * FROM forms WHERE vendor_id = ? ORDER BY created_at DESC')
    .bind(vendorId)
    .all<Form>()
    .then((r) => r.results)
}

export async function updateForm(
  db: D1Database,
  vendorId: string,
  formId: string,
  data: Partial<Pick<Form, 'title' | 'slug' | 'config' | 'is_active' | 'wedding_id' | 'contact_id'>>
): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`)
      values.push(val)
    }
  }
  if (sets.length === 0) return
  sets.push('updated_at = datetime(\'now\')')
  values.push(formId, vendorId)
  await db
    .prepare(`UPDATE forms SET ${sets.join(', ')} WHERE id = ? AND vendor_id = ?`)
    .bind(...values)
    .run()
}

export async function deleteForm(
  db: D1Database,
  vendorId: string,
  formId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM forms WHERE id = ? AND vendor_id = ?')
    .bind(formId, vendorId)
    .run()
}

export async function incrementSubmissionCount(
  db: D1Database,
  formId: string
): Promise<void> {
  await db
    .prepare('UPDATE forms SET submission_count = submission_count + 1 WHERE id = ?')
    .bind(formId)
    .run()
}

export async function createFormSubmission(
  db: D1Database,
  vendorId: string,
  data: {
    form_id: string
    data: string
    contact_id?: string | null
    ip_address?: string | null
    user_agent?: string | null
  }
): Promise<FormSubmission> {
  const result = await db
    .prepare(
      `INSERT INTO form_submissions (form_id, vendor_id, data, contact_id, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      data.form_id,
      vendorId,
      data.data,
      data.contact_id ?? null,
      data.ip_address ?? null,
      data.user_agent ?? null
    )
    .first<FormSubmission>()
  return result!
}

export async function listFormSubmissions(
  db: D1Database,
  vendorId: string,
  formId: string,
  limit = 50
): Promise<FormSubmission[]> {
  return db
    .prepare(
      `SELECT * FROM form_submissions WHERE form_id = ? AND vendor_id = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .bind(formId, vendorId, limit)
    .all<FormSubmission>()
    .then((r) => r.results)
}

export async function getFormSubmission(
  db: D1Database,
  vendorId: string,
  submissionId: string
): Promise<FormSubmission | null> {
  return db
    .prepare('SELECT * FROM form_submissions WHERE id = ? AND vendor_id = ?')
    .bind(submissionId, vendorId)
    .first<FormSubmission>()
}

export async function updateFormSubmission(
  db: D1Database,
  vendorId: string,
  submissionId: string,
  data: { status: 'submitted' | 'reviewed' | 'archived' }
): Promise<void> {
  await db
    .prepare('UPDATE form_submissions SET status = ? WHERE id = ? AND vendor_id = ?')
    .bind(data.status, submissionId, vendorId)
    .run()
}
