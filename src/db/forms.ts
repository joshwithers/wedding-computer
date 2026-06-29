import type { Form, FormKind, FormSubmission, FormSend, FormFile } from '../types'

export type WeddingSubmission = FormSubmission & { form_title: string; vendor_name: string; form_config: string }
export type WeddingFormSend = FormSend & { form_title: string; form_type: string; vendor_name: string | null; response_count: number }

export type SubmissionField = {
  label: string
  value: string
  // Present for file-upload fields — render a download link to /form-file/:id.
  file?: { id: string; name: string }
}

// Rebuild human label/value pairs from a submission's stored data + its form
// config (data is keyed by field id; the config carries the labels). File
// fields store a {id,name} marker and come back with a `file` ref. Shared by
// the notifier, the wedding-page renderers, the submission inbox, and emails.
export function formSubmissionFields(configJson: string, dataJson: string): SubmissionField[] {
  let config: any = {}
  let data: Record<string, unknown> = {}
  try { config = JSON.parse(configJson) } catch { /* ignore */ }
  try { data = JSON.parse(dataJson) } catch { /* ignore */ }
  const all = Array.isArray(config.steps)
    ? config.steps.flatMap((s: any) => (Array.isArray(s.fields) ? s.fields : []))
    : (Array.isArray(config.fields) ? config.fields : [])
  const meta = new Map<string, { label: string; type: string }>(
    all.filter((f: any) => f && f.id).map((f: any) => [f.id, { label: f.label ?? f.id, type: String(f.type ?? 'text') }])
  )
  return Object.entries(data).map(([k, v]) => {
    const m = meta.get(k)
    const label = m?.label ?? k
    if (m?.type === 'file') {
      let parsed: any = null
      try { parsed = typeof v === 'string' ? JSON.parse(v) : v } catch { /* ignore */ }
      if (parsed && parsed.id) {
        const name = String(parsed.name ?? 'File')
        return { label, value: name, file: { id: String(parsed.id), name } }
      }
      return { label, value: '—' }
    }
    return { label, value: String(v ?? '') }
  })
}

// ─── Form file uploads (migration 057) ───

