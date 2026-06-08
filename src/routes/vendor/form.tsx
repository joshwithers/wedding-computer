import { Hono } from 'hono'
import type { Env } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { updateVendor } from '../../db/vendors'
import {
  parseFormConfig,
  validateFormConfig,
  defaultFormConfig,
  generateFieldId,
  FIELD_TYPES,
  CONTACT_MAPPINGS,
} from '../../lib/form-schema'
import type { FormConfig, FormField } from '../../lib/form-schema'

const form = new Hono<Env>()

form.use('/app/*', requireAuth, csrf, requireVendor)

// ─── Main editor page ───

form.get('/app/form', (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const config = parseFormConfig(vendor.enquiry_form)
  const saved = c.req.query('saved')
  const error = c.req.query('error')

  return c.html(
    <AppLayout title="Enquiry Form" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <FormEditor config={config} vendorId={vendor.id} appUrl={c.env.APP_URL} csrfToken={c.get('csrfToken')} saved={!!saved} error={error} />
    </AppLayout>
  )
})

// ─── Save form config ───

form.post('/app/form', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()

  try {
    const config = buildConfigFromBody(body as Record<string, string>)
    const validationError = validateFormConfig(config)
    if (validationError) throw new Error(validationError)

    await updateVendor(c.env.DB, vendor.id, {
      enquiry_form: JSON.stringify(config),
    })

    return c.redirect('/app/form?saved=1')
  } catch (e: any) {
    return c.redirect(`/app/form?error=${encodeURIComponent(e.message)}`)
  }
})

// ─── Add field (htmx) ───

form.post('/app/form/add-field', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()
  // Build from the posted form so any in-progress edits are preserved.
  const config = buildConfigFromBody(body as Record<string, string>)

  config.fields.push({
    id: generateFieldId(),
    type: 'text',
    label: 'New field',
    width: 'full',
  })

  await updateVendor(c.env.DB, vendor.id, {
    enquiry_form: JSON.stringify(config),
  })

  return c.redirect('/app/form')
})

// ─── Add section heading (htmx) ───

form.post('/app/form/add-heading', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()
  const config = buildConfigFromBody(body as Record<string, string>)

  config.fields.push({
    id: generateFieldId(),
    type: 'heading',
    label: 'New section',
  })

  await updateVendor(c.env.DB, vendor.id, {
    enquiry_form: JSON.stringify(config),
  })

  return c.redirect('/app/form')
})

// ─── Move field ───

form.post('/app/form/move/:fieldId/:direction', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()
  // Built from the posted form so any in-progress edits are preserved.
  const config = buildConfigFromBody(body as Record<string, string>)
  const fieldId = c.req.param('fieldId')
  const direction = c.req.param('direction')

  const idx = config.fields.findIndex((f) => f.id === fieldId)
  if (idx === -1) return c.redirect('/app/form')

  const swap = direction === 'up' ? idx - 1 : idx + 1
  if (swap < 0 || swap >= config.fields.length) return c.redirect('/app/form')

  const temp = config.fields[idx]
  config.fields[idx] = config.fields[swap]
  config.fields[swap] = temp

  await updateVendor(c.env.DB, vendor.id, {
    enquiry_form: JSON.stringify(config),
  })

  return c.redirect('/app/form')
})

// ─── Delete field ───

form.post('/app/form/delete/:fieldId', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()
  // Built from the posted form so any in-progress edits are preserved.
  const config = buildConfigFromBody(body as Record<string, string>)
  const fieldId = c.req.param('fieldId')

  config.fields = config.fields.filter((f) => f.id !== fieldId)

  await updateVendor(c.env.DB, vendor.id, {
    enquiry_form: JSON.stringify(config),
  })

  return c.redirect('/app/form')
})

// ─── Reset to default ───

form.post('/app/form/reset', async (c) => {
  const vendor = c.get('vendor')!

  await updateVendor(c.env.DB, vendor.id, {
    enquiry_form: JSON.stringify(defaultFormConfig()),
  })

  return c.redirect('/app/form?saved=1')
})

// ─── Export config as JSON ───

