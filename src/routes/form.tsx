import { Hono } from 'hono'
import type { Env } from '../types'
import { SharedHead } from '../views/head'
import { getFormByToken, createFormSubmission, incrementSubmissionCount, getFormSubmission } from '../db/forms'
import { getVendorById } from '../db/vendors'
import { verifyTurnstile } from '../services/turnstile'
import { rateLimit } from '../middleware/rate-limit'
import { isValidEmail } from '../lib/validation'
import { COUNTRIES } from '../forms/countries'
import type { FormConfig, FormField, FormStep, FormAction, ContactMapping } from '../lib/form-schema'
import { FormEnhancements } from '../lib/form-enhance'
import { t } from '../i18n'

const form = new Hono<Env>()

// ─── Public form render ───

form.get('/form/:token', async (c) => {
  const formRecord = await getFormByToken(c.env.DB, c.req.param('token'))
  if (!formRecord) {
    return c.html(<FormShell embed={c.req.query('embed') === '1'}><p class="text-gray-600">This form is no longer available.</p></FormShell>, 404)
  }

  const vendor = await getVendorById(c.env.DB, formRecord.vendor_id)
  if (!vendor) return c.html(<FormShell embed={false}><p class="text-gray-600">Form unavailable.</p></FormShell>, 404)

  const config = JSON.parse(formRecord.config) as FormConfig
  const embed = c.req.query('embed') === '1'

  return c.html(
    <FormShell embed={embed}>
      <FormRenderer
        config={config}
        formType={formRecord.type}
        vendorName={vendor.business_name}
        siteKey={c.env.TURNSTILE_SITE_KEY}
        token={formRecord.public_token}
        mapsKey={c.env.GOOGLE_MAPS_API_KEY}
      />
    </FormShell>
  )
})

// ─── Public form submission ───