export async function createFormFile(
  db: D1Database,
  data: {
    submission_id: string
    vendor_id: string
    field_id: string
    r2_key: string
    filename: string
    mime_type?: string | null
    size_bytes?: number | null
  }
): Promise<FormFile> {
  const result = await db
    .prepare(
      `INSERT INTO form_files (submission_id, vendor_id, field_id, r2_key, filename, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      data.submission_id,
      data.vendor_id,
      data.field_id,
      data.r2_key,
      data.filename,
      data.mime_type ?? null,
      data.size_bytes ?? null
    )
    .first<FormFile>()
  return result!
}

// Unscoped fetch for the download route, which does its own authorisation
// (owning vendor or a member of the submission's wedding).
export async function getFormFile(db: D1Database, id: string): Promise<FormFile | null> {
  return db.prepare('SELECT * FROM form_files WHERE id = ?').bind(id).first<FormFile>()
}

export async function createForm(
  db: D1Database,
  vendorId: string,
  data: {
    title: string
    slug?: string | null
    type?: 'custom' | 'noim' | 'contact'
    kind?: FormKind
    config: string
    wedding_id?: string | null
    contact_id?: string | null
  }
): Promise<Form> {
  const result = await db
    .prepare(
      `INSERT INTO forms (vendor_id, title, slug, type, kind, config, wedding_id, contact_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      vendorId,
      data.title,
      data.slug ?? null,
      data.type ?? 'custom',
      data.kind ?? 'information',
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

// Resolve a vendor's singleton form by its reserved slug (e.g. 'enquiry',
// 'booking'). Used by the read-both resolvers and the editor's mirror.
export async function getFormByVendorSlug(
  db: D1Database,
  vendorId: string,
  slug: string
): Promise<Form | null> {
  return db
    .prepare('SELECT * FROM forms WHERE vendor_id = ? AND slug = ? ORDER BY created_at ASC LIMIT 1')
    .bind(vendorId, slug)
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

export async function listFormsByKind(
  db: D1Database,
  vendorId: string,
  kind: FormKind
): Promise<Form[]> {
  return db
    .prepare('SELECT * FROM forms WHERE vendor_id = ? AND kind = ? ORDER BY created_at DESC')
    .bind(vendorId, kind)
    .all<Form>()
    .then((r) => r.results)
}

export async function updateForm(
  db: D1Database,
  vendorId: string,
  formId: string,
  data: Partial<Pick<Form, 'title' | 'slug' | 'config' | 'kind' | 'is_active' | 'wedding_id' | 'contact_id'>>
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
    kind?: string | null
    invoice_id?: string | null
    ip_address?: string | null
    user_agent?: string | null
    wedding_id?: string | null
    form_send_id?: string | null
  }
): Promise<FormSubmission> {
  const result = await db
    .prepare(
      `INSERT INTO form_submissions (form_id, vendor_id, data, contact_id, kind, invoice_id, ip_address, user_agent, wedding_id, form_send_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      data.form_id,
      vendorId,
      data.data,
      data.contact_id ?? null,
      data.kind ?? null,
      data.invoice_id ?? null,
      data.ip_address ?? null,
      data.user_agent ?? null,
      data.wedding_id ?? null,
      data.form_send_id ?? null
    )
    .first<FormSubmission>()
  return result!
}

// ─── Sending a form to a wedding's couple (migration 056) ───

export async function createFormSend(
  db: D1Database,
  vendorId: string,
  data: { form_id: string; wedding_id: string; created_by_user_id?: string | null }
): Promise<FormSend> {
  // form_id is verified to belong to the vendor by the caller (getForm).
  const result = await db
    .prepare(
      `INSERT INTO form_sends (form_id, wedding_id, vendor_id, created_by_user_id)
       VALUES (?, ?, ?, ?)
       RETURNING *`
    )
    .bind(data.form_id, data.wedding_id, vendorId, data.created_by_user_id ?? null)
    .first<FormSend>()
  return result!
}

// Resolve a send link to its send row + the (active) form to render.
export async function getFormSendByToken(
  db: D1Database,
  token: string
): Promise<{ send: FormSend; form: Form } | null> {
  const row = await db
    .prepare(
      `SELECT fs.id, fs.form_id, fs.wedding_id, fs.vendor_id, fs.token,
              fs.created_by_user_id, fs.created_at,
              f.id AS f_id, f.vendor_id AS f_vendor_id, f.title AS f_title, f.slug AS f_slug,
              f.type AS f_type, f.kind AS f_kind, f.config AS f_config, f.is_active AS f_is_active,
              f.public_token AS f_public_token, f.wedding_id AS f_wedding_id,
              f.contact_id AS f_contact_id, f.submission_count AS f_submission_count,
              f.created_at AS f_created_at, f.updated_at AS f_updated_at
       FROM form_sends fs
       JOIN forms f ON f.id = fs.form_id
       WHERE fs.token = ? AND f.is_active = 1`
    )
    .bind(token)
    .first<Record<string, any>>()
  if (!row) return null
  return {
    send: {
      id: row.id, form_id: row.form_id, wedding_id: row.wedding_id, vendor_id: row.vendor_id,
      token: row.token, created_by_user_id: row.created_by_user_id, created_at: row.created_at,
    },
    form: {
      id: row.f_id, vendor_id: row.f_vendor_id, title: row.f_title, slug: row.f_slug, type: row.f_type,
      kind: row.f_kind, config: row.f_config, is_active: row.f_is_active, public_token: row.f_public_token,
      wedding_id: row.f_wedding_id, contact_id: row.f_contact_id, submission_count: row.f_submission_count,
      created_at: row.f_created_at, updated_at: row.f_updated_at,
    },
  }
}

export async function listFormSendsForWedding(
  db: D1Database,
  weddingId: string,
  vendorId?: string
): Promise<WeddingFormSend[]> {
  // A vendor manages only their own sends; omit vendorId for the full list.
  const where = vendorId ? 'fs.wedding_id = ? AND fs.vendor_id = ?' : 'fs.wedding_id = ?'
  const binds = vendorId ? [weddingId, vendorId] : [weddingId]
  return db
    .prepare(
      `SELECT fs.*, f.title AS form_title, f.type AS form_type, vp.business_name AS vendor_name,
              (SELECT COUNT(*) FROM form_submissions s WHERE s.form_send_id = fs.id) AS response_count
       FROM form_sends fs
       JOIN forms f ON f.id = fs.form_id
       JOIN vendor_profiles vp ON vp.id = fs.vendor_id
       WHERE ${where}
       ORDER BY fs.created_at DESC`
    )
    .bind(...binds)
    .all<WeddingFormSend>()
    .then((r) => r.results)
}

// Submissions tied to a wedding. The couple sees them all; a vendor sees their
// own plus any a colleague has shared with the team.
export async function listWeddingSubmissions(
  db: D1Database,
  weddingId: string,
  viewer: { role: string; vendorId?: string | null }
): Promise<WeddingSubmission[]> {
  const base =
    `SELECT s.*, f.title AS form_title, f.config AS form_config, vp.business_name AS vendor_name
     FROM form_submissions s
     JOIN forms f ON f.id = s.form_id
     JOIN vendor_profiles vp ON vp.id = s.vendor_id
     WHERE s.wedding_id = ?`
  if (viewer.role === 'vendor' && viewer.vendorId) {
    return db
      .prepare(`${base} AND (s.vendor_id = ? OR s.shared_with_team = 1) ORDER BY s.created_at DESC`)
      .bind(weddingId, viewer.vendorId)
      .all<WeddingSubmission>()
      .then((r) => r.results)
  }
  return db
    .prepare(`${base} ORDER BY s.created_at DESC`)
    .bind(weddingId)
    .all<WeddingSubmission>()
    .then((r) => r.results)
}

// Owning vendor opens a submission to the whole vendor team (or closes it again).
export async function setSubmissionTeamVisibility(
  db: D1Database,
  vendorId: string,
  submissionId: string,
  shared: boolean
): Promise<void> {
  await db
    .prepare('UPDATE form_submissions SET shared_with_team = ? WHERE id = ? AND vendor_id = ?')
    .bind(shared ? 1 : 0, submissionId, vendorId)
    .run()
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