form.get('/app/form/export', (c) => {
  const vendor = c.get('vendor')!
  const config = parseFormConfig(vendor.enquiry_form)

  return c.json(config, 200, {
    'Content-Disposition': `attachment; filename="${vendor.business_name.replace(/[^a-zA-Z0-9]/g, '-')}-form.json"`,
  })
})

// ─── Import config from JSON ───

form.post('/app/form/import', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()
  const jsonText = typeof body.config === 'string' ? body.config : ''

  try {
    const config = JSON.parse(jsonText) as FormConfig
    if (!config.version || !Array.isArray(config.fields)) {
      throw new Error('Invalid form config format')
    }
    config.version = 1
    const validationError = validateFormConfig(config)
    if (validationError) throw new Error(validationError)

    await updateVendor(c.env.DB, vendor.id, {
      enquiry_form: JSON.stringify(config),
    })

    return c.redirect('/app/form?saved=1')
  } catch (e: any) {
    return c.redirect(`/app/form?error=${encodeURIComponent(e.message)}`)
  }
})

export default form

// ─── Build config from form submission ───

function buildConfigFromBody(body: Record<string, string>): FormConfig {
  const title = (body.form_title ?? 'Get in touch').trim()
  const subtitle = (body.form_subtitle ?? '').trim() || undefined
  const submitLabel = (body.form_submit_label ?? 'Send enquiry').trim()

  const fieldIds = (body.field_ids ?? '').split(',').filter(Boolean)
  const fields: FormField[] = []

  for (const id of fieldIds) {
    const type = body[`field_type_${id}`] as FormField['type'] ?? 'text'
    const label = (body[`field_label_${id}`] ?? '').trim()
    if (!label) continue

    const field: FormField = { id, type, label }

    if (type !== 'heading') {
      const placeholder = (body[`field_placeholder_${id}`] ?? '').trim()
      if (placeholder) field.placeholder = placeholder

      field.required = body[`field_required_${id}`] === 'on'
      field.width = (body[`field_width_${id}`] ?? 'full') as 'full' | 'half'

      const mapTo = body[`field_mapto_${id}`]
      if (mapTo && mapTo !== '') field.mapTo = mapTo as FormField['mapTo']

      if (type === 'select' || type === 'radio') {
        const opts = (body[`field_options_${id}`] ?? '')
          .split('\n')
          .map((o) => o.trim())
          .filter(Boolean)
        if (opts.length > 0) field.options = opts
      }
    }

    fields.push(field)
  }

  return {
    version: 1,
    title,
    subtitle,
    submitLabel,
    fields,
    actions: {
      notifyVendor: body.action_notify !== 'off',
      confirmationEmail: {
        enabled: body.action_confirm === 'on',
        mode: (body.action_confirm_mode ?? 'ai') as 'ai' | 'template',
        template: body.action_confirm_template?.trim() || undefined,
      },
    },
  }
}

// ─── Components ───