form.post('/form/:token', rateLimit(10, 60), async (c) => {
  const formRecord = await getFormByToken(c.env.DB, c.req.param('token'))
  if (!formRecord) return c.text('Not found', 404)

  const vendor = await getVendorById(c.env.DB, formRecord.vendor_id)
  if (!vendor) return c.text('Not found', 404)

  const config = JSON.parse(formRecord.config) as FormConfig
  const body = await c.req.parseBody()
  const embed = c.req.query('embed') === '1'

  // Honeypot
  if (body.website_url) {
    return c.html(<FormShell embed={embed}><ThankYou title={config.title} vendorName={vendor.business_name} formType={formRecord.type} /></FormShell>)
  }

  // Turnstile verification
  const turnstileToken = typeof body['cf-turnstile-response'] === 'string' ? body['cf-turnstile-response'] : ''
  const ip = c.req.header('cf-connecting-ip') ?? null
  const turnstileOk = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, turnstileToken, ip)

  if (!turnstileOk) {
    return c.html(
      <FormShell embed={embed}>
        <FormRenderer
          config={config}
          formType={formRecord.type}
          vendorName={vendor.business_name}
          siteKey={c.env.TURNSTILE_SITE_KEY}
          token={formRecord.public_token}
          error="Verification failed. Please try again."
          values={body as Record<string, string>}
          mapsKey={c.env.GOOGLE_MAPS_API_KEY}
        />
      </FormShell>
    )
  }

  // Collect form data. Store raw text (capped + trimmed) — output is escaped
  // at render time by JSX (app UI) and escapeHtml in email templates. Encoding
  // here would double-encode in the vendor's UI and the NOIM email/PDF.
  const formData: Record<string, string> = {}
  const allFields = config.steps ? config.steps.flatMap(s => s.fields) : config.fields
  const fieldLabels: Record<string, string> = {}

  for (const field of allFields) {
    if (field.type === 'heading') continue
    fieldLabels[field.id] = field.label
    const rawVal = body[field.id]
    if (rawVal !== undefined && rawVal !== '') {
      formData[field.id] = String(rawVal).slice(0, 2000).trim()
    }
  }

  // Label/value pairs for email notifications (raw values; escaped on render)
  const submittedFields = allFields
    .filter((f) => f.type !== 'heading' && formData[f.id])
    .map((f) => ({ label: f.label, value: formData[f.id] }))

  // Store submission
  const submission = await createFormSubmission(c.env.DB, vendor.id, {
    form_id: formRecord.id,
    data: JSON.stringify(formData),
    ip_address: ip,
    user_agent: c.req.header('user-agent') ?? null,
  })
  await incrementSubmissionCount(c.env.DB, formRecord.id)

  // Execute actions
  const actions = config.actions.actions ?? []
  let contactId: string | null = null

  // Action: create_contact
  if (actions.some(a => a.type === 'create_contact' && a.enabled)) {
    try {
      contactId = await handleCreateContact(c.env.DB, vendor.id, config, formData)
      if (contactId) {
        await c.env.DB.prepare('UPDATE form_submissions SET contact_id = ? WHERE id = ?').bind(contactId, submission.id).run()
      }
    } catch (e: any) {
      console.error('[form] create_contact failed', e.message)
    }
  }

  // Action: notify_vendor
  if (config.actions.notifyVendor) {
    try {
      await c.env.EMAIL_QUEUE.send({
        type: 'form_submission',
        vendorId: vendor.id,
        formId: formRecord.id,
        submissionId: submission.id,
        formTitle: config.title,
        fields: submittedFields,
      })
    } catch (e: any) {
      console.error('[form] notify_vendor failed', e.message)
    }
  }

  // Action: ai_email
  if (actions.some(a => a.type === 'ai_email' && a.enabled) && contactId) {
    try {
      const { draftEnquiryReply } = await import('../services/ai')
      const { resolveSecret } = await import('../services/secrets')
      const anthropicKey = await resolveSecret(c.env.KV, vendor.anthropic_api_key)
      const contactName = [formData.first_name || formData.p1_first_name, formData.last_name || formData.p1_last_name].filter(Boolean).join(' ')
      const draft = await draftEnquiryReply(c.env.AI, {
        vendorName: vendor.business_name,
        vendorCategory: vendor.category,
        contactName,
        weddingDate: formData.wedding_date ?? null,
        weddingLocation: formData.wedding_location ?? null,
        isAvailable: null,
        busynessScore: null,
        notes: null,
      }, anthropicKey)

      if (draft && formData.email) {
        await c.env.DB.prepare(
          `INSERT INTO emails (vendor_id, contact_id, direction, from_email, from_name, to_email, subject, body_text, status, is_system)
           VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?, 'draft', 1)`
        ).bind(
          vendor.id,
          contactId,
          vendor.email_handle ? `${vendor.email_handle}@wedding.computer` : 'noreply@wedding.computer',
          vendor.business_name,
          formData.email,
          `Re: ${config.title} from ${contactName}`,
          draft,
        ).run()
      }
    } catch (e: any) {
      console.error('[form] ai_email failed', e.message)
    }
  }

  // Action: email_recipient (send notification to a specific email)
  const emailRecipientAction = actions.find(a => a.type === 'email_recipient' && a.enabled)
  if (emailRecipientAction) {
    const recipientEmail = emailRecipientAction.recipientEmail || (emailRecipientAction.emailField ? formData[emailRecipientAction.emailField] : null)
    if (recipientEmail && isValidEmail(recipientEmail)) {
      try {
        await c.env.EMAIL_QUEUE.send({
          type: 'form_notification',
          to: recipientEmail,
          formTitle: config.title,
          vendorName: vendor.business_name,
          submissionId: submission.id,
          fields: submittedFields,
        })
      } catch (e: any) {
        console.error('[form] email_recipient failed', e.message)
      }
    }
  }

  // Action: email_submitter (send confirmation to form filler)
  const emailSubmitterAction = actions.find(a => a.type === 'email_submitter' && a.enabled)
  if (emailSubmitterAction) {
    const submitterEmail = emailSubmitterAction.emailField ? formData[emailSubmitterAction.emailField] : formData.email
    if (submitterEmail && isValidEmail(submitterEmail)) {
      try {
        await c.env.EMAIL_QUEUE.send({
          type: 'form_confirmation',
          to: submitterEmail,
          formTitle: config.title,
          vendorName: vendor.business_name,
          formType: formRecord.type,
          fields: submittedFields,
        })
      } catch (e: any) {
        console.error('[form] email_submitter failed', e.message)
      }
    }
  }

  // Action: generate_pdf (NOIM)
  if (formRecord.type === 'noim' && actions.some(a => a.type === 'generate_pdf' && a.enabled)) {
    // PDF generation happens on-demand via download link on thank-you page
  }

  return c.html(
    <FormShell embed={embed}>
      <ThankYou
        title={config.title}
        vendorName={vendor.business_name}
        formType={formRecord.type}
        submissionId={submission.id}
        token={formRecord.public_token}
        showPdfLink={formRecord.type === 'noim' && actions.some(a => a.type === 'generate_pdf' && a.enabled)}
      />
    </FormShell>
  )
})

