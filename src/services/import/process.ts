import { createContact } from '../../db/contacts'
import {
  getImportJob,
  updateImportJob,
  createImportRecord,
  updateImportRecord,
  listImportRecords,
} from '../../db/imports'
import { normalizeStatus } from './presets'
import type { ImportJob } from '../../types'

export type ProcessResult = {
  imported: number
  skipped: number
  failed: number
  errors: { index: number; error: string }[]
}

export async function processImportJob(
  db: D1Database,
  vendorId: string,
  jobId: string
): Promise<ProcessResult> {
  const job = await getImportJob(db, vendorId, jobId)
  if (!job) throw new Error('Import job not found')
  if (job.status !== 'previewing' && job.status !== 'mapping') {
    throw new Error(`Cannot process job in ${job.status} state`)
  }

  await updateImportJob(db, vendorId, jobId, { status: 'processing' })

  const mapping: Record<string, string> = job.column_mapping
    ? JSON.parse(job.column_mapping)
    : {}

  const rows: Record<string, string>[] = job.raw_data
    ? JSON.parse(job.raw_data)
    : []

  const result: ProcessResult = { imported: 0, skipped: 0, failed: 0, errors: [] }

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]
    const mapped = applyMapping(raw, mapping)

    const record = await createImportRecord(db, {
      import_job_id: jobId,
      record_index: i,
      entity_type: job.entity_type,
      raw_data: JSON.stringify(raw),
      mapped_data: JSON.stringify(mapped),
    })

    if (!mapped.first_name || mapped.first_name.trim() === '') {
      await updateImportRecord(db, record.id, {
        status: 'skipped',
        error: 'Missing required field: first_name',
      })
      result.skipped++
      continue
    }

    try {
      if (job.entity_type === 'contact') {
        const contact = await importContact(db, vendorId, mapped)
        await updateImportRecord(db, record.id, {
          status: 'imported',
          entity_id: contact.id,
        })
        result.imported++
      } else {
        await updateImportRecord(db, record.id, {
          status: 'skipped',
          error: `Import of ${job.entity_type} not yet supported`,
        })
        result.skipped++
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await updateImportRecord(db, record.id, {
        status: 'failed',
        error: message,
      })
      result.failed++
      result.errors.push({ index: i, error: message })
    }

    if (i % 10 === 0 || i === rows.length - 1) {
      await updateImportJob(db, vendorId, jobId, {
        imported_count: result.imported,
        skipped_count: result.skipped,
        failed_count: result.failed,
      })
    }
  }

  await updateImportJob(db, vendorId, jobId, {
    status: result.failed > 0 && result.imported === 0 ? 'failed' : 'completed',
    imported_count: result.imported,
    skipped_count: result.skipped,
    failed_count: result.failed,
    error_log: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
    completed_at: new Date().toISOString(),
  })

  return result
}

function applyMapping(
  row: Record<string, string>,
  mapping: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {}

  for (const [sourceCol, targetField] of Object.entries(mapping)) {
    if (targetField === '_skip' || !targetField) continue
    const value = row[sourceCol]
    if (value && value.trim()) {
      if (result[targetField]) {
        result[targetField] += ' ' + value.trim()
      } else {
        result[targetField] = value.trim()
      }
    }
  }

  return result
}

async function importContact(
  db: D1Database,
  vendorId: string,
  data: Record<string, string>
) {
  const contact = await createContact(db, vendorId, {
    first_name: data.first_name,
    last_name: data.last_name || '',
    email: data.email || null,
    phone: data.phone || null,
    partner_first_name: data.partner_first_name || null,
    partner_last_name: data.partner_last_name || null,
    partner_email: data.partner_email || null,
    partner_phone: data.partner_phone || null,
    source: data.source || 'import',
    wedding_date: normalizeDate(data.wedding_date) || null,
    wedding_location: data.wedding_location || null,
    notes: data.notes || null,
  })

  if (data.status) {
    const { updateContactStatus } = await import('../../db/contacts')
    await updateContactStatus(db, vendorId, contact.id, normalizeStatus(data.status))
  }

  return contact
}

export function normalizeDate(raw?: string): string | null {
  if (!raw || raw.trim() === '') return null
  const trimmed = raw.trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  const formats = [
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
  ]

  for (const fmt of formats) {
    const match = trimmed.match(fmt)
    if (match) {
      const [, a, b, year] = match
      const first = parseInt(a)
      const second = parseInt(b)
      if (first > 12 && second <= 12) {
        // first is day, second is month (e.g. 25/03/2026)
        if (first > 31) return trimmed
        return `${year}-${String(second).padStart(2, '0')}-${String(first).padStart(2, '0')}`
      }
      if (second > 12 && first <= 12) {
        // second is day, first is month (e.g. 03/25/2026)
        if (second > 31) return trimmed
        return `${year}-${String(first).padStart(2, '0')}-${String(second).padStart(2, '0')}`
      }
      // ambiguous (both <= 12) — assume dd/mm/yyyy (AU format)
      if (first < 1 || first > 31 || second < 1 || second > 12) return trimmed
      return `${year}-${String(second).padStart(2, '0')}-${String(first).padStart(2, '0')}`
    }
  }

  const usFormat = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (usFormat) {
    const [, a, b, y] = usFormat
    const first = parseInt(a)
    const second = parseInt(b)
    if (first < 1 || first > 31 || second < 1 || second > 31) return trimmed
    const year = parseInt(y) > 50 ? `19${y}` : `20${y}`
    if (first > 12 && second <= 12) {
      return `${year}-${String(second).padStart(2, '0')}-${String(first).padStart(2, '0')}`
    }
    // assume dd/mm/yy (AU format)
    return `${year}-${String(second).padStart(2, '0')}-${String(first).padStart(2, '0')}`
  }

  try {
    const d = new Date(trimmed)
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0]
    }
  } catch {
    // ignore
  }

  return trimmed
}

export function generatePreview(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  limit = 5
): Record<string, string>[] {
  return rows.slice(0, limit).map((row) => applyMapping(row, mapping))
}
