import { Hono } from 'hono'
import type { Env } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { createForm, getForm, listForms, updateForm, deleteForm, listFormSubmissions, getFormSubmission, updateFormSubmission } from '../../db/forms'
import { noimFormConfig } from '../../forms/noim/schema'
import { hasCategory } from '../../lib/categories'
import type { FormConfig, FormStep } from '../../lib/form-schema'
import { defaultFormConfig, generateFieldId } from '../../lib/form-schema'
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

        {/* Fields preview */}
        {form.type !== 'noim' && (
          <div class="bg-white border border-papaya-300/30 rounded-xl p-5 mb-4">
            <h2 class="font-bold text-gray-900 mb-3">Fields ({config.fields.length})</h2>
            <p class="text-xs text-gray-500 mb-3">
              To customise fields, use the <a href="/app/form" class="text-horizon-600 underline">enquiry form editor</a> or edit the JSON config directly.
            </p>
            <div class="space-y-2">
              {config.fields.map((f) => (
                <div class="flex items-center gap-2 text-sm py-1 border-b border-gray-100 last:border-0">
                  <span class="text-xs text-gray-400 w-16">{f.type}</span>
                  <span class="text-gray-900">{f.label}</span>
                  {f.required && <span class="text-red-500 text-xs">*</span>}
                  {f.mapTo && <span class="text-xs bg-green-50 text-green-700 px-1 rounded">&rarr; {f.mapTo}</span>}
                </div>
              ))}
            </div>
          </div>
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

  const data = JSON.parse(sub.data) as Record<string, string>
  const config = JSON.parse(form.config) as FormConfig
  const allFields = config.steps ? config.steps.flatMap(s => s.fields) : config.fields

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
            {Object.entries(data).filter(([k]) => !k.startsWith('_')).map(([key, value]) => {
              const field = allFields.find(f => f.id === key)
              const label = field?.label ?? key
              return (
                <div class="flex gap-4 py-2 border-b border-gray-100 last:border-0">
                  <span class="text-sm font-medium text-gray-600 w-48 flex-shrink-0">{label}</span>
                  <span class="text-sm text-gray-900">{value || '—'}</span>
                </div>
              )
            })}
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

export default forms