// ─── NOIM PDF download ───

form.post('/form/:token/pdf', rateLimit(5, 60), async (c) => {
  const formRecord = await getFormByToken(c.env.DB, c.req.param('token'))
  if (!formRecord || formRecord.type !== 'noim') return c.text('Not found', 404)

  const body = await c.req.parseBody()

  // Preferred: regenerate from the stored submission (the thank-you page no
  // longer has the form in the DOM). Fall back to inline _data if provided.
  let data: Record<string, unknown>
  const submissionId = typeof body.submission_id === 'string' ? body.submission_id : ''
  if (submissionId) {
    const submission = await getFormSubmission(c.env.DB, formRecord.vendor_id, submissionId)
    if (!submission || submission.form_id !== formRecord.id) return c.text('Not found', 404)
    try {
      data = JSON.parse(submission.data)
    } catch {
      return c.text('Invalid data', 400)
    }
  } else {
    const dataStr = body._data as string
    if (!dataStr) return c.text('Missing data', 400)
    try {
      data = JSON.parse(dataStr)
    } catch {
      return c.text('Invalid data', 400)
    }
  }

  const { generateNoimPdf } = await import('../forms/noim/pdf-generator')
  const noimPdfBytes = (await import('../forms/noim/noim-blank.pdf')).default

  const pdfBytes = await generateNoimPdf(data, noimPdfBytes)
  const p1Last = String(data.p1_last_name || 'Party1')
  const p2Last = String(data.p2_last_name || 'Party2')

  return new Response(pdfBytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="NOIM-${p1Last}-${p2Last}.pdf"`,
    },
  })
})

// ─── Contact creation helper ───

async function handleCreateContact(
  db: D1Database,
  vendorId: string,
  config: FormConfig,
  formData: Record<string, string>
): Promise<string | null> {
  const allFields = config.steps ? config.steps.flatMap(s => s.fields) : config.fields
  const mapped: Partial<Record<ContactMapping, string>> = {}
  const extra: Record<string, string> = {}

  for (const field of allFields) {
    if (field.type === 'heading') continue
    const val = formData[field.id]
    if (!val) continue
    if (field.mapTo) {
      mapped[field.mapTo] = val
    } else {
      extra[field.label || field.id] = val
    }
  }

  const firstName = mapped.first_name?.trim()
  if (!firstName) return null

  const { createContact } = await import('../storage/contacts')
  const { getStorageWithSecrets } = await import('../storage')
  const vendor = await db.prepare('SELECT * FROM vendor_profiles WHERE id = ?').bind(vendorId).first()
  if (!vendor) return null

  const storage = await getStorageWithSecrets({ DB: db, KV: null as any, STORAGE: null as any } as any, vendor as any)
  const contact = await createContact(storage, db, vendorId, {
    first_name: firstName,
    last_name: mapped.last_name ?? '',
    email: mapped.email ?? null,
    phone: mapped.phone ?? null,
    partner_first_name: mapped.partner_first_name ?? null,
    partner_last_name: mapped.partner_last_name ?? null,
    wedding_date: mapped.wedding_date ?? null,
    wedding_location: mapped.wedding_location ?? null,
    notes: mapped.notes ?? null,
    source: 'form',
    form_data: Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
  })

  const { createActivity } = await import('../db/activities')
  await createActivity(db, contact.id, 'lead', `Submitted form: ${config.title}`)

  return contact.id
}

// ─── Components ───

function FormShell({ children, embed }: { children: any; embed?: boolean }) {
  if (embed) {
    return (
      <html>
        <head>
          <SharedHead title="Form" />
        </head>
        <body class="bg-white p-4">
          {children}
        </body>
      </html>
    )
  }

  return (
    <html>
      <head>
        <SharedHead title="Form" />
      </head>
      <body class="bg-gray-50 min-h-screen">
        <div class="max-w-2xl mx-auto py-8 px-4">
          {children}
        </div>
      </body>
    </html>
  )
}

function FormRenderer({
  config, formType, vendorName, siteKey, token, error, values, mapsKey,
}: {
  config: FormConfig
  formType: string
  vendorName: string
  siteKey: string
  token: string
  error?: string
  values?: Record<string, string>
  mapsKey?: string
}) {
  const isMultiStep = !!(config.steps && config.steps.length > 0)
  const allFields = isMultiStep ? config.steps!.flatMap(s => s.fields) : config.fields

  return (
    <div>
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">{config.title}</h1>
        {config.subtitle && <p class="text-sm text-gray-600 mt-1">{config.subtitle}</p>}
        <p class="text-xs text-gray-400 mt-2">{vendorName}</p>
      </div>

      {error && (
        <div class="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{error}</div>
      )}

      <form method="post" action={`/form/${token}`} id="main-form">
        {/* Honeypot */}
        <div style="position:absolute;left:-9999px" aria-hidden="true">
          <input type="text" name="website_url" tabindex={-1} autocomplete="off" />
        </div>

        {isMultiStep ? (
          <div id="form-steps">
            {config.steps!.map((step, i) => (
              <div class="form-step" data-step={i} style={i === 0 ? {} : { display: 'none' }}>
                <div class="mb-4">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="text-xs bg-horizon-100 text-horizon-700 px-2 py-0.5 rounded-full">Step {i + 1} of {config.steps!.length}</span>
                  </div>
                  <h2 class="text-lg font-bold text-gray-900">{step.title}</h2>
                  {step.description && <p class="text-sm text-gray-600">{step.description}</p>}
                </div>
                <div class="space-y-4">
                  {step.fields.map((field) => (
                    <FieldRenderer field={field} value={values?.[field.id]} />
                  ))}
                  {step.id === 'documents' && (
                    <ul id="noim-doc-checklist" class="space-y-2 text-sm text-gray-800 list-none">
                      <li class="text-gray-400">Complete the earlier steps to see your document list.</li>
                    </ul>
                  )}
                </div>
                <div class="flex justify-between mt-6">
                  {i > 0 && (
                    <button type="button" class="text-sm text-gray-600 hover:text-gray-900 px-4 py-2 border border-gray-200 rounded-lg step-prev">Back</button>
                  )}
                  {i < config.steps!.length - 1 ? (
                    <button type="button" class="ml-auto text-sm text-white bg-horizon-600 hover:bg-horizon-700 px-4 py-2 rounded-lg font-bold step-next">Continue</button>
                  ) : (
                    <div class="ml-auto flex flex-col items-end gap-3">
                      <div class="cf-turnstile" data-sitekey={siteKey} data-theme="light"></div>
                      <button type="submit" class="text-sm text-white bg-horizon-600 hover:bg-horizon-700 px-6 py-2 rounded-lg font-bold">{config.submitLabel}</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div class="space-y-4">
            {config.fields.map((field) => (
              <FieldRenderer field={field} value={values?.[field.id]} />
            ))}
            <div class="mt-4 flex flex-col items-start gap-3">
              <div class="cf-turnstile" data-sitekey={siteKey} data-theme="light"></div>
              <button type="submit" class="text-sm text-white bg-horizon-600 hover:bg-horizon-700 px-6 py-2 rounded-lg font-bold">{config.submitLabel}</button>
            </div>
          </div>
        )}
      </form>

      {/* Turnstile */}
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>

      {/* Multi-step + conditional logic */}
      <script dangerouslySetInnerHTML={{ __html: formLogicScript() }} />

      {/* Location autocomplete + future-date/countdown helpers */}
      <FormEnhancements mapsKey={mapsKey} />
    </div>
  )
}

function FieldRenderer({ field, value }: { field: FormField; value?: string }) {
  if (field.type === 'heading') {
    return <h3 class="text-base font-bold text-gray-900 pt-4 pb-1 border-b border-gray-100">{field.label}</h3>
  }

  const wrapClass = field.width === 'half' ? 'inline-block w-[calc(50%-0.5rem)] align-top' : ''
  const conditions = field.conditions ? JSON.stringify(field.conditions) : undefined

  return (
    <div class={wrapClass} data-field-id={field.id} data-conditions={conditions} style={conditions ? {} : undefined}>
      <label class="block text-sm font-medium text-gray-700 mb-1">
        {field.label}
        {field.required && <span class="text-red-500 ml-0.5">*</span>}
      </label>
      {field.helpText && <p class="text-xs text-gray-500 mb-1">{field.helpText}</p>}

      {field.type === 'textarea' ? (
        <textarea
          name={field.id}
          placeholder={field.placeholder}
          required={field.required}
          class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          rows={3}
          data-title-case={field.titleCase ? 'true' : undefined}
        >{value ?? ''}</textarea>
      ) : field.type === 'select' ? (
        <select name={field.id} required={field.required} class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Select...</option>
          {field.options?.map((opt) => {
            const optValue = typeof opt === 'string' ? opt : opt.value
            const optLabel = typeof opt === 'string' ? opt : opt.label
            return <option value={optValue} selected={value === optValue}>{optLabel}</option>
          })}
        </select>
      ) : field.type === 'radio' ? (
        <div class="flex flex-wrap gap-4">
          {field.options?.map((opt) => {
            const optValue = typeof opt === 'string' ? opt : opt.value
            const optLabel = typeof opt === 'string' ? opt : opt.label
            return (
              <label class="flex items-center gap-2 text-sm">
                <input type="radio" name={field.id} value={optValue} checked={value === optValue} required={field.required} />
                {optLabel}
              </label>
            )
          })}
        </div>
      ) : field.type === 'checkbox' ? (
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" name={field.id} value="yes" checked={value === 'yes'} required={field.required} />
          {field.label}
        </label>
      ) : field.type === 'country' ? (
        <div class="relative">
          <input
            type="text"
            name={field.id}
            value={value ?? ''}
            placeholder="Start typing a country..."
            required={field.required}
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            list={`${field.id}_list`}
            autocomplete="off"
          />
          <datalist id={`${field.id}_list`}>
            {COUNTRIES.map((country) => <option value={country} />)}
          </datalist>
        </div>
      ) : field.type === 'address' ? (
        <input
          type="text"
          name={field.id}
          value={value ?? ''}
          placeholder={field.placeholder || t('forms.address.placeholder')}
          required={field.required}
          class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm address-autocomplete"
          data-title-case={field.titleCase ? 'true' : undefined}
        />
      ) : (
        <input
          type={field.type}
          name={field.id}
          value={value ?? ''}
          placeholder={field.placeholder}
          required={field.required}
          class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          data-title-case={field.titleCase ? 'true' : undefined}
          data-future-date={field.type === 'date' && field.mapTo === 'wedding_date' ? 'true' : undefined}
        />
      )}
    </div>
  )
}

function ThankYou({ title, vendorName, formType, submissionId, token, showPdfLink }: {
  title: string
  vendorName: string
  formType?: string
  submissionId?: string
  token?: string
  showPdfLink?: boolean
}) {
  return (
    <div class="text-center py-8">
      <div class="text-4xl mb-4">&#10003;</div>
      <h2 class="text-xl font-bold text-gray-900 mb-2">Submitted successfully</h2>
      <p class="text-sm text-gray-600 mb-4">Thank you for completing the {title.toLowerCase()} form.</p>
      {showPdfLink && token && submissionId && (
        <div class="mt-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
          <p class="text-sm text-purple-800 mb-2 font-medium">Your NOIM PDF is ready to download.</p>
          <p class="text-xs text-purple-600 mb-3">Click below to generate and download your completed Notice of Intended Marriage.</p>
          <form method="post" action={`/form/${token}/pdf`}>
            <input type="hidden" name="submission_id" value={submissionId} />
            <button
              type="submit"
              class="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-purple-700"
            >
              Download NOIM PDF
            </button>
          </form>
        </div>
      )}
      <p class="text-xs text-gray-400 mt-6">{vendorName}</p>
    </div>
  )
}

function formLogicScript(): string {
  return `
(function() {
  // Build the NOIM document checklist client-side from the current answers.
  // Mirrors buildDocumentChecklist() in forms/noim/pdf-generator.ts.
  function populateDocChecklist(stepEl) {
    var ul = stepEl && stepEl.querySelector('#noim-doc-checklist');
    if (!ul) return;
    function gv(name) { var el = document.querySelector('[name="'+name+'"]'); return el ? (el.value || '').trim() : ''; }
    var p1c = gv('p1_conjugal_status'), p2c = gv('p2_conjugal_status');
    var p1co = gv('p1_birth_country'), p2co = gv('p2_birth_country');
    var docs = [];
    docs.push(p1co === 'Australia' ? 'Official birth certificate (Party 1) — Australian' : 'Official birth certificate (Party 1) — from ' + (p1co || 'country of birth'));
    docs.push(p2co === 'Australia' ? 'Official birth certificate (Party 2) — Australian' : 'Official birth certificate (Party 2) — from ' + (p2co || 'country of birth'));
    docs.push('Government-issued photo ID for each party (passport, driver licence)');
    if (p1c === 'divorced') docs.push('Divorce order/decree absolute (Party 1)');
    if (p2c === 'divorced') docs.push('Divorce order/decree absolute (Party 2)');
    if (p1c === 'widowed') docs.push('Death certificate of former spouse (Party 1)');
    if (p2c === 'widowed') docs.push('Death certificate of former spouse (Party 2)');
    if (p1co && p1co !== 'Australia') docs.push('Certified translation of any non-English documents (Party 1)');
    if (p2co && p2co !== 'Australia') docs.push('Certified translation of any non-English documents (Party 2)');
    function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    ul.innerHTML = docs.map(function(d) {
      return '<li style="display:flex;gap:8px;align-items:flex-start"><span style="color:#16a34a;font-weight:700">✓</span><span>' + esc(d) + '</span></li>';
    }).join('');
  }

  // Multi-step navigation
  var steps = document.querySelectorAll('.form-step');
  if (steps.length > 1) {
    document.addEventListener('click', function(e) {
      if (e.target.classList.contains('step-next')) {
        var current = e.target.closest('.form-step');
        var idx = parseInt(current.getAttribute('data-step'));
        // Validate current step
        var invalid = false;
        current.querySelectorAll('[required]').forEach(function(el) {
          var wrapper = el.closest('[data-field-id]');
          if (wrapper && wrapper.style.display === 'none') return;
          if (el.type === 'radio') {
            var name = el.name;
            if (!current.querySelector('input[name="'+name+'"]:checked')) { el.closest('.flex')?.classList.add('text-red-600'); invalid = true; }
          } else if (!el.value.trim()) {
            el.classList.add('border-red-500'); invalid = true;
          }
        });
        if (invalid) return;
        current.style.display = 'none';
        var next = document.querySelector('[data-step="'+(idx+1)+'"]');
        if (next) { next.style.display = ''; populateDocChecklist(next); }
        window.scrollTo(0,0);
      }
      if (e.target.classList.contains('step-prev')) {
        var current = e.target.closest('.form-step');
        var idx = parseInt(current.getAttribute('data-step'));
        current.style.display = 'none';
        var prev = document.querySelector('[data-step="'+(idx-1)+'"]');
        if (prev) prev.style.display = '';
        window.scrollTo(0,0);
      }
    });
  }

  // Conditional fields
  function updateConditionals() {
    document.querySelectorAll('[data-conditions]').forEach(function(el) {
      var conditions = JSON.parse(el.getAttribute('data-conditions'));
      var visible = conditions.every(function(c) {
        var target = document.querySelector('[name="'+c.field+'"]');
        if (!target) {
          var radios = document.querySelectorAll('[name="'+c.field+'"]');
          var checked = '';
          radios.forEach(function(r) { if (r.checked) checked = r.value; });
          target = { value: checked };
        }
        var val = target.value || '';
        if (target.tagName === 'INPUT' && target.type === 'radio') {
          val = '';
          document.querySelectorAll('[name="'+c.field+'"]').forEach(function(r) { if (r.checked) val = r.value; });
        }
        if (c.operator === 'eq') return val === c.value;
        if (c.operator === 'neq') return val !== c.value;
        if (c.operator === 'in') return c.value.indexOf(val) !== -1;
        return true;
      });
      el.style.display = visible ? '' : 'none';
      if (!visible) {
        el.querySelectorAll('input,select,textarea').forEach(function(inp) { inp.removeAttribute('required'); });
      } else {
        // Restore required based on original
      }
    });
  }

  document.addEventListener('change', updateConditionals);
  document.addEventListener('input', function(e) { setTimeout(updateConditionals, 50); });
  updateConditionals();

  // Title case on blur
  document.addEventListener('blur', function(e) {
    if (e.target.getAttribute && e.target.getAttribute('data-title-case') === 'true') {
      var val = e.target.value;
      if (val) {
        e.target.value = val.replace(/\\b\\w/g, function(c) { return c.toUpperCase(); });
      }
    }
  }, true);

  // Address autocomplete + future-date helpers are injected separately via
  // <FormEnhancements/> so they're shared across every public form.
})();
`
}

export default form
