import type { ImportJob, ImportRecord } from '../types'

export async function createImportJob(
  db: D1Database,
  vendorId: string,
  data: {
    source: string
    entity_type?: string
    filename?: string | null
    config?: string | null
    raw_data?: string | null
  }
): Promise<ImportJob> {
  const result = await db
    .prepare(
      `INSERT INTO import_jobs (vendor_id, source, entity_type, filename, config, raw_data)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      vendorId,
      data.source,
      data.entity_type ?? 'contact',
      data.filename ?? null,
      data.config ?? null,
      data.raw_data ?? null
    )
    .first<ImportJob>()
  return result!
}

export async function getImportJob(
  db: D1Database,
  vendorId: string,
  jobId: string
): Promise<ImportJob | null> {
  return db
    .prepare('SELECT * FROM import_jobs WHERE id = ? AND vendor_id = ?')
    .bind(jobId, vendorId)
    .first<ImportJob>()
}

export async function updateImportJob(
  db: D1Database,
  vendorId: string,
  jobId: string,
  data: Partial<Pick<ImportJob, 'status' | 'column_mapping' | 'total_records' | 'imported_count' | 'skipped_count' | 'failed_count' | 'error_log' | 'preview_data' | 'raw_data' | 'config' | 'completed_at'>>
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
  values.push(jobId, vendorId)
  await db
    .prepare(`UPDATE import_jobs SET ${sets.join(', ')} WHERE id = ? AND vendor_id = ?`)
    .bind(...values)
    .run()
}

export async function listImportJobs(
  db: D1Database,
  vendorId: string
): Promise<ImportJob[]> {
  return db
    .prepare(
      `SELECT * FROM import_jobs WHERE vendor_id = ?
       ORDER BY created_at DESC LIMIT 50`
    )
    .bind(vendorId)
    .all<ImportJob>()
    .then((r) => r.results)
}

export async function createImportRecord(
  db: D1Database,
  data: {
    import_job_id: string
    record_index: number
    entity_type?: string
    raw_data: string
    mapped_data?: string | null
  }
): Promise<ImportRecord> {
  const result = await db
    .prepare(
      `INSERT INTO import_records (import_job_id, record_index, entity_type, raw_data, mapped_data)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      data.import_job_id,
      data.record_index,
      data.entity_type ?? 'contact',
      data.raw_data,
      data.mapped_data ?? null
    )
    .first<ImportRecord>()
  return result!
}

export async function updateImportRecord(
  db: D1Database,
  vendorId: string,
  recordId: string,
  data: Partial<Pick<ImportRecord, 'status' | 'entity_id' | 'mapped_data' | 'error'>>
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
  values.push(recordId, vendorId)
  await db
    .prepare(
      `UPDATE import_records SET ${sets.join(', ')} WHERE id = ? AND import_job_id IN (SELECT id FROM import_jobs WHERE vendor_id = ?)`
    )
    .bind(...values)
    .run()
}

export async function listImportRecords(
  db: D1Database,
  jobId: string,
  statusFilter?: string
): Promise<ImportRecord[]> {
  let query = 'SELECT * FROM import_records WHERE import_job_id = ?'
  const params: unknown[] = [jobId]
  if (statusFilter) {
    query += ' AND status = ?'
    params.push(statusFilter)
  }
  query += ' ORDER BY record_index ASC'
  return db
    .prepare(query)
    .bind(...params)
    .all<ImportRecord>()
    .then((r) => r.results)
}

export async function countImportRecordsByStatus(
  db: D1Database,
  jobId: string
): Promise<Record<string, number>> {
  const rows = await db
    .prepare(
      'SELECT status, COUNT(*) as count FROM import_records WHERE import_job_id = ? GROUP BY status'
    )
    .bind(jobId)
    .all<{ status: string; count: number }>()
  const counts: Record<string, number> = {}
  for (const row of rows.results) {
    counts[row.status] = row.count
  }
  return counts
}

export async function deleteImportJob(
  db: D1Database,
  vendorId: string,
  jobId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM import_jobs WHERE id = ? AND vendor_id = ?')
    .bind(jobId, vendorId)
    .run()
}
