import { Hono } from 'hono'
import type { Env, ImportJob } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import {
  createImportJob,
  getImportJob,
  updateImportJob,
  listImportJobs,
  listImportRecords,
  deleteImportJob,
} from '../../db/imports'
import { parseCSV, parseJSON, detectDelimiter, parseTSV } from '../../services/import/csv'
import { autoMapColumns, CONTACT_TARGET_FIELDS, IMPORT_PRESETS } from '../../services/import/presets'
import { generatePreview, processImportJob } from '../../services/import/process'
import { extractContactsFromText, extractFromUrl } from '../../services/import/extract'
import { resolveSecret } from '../../services/secrets'
import { formatDate } from '../../lib/date'
import { t } from '../../i18n'

// Newer target fields have i18n labels; older ones keep their inline label.
function fieldLabel(field: { key: string; label: string }): string {
  if (field.key === '_extra') return t('contacts.import.field.extra')
  if (field.key === 'created_at') return t('contacts.import.field.createdAt')
  return field.label
}

function safeJsonParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

const importRoutes = new Hono<Env>()

importRoutes.use('/app/*', requireAuth, csrf, requireVendor)

// ─── Import landing / history ───

importRoutes.get('/app/import', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const jobs = await listImportJobs(c.env.DB, vendor.id)

  return c.html(
    <AppLayout title="Import data" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-2xl">
        <p class="text-sm text-gray-500 mb-6">
          Import your contacts from another system. We support CSV and JSON files, plus exports from popular wedding CRMs.
        </p>

        <div class="grid gap-3 sm:grid-cols-2 mb-8">
          <SourceCard
            href="/app/import/upload?source=csv"
            title="CSV file"
            description="Upload a spreadsheet export (.csv)"
          />
          <SourceCard
            href="/app/import/upload?source=json"
            title="JSON file"
            description="Upload a JSON export (.json)"
          />
          <SourceCard
            href="/app/import/upload?source=dubsado"
            title="Dubsado"
            description="Import from a Dubsado CSV export"
          />
          <SourceCard
            href="/app/import/upload?source=studio_ninja"
            title="Studio Ninja"
            description="Import from a Studio Ninja export"
          />
          <SourceCard
            href="/app/import/upload?source=honeybook"
            title="HoneyBook"
            description="Import from a HoneyBook export"
          />
          <SourceCard
            href="/app/import/upload?source=vsco_workspace"
            title="VSCO Workspace"
            description="Import from a VSCO Workspace (formerly Táve) export"
          />
          <SourceCard
            href="/app/import/upload?source=tardis"
            title="Tardis"
            description="Import from a Tardis CRM export"
          />
          <SourceCard
            href="/app/import/extract"
            title="Paste text or URL"
            description="AI-powered extraction from text or a web page"
          />
        </div>

        {jobs.length > 0 && (
          <section>
            <h2 class="text-sm font-bold text-gray-900 mb-3">Import history</h2>
            <div class="space-y-2">
              {jobs.map((job) => (
                <a
                  href={`/app/import/${job.id}`}
                  class="flex items-center justify-between bg-white border border-papaya-300/30 rounded-xl p-3 hover:border-horizon-600/30 transition-colors"
                >
                  <div>
                    <p class="text-sm font-medium text-gray-900">
                      {job.filename ?? job.source}
                      <span class="text-gray-400"> · {job.entity_type}s</span>
                    </p>
                    <p class="text-xs text-gray-500">
                      {formatDate(job.created_at)}
                      {job.status === 'completed' && ` · ${job.imported_count} imported`}
                      {job.failed_count > 0 && `, ${job.failed_count} failed`}
                    </p>
                  </div>
                  <StatusBadge status={job.status} />
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppLayout>
  )
})

// ─── File upload ───

importRoutes.get('/app/import/upload', (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const source = c.req.query('source') ?? 'csv'
  const preset = IMPORT_PRESETS[source]

  return c.html(
    <AppLayout title="Upload data" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        <a href="/app/import" class="text-sm text-horizon-600 hover:text-horizon-700 mb-4 inline-block">&larr; Back</a>

        {preset && (
          <div class="bg-papaya-100 rounded-xl p-4 mb-6">
            <p class="text-sm font-bold text-gray-900 mb-1">{preset.name} import</p>
            <p class="text-sm text-gray-600">{preset.notes}</p>
          </div>
        )}

        <form method="post" action="/app/import/upload" enctype="multipart/form-data" class="space-y-4">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
          <input type="hidden" name="source" value={source} />

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-1.5">File</label>
            <input
              type="file"
              name="file"
              required
              accept=".csv,.tsv,.json,.txt"
              class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent file:mr-3 file:rounded-lg file:border-0 file:bg-horizon-600 file:text-white file:text-sm file:font-bold file:px-3 file:py-1.5 file:cursor-pointer"
            />
            <p class="text-xs text-gray-400 mt-1">CSV, TSV, JSON, or TXT. Max 10 MB.</p>
          </div>

          <button
            type="submit"
            class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            Upload and continue
          </button>
        </form>
      </div>
    </AppLayout>
  )
})

importRoutes.post('/app/import/upload', async (c) => {
  const vendor = c.get('vendor')!
  const form = await c.req.formData()
  const source = (form.get('source') as string) ?? 'csv'
  const file = form.get('file') as File | null

  if (!file || file.size === 0) {
    return c.redirect(`/app/import/upload?source=${source}&error=No+file+selected`)
  }

  if (file.size > 10 * 1024 * 1024) {
    return c.redirect(`/app/import/upload?source=${source}&error=File+too+large+(max+10MB)`)
  }

  const text = await file.text()
  let parsed: { headers: string[]; rows: Record<string, string>[] }

  try {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext === 'json') {
      parsed = parseJSON(text)
    } else if (ext === 'tsv' || detectDelimiter(text) === '\t') {
      parsed = parseTSV(text)
    } else {
      parsed = parseCSV(text)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse file'
    return c.redirect(`/app/import/upload?source=${source}&error=${encodeURIComponent(message)}`)
  }

  if (parsed.rows.length === 0) {
    return c.redirect(`/app/import/upload?source=${source}&error=No+records+found+in+file`)
  }

  const mapping = autoMapColumns(parsed.headers, source)

  const job = await createImportJob(c.env.DB, vendor.id, {
    source,
    filename: file.name,
    raw_data: JSON.stringify(parsed.rows),
  })

  await updateImportJob(c.env.DB, vendor.id, job.id, {
    status: 'mapping',
    total_records: parsed.rows.length,
    column_mapping: JSON.stringify(mapping),
    preview_data: JSON.stringify(parsed.headers),
  })

  return c.redirect(`/app/import/${job.id}/map`)
})

// ─── Column mapping ───

importRoutes.get('/app/import/:id/map', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const job = await getImportJob(c.env.DB, vendor.id, c.req.param('id'))
  if (!job) return c.redirect('/app/import')

  const headers: string[] = safeJsonParse<string[]>(job.preview_data, [])
  const mapping: Record<string, string> = safeJsonParse<Record<string, string>>(job.column_mapping, {})
  const rows: Record<string, string>[] = safeJsonParse<Record<string, string>[]>(job.raw_data, [])
  const sampleRow = rows[0] ?? {}

  return c.html(
    <AppLayout title="Map columns" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-3xl">
        <a href="/app/import" class="text-sm text-horizon-600 hover:text-horizon-700 mb-4 inline-block">&larr; Back</a>

        <div class="bg-papaya-100 rounded-xl p-4 mb-6">
          <p class="text-sm text-gray-700">
            <span class="font-bold">{job.total_records} records</span> found in <span class="font-bold">{job.filename}</span>.
            Map each column to a contact field, or skip columns you don't need.
          </p>
        </div>

        <form method="post" action={`/app/import/${job.id}/map`}>
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />

          <div class="bg-white border border-papaya-300/30 rounded-xl overflow-hidden mb-6">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th class="text-left px-4 py-3 font-bold text-gray-700">Source column</th>
                  <th class="text-left px-4 py-3 font-bold text-gray-700">Sample</th>
                  <th class="text-left px-4 py-3 font-bold text-gray-700">Maps to</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                {headers.map((header) => (
                  <tr>
                    <td class="px-4 py-3 font-medium text-gray-900">{header}</td>
                    <td class="px-4 py-3 text-gray-500 max-w-[200px] truncate">{sampleRow[header] ?? ''}</td>
                    <td class="px-4 py-3">
                      <select
                        name={`map_${header}`}
                        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                      >
                        {CONTACT_TARGET_FIELDS.map((field) => (
                          <option
                            value={field.key}
                            selected={mapping[header] === field.key}
                          >
                            {fieldLabel(field)}{'required' in field && field.required ? ' *' : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div class="flex items-center gap-3">
            <button
              type="submit"
              class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Preview import
            </button>
            <a href="/app/import" class="text-sm text-gray-500 hover:text-gray-700">Cancel</a>
          </div>
        </form>
      </div>
    </AppLayout>
  )
})

importRoutes.post('/app/import/:id/map', async (c) => {
  const vendor = c.get('vendor')!
  const jobId = c.req.param('id')
  const job = await getImportJob(c.env.DB, vendor.id, jobId)
  if (!job) return c.redirect('/app/import')

  const form = await c.req.formData()
  const headers: string[] = safeJsonParse<string[]>(job.preview_data, [])
  const mapping: Record<string, string> = {}

  for (const header of headers) {
    const value = form.get(`map_${header}`) as string
    if (value) mapping[header] = value
  }

  await updateImportJob(c.env.DB, vendor.id, jobId, {
    status: 'previewing',
    column_mapping: JSON.stringify(mapping),
  })

  return c.redirect(`/app/import/${jobId}/preview`)
})

// ─── Preview ───

importRoutes.get('/app/import/:id/preview', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const job = await getImportJob(c.env.DB, vendor.id, c.req.param('id'))
  if (!job) return c.redirect('/app/import')

  const mapping: Record<string, string> = safeJsonParse<Record<string, string>>(job.column_mapping, {})
  const rows: Record<string, string>[] = safeJsonParse<Record<string, string>[]>(job.raw_data, [])
  const preview = generatePreview(rows, mapping, 5)

  const mappedFields = Object.values(mapping).filter((v) => v !== '_skip')
  const uniqueFields = [...new Set(mappedFields)]
  const fieldLabels = CONTACT_TARGET_FIELDS.reduce<Record<string, string>>((acc, f) => {
    acc[f.key] = fieldLabel(f)
    return acc
  }, {})
  fieldLabels._extra = t('contacts.import.preview.extraColumn')

  const canCreateWeddings = uniqueFields.includes('status') && uniqueFields.includes('wedding_date')

  return c.html(
    <AppLayout title="Preview import" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-4xl">
        <a href={`/app/import/${job.id}/map`} class="text-sm text-horizon-600 hover:text-horizon-700 mb-4 inline-block">&larr; Adjust mapping</a>

        <div class="bg-papaya-100 rounded-xl p-4 mb-6">
          <p class="text-sm text-gray-700">
            Preview of first {preview.length} of {job.total_records} records. Check the data looks correct before importing.
          </p>
        </div>

        <div class="bg-white border border-papaya-300/30 rounded-xl overflow-x-auto mb-6">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 border-b border-gray-200">
              <tr>
                <th class="text-left px-4 py-3 font-bold text-gray-700">#</th>
                {uniqueFields.map((f) => (
                  <th class="text-left px-4 py-3 font-bold text-gray-700 whitespace-nowrap">
                    {fieldLabels[f] ?? f}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              {preview.map((row, i) => (
                <tr>
                  <td class="px-4 py-3 text-gray-400">{i + 1}</td>
                  {uniqueFields.map((f) => (
                    <td class="px-4 py-3 text-gray-900 max-w-[200px] truncate">{row[f] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form method="post" action={`/app/import/${job.id}/process`}>
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />

          {canCreateWeddings && (
            <div class="bg-white border border-papaya-300/30 rounded-xl p-4 mb-6">
              <p class="text-sm font-bold text-gray-900 mb-2">{t('contacts.import.options.title')}</p>
              <label class="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  name="create_weddings"
                  value="1"
                  class="mt-0.5 rounded border-gray-300 text-horizon-600 focus:ring-horizon-600"
                />
                <span>
                  <span class="block text-sm font-medium text-gray-900">{t('contacts.import.options.createWeddings')}</span>
                  <span class="block text-xs text-gray-500 mt-0.5">{t('contacts.import.options.createWeddingsHelp')}</span>
                </span>
              </label>
            </div>
          )}

          <div class="flex items-center gap-3">
            <button
              type="submit"
              class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Import {job.total_records} contacts
            </button>
            <a href={`/app/import/${job.id}/map`} class="text-sm text-gray-500 hover:text-gray-700">Go back</a>
          </div>
        </form>
      </div>
    </AppLayout>
  )
})

// ─── Process import ───

importRoutes.post('/app/import/:id/process', async (c) => {
  const vendor = c.get('vendor')!
  const jobId = c.req.param('id')

  const form = await c.req.formData()
  if (form.get('create_weddings') === '1') {
    await updateImportJob(c.env.DB, vendor.id, jobId, {
      config: JSON.stringify({ create_weddings: true }),
    })
  }

  try {
    await processImportJob(c.env, vendor.id, jobId)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed'
    await updateImportJob(c.env.DB, vendor.id, jobId, {
      status: 'failed',
      error_log: JSON.stringify([{ index: -1, error: message }]),
    })
  }

  return c.redirect(`/app/import/${jobId}`)
})

// ─── Import detail / results ───

importRoutes.get('/app/import/:id', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const job = await getImportJob(c.env.DB, vendor.id, c.req.param('id'))
  if (!job) return c.redirect('/app/import')

  const failedRecords = job.status === 'completed' || job.status === 'failed'
    ? await listImportRecords(c.env.DB, job.id, 'failed')
    : []

  const jobConfig = safeJsonParse<{ weddings_created?: number }>(job.config, {})

  return c.html(
    <AppLayout title="Import results" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-2xl">
        <a href="/app/import" class="text-sm text-horizon-600 hover:text-horizon-700 mb-4 inline-block">&larr; All imports</a>

        <div class="bg-white border border-papaya-300/30 rounded-xl p-6 mb-6">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-base font-bold text-gray-900">{job.filename ?? job.source}</h2>
              <p class="text-sm text-gray-500">{formatDate(job.created_at)}</p>
            </div>
            <StatusBadge status={job.status} />
          </div>

          {(job.status === 'completed' || job.status === 'failed') && (
            <div class={`grid gap-4 ${jobConfig.weddings_created ? 'grid-cols-4' : 'grid-cols-3'}`}>
              <StatBox label="Imported" value={job.imported_count} color="horizon" />
              <StatBox label="Skipped" value={job.skipped_count} color="gray" />
              <StatBox label="Failed" value={job.failed_count} color="grapefruit" />
              {jobConfig.weddings_created ? (
                <StatBox label={t('contacts.import.weddingsCreated')} value={jobConfig.weddings_created} color="horizon" />
              ) : null}
            </div>
          )}

          {job.status === 'processing' && (
            <div class="text-center py-4">
              <p class="text-sm text-gray-600 mb-2">Processing...</p>
              <div class="w-full bg-gray-200 rounded-full h-2">
                <div
                  class="bg-horizon-600 h-2 rounded-full transition-all"
                  style={`width: ${job.total_records > 0 ? Math.round(((job.imported_count + job.skipped_count + job.failed_count) / job.total_records) * 100) : 0}%`}
                />
              </div>
              <p class="text-xs text-gray-400 mt-1">
                {job.imported_count + job.skipped_count + job.failed_count} / {job.total_records}
              </p>
            </div>
          )}

          {job.status === 'mapping' && (
            <a
              href={`/app/import/${job.id}/map`}
              class="inline-block bg-horizon-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Continue mapping
            </a>
          )}

          {job.status === 'previewing' && (
            <a
              href={`/app/import/${job.id}/preview`}
              class="inline-block bg-horizon-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Continue to preview
            </a>
          )}
        </div>

        {failedRecords.length > 0 && (
          <section>
            <h3 class="text-sm font-bold text-gray-900 mb-3">Failed records</h3>
            <div class="space-y-2">
              {failedRecords.map((rec) => {
                const raw = JSON.parse(rec.raw_data) as Record<string, string>
                const preview = Object.values(raw).filter(Boolean).slice(0, 3).join(', ')
                return (
                  <div class="bg-white border border-grapefruit-200 rounded-xl p-3">
                    <p class="text-sm text-gray-900 truncate">Row {rec.record_index + 1}: {preview}</p>
                    <p class="text-xs text-grapefruit-600 mt-1">{rec.error}</p>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {(job.status === 'completed' || job.status === 'failed') && (
          <div class="mt-6 flex items-center gap-4">
            <a
              href="/app/contacts"
              class="text-sm font-bold text-horizon-600 hover:text-horizon-700 transition-colors"
            >
              View contacts
            </a>
            <form method="post" action={`/app/import/${job.id}/delete`}>
              <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
              <button
                type="submit"
                class="text-sm text-gray-400 hover:text-grapefruit-600 transition-colors"
                onclick="return confirm('Delete this import record?')"
              >
                Delete import
              </button>
            </form>
          </div>
        )}
      </div>
    </AppLayout>
  )
})

importRoutes.post('/app/import/:id/delete', async (c) => {
  const vendor = c.get('vendor')!
  await deleteImportJob(c.env.DB, vendor.id, c.req.param('id'))
  return c.redirect('/app/import')
})

// ─── AI text extraction ───

importRoutes.get('/app/import/extract', (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const error = c.req.query('error')

  return c.html(
    <AppLayout title="Extract contacts" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        <a href="/app/import" class="text-sm text-horizon-600 hover:text-horizon-700 mb-4 inline-block">&larr; Back</a>

        {error && (
          <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-3 mb-6">
            {decodeURIComponent(error)}
          </div>
        )}

        <div class="bg-papaya-100 rounded-xl p-4 mb-6">
          <p class="text-sm font-bold text-gray-900 mb-1">AI-powered extraction</p>
          <p class="text-sm text-gray-600">
            Paste text containing contact information (from a spreadsheet, email, website, or any format) and we'll extract structured contact records using AI.
          </p>
        </div>

        <form method="post" action="/app/import/extract" class="space-y-4">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-1.5">Paste your data</label>
            <textarea
              name="text"
              rows={10}
              placeholder={"Paste contacts here...\n\nExamples:\n- A list of names and emails\n- Copied rows from a spreadsheet\n- Text from a website or email\n- Any format — the AI will figure it out"}
              class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            />
          </div>

          <div class="border-t border-gray-200 pt-4">
            <label class="block text-sm font-bold text-gray-700 mb-1.5">Or provide a URL</label>
            <input
              type="url"
              name="url"
              placeholder="https://example.com/team"
              class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            />
            <p class="text-xs text-gray-400 mt-1">We'll fetch the page and extract contacts from it.</p>
          </div>

          <button
            type="submit"
            class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            Extract contacts
          </button>
        </form>
      </div>
    </AppLayout>
  )
})

importRoutes.post('/app/import/extract', async (c) => {
  const vendor = c.get('vendor')!
  const form = await c.req.formData()
  const text = (form.get('text') as string)?.trim()
  const url = (form.get('url') as string)?.trim()

  if (!text && !url) {
    return c.redirect('/app/import/extract?error=Provide+text+or+a+URL')
  }

  const anthropicKey = vendor.anthropic_api_key
    ? await resolveSecret(c.env.KV, vendor.anthropic_api_key)
    : (c.env.ANTHROPIC_API_KEY ?? null)

  try {
    const result = url && !text
      ? await extractFromUrl(url, c.env.AI, anthropicKey)
      : await extractContactsFromText(text, c.env.AI, anthropicKey)

    if (result.contacts.length === 0) {
      return c.redirect('/app/import/extract?error=No+contacts+found+in+the+provided+data')
    }

    const rows = result.contacts.map((contact) => {
      const row: Record<string, string> = {}
      for (const [key, val] of Object.entries(contact)) {
        if (val) row[key] = String(val)
      }
      return row
    })

    const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))]

    const identityMapping: Record<string, string> = {}
    for (const h of headers) identityMapping[h] = h

    const job = await createImportJob(c.env.DB, vendor.id, {
      source: url ? 'web_scrape' : 'text',
      filename: url ?? 'text extraction',
      raw_data: JSON.stringify(rows),
    })

    await updateImportJob(c.env.DB, vendor.id, job.id, {
      status: 'previewing',
      total_records: rows.length,
      column_mapping: JSON.stringify(identityMapping),
      preview_data: JSON.stringify(headers),
    })

    return c.redirect(`/app/import/${job.id}/preview`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Extraction failed'
    return c.redirect(`/app/import/extract?error=${encodeURIComponent(message)}`)
  }
})

// ─── Shared components ───

function SourceCard({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <a
      href={href}
      class="flex flex-col bg-white border border-papaya-300/30 rounded-xl p-4 hover:border-horizon-600/30 hover:shadow-sm transition-all"
    >
      <p class="text-sm font-bold text-gray-900">{title}</p>
      <p class="text-xs text-gray-500 mt-1">{description}</p>
    </a>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    uploading: 'bg-gray-100 text-gray-600',
    mapping: 'bg-papaya-100 text-papaya-700',
    previewing: 'bg-papaya-100 text-papaya-700',
    processing: 'bg-horizon-50 text-horizon-700',
    completed: 'bg-horizon-50 text-horizon-700',
    failed: 'bg-grapefruit-50 text-grapefruit-700',
    cancelled: 'bg-gray-100 text-gray-500',
  }
  return (
    <span class={`text-xs font-bold px-2.5 py-1 rounded-lg ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div class={`bg-${color}-50 rounded-xl p-3 text-center`}>
      <p class={`text-2xl font-bold text-${color}-700`}>{value}</p>
      <p class={`text-xs text-${color}-600`}>{label}</p>
    </div>
  )
}

export default importRoutes
