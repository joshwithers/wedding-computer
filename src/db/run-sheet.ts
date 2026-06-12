import type { RunSheetItem } from '../types'

export async function listRunSheetItems(
  db: D1Database,
  weddingId: string,
  vendorId: string
): Promise<RunSheetItem[]> {
  return db
    .prepare(
      `SELECT * FROM run_sheet_items
       WHERE wedding_id = ? AND vendor_id = ?
       ORDER BY sort_order ASC, time ASC`
    )
    .bind(weddingId, vendorId)
    .all<RunSheetItem>()
    .then((r) => r.results)
}

export async function getRunSheetItem(
  db: D1Database,
  id: string,
  vendorId: string
): Promise<RunSheetItem | null> {
  return db
    .prepare('SELECT * FROM run_sheet_items WHERE id = ? AND vendor_id = ?')
    .bind(id, vendorId)
    .first<RunSheetItem>()
}

export async function createRunSheetItem(
  db: D1Database,
  data: {
    wedding_id: string
    vendor_id: string
    time?: string | null
    end_time?: string | null
    title: string
    description?: string | null
    location?: string | null
    assigned_to?: string | null
    category?: RunSheetItem['category']
    sort_order?: number
  }
): Promise<RunSheetItem> {
  const result = await db
    .prepare(
      `INSERT INTO run_sheet_items
        (wedding_id, vendor_id, time, end_time, title, description, location, assigned_to, category, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      data.wedding_id,
      data.vendor_id,
      data.time ?? null,
      data.end_time ?? null,
      data.title,
      data.description ?? null,
      data.location ?? null,
      data.assigned_to ?? null,
      data.category ?? 'other',
      data.sort_order ?? 0
    )
    .first<RunSheetItem>()
  return result!
}

export async function updateRunSheetItem(
  db: D1Database,
  id: string,
  vendorId: string,
  updates: Partial<
    Pick<
      RunSheetItem,
      'time' | 'end_time' | 'title' | 'description' | 'location' | 'assigned_to' | 'category' | 'sort_order'
    >
  >
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
  values.push(id, vendorId)
  await db
    .prepare(
      `UPDATE run_sheet_items SET ${sets.join(', ')} WHERE id = ? AND vendor_id = ?`
    )
    .bind(...values)
    .run()
}

export async function deleteRunSheetItem(
  db: D1Database,
  id: string,
  vendorId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM run_sheet_items WHERE id = ? AND vendor_id = ?')
    .bind(id, vendorId)
    .run()
}

export type RunSheetRowInput = {
  time: string | null
  end_time: string | null
  title: string
  description: string | null
  location: string | null
  assigned_to: string | null
  category: RunSheetItem['category']
  sort_order: number
}

/**
 * Apply a computed run-sheet diff (see storage/run-sheet-md.ts) to the
 * vendor's items. Shared by the file-sync ingest and the MCP tool so both
 * doors apply edits identically.
 */
export async function applyRunSheetDiff(
  db: D1Database,
  weddingId: string,
  vendorId: string,
  diff: {
    creates: RunSheetRowInput[]
    updates: { id: string; changes: Parameters<typeof updateRunSheetItem>[3] }[]
    deletes: string[]
  }
): Promise<void> {
  for (const id of diff.deletes) {
    await deleteRunSheetItem(db, id, vendorId)
  }
  for (const update of diff.updates) {
    await updateRunSheetItem(db, update.id, vendorId, update.changes)
  }
  for (const create of diff.creates) {
    await createRunSheetItem(db, {
      wedding_id: weddingId,
      vendor_id: vendorId,
      time: create.time,
      end_time: create.end_time,
      title: create.title,
      description: create.description,
      location: create.location,
      assigned_to: create.assigned_to,
      category: create.category,
      sort_order: create.sort_order,
    })
  }
}

export async function reorderRunSheetItems(
  db: D1Database,
  weddingId: string,
  vendorId: string,
  orderedIds: string[]
): Promise<void> {
  const stmt = db.prepare(
    `UPDATE run_sheet_items SET sort_order = ?, updated_at = datetime('now')
     WHERE id = ? AND wedding_id = ? AND vendor_id = ?`
  )
  await db.batch(
    orderedIds.map((id, i) => stmt.bind(i, id, weddingId, vendorId))
  )
}