function FormEditor({
  config,
  vendorId,
  appUrl,
  csrfToken,
  saved,
  error,
}: {
  config: FormConfig
  vendorId: string
  appUrl: string
  csrfToken: string
  saved: boolean
  error?: string | null
}) {
  const formUrl = `/enquire/${vendorId}`
  const fullFormUrl = `${appUrl}/enquire/${vendorId}`

  return (
    <div class="max-w-2xl">
      {saved && (
        <div class="bg-horizon-50 border border-horizon-600/20 text-horizon-700 text-sm font-bold rounded-xl p-3 mb-6">
          Form saved.
        </div>
      )}
      {error && (
        <div class="bg-grapefruit-50 border border-grapefruit-600/20 text-grapefruit-700 text-sm font-bold rounded-xl p-3 mb-6">
          {error}
        </div>
      )}

      {/* Preview + Export/Import bar */}
      <div class="flex flex-wrap items-center gap-2 mb-6">
        <a
          href={formUrl}
          target="_blank"
          class="inline-flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 py-2 px-4 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Preview
        </a>
        <a
          href="/app/form/export"
          class="inline-flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 py-2 px-4 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
        >
          Export JSON
        </a>
        <button
          type="button"
          onclick="document.getElementById('import-panel').classList.toggle('hidden')"
          class="inline-flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 py-2 px-4 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
        >
          Import JSON
        </button>
        <form method="post" action="/app/form/reset" class="ml-auto">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <button
            type="submit"
            class="text-sm text-gray-400 hover:text-grapefruit-700 transition-colors"
            onclick="return confirm('Reset form to default? This cannot be undone.')"
          >
            Reset to default
          </button>
        </form>
      </div>

      {/* Import panel */}
      <div id="import-panel" class="hidden mb-6">
        <form method="post" action="/app/form/import" class="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <label class="block text-sm font-bold text-gray-700">Paste form config JSON</label>
          <textarea
            name="config"
            rows={6}
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            placeholder='{"version": 1, "title": "...", "fields": [...]}'
          ></textarea>
          <button
            type="submit"
            class="bg-horizon-600 text-white py-2 px-4 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            Import
          </button>
        </form>
      </div>

      {/* Share & Embed */}
      <div class="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h2 class="text-base font-bold mb-1">Share your form</h2>
        <p class="text-xs text-gray-500 mb-3">Share this link or embed the form on your website.</p>
        <div class="flex items-center gap-2 mb-3">
          <input
            type="text"
            readonly
            value={fullFormUrl}
            class="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-gray-50"
            id="enquiry-link"
          />
          <button
            type="button"
            onclick="navigator.clipboard.writeText(document.getElementById('enquiry-link').value);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)"
            class="border border-gray-200 px-3 py-2 rounded-xl text-sm font-bold hover:bg-papaya-50 transition-colors whitespace-nowrap"
          >
            Copy
          </button>
        </div>
        <details class="text-xs">
          <summary class="text-gray-500 cursor-pointer hover:text-gray-700">Embed code</summary>
          <textarea
            readonly
            rows={3}
            class="mt-2 w-full border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-600 bg-gray-50 font-mono"
            onclick="this.select()"
          >{`<iframe src="${fullFormUrl}?embed=1" width="100%" height="700" frameborder="0"></iframe>`}</textarea>
        </details>
      </div>

      {/* Main form editor */}
      <form method="post" action="/app/form">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <input type="hidden" name="field_ids" value={config.fields.map((f) => f.id).join(',')} />

        {/* Form settings */}
        <div class="bg-white border border-gray-200 rounded-xl p-5 mb-4 space-y-4">
          <h2 class="text-base font-bold">Form settings</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="form_title">Title</label>
              <input
                type="text"
                id="form_title"
                name="form_title"
                value={config.title}
                required
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="form_submit_label">Button text</label>
              <input
                type="text"
                id="form_submit_label"
                name="form_submit_label"
                value={config.submitLabel}
                required
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
            </div>
          </div>
          <div>
            <label class="block text-sm font-bold text-gray-700 mb-1.5" for="form_subtitle">Subtitle <span class="font-normal text-gray-400">(optional)</span></label>
            <input
              type="text"
              id="form_subtitle"
              name="form_subtitle"
              value={config.subtitle ?? ''}
              placeholder="Leave blank to show your business name automatically"
              class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            />
          </div>
        </div>

        {/* Fields */}
        <div class="space-y-3 mb-4">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-bold">Fields</h2>
            <span class="text-xs text-gray-400">{config.fields.length} fields</span>
          </div>

          {config.fields.map((field, idx) => (
            <FieldCard
              field={field}
              index={idx}
              total={config.fields.length}
              csrfToken={csrfToken}
            />
          ))}

          {config.fields.length === 0 && (
            <div class="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center text-sm text-gray-400">
              No fields yet. Add one below.
            </div>
          )}
        </div>

        {/* Add buttons */}
        <div class="flex gap-2 mb-6">
          <button
            type="submit"
            formaction="/app/form/add-field"
            formnovalidate={true}
            class="inline-flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 py-2 px-4 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add field
          </button>
          <button
            type="submit"
            formaction="/app/form/add-heading"
            formnovalidate={true}
            class="inline-flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 py-2 px-4 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h8" />
            </svg>
            Add heading
          </button>
        </div>

        {/* Actions */}
        <div class="bg-white border border-gray-200 rounded-xl p-5 mb-6 space-y-4">
          <h2 class="text-base font-bold">After submission</h2>

          <label class="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="action_notify"
              checked={config.actions.notifyVendor}
              class="accent-grapefruit-700 w-4 h-4"
              value="on"
            />
            <div>
              <span class="text-sm font-bold text-gray-700">Email me when someone enquires</span>
              <p class="text-xs text-gray-400">You'll get an email with their details</p>
            </div>
          </label>

          <label class="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="action_confirm"
              checked={config.actions.confirmationEmail.enabled}
              class="accent-grapefruit-700 w-4 h-4"
              value="on"
            />
            <div>
              <span class="text-sm font-bold text-gray-700">Send AI confirmation email to enquirer</span>
              <p class="text-xs text-gray-400">An AI-written email confirming their enquiry was received</p>
            </div>
          </label>
        </div>

        <button
          type="submit"
          class="w-full bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
        >
          Save form
        </button>
      </form>
    </div>
  )
}

