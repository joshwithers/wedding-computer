import type { TodoTemplate, WeddingTodo, D1Like } from '../types'

// ─── Templates ───

export async function listTemplates(
  db: D1Database,
  vendorId: string
): Promise<TodoTemplate[]> {
  return db
    .prepare(
      `SELECT * FROM todo_templates WHERE vendor_id = ?
       ORDER BY is_default DESC, name`
    )
    .bind(vendorId)
    .all<TodoTemplate>()
    .then((r) => r.results)
}

export async function getTemplate(
  db: D1Database,
  vendorId: string,
  templateId: string
): Promise<TodoTemplate | null> {
  return db
    .prepare('SELECT * FROM todo_templates WHERE id = ? AND vendor_id = ?')
    .bind(templateId, vendorId)
    .first<TodoTemplate>()
}

export async function getDefaultTemplate(
  db: D1Database,
  vendorId: string
): Promise<TodoTemplate | null> {
  return db
    .prepare('SELECT * FROM todo_templates WHERE vendor_id = ? AND is_default = 1')
    .bind(vendorId)
    .first<TodoTemplate>()
}

export async function createTemplate(
  db: D1Database,
  vendorId: string,
  name: string,
  content: string,
  isDefault: boolean = false
): Promise<TodoTemplate> {
  if (isDefault) {
    // Unset other defaults first
    await db
      .prepare('UPDATE todo_templates SET is_default = 0 WHERE vendor_id = ? AND is_default = 1')
      .bind(vendorId)
      .run()
  }
  const result = await db
    .prepare(
      `INSERT INTO todo_templates (vendor_id, name, content, is_default)
       VALUES (?, ?, ?, ?)
       RETURNING *`
    )
    .bind(vendorId, name, content, isDefault ? 1 : 0)
    .first<TodoTemplate>()
  return result!
}

export async function updateTemplate(
  db: D1Database,
  vendorId: string,
  templateId: string,
  updates: Partial<Pick<TodoTemplate, 'name' | 'content' | 'is_default'>>
): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`)
      values.push(val)
    }
  }
  if (sets.length === 0) return
  sets.push("updated_at = datetime('now')")
  values.push(templateId, vendorId)
  await db
    .prepare(`UPDATE todo_templates SET ${sets.join(', ')} WHERE id = ? AND vendor_id = ?`)
    .bind(...values)
    .run()
}

export async function setDefaultTemplate(
  db: D1Database,
  vendorId: string,
  templateId: string
): Promise<void> {
  await db.batch([
    db
      .prepare('UPDATE todo_templates SET is_default = 0 WHERE vendor_id = ? AND is_default = 1')
      .bind(vendorId),
    db
      .prepare('UPDATE todo_templates SET is_default = 1 WHERE id = ? AND vendor_id = ?')
      .bind(templateId, vendorId),
  ])
}

export async function deleteTemplate(
  db: D1Database,
  vendorId: string,
  templateId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM todo_templates WHERE id = ? AND vendor_id = ?')
    .bind(templateId, vendorId)
    .run()
}

// ─── Wedding todos ───

export async function getWeddingTodo(
  db: D1Database,
  vendorId: string,
  weddingId: string
): Promise<WeddingTodo | null> {
  return db
    .prepare('SELECT * FROM wedding_todos WHERE vendor_id = ? AND wedding_id = ?')
    .bind(vendorId, weddingId)
    .first<WeddingTodo>()
}

export async function upsertWeddingTodo(
  db: D1Database,
  vendorId: string,
  weddingId: string,
  content: string,
  templateId?: string | null
): Promise<WeddingTodo> {
  const result = await db
    .prepare(
      `INSERT INTO wedding_todos (vendor_id, wedding_id, content, template_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(vendor_id, wedding_id) DO UPDATE SET
         content = excluded.content,
         template_id = COALESCE(excluded.template_id, wedding_todos.template_id),
         updated_at = datetime('now')
       RETURNING *`
    )
    .bind(vendorId, weddingId, content, templateId ?? null)
    .first<WeddingTodo>()
  return result!
}

export async function updateWeddingTodoContent(
  db: D1Database,
  vendorId: string,
  weddingId: string,
  content: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE wedding_todos SET content = ?, updated_at = datetime('now')
       WHERE vendor_id = ? AND wedding_id = ?`
    )
    .bind(content, vendorId, weddingId)
    .run()
}

export async function deleteWeddingTodo(
  db: D1Database,
  vendorId: string,
  weddingId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM wedding_todos WHERE vendor_id = ? AND wedding_id = ?')
    .bind(vendorId, weddingId)
    .run()
}

/** List all wedding todos for a vendor with wedding titles (for dashboard). */
export async function listWeddingTodosWithProgress(
  db: D1Like,
  vendorId: string
): Promise<
  Array<{
    wedding_id: string
    wedding_title: string
    wedding_date: string | null
    content: string
  }>
> {
  return db
    .prepare(
      `SELECT wt.wedding_id, w.title as wedding_title, w.date as wedding_date, wt.content
       FROM wedding_todos wt
       JOIN weddings w ON w.id = wt.wedding_id
       WHERE wt.vendor_id = ? AND w.status IN ('planning', 'confirmed')
       ORDER BY w.date ASC NULLS LAST`
    )
    .bind(vendorId)
    .all<{
      wedding_id: string
      wedding_title: string
      wedding_date: string | null
      content: string
    }>()
    .then((r) => r.results)
}
