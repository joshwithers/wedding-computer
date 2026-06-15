import { createContact, updateContact } from '../../db/contacts'
import { createWedding, updateWedding, addWeddingMember } from '../../db/weddings'
import { applyWeddingUpdate } from '../../db/timeline'
import { createEvent } from '../../db/calendar'
import { createActivity } from '../../db/activities'
import { getVendorById } from '../../db/vendors'
import { todayString } from '../../lib/date'
import {
  getImportJob,
  updateImportJob,
  createImportRecord,
  updateImportRecord,
  listImportRecords,
} from '../../db/imports'
import { normalizeStatus } from './presets'
import type { ImportJob, VendorProfile } from '../../types'

export type ProcessResult = {
  imported: number
  skipped: number
  failed: number
  weddings_created: number
  errors: { index: number; error: string }[]
}

export type MappedRow = {
  fields: Record<string, string>
  extras: Record<string, string>
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

  const config: { create_weddings?: boolean } = job.config
    ? safeParse(job.config, {})
    : {}

  // Wedding creation needs the vendor's user for membership rows.
  const vendor = config.create_weddings ? await getVendorById(db, vendorId) : null

  const result: ProcessResult = { imported: 0, skipped: 0, failed: 0, weddings_created: 0, errors: [] }

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]
    const mapped = applyMapping(raw, mapping)

    const record = await createImportRecord(db, {
      import_job_id: jobId,
      record_index: i,
      entity_type: job.entity_type,
      raw_data: JSON.stringify(raw),
      mapped_data: JSON.stringify({ ...mapped.fields, ...(Object.keys(mapped.extras).length ? { _extra: mapped.extras } : {}) }),
    })

    if (!mapped.fields.first_name || mapped.fields.first_name.trim() === '') {
      await updateImportRecord(db, vendorId, record.id, {
        status: 'skipped',
        error: 'Missing required field: first_name',
      })
      result.skipped++
      continue
    }

    try {
      if (job.entity_type === 'contact') {
        const { contact, status } = await importContact(db, vendorId, mapped)
        if (vendor) {
          const created = await createWeddingForImportedContact(db, vendor, contact.id, mapped, status)
          if (created) result.weddings_created++
        }
        await updateImportRecord(db, vendorId, record.id, {
          status: 'imported',
          entity_id: contact.id,
        })
        result.imported++
      } else {
        await updateImportRecord(db, vendorId, record.id, {
          status: 'skipped',
          error: `Import of ${job.entity_type} not yet supported`,
        })
        result.skipped++
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await updateImportRecord(db, vendorId, record.id, {
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
    config: JSON.stringify({ ...config, weddings_created: result.weddings_created }),
    completed_at: new Date().toISOString(),
  })

  return result
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

function applyMapping(
  row: Record<string, string>,
  mapping: Record<string, string>
): MappedRow {
  const fields: Record<string, string> = {}
  const extras: Record<string, string> = {}

  for (const [sourceCol, targetField] of Object.entries(mapping)) {
    if (targetField === '_skip' || !targetField) continue
    const value = row[sourceCol]
    if (!value || !value.trim()) continue
    if (targetField === '_extra') {
      extras[sourceCol] = value.trim()
    } else if (fields[targetField]) {
      fields[targetField] += ' ' + value.trim()
    } else {
      fields[targetField] = value.trim()
    }
  }

  return { fields, extras }
}

async function importContact(
  db: D1Database,
  vendorId: string,
  mapped: MappedRow
): Promise<{ contact: { id: string }; status: string | null }> {
  const data = mapped.fields
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
    form_data: Object.keys(mapped.extras).length > 0 ? JSON.stringify(mapped.extras) : null,
    created_at: normalizeTimestamp(data.created_at),
  })

  let status: string | null = null
  if (data.status) {
    status = normalizeStatus(data.status)
    const { updateContactStatus } = await import('../../db/contacts')
    await updateContactStatus(db, vendorId, contact.id, status)
  }

  return { contact, status }
}

/**
 * Quietly create a wedding for an imported booked/completed contact: wedding +
 * vendor membership + calendar booking + contact link. Unlike the interactive
 * promote flow this sends no couple invites and creates no user accounts —
 * bulk imports of historical clients must never email them.
 */
async function createWeddingForImportedContact(
  db: D1Database,
  vendor: VendorProfile,
  contactId: string,
  mapped: MappedRow,
  status: string | null
): Promise<boolean> {
  if (status !== 'booked' && status !== 'completed') return false

  const date = normalizeDate(mapped.fields.wedding_date)
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  // Junk years (e.g. a real-world '0021-11-17' typo) — keep the contact's raw
  // date for the vendor to fix, but don't mint a wedding in year 21.
  const year = parseInt(date.slice(0, 4))
  if (year < 1900 || year > 2200) return false

  const f = mapped.fields
  const title = f.partner_first_name
    ? `${f.first_name} & ${f.partner_first_name}`
    : `${f.first_name} ${f.last_name ?? ''}`.trim()

  const bookingType = (mapped.extras.booking_type ?? '').toLowerCase().trim()
  const time = normalizeTime(mapped.extras.ceremony_time)

  const wedding = await createWedding(db, {
    title,
    date,
    time,
    location: f.wedding_location ?? null,
    ceremony_type: bookingType || 'wedding',
    created_by_user_id: vendor.user_id,
  })

  // Historical weddings land as completed; future bookings as confirmed.
  const weddingStatus = status === 'completed' || date < todayString() ? 'completed' : 'confirmed'
  await updateWedding(db, wedding.id, { status: weddingStatus })

  // Seed the ceremony slot row from the imported time so timeline_items stays the
  // source of truth — otherwise the first projection would blank the column.
  if (time) {
    await applyWeddingUpdate(db, wedding.id, { time }, vendor.user_id)
  }

  await addWeddingMember(db, {
    wedding_id: wedding.id,
    user_id: vendor.user_id,
    role: 'vendor',
    vendor_profile_id: vendor.id,
    vendor_role: vendor.category,
    can_manage: true,
  })

  try {
    await createEvent(db, vendor.id, {
      title,
      date,
      start_time: time,
      type: 'booking',
      wedding_id: wedding.id,
      all_day: !time,
    })
  } catch (err) {
    console.error('[IMPORT] calendar event failed:', err instanceof Error ? err.message : err)
  }

  await updateContact(db, vendor.id, contactId, { wedding_id: wedding.id })
  await createActivity(db, contactId, 'status_change', `Imported with wedding: ${title}`)

  return true
}

/** Accept 'HH:MM' / 'H:MM' (with optional seconds) — anything else is dropped. */
export function normalizeTime(raw?: string): string | null {
  if (!raw) return null
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hours = parseInt(match[1])
  if (hours > 23 || parseInt(match[2]) > 59) return null
  return `${String(hours).padStart(2, '0')}:${match[2]}`
}

/**
 * Source timestamps ('2024-03-01 10:22:01' or ISO) pass through so imported
 * contacts keep their original created date; date-only values are accepted;
 * anything else falls back to the insert default.
 */
export function normalizeTimestamp(raw?: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/.test(trimmed)) {
    return trimmed.replace('T', ' ').replace(/(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/, '')
  }
  const date = normalizeDate(trimmed)
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
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
  return rows.slice(0, limit).map((row) => {
    const mapped = applyMapping(row, mapping)
    const display = { ...mapped.fields }
    const extraEntries = Object.entries(mapped.extras)
    if (extraEntries.length > 0) {
      display._extra = extraEntries.map(([k, v]) => `${k}: ${v}`).join(' · ')
    }
    return display
  })
}
