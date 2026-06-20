import { Hono } from 'hono'
import type { Env } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { createForm, getForm, listForms, updateForm, deleteForm, listFormSubmissions, getFormSubmission, updateFormSubmission, formSubmissionFields } from '../../db/forms'
import { noimFormConfig } from '../../forms/noim/schema'
import { hasCategory } from '../../lib/categories'
import type { FormConfig, FormStep, FormField } from '../../lib/form-schema'
import { defaultFormConfig, generateFieldId, BUILDER_FIELD_TYPES, CONTACT_MAPPINGS, sanitizeBuilderFields, validateBuilderFields } from '../../lib/form-schema'
import { requireEmailHandle } from '../../middleware/email-handle'

const forms = new Hono<Env>()

// Custom forms send email on our domain too — require the handle first. Auth +
// vendor are already applied by the shared /app/* guard chain; this runs after
// them (vendor is in context), and is defensive if it isn't.
forms.use('/app/forms', requireEmailHandle)
forms.use('/app/forms/*', requireEmailHandle)

// ─── List all forms ───

forms.get('/app/forms', async (c) => {
  const vendor = c.get('vendor')!
  const allForms = await listForms(c.env.DB, vendor.id)

  return c.html(
    <AppLayout title="Forms" user={c.get('user')} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-4xl mx-auto">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h1 class="text-2xl font-bold text-gray-900">Forms</h1>
            <p class="text-sm text-gray-600 mt-1">Create forms for enquiries, NOIM collection, and more</p>
          </div>
          <a href="/app/forms/new" class="bg-horizon-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-horizon-700 transition-colors">
            New form
          </a>
        </div>

        {allForms.length === 0 ? (
          <div class="bg-white border border-papaya-300/30 rounded-xl p-8 text-center">
            <p class="text-gray-600 mb-4">You haven't created any forms yet.</p>
            <a href="/app/forms/new" class="text-horizon-600 font-bold hover:underline">Create your first form</a>
          </div>
        ) : (
          <div class="space-y-3">
            {allForms.map((form) => {
              const config = JSON.parse(form.config) as FormConfig
              return (
                <div class="bg-white border border-papaya-300/30 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <div class="flex items-center gap-2">
                      <h3 class="font-bold text-gray-900">{form.title}</h3>
                      <span class={`text-xs px-2 py-0.5 rounded-full ${form.type === 'noim' ? 'bg-purple-100 text-purple-700' : form.type === 'contact' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                        {form.type === 'noim' ? 'NOIM' : form.type === 'contact' ? 'Contact' : 'Custom'}
                      </span>
                      {!form.is_active && <span class="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Inactive</span>}
                    </div>
                    <p class="text-xs text-gray-500 mt-1">
                      {form.submission_count} submission{form.submission_count !== 1 ? 's' : ''}
                      {' '}&middot;{' '}
                      Created {new Date(form.created_at).toLocaleDateString('en-AU')}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <a href={`/app/forms/${form.id}/submissions`} class="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5 border border-gray-200 rounded-lg">
                      Submissions
                    </a>
                    <a href={`/app/forms/${form.id}`} class="text-xs text-horizon-600 hover:text-horizon-700 px-3 py-1.5 border border-horizon-200 rounded-lg">
                      Edit
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppLayout>
  )
})

// ─── New form (choose type) ───

forms.get('/app/forms/new', async (c) => {
  const vendor = c.get('vendor')!

  return c.html(
    <AppLayout title="New Form" user={c.get('user')} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-2xl mx-auto">
        <h1 class="text-2xl font-bold text-gray-900 mb-6">Create a new form</h1>

        <div class="space-y-4">
          <form method="post" action="/app/forms/new">
            <input type="hidden" name="type" value="contact" />
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <button type="submit" class="w-full text-left bg-white border border-papaya-300/30 rounded-xl p-5 hover:border-horizon-600/30 transition-colors cursor-pointer">
              <h3 class="font-bold text-gray-900">Contact / Enquiry form</h3>
              <p class="text-sm text-gray-600 mt-1">Collect enquiries and create leads in your CRM automatically</p>
            </button>
          </form>

          {hasCategory(vendor, 'celebrant') && (
            <form method="post" action="/app/forms/new">
              <input type="hidden" name="type" value="noim" />
              <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
              <button type="submit" class="w-full text-left bg-white border border-purple-200 rounded-xl p-5 hover:border-purple-400 transition-colors cursor-pointer">
                <h3 class="font-bold text-gray-900">Notice of Intended Marriage (NOIM)</h3>
                <p class="text-sm text-gray-600 mt-1">Collect NOIM details from couples and generate a completed PDF</p>
                <span class="inline-block mt-2 text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">Celebrant</span>
              </button>
            </form>
          )}

          <form method="post" action="/app/forms/new">
            <input type="hidden" name="type" value="custom" />
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <button type="submit" class="w-full text-left bg-white border border-papaya-300/30 rounded-xl p-5 hover:border-horizon-600/30 transition-colors cursor-pointer">
              <h3 class="font-bold text-gray-900">Custom form</h3>
              <p class="text-sm text-gray-600 mt-1">Build any form with custom fields, actions, and notifications</p>
            </button>
          </form>
        </div>
      </div>
    </AppLayout>
  )
})

forms.post('/app/forms/new', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()
  const type = (body.type as string) || 'custom'

  let config: FormConfig
  let title: string

  switch (type) {
    case 'noim':
      config = noimFormConfig()
      title = 'Notice of Intended Marriage'
      break
    case 'contact':
      config = defaultFormConfig()
      title = 'Enquiry Form'
      break
    default:
      config = {
        version: 1,
        title: 'Custom Form',
        submitLabel: 'Submit',
        fields: [
          { id: generateFieldId(), type: 'heading', label: 'Your details' },
          { id: 'first_name', type: 'text', label: 'First name', required: true, width: 'half', mapTo: 'first_name' },
          { id: 'last_name', type: 'text', label: 'Last name', required: true, width: 'half', mapTo: 'last_name' },
          { id: 'email', type: 'email', label: 'Email', required: true, mapTo: 'email' },
        ],
        actions: {
          notifyVendor: true,
          confirmationEmail: { enabled: false, mode: 'ai' },
          actions: [{ type: 'create_contact', enabled: true }],
        },
      }
      title = 'Custom Form'
  }

  const form = await createForm(c.env.DB, vendor.id, {
    title,
    type: type as 'custom' | 'noim' | 'contact',
    config: JSON.stringify(config),
  })

  return c.redirect(`/app/forms/${form.id}`)
})

// ─── Edit form ───

forms.get('/app/forms/:id', async (c) => {
  const vendor = c.get('vendor')!
  const form = await getForm(c.env.DB, vendor.id, c.req.param('id'))
  if (!form) return c.text('Not found', 404)

  const config = JSON.parse(form.config) as FormConfig
  const publicUrl = `${c.env.APP_URL}/form/${form.public_token}`
  const saved = c.req.query('saved')
  const buildError = c.req.query('error')

  return c.html(
    <AppLayout title={`Edit: ${form.title}`} user={c.get('user')} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-3xl mx-auto">
        <div class="flex items-center justify-between mb-6">
          <div>
            <a href="/app/forms" class="text-sm text-gray-500 hover:text-gray-700">&larr; All forms</a>
            <h1 class="text-2xl font-bold text-gray-900 mt-1">{form.title}</h1>
          </div>
          <div class="flex items-center gap-2">
            <a href={`/form/${form.public_token}`} target="_blank" class="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5 border border-gray-200 rounded-lg">
              Preview
            </a>
            <a href={`/app/forms/${form.id}/submissions`} class="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5 border border-gray-200 rounded-lg">
              Submissions ({form.submission_count})
            </a>
          </div>
        </div>

        {saved && (
          <div class="bg-horizon-50 border border-horizon-600/20 text-horizon-700 text-sm font-bold rounded-xl p-3 mb-4">
            {saved === 'fields' ? 'Fields saved.' : 'Saved.'}
          </div>
        )}
        {buildError && (
          <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-3 mb-4">
            {decodeURIComponent(buildError)}
          </div>
        )}

        {/* Settings */}
        <form method="post" action={`/app/forms/${form.id}/settings`} class="bg-white border border-papaya-300/30 rounded-xl p-5 mb-4">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1">Form title</label>
              <input type="text" name="title" value={form.title} class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1">Submit button text</label>
              <input type="text" name="submitLabel" value={config.submitLabel} class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div class="mb-4">
            <label class="block text-sm font-bold text-gray-700 mb-1">Subtitle (optional)</label>
            <input type="text" name="subtitle" value={config.subtitle ?? ''} class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Shown below the title" />
          </div>
          <div class="flex items-center gap-4 mb-4">
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_active" value="1" checked={!!form.is_active} class="rounded" />
              Active (accepting submissions)
            </label>
          </div>
          <button type="submit" class="bg-horizon-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-horizon-700">Save settings</button>
        </form>

        {/* Actions */}
        <div class="bg-white border border-papaya-300/30 rounded-xl p-5 mb-4">
          <h2 class="font-bold text-gray-900 mb-3">Actions on submission</h2>
          <form method="post" action={`/app/forms/${form.id}/actions`}>
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <div class="space-y-3">
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" name="notifyVendor" value="1" checked={config.actions.notifyVendor} class="rounded" />
                Email me when someone submits this form
              </label>
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" name="create_contact" value="1" checked={config.actions.actions?.some(a => a.type === 'create_contact' && a.enabled)} class="rounded" />
                Create a contact/lead in my CRM
              </label>
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ai_email" value="1" checked={config.actions.actions?.some(a => a.type === 'ai_email' && a.enabled)} class="rounded" />
                Draft an AI reply based on form contents
              </label>
              {form.type === 'noim' && (
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="generate_pdf" value="1" checked={config.actions.actions?.some(a => a.type === 'generate_pdf' && a.enabled)} class="rounded" />
                  Generate NOIM PDF
                </label>
              )}
              <div>
                <label class="block text-sm text-gray-700 mb-1">
                  Send submission to another email (field name or address)
                </label>
                <input type="text" name="email_recipient" value={config.actions.actions?.find(a => a.type === 'email_recipient')?.recipientEmail ?? ''} class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. assistant@example.com" />
              </div>
            </div>
            <button type="submit" class="mt-4 bg-horizon-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-horizon-700">Save actions</button>
          </form>
        </div>

        {/* Share / Embed */}
        <div class="bg-white border border-papaya-300/30 rounded-xl p-5 mb-4">
          <h2 class="font-bold text-gray-900 mb-3">Share & embed</h2>
          <div class="space-y-3">
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1">Direct link</label>
              <input type="text" readonly value={publicUrl} class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50 font-mono text-xs" />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1">Embed code</label>
              <textarea readonly class="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs bg-gray-50 font-mono" rows={3}>
                {`<iframe src="${publicUrl}?embed=1" width="100%" height="800" frameborder="0"></iframe>`}
              </textarea>
            </div>
          </div>
        </div>

        {/* Field builder */}
        {form.type !== 'noim' && (
          <FormBuilder formId={form.id} fields={config.fields} csrfToken={c.get('csrfToken')} />
        )}

        {form.type === 'noim' && config.steps && (
          <div class="bg-white border border-papaya-300/30 rounded-xl p-5 mb-4">
            <h2 class="font-bold text-gray-900 mb-3">Form steps ({config.steps.length})</h2>
            <div class="space-y-2">
              {config.steps.map((step, i) => (
                <div class="flex items-center gap-2 text-sm py-1 border-b border-gray-100 last:border-0">
                  <span class="text-xs text-gray-400 w-6">{i + 1}</span>
                  <span class="text-gray-900 font-medium">{step.title}</span>
                  <span class="text-xs text-gray-500">({step.fields.length} fields)</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Danger zone */}
        <div class="bg-white border border-red-200 rounded-xl p-5">
          <h2 class="font-bold text-red-700 mb-3">Danger zone</h2>
          <form method="post" action={`/app/forms/${form.id}/delete`} onsubmit="return confirm('Delete this form and all submissions?')">
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <button type="submit" class="text-sm text-red-600 hover:text-red-800 px-3 py-1.5 border border-red-200 rounded-lg">
              Delete form
            </button>
          </form>
        </div>
      </div>
    </AppLayout>
  )
})

// ─── Update settings ───

forms.post('/app/forms/:id/settings', async (c) => {
  const vendor = c.get('vendor')!
  const form = await getForm(c.env.DB, vendor.id, c.req.param('id'))
  if (!form) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  const config = JSON.parse(form.config) as FormConfig
  config.title = (body.title as string) || config.title
  config.submitLabel = (body.submitLabel as string) || config.submitLabel
  config.subtitle = (body.subtitle as string) || undefined

  await updateForm(c.env.DB, vendor.id, form.id, {
    title: (body.title as string) || form.title,
    config: JSON.stringify(config),
    is_active: body.is_active ? 1 : 0,
  })

  return c.redirect(`/app/forms/${form.id}`)
})

// ─── Update actions ───

forms.post('/app/forms/:id/actions', async (c) => {
  const vendor = c.get('vendor')!
  const form = await getForm(c.env.DB, vendor.id, c.req.param('id'))
  if (!form) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  const config = JSON.parse(form.config) as FormConfig

  config.actions.notifyVendor = !!body.notifyVendor

  const actions: FormConfig['actions']['actions'] = []
  if (body.create_contact) actions.push({ type: 'create_contact', enabled: true })
  if (body.ai_email) actions.push({ type: 'ai_email', enabled: true })
  if (body.generate_pdf) actions.push({ type: 'generate_pdf', enabled: true })
  if (body.email_recipient && (body.email_recipient as string).trim()) {
    actions.push({ type: 'email_recipient', enabled: true, recipientEmail: (body.email_recipient as string).trim() })
  }

  config.actions.actions = actions
  await updateForm(c.env.DB, vendor.id, form.id, { config: JSON.stringify(config) })

  return c.redirect(`/app/forms/${form.id}`)
})

// ─── Update fields (modern builder) ───

forms.post('/app/forms/:id/build', async (c) => {
  const vendor = c.get('vendor')!
  const form = await getForm(c.env.DB, vendor.id, c.req.param('id'))
  if (!form) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  let raw: unknown = []
  try { raw = JSON.parse(String(body.fields ?? '[]')) } catch { raw = [] }

  const fields = sanitizeBuilderFields(raw)
  // sanitizeBuilderFields drops fields with a blank label; if the client sent
  // more field objects than survived, one lost its label — surface that rather
  // than silently deleting it on a "saved" confirmation.
  const sentCount = Array.isArray(raw) ? raw.filter((r) => r && typeof r === 'object').length : 0
  const error = fields.length < sentCount ? 'Every field needs a label.' : validateBuilderFields(fields)
  if (error) return c.redirect(`/app/forms/${form.id}?error=${encodeURIComponent(error)}#fields`)

  const config = JSON.parse(form.config) as FormConfig
  config.fields = fields
  // The builder edits a flat field list; custom forms don't use steps.
  if (form.type !== 'noim') delete config.steps

  await updateForm(c.env.DB, vendor.id, form.id, { config: JSON.stringify(config) })
  return c.redirect(`/app/forms/${form.id}?saved=fields#fields`)
})

// ─── Delete form ───

forms.post('/app/forms/:id/delete', async (c) => {
  const vendor = c.get('vendor')!
  await deleteForm(c.env.DB, vendor.id, c.req.param('id'))
  return c.redirect('/app/forms')
})

// ─── Submissions ───

forms.get('/app/forms/:id/submissions', async (c) => {
  const vendor = c.get('vendor')!
  const form = await getForm(c.env.DB, vendor.id, c.req.param('id'))
  if (!form) return c.text('Not found', 404)

  const submissions = await listFormSubmissions(c.env.DB, vendor.id, form.id)

  return c.html(
    <AppLayout title={`Submissions: ${form.title}`} user={c.get('user')} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-4xl mx-auto">
        <div class="mb-6">
          <a href={`/app/forms/${form.id}`} class="text-sm text-gray-500 hover:text-gray-700">&larr; {form.title}</a>
          <h1 class="text-2xl font-bold text-gray-900 mt-1">Submissions</h1>
          <p class="text-sm text-gray-600">{submissions.length} submission{submissions.length !== 1 ? 's' : ''}</p>
        </div>

        {submissions.length === 0 ? (
          <div class="bg-white border border-papaya-300/30 rounded-xl p-8 text-center">
            <p class="text-gray-600">No submissions yet.</p>
          </div>
        ) : (
          <div class="space-y-3">
            {submissions.map((sub) => {
              const data = JSON.parse(sub.data) as Record<string, string>
              const name = [data.first_name || data.p1_first_name, data.last_name || data.p1_last_name].filter(Boolean).join(' ') || 'Anonymous'
              const email = data.email || data.couple_email || ''
              return (
                <a href={`/app/forms/${form.id}/submissions/${sub.id}`} class="block bg-white border border-papaya-300/30 rounded-xl p-4 hover:border-horizon-600/30 transition-colors">
                  <div class="flex items-center justify-between">
                    <div>
                      <span class="font-bold text-gray-900 text-sm">{name}</span>
                      {email && <span class="text-xs text-gray-500 ml-2">{email}</span>}
                    </div>
                    <div class="flex items-center gap-2">
                      <span class={`text-xs px-2 py-0.5 rounded-full ${sub.status === 'submitted' ? 'bg-blue-100 text-blue-700' : sub.status === 'reviewed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                        {sub.status}
                      </span>
                      <span class="text-xs text-gray-400">{new Date(sub.created_at).toLocaleDateString('en-AU')}</span>
                    </div>
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </div>
    </AppLayout>
  )
})

// ─── View single submission ───

forms.get('/app/forms/:id/submissions/:subId', async (c) => {
  const vendor = c.get('vendor')!
  const form = await getForm(c.env.DB, vendor.id, c.req.param('id'))
  if (!form) return c.text('Not found', 404)

  const sub = await getFormSubmission(c.env.DB, vendor.id, c.req.param('subId'))
  if (!sub) return c.text('Not found', 404)

  const rows = formSubmissionFields(form.config, sub.data)

  if (sub.status === 'submitted') {
    await updateFormSubmission(c.env.DB, vendor.id, sub.id, { status: 'reviewed' })
  }

  return c.html(
    <AppLayout title="Submission Detail" user={c.get('user')} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-3xl mx-auto">
        <div class="mb-6">
          <a href={`/app/forms/${form.id}/submissions`} class="text-sm text-gray-500 hover:text-gray-700">&larr; All submissions</a>
          <h1 class="text-2xl font-bold text-gray-900 mt-1">Submission</h1>
          <p class="text-xs text-gray-500">
            Submitted {new Date(sub.created_at).toLocaleString('en-AU')}
            {sub.ip_address && ` from ${sub.ip_address}`}
          </p>
        </div>

        <div class="bg-white border border-papaya-300/30 rounded-xl p-5">
          <div class="space-y-3">
            {rows.filter((r) => !r.label.startsWith('_')).map((r) => (
              <div class="flex gap-4 py-2 border-b border-gray-100 last:border-0">
                <span class="text-sm font-medium text-gray-600 w-48 flex-shrink-0">{r.label}</span>
                <span class="text-sm text-gray-900">
                  {r.file ? (
                    <a href={`/form-file/${r.file.id}`} target="_blank" rel="noopener" class="text-horizon-600 hover:underline font-medium">{r.file.name} &darr;</a>
                  ) : (r.value || '—')}
                </span>
              </div>
            ))}
          </div>
        </div>

        {sub.contact_id && (
          <div class="mt-4">
            <a href={`/app/contacts/${sub.contact_id}`} class="text-sm text-horizon-600 hover:underline">View linked contact &rarr;</a>
          </div>
        )}
      </div>
    </AppLayout>
  )
})

// ─── Modern client-side field builder ───
//
// A Tally-style editor for a custom form's fields: an add-field menu with typed
// icons, inline label editing, per-type settings, drag/▲▼ reorder, and delete.
// State lives in the browser; on save the whole fields array is posted as JSON
// to /app/forms/:id/build, where it's sanitised + validated server-side.

function FormBuilder({ formId, fields, csrfToken }: { formId: string; fields: FormField[]; csrfToken: string }) {
  const initial = fields.map((f) => ({
    ...f,
    options: Array.isArray(f.options)
      ? f.options.map((o) => (typeof o === 'string' ? o : o.value)).join('\n')
      : f.options,
  }))
  const data = { fields: initial, types: BUILDER_FIELD_TYPES, mappings: CONTACT_MAPPINGS }
  return (
    <div class="bg-white border border-papaya-300/30 rounded-xl p-5 mb-4" id="fields">
      <h2 class="font-bold text-gray-900 mb-3">Fields (<span id="fb-count">{fields.length}</span>)</h2>
      <noscript><p class="text-sm text-gray-500">Enable JavaScript to edit this form's fields.</p></noscript>

      <div id="fb-root">
        <div id="fb-list" class="space-y-3"></div>
        <div class="relative mt-3">
          <button type="button" data-act="add" class="w-full border-2 border-dashed border-gray-200 text-gray-500 hover:border-horizon-400 hover:text-horizon-600 rounded-xl py-3 text-sm font-bold transition-colors">+ Add field</button>
          <div id="fb-menu" class="hidden absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-2 max-h-80 overflow-y-auto"></div>
        </div>
      </div>

      <form method="post" action={`/app/forms/${formId}/build`} id="fb-form" class="mt-4">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <input type="hidden" name="fields" id="fb-fields-input" />
        <button type="submit" id="fb-save" class="bg-horizon-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-horizon-700 transition-colors">Save fields</button>
      </form>

      <script type="application/json" id="fb-data" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />
      <script dangerouslySetInnerHTML={{ __html: formBuilderScript() }} />
    </div>
  )
}

function formBuilderScript(): string {
  return `
(function(){
  var box = document.getElementById('fields'); if(!box) return;
  var DATA = {}; try { DATA = JSON.parse(document.getElementById('fb-data').textContent); } catch(e){}
  var TYPES = DATA.types || [], MAPPINGS = DATA.mappings || [];
  var fields = (DATA.fields || []).map(normalize);

  var list = document.getElementById('fb-list');
  var menu = document.getElementById('fb-menu');
  var countEl = document.getElementById('fb-count');
  var input = document.getElementById('fb-fields-input');
  var form = document.getElementById('fb-form');
  var root = document.getElementById('fb-root');

  var INCLS = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm';
  var OPTION_TYPES = {select:1, radio:1, multiselect:1};
  var TEXTY = {text:1,textarea:1,email:1,tel:1,number:1,url:1,date:1,time:1,address:1,country:1};
  var TYPE_LABEL = {}, TYPE_ICON = {};
  TYPES.forEach(function(t){ TYPE_LABEL[t.value]=t.label; TYPE_ICON[t.value]=t.icon; });

  function gen(){ return 'f_' + Math.random().toString(36).slice(2,8); }
  function normalize(f){
    f = Object.assign({}, f);
    if (!f.id) f.id = gen();
    if (!f.type) f.type = 'text';
    if (Array.isArray(f.options)) f.options = f.options.map(function(o){ return typeof o==='string'?o:(o&&o.value)||''; }).join('\\n');
    return f;
  }
  function byId(id){ for (var i=0;i<fields.length;i++) if (fields[i].id===id) return fields[i]; return null; }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function field(label, control){ return '<div><label class="block text-xs font-bold text-gray-500 mb-1">'+esc(label)+'</label>'+control+'</div>'; }

  function typeSelectHtml(cur){
    var groups = {}, order = [];
    TYPES.forEach(function(t){ if(!groups[t.group]){groups[t.group]=[];order.push(t.group);} groups[t.group].push(t); });
    var html = '<select data-prop="type" class="text-xs font-bold text-gray-500 bg-transparent border-0 focus:ring-0 cursor-pointer shrink-0 max-w-[7rem]">';
    order.forEach(function(g){
      html += '<optgroup label="'+esc(g)+'">';
      groups[g].forEach(function(t){ html += '<option value="'+t.value+'"'+(t.value===cur?' selected':'')+'>'+esc(t.label)+'</option>'; });
      html += '</optgroup>';
    });
    return html + '</select>';
  }
  function mapSelectHtml(){
    var html = '<select data-prop="mapTo" class="'+INCLS+'"><option value="">Custom data</option>';
    MAPPINGS.forEach(function(m){ html += '<option value="'+esc(m.value)+'">'+esc(m.label)+'</option>'; });
    return html + '</select>';
  }
  function iconSvg(d, cls){ return '<svg class="'+cls+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" stroke-linejoin="round" d="'+d+'"/></svg>'; }

  function cardHtml(f){
    var isHeading = f.type==='heading';
    var settings = '';
    if (!isHeading){
      var rows = '';
      if (TEXTY[f.type]) rows += field('Placeholder', '<input data-prop="placeholder" class="'+INCLS+'">');
      if (OPTION_TYPES[f.type]) rows += field('Options (one per line)', '<textarea data-prop="options" rows="3" class="'+INCLS+'"></textarea>');
      if (f.type==='rating') rows += field('Number of stars', '<input data-prop="max" type="number" min="3" max="10" class="'+INCLS+'">');
      if (f.type==='scale'){
        rows += '<div class="grid grid-cols-2 gap-2">'+field('From','<input data-prop="min" type="number" min="0" max="1" class="'+INCLS+'">')+field('To','<input data-prop="max" type="number" min="2" max="11" class="'+INCLS+'">')+'</div>';
        rows += '<div class="grid grid-cols-2 gap-2">'+field('Low label','<input data-prop="minLabel" class="'+INCLS+'">')+field('High label','<input data-prop="maxLabel" class="'+INCLS+'">')+'</div>';
      }
      if (f.type==='file') rows += field('Accepted files (hint)', '<input data-prop="accept" placeholder="e.g. PDFs and images" class="'+INCLS+'">');
      rows += field('Help text', '<input data-prop="helpText" class="'+INCLS+'">');
      rows += '<div class="grid grid-cols-2 gap-2">'+field('Width','<select data-prop="width" class="'+INCLS+'"><option value="full">Full</option><option value="half">Half</option></select>')+field('Maps to', mapSelectHtml())+'</div>';
      rows += '<label class="flex items-center gap-2 text-sm mt-1"><input type="checkbox" data-prop="required" class="accent-horizon-600"> Required</label>';
      settings = '<div class="fb-body hidden mt-3 pt-3 border-t border-gray-100 space-y-2">'+rows+'</div>';
    }
    return '<div class="fb-card bg-white border border-gray-200 rounded-xl p-3" data-fid="'+f.id+'">'
      + '<div class="flex items-center gap-2">'
      +   '<span class="fb-handle cursor-grab text-gray-300 hover:text-gray-500 shrink-0" title="Drag to reorder"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg></span>'
      +   '<span class="text-gray-400 shrink-0">'+iconSvg(TYPE_ICON[f.type]||'', 'w-4 h-4')+'</span>'
      +   '<input data-prop="label" placeholder="'+(isHeading?'Section heading':'Field label')+'" class="flex-1 min-w-0 font-medium text-gray-900 text-sm bg-transparent border-0 focus:ring-0 px-0">'
      +   typeSelectHtml(f.type)
      +   '<button type="button" data-act="up" class="text-gray-400 hover:text-gray-700 shrink-0 px-1" title="Move up">&#9650;</button>'
      +   '<button type="button" data-act="down" class="text-gray-400 hover:text-gray-700 shrink-0 px-1" title="Move down">&#9660;</button>'
      +   (isHeading ? '' : '<button type="button" data-act="toggle" class="text-gray-400 hover:text-gray-700 shrink-0" title="Settings">'+iconSvg('M10.3 3.3a1 1 0 011.4 0l.5.6a1 1 0 00.9.3 1 1 0 011.2.8l.1.8a1 1 0 00.6.6 1 1 0 01.5 1.4l-.4.7a1 1 0 000 .9l.4.7a1 1 0 01-.5 1.4 1 1 0 00-.6.6l-.1.8a1 1 0 01-1.2.8 1 1 0 00-.9.3l-.5.6a1 1 0 01-1.4 0M12 9a3 3 0 100 6 3 3 0 000-6z','w-4 h-4')+'</button>')
      +   '<button type="button" data-act="del" class="text-gray-300 hover:text-red-500 shrink-0" title="Delete">'+iconSvg('M6 7h12M9 7V5h6v2m-1 0v12H10V7M5 7l1 13h12l1-13','w-4 h-4')+'</button>'
      + '</div>'
      + settings
      + '</div>';
  }

  function setVal(card, prop, val){ var el = card.querySelector('[data-prop="'+prop+'"]'); if(el) el.value = (val==null?'':val); }
  function setChk(card, prop, on){ var el = card.querySelector('[data-prop="'+prop+'"]'); if(el) el.checked = !!on; }

  function render(){
    list.innerHTML = fields.map(cardHtml).join('');
    fields.forEach(function(f){
      var card = list.querySelector('.fb-card[data-fid="'+f.id+'"]'); if(!card) return;
      setVal(card,'label',f.label); setVal(card,'placeholder',f.placeholder); setVal(card,'options',f.options);
      setVal(card,'helpText',f.helpText); setVal(card,'width',f.width||'full'); setVal(card,'mapTo',f.mapTo);
      setVal(card,'max',f.max); setVal(card,'min',f.min); setVal(card,'minLabel',f.minLabel); setVal(card,'maxLabel',f.maxLabel);
      setVal(card,'accept',f.accept); setChk(card,'required',f.required);
    });
    if (countEl) countEl.textContent = fields.length;
  }

  function onEdit(el){
    if (!el || !el.getAttribute) return;
    var prop = el.getAttribute('data-prop'); if(!prop || prop==='type') return;
    var card = el.closest('.fb-card'); if(!card) return;
    var f = byId(card.getAttribute('data-fid')); if(!f) return;
    f[prop] = (el.type==='checkbox') ? el.checked : el.value;
  }
  root.addEventListener('input', function(e){ onEdit(e.target); });
  root.addEventListener('change', function(e){
    var el = e.target;
    if (el.getAttribute && el.getAttribute('data-prop')==='type'){
      var card = el.closest('.fb-card'); var f = card && byId(card.getAttribute('data-fid')); if(!f) return;
      f.type = el.value;
      if (f.type==='rating' && !f.max) f.max = 5;
      if (f.type==='scale'){ if(f.min==null||f.min==='')f.min=1; if(f.max==null||f.max==='')f.max=10; }
      if (OPTION_TYPES[f.type] && !f.options) f.options = 'Option 1\\nOption 2';
      render();
    } else { onEdit(el); }
  });

  root.addEventListener('click', function(e){
    var btn = e.target.closest('[data-act]'); if(!btn) return;
    var act = btn.getAttribute('data-act');
    if (act==='add'){ toggleMenu(); return; }
    if (act==='addtype'){ addField(btn.getAttribute('data-type')); toggleMenu(false); return; }
    var card = btn.closest('.fb-card'); if(!card) return;
    var id = card.getAttribute('data-fid');
    if (act==='del'){ if(confirm('Delete this field?')){ fields = fields.filter(function(f){return f.id!==id;}); render(); } }
    else if (act==='up'){ move(id,-1); }
    else if (act==='down'){ move(id,1); }
    else if (act==='toggle'){ var b=card.querySelector('.fb-body'); if(b) b.classList.toggle('hidden'); }
  });

  function move(id, dir){
    var i = fields.findIndex(function(f){return f.id===id;}); var j = i+dir;
    if (i<0||j<0||j>=fields.length) return;
    var t = fields[i]; fields[i]=fields[j]; fields[j]=t; render();
  }
  function addField(type){
    var f = { id: gen(), type: type, label: TYPE_LABEL[type]||'Field', width:'full' };
    if (type==='heading') f.label = 'Section heading';
    if (type==='rating') f.max = 5;
    if (type==='scale'){ f.min=1; f.max=10; }
    if (OPTION_TYPES[type]) f.options = 'Option 1\\nOption 2';
    fields.push(f); render();
    var card = list.querySelector('.fb-card[data-fid="'+f.id+'"]');
    if (card){ card.scrollIntoView({block:'center'}); var b=card.querySelector('.fb-body'); if(b) b.classList.remove('hidden'); var lab=card.querySelector('[data-prop="label"]'); if(lab) lab.focus(); }
  }

  function menuHtml(){
    var groups = {}, order = [];
    TYPES.forEach(function(t){ if(!groups[t.group]){groups[t.group]=[];order.push(t.group);} groups[t.group].push(t); });
    return order.map(function(g){
      return '<div class="px-2 pt-2 pb-1 text-xs font-bold text-gray-400 uppercase tracking-wide">'+esc(g)+'</div>'
        + '<div class="grid grid-cols-2 gap-1">'
        + groups[g].map(function(t){
            return '<button type="button" data-act="addtype" data-type="'+t.value+'" class="flex items-center gap-2 text-left px-2 py-2 rounded-lg hover:bg-papaya-50 text-sm text-gray-700">'
              + '<span class="text-gray-400 shrink-0">'+iconSvg(t.icon,'w-4 h-4')+'</span>'+esc(t.label)+'</button>';
          }).join('') + '</div>';
    }).join('');
  }
  var menuOpen = false;
  function toggleMenu(force){
    menuOpen = (force===undefined) ? !menuOpen : force;
    if (menuOpen){ menu.innerHTML = menuHtml(); menu.classList.remove('hidden'); } else menu.classList.add('hidden');
  }
  document.addEventListener('click', function(e){ if(menuOpen && !menu.contains(e.target) && !e.target.closest('[data-act="add"]')) toggleMenu(false); });

  // drag reorder, initiated from the handle
  var dragId = null;
  list.addEventListener('mousedown', function(e){ var h=e.target.closest('.fb-handle'); if(h){ var c=h.closest('.fb-card'); if(c) c.setAttribute('draggable','true'); } });
  list.addEventListener('dragstart', function(e){ var c=e.target.closest('.fb-card'); if(c){ dragId=c.getAttribute('data-fid'); c.style.opacity='0.4'; } });
  list.addEventListener('dragend', function(e){ var c=e.target.closest('.fb-card'); if(c){ c.style.opacity=''; c.removeAttribute('draggable'); } dragId=null; });
  list.addEventListener('dragover', function(e){ e.preventDefault(); });
  list.addEventListener('drop', function(e){
    e.preventDefault(); var over=e.target.closest('.fb-card'); if(!over||!dragId) return;
    var overId=over.getAttribute('data-fid'); if(overId===dragId) return;
    var from=fields.findIndex(function(f){return f.id===dragId;});
    var to=fields.findIndex(function(f){return f.id===overId;});
    if(from<0||to<0) return;
    var moved=fields.splice(from,1)[0]; fields.splice(to,0,moved); render();
  });

  form.addEventListener('submit', function(){ input.value = JSON.stringify(fields); });
  render();
})();
`
}

export default forms