function FieldCard({
  field,
  index,
  total,
  csrfToken,
}: {
  field: FormField
  index: number
  total: number
  csrfToken: string
}) {
  const isHeading = field.type === 'heading'
  const hasOptions = field.type === 'select' || field.type === 'radio'

  return (
    <div class={`bg-white border rounded-xl p-4 ${isHeading ? 'border-gray-300 bg-gray-50' : 'border-gray-200'}`}>
      <div class="flex items-start gap-3">
        {/* Reorder + delete */}
        <div class="flex flex-col gap-1 pt-1 shrink-0">
          {index > 0 && (
            <button type="submit" formaction={`/app/form/move/${field.id}/up`} formnovalidate={true} class="p-1 text-gray-300 hover:text-gray-600" title="Move up">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
              </svg>
            </button>
          )}
          {index < total - 1 && (
            <button type="submit" formaction={`/app/form/move/${field.id}/down`} formnovalidate={true} class="p-1 text-gray-300 hover:text-gray-600" title="Move down">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
        </div>

        {/* Field settings */}
        <div class="flex-1 space-y-3 min-w-0">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-gray-500 mb-1">Label</label>
              <input
                type="text"
                name={`field_label_${field.id}`}
                value={field.label}
                required
                class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
            </div>
            {!isHeading && (
              <div>
                <label class="block text-xs font-bold text-gray-500 mb-1">Type</label>
                <select
                  name={`field_type_${field.id}`}
                  class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                >
                  {FIELD_TYPES.map((t) => (
                    <option value={t.value} selected={t.value === field.type}>{t.label}</option>
                  ))}
                </select>
              </div>
            )}
            {isHeading && (
              <input type="hidden" name={`field_type_${field.id}`} value="heading" />
            )}
          </div>

          {!isHeading && (
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label class="block text-xs font-bold text-gray-500 mb-1">Placeholder</label>
                <input
                  type="text"
                  name={`field_placeholder_${field.id}`}
                  value={field.placeholder ?? ''}
                  class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                />
              </div>
              <div>
                <label class="block text-xs font-bold text-gray-500 mb-1">Width</label>
                <select
                  name={`field_width_${field.id}`}
                  class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                >
                  <option value="full" selected={field.width !== 'half'}>Full</option>
                  <option value="half" selected={field.width === 'half'}>Half</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-bold text-gray-500 mb-1">Maps to</label>
                <select
                  name={`field_mapto_${field.id}`}
                  class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                >
                  <option value="">Custom data</option>
                  {CONTACT_MAPPINGS.map((m) => (
                    <option value={m.value} selected={m.value === field.mapTo}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {!isHeading && (
            <div class="flex items-center gap-4">
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  name={`field_required_${field.id}`}
                  checked={field.required}
                  class="accent-grapefruit-700"
                />
                <span class="text-gray-600">Required</span>
              </label>
            </div>
          )}

          {hasOptions && (
            <div>
              <label class="block text-xs font-bold text-gray-500 mb-1">Options (one per line)</label>
              <textarea
                name={`field_options_${field.id}`}
                rows={3}
                class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              >{(field.options ?? []).join('\n')}</textarea>
            </div>
          )}
        </div>

        {/* Delete */}
        <button
          type="submit"
          formaction={`/app/form/delete/${field.id}`}
          formnovalidate={true}
          class="p-1.5 text-gray-300 hover:text-grapefruit-700 transition-colors shrink-0"
          title="Delete field"
          onclick="return confirm('Delete this field?')"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
