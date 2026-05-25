import { Hono } from 'hono'
import type { Env } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { updateVendor } from '../../db/vendors'
import {
  parseBookingFormConfig,
  validateBookingFormConfig,
  defaultBookingFormConfig,
  generateFieldId,
  FIELD_TYPES,
  CONTACT_MAPPINGS,
} from '../../lib/form-schema'
import type { FormConfig, FormField } from '../../lib/form-schema'

const bookingForm = new Hono<Env>()

bookingForm.use('/app/*', requireAuth, csrf, requireVendor)

bookingForm.get('/app/booking-form', (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const config = parseBookingFormConfig(vendor.booking_form)
  const saved = c.req.query('saved')
  const error = c.req.query('error')

  return c.html(
    <AppLayout title="Booking Form" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <BookingFormEditor config={config} appUrl={c.env.APP_URL} csrfToken={c.get('csrfToken')} saved={!!saved} error={error} />
    </AppLayout>
  )
})

bookingForm.post('/app/booking-form', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()

  try {
    const config = buildConfigFromBody(body as Record<string, string>)
    const validationError = validateBookingFormConfig(config)
    if (validationError) throw new Error(validationError)

    await updateVendor(c.env.DB, vendor.id, {
      booking_form: JSON.stringify(config),
    })

    return c.redirect('/app/booking-form?saved=1')
  } catch (e: any) {
    return c.redirect(`/app/booking-form?error=${encodeURIComponent(e.message)}`)
  }
})

bookingForm.post('/app/booking-form/add-field', async (c) => {
  const vendor = c.get('vendor')!
  const config = parseBookingFormConfig(vendor.booking_form)

  config.fields.push({
    id: generateFieldId(),
    type: 'text',
    label: 'New field',
    width: 'full',
  })

  await updateVendor(c.env.DB, vendor.id, {
    booking_form: JSON.stringify(config),
  })

  return c.redirect('/app/booking-form')
})

bookingForm.post('/app/booking-form/add-heading', async (c) => {
  const vendor = c.get('vendor')!
  const config = parseBookingFormConfig(vendor.booking_form)

  config.fields.push({
    id: generateFieldId(),
    type: 'heading',
    label: 'New section',
  })

  await updateVendor(c.env.DB, vendor.id, {
    booking_form: JSON.stringify(config),
  })

  return c.redirect('/app/booking-form')
})

bookingForm.post('/app/booking-form/move/:fieldId/:direction', async (c) => {
  const vendor = c.get('vendor')!
  const config = parseBookingFormConfig(vendor.booking_form)
  const fieldId = c.req.param('fieldId')
  const direction = c.req.param('direction')

  const idx = config.fields.findIndex((f) => f.id === fieldId)
  if (idx === -1) return c.redirect('/app/booking-form')

  const swap = direction === 'up' ? idx - 1 : idx + 1
  if (swap < 0 || swap >= config.fields.length) return c.redirect('/app/booking-form')

  const temp = config.fields[idx]
  config.fields[idx] = config.fields[swap]
  config.fields[swap] = temp

  await updateVendor(c.env.DB, vendor.id, {
    booking_form: JSON.stringify(config),
  })

  return c.redirect('/app/booking-form')
})

bookingForm.post('/app/booking-form/delete/:fieldId', async (c) => {
  const vendor = c.get('vendor')!
  const config = parseBookingFormConfig(vendor.booking_form)
  const fieldId = c.req.param('fieldId')

  config.fields = config.fields.filter((f) => f.id !== fieldId)

  await updateVendor(c.env.DB, vendor.id, {
    booking_form: JSON.stringify(config),
  })

  return c.redirect('/app/booking-form')
})

bookingForm.post('/app/booking-form/reset', async (c) => {
  const vendor = c.get('vendor')!

  await updateVendor(c.env.DB, vendor.id, {
    booking_form: JSON.stringify(defaultBookingFormConfig()),
  })

  return c.redirect('/app/booking-form?saved=1')
})

export default bookingForm

// ─── Build config from form submission ───

function buildConfigFromBody(body: Record<string, string>): FormConfig {
  const title = (body.form_title ?? 'Confirm your booking').trim()
  const subtitle = (body.form_subtitle ?? '').trim() || undefined
  const submitLabel = (body.form_submit_label ?? 'Confirm booking').trim()

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

function BookingFormEditor({
  config,
  appUrl,
  csrfToken,
  saved,
  error,
}: {
  config: FormConfig
  appUrl: string
  csrfToken: string
  saved: boolean
  error?: string | null
}) {
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

      <p class="text-sm text-gray-500 mb-6">
        This form appears on your booking page when you send a proposal. Clients fill it in to confirm their booking.
      </p>

      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-2 mb-6">
        <form method="post" action="/app/booking-form/reset" class="ml-auto">
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

      {/* Main form editor */}
      <form method="post" action="/app/booking-form">
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
          <form method="post" action="/app/booking-form/add-field" class="inline">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <button
              type="submit"
              class="inline-flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 py-2 px-4 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Add field
            </button>
          </form>
          <form method="post" action="/app/booking-form/add-heading" class="inline">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <button
              type="submit"
              class="inline-flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 py-2 px-4 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h8" />
              </svg>
              Add heading
            </button>
          </form>
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
              <span class="text-sm font-bold text-gray-700">Email me when someone confirms</span>
              <p class="text-xs text-gray-400">You'll get an email when a client fills in the booking form</p>
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
        <div class="flex flex-col gap-1 pt-1 shrink-0">
          {index > 0 && (
            <form method="post" action={`/app/booking-form/move/${field.id}/up`} class="inline">
              <input type="hidden" name="_csrf" value={csrfToken} />
              <button type="submit" class="p-1 text-gray-300 hover:text-gray-600" title="Move up">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                </svg>
              </button>
            </form>
          )}
          {index < total - 1 && (
            <form method="post" action={`/app/booking-form/move/${field.id}/down`} class="inline">
              <input type="hidden" name="_csrf" value={csrfToken} />
              <button type="submit" class="p-1 text-gray-300 hover:text-gray-600" title="Move down">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </form>
          )}
        </div>

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

        <form method="post" action={`/app/booking-form/delete/${field.id}`} class="shrink-0">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <button
            type="submit"
            class="p-1.5 text-gray-300 hover:text-grapefruit-700 transition-colors"
            title="Delete field"
            onclick="return confirm('Delete this field?')"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  )
}
