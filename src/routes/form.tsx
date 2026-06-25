import { Hono } from 'hono'
import type { Bindings, Env, VendorProfile } from '../types'
import { SharedHead } from '../views/head'
import type { HeadMeta } from '../views/head'
import { getFormByToken, getFormSendByToken, createFormSubmission, createFormFile, formSubmissionFields, incrementSubmissionCount, getFormSubmission } from '../db/forms'
import type { Form, FormSend } from '../types'
import { isAllowedUpload, uploadExt, ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from '../lib/upload'

const FILE_ACCEPT = [...ALLOWED_UPLOAD_TYPES].join(',')
import { getVendorById } from '../db/vendors'
import { verifyTurnstile } from '../services/turnstile'
import { rateLimit } from '../middleware/rate-limit'
import { isValidEmail } from '../lib/validation'
import { COUNTRIES } from '../forms/countries'
import type { FormConfig, FormField, FormStep, FormAction, ContactMapping } from '../lib/form-schema'
import { configHasAddressField, configHasFileField } from '../lib/form-schema'
import { FormEnhancements } from '../lib/form-enhance'
import { t } from '../i18n'
import { BrandThemeHead, BrandLogo, parseBrandTheme, formLogoUrl, formOgImage } from '../lib/form-theme'
import type { BrandTheme } from '../lib/form-theme'
import { withDoctype } from '../views/document'

const form = new Hono<Env>()

// ─── Public form render ───

// A /form/:token URL is either a form's own public_token (vendor-global use) or
// a "send to a couple" token, which also carries the wedding the response
// belongs to. Resolve to the form to render plus the optional send context.
async function resolveFormToken(
  db: D1Database,
  token: string
): Promise<{ form: Form; send: FormSend | null } | null> {
  const sent = await getFormSendByToken(db, token)
  if (sent) return { form: sent.form, send: sent.send }
  const form = await getFormByToken(db, token)
  return form ? { form, send: null } : null
}

// Per-recipient daily cap for the submitter-facing confirmation email. The
// public submitter chooses this recipient, so bound how much mail any one
// address can be sent from our domain (stops the receipt being used to spam a
// chosen victim). Generous for legitimate re-submits. Returns true when over.
async function confirmationCapReached(kv: KVNamespace, email: string, limit = 5): Promise<boolean> {
  const key = `rl:formconf:${new Date().toISOString().slice(0, 10)}:${email.toLowerCase()}`
  const n = parseInt((await kv.get(key)) ?? '0', 10)
  if (n >= limit) return true
  await kv.put(key, String(n + 1), { expirationTtl: 60 * 60 * 25 })
  return false
}

// Coerce a parsed multipart body to plain strings for re-rendering a failed
// submission (arrays → joined; File objects dropped — file inputs re-prompt).
function toStringValues(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'string') out[k] = v
    else if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string').join(', ')
  }
  return out
}

form.get('/form/:token', async (c) => {
  const token = c.req.param('token')
  const resolved = await resolveFormToken(c.env.DB, token)
  if (!resolved) {
    return c.html(<FormShell embed={c.req.query('embed') === '1'}><p class="text-gray-600">This form is no longer available.</p></FormShell>, 404)
  }
  const formRecord = resolved.form

  const vendor = await getVendorById(c.env.DB, formRecord.vendor_id)
  if (!vendor) return c.html(<FormShell embed={false}><p class="text-gray-600">Form unavailable.</p></FormShell>, 404)

  const config = JSON.parse(formRecord.config) as FormConfig
  const embed = c.req.query('embed') === '1'
  const theme = parseBrandTheme(vendor.brand_theme)
  const logoUrl = formLogoUrl(vendor)
  const meta: HeadMeta = {
    title: 'Form',
    ogTitle: `${config.title} · ${vendor.business_name}`,
    ogDescription: config.subtitle ?? `${config.title} — ${vendor.business_name}.`,
    ogUrl: `${c.env.APP_URL}/form/${token}`,
    ogImageAlt: vendor.business_name,
    noindex: true,
    ...formOgImage(vendor, c.env.APP_URL),
  }

  return c.html(
    <FormShell embed={embed} theme={theme} logoUrl={logoUrl} meta={meta}>
      <FormRenderer
        config={config}
        formType={formRecord.type}
        vendorName={vendor.business_name}
        siteKey={c.env.TURNSTILE_SITE_KEY}
        token={token}
        mapsKey={c.env.GOOGLE_MAPS_API_KEY}
      />
    </FormShell>
  )
})

// ─── Public form submission ───

form.post('/form/:token', rateLimit(10, 60), async (c) => {
  const token = c.req.param('token')
  const resolved = await resolveFormToken(c.env.DB, token)
  if (!resolved) return c.text('Not found', 404)
  const formRecord = resolved.form
  const send = resolved.send

  const vendor = await getVendorById(c.env.DB, formRecord.vendor_id)
  if (!vendor) return c.text('Not found', 404)

  const config = JSON.parse(formRecord.config) as FormConfig
  // all:true so multi-select checkboxes arrive as arrays; file fields arrive as File objects.
  const body = await c.req.parseBody({ all: true })
  const embed = c.req.query('embed') === '1'
  const theme = parseBrandTheme(vendor.brand_theme)
  const logoUrl = formLogoUrl(vendor)

  // Honeypot
  if (body.website_url) {
    return c.html(<FormShell embed={embed} theme={theme} logoUrl={logoUrl}><ThankYou title={config.title} vendorName={vendor.business_name} formType={formRecord.type} /></FormShell>)
  }

  // Turnstile verification
  const turnstileToken = typeof body['cf-turnstile-response'] === 'string' ? body['cf-turnstile-response'] : ''
  const ip = c.req.header('cf-connecting-ip') ?? null
  const turnstileOk = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, turnstileToken, ip)

  if (!turnstileOk) {
    return c.html(
      <FormShell embed={embed} theme={theme} logoUrl={logoUrl}>
        <FormRenderer
          config={config}
          formType={formRecord.type}
          vendorName={vendor.business_name}
          siteKey={c.env.TURNSTILE_SITE_KEY}
          token={token}
          error="Verification failed. Please try again."
          values={toStringValues(body)}
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
  const fileFields: FormField[] = []

  for (const field of allFields) {
    if (field.type === 'heading') continue
    if (field.type === 'file') { fileFields.push(field); continue } // validated + uploaded below
    const rawVal = body[field.id]
    if (field.type === 'multiselect') {
      // Only accept values that are actually configured options, cap the count,
      // and cap the joined length — a public submitter can otherwise post
      // thousands of repeated/arbitrary values to bloat the stored row + emails.
      const arr = Array.isArray(rawVal) ? rawVal : rawVal !== undefined && rawVal !== '' ? [rawVal] : []
      const allowed = new Set((field.options ?? []).map((o) => (typeof o === 'string' ? o : o.value)))
      const vals = arr
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter((x) => x && allowed.has(x))
        .slice(0, 50)
      if (vals.length) formData[field.id] = vals.join(', ').slice(0, 2000)
    } else if (typeof rawVal === 'string' && rawVal !== '') {
      formData[field.id] = rawVal.slice(0, 2000).trim()
    }
  }

  // Validate uploaded files before committing anything: a chosen file that is
  // too large / unsupported is an error (not a silent drop), and a missing
  // file for a required field is an error too. Keep the valid File objects to
  // upload after the submission row exists.
  const validFiles = new Map<string, File>()
  const errors: string[] = []
  for (const field of fileFields) {
    const raw = body[field.id]
    const file = Array.isArray(raw) ? raw.find((x) => x instanceof File && x.size > 0) : raw
    if (file instanceof File && file.size > 0) {
      if (isAllowedUpload(file)) validFiles.set(field.id, file)
      else errors.push(`${field.label}: that file is too large or an unsupported type (max 10MB).`)
    } else if (field.required && !field.conditions) {
      errors.push(`${field.label} is required.`)
    }
  }

  // Server-side "required" enforcement for the widget types whose hidden inputs
  // the browser can't validate (rating/scale/multiselect). Skip conditional
  // fields, whose visibility is decided client-side.
  for (const field of allFields) {
    if (field.type !== 'rating' && field.type !== 'scale' && field.type !== 'multiselect') continue
    if (field.required && !field.conditions && !formData[field.id]) {
      errors.push(`${field.label} is required.`)
    }
  }

  if (errors.length > 0) {
    return c.html(
      <FormShell embed={embed} theme={theme} logoUrl={logoUrl}>
        <FormRenderer
          config={config}
          formType={formRecord.type}
          vendorName={vendor.business_name}
          siteKey={c.env.TURNSTILE_SITE_KEY}
          token={token}
          error={errors[0]}
          values={toStringValues(body)}
          mapsKey={c.env.GOOGLE_MAPS_API_KEY}
        />
      </FormShell>
    )
  }

  // Store submission. When this came through a "send to a couple" link, stamp
  // the wedding so it surfaces on the wedding page for the couple + vendor.
  const submission = await createFormSubmission(c.env.DB, vendor.id, {
    form_id: formRecord.id,
    data: JSON.stringify(formData),
    ip_address: ip,
    user_agent: c.req.header('user-agent') ?? null,
    wedding_id: send?.wedding_id ?? null,
    form_send_id: send?.id ?? null,
  })
  await incrementSubmissionCount(c.env.DB, formRecord.id)

  // Upload the validated files now that we have a submission id to scope them
  // to. Each goes to R2 + a form_files row; the field's stored value becomes a
  // {id,name} marker that renders as a gated download link everywhere.
  if (validFiles.size > 0 && c.env.STORAGE) {
    for (const [fieldId, file] of validFiles) {
      const r2Key = `form-uploads/${submission.id}/${crypto.randomUUID()}.${uploadExt(file.name)}`
      await c.env.STORAGE.put(r2Key, file.stream(), {
        httpMetadata: { contentType: file.type },
        customMetadata: { originalName: file.name },
      })
      const rec = await createFormFile(c.env.DB, {
        submission_id: submission.id,
        vendor_id: vendor.id,
        field_id: fieldId,
        r2_key: r2Key,
        filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      })
      formData[fieldId] = JSON.stringify({ id: rec.id, name: file.name })
    }
    await c.env.DB.prepare('UPDATE form_submissions SET data = ? WHERE id = ?')
      .bind(JSON.stringify(formData), submission.id)
      .run()
  }

  // Label/value pairs for email notifications, built from the final data so
  // file fields carry a download reference (escaped/linked at render time).
  const submittedFields = formSubmissionFields(formRecord.config, JSON.stringify(formData))

  // Wedding-linked responses notify the couple + the owning vendor (and the
  // team once shared) via the richer wedding notification, so skip the plain
  // notify_vendor email below to avoid double-pinging the vendor.
  if (send) {
    try {
      await c.env.EMAIL_QUEUE.send({ type: 'wedding_form_submission', submissionId: submission.id })
    } catch (e: any) {
      console.error('[form] wedding_form_submission enqueue failed', e.message)
    }
  }

  // Execute actions
  const actions = config.actions.actions ?? []
  let contactId: string | null = null

  // Action: create_contact
  if (actions.some(a => a.type === 'create_contact' && a.enabled)) {
    try {
      contactId = await handleCreateContact(c.env, vendor, config, formData)
      if (contactId) {
        await c.env.DB.prepare('UPDATE form_submissions SET contact_id = ? WHERE id = ?').bind(contactId, submission.id).run()
      }
    } catch (e: any) {
      console.error('[form] create_contact failed', e.message)
    }
  }

  // Action: notify_vendor (skipped for wedding sends — covered above)
  if (config.actions.notifyVendor && !send) {
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
    if (submitterEmail && isValidEmail(submitterEmail) && !(await confirmationCapReached(c.env.KV, submitterEmail))) {
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
    <FormShell embed={embed} theme={theme} logoUrl={logoUrl}>
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
  env: Bindings,
  vendor: VendorProfile,
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
    if (field.type === 'file') {
      // formData holds a {id,name} marker for files — surface the filename, not
      // the internal JSON, in the contact's custom data.
      try { extra[field.label || field.id] = String(JSON.parse(val).name ?? 'File') } catch { /* skip */ }
    } else if (field.mapTo) {
      mapped[field.mapTo] = val
    } else {
      extra[field.label || field.id] = val
    }
  }

  const firstName = mapped.first_name?.trim()
  if (!firstName) return null

  const { createContact } = await import('../storage/contacts')
  const { getStorageWithSecrets } = await import('../storage')
  const storage = await getStorageWithSecrets(env, vendor)
  const contact = await createContact(storage, env.DB, vendor.id, {
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
  await createActivity(env.DB, contact.id, 'lead', `Submitted form: ${config.title}`)

  return contact.id
}

// ─── Components ───

function FormShell({ children, embed, theme, logoUrl, meta }: { children: any; embed?: boolean; theme?: BrandTheme; logoUrl?: string | null; meta?: HeadMeta }) {
  if (embed) {
    return withDoctype(
      <html>
        <head>
          <SharedHead title="Form" {...meta} />
          <BrandThemeHead theme={theme} />
        </head>
        <body class="bg-transparent p-4">
          <BrandLogo logoUrl={logoUrl} />
          <div class="bg-[var(--form-surface)] rounded-2xl p-5 sm:p-6">
            {children}
          </div>
        </body>
      </html>
    )
  }

  return withDoctype(
    <html>
      <head>
        <SharedHead title="Form" {...meta} />
        <BrandThemeHead theme={theme} />
      </head>
      <body class="bg-[var(--form-bg)] min-h-screen">
        <div class="max-w-2xl mx-auto px-4 py-8 sm:py-12">
          <BrandLogo logoUrl={logoUrl} />
          <div class="bg-[var(--form-surface)] rounded-2xl shadow-lg shadow-gray-900/5 p-5 sm:p-8">
            {children}
          </div>
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
  const hasFile = configHasFileField(config)

  return (
    <div>
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-[var(--form-ink)]">{config.title}</h1>
        {config.subtitle && <p class="text-sm text-[var(--form-ink-muted)] mt-1">{config.subtitle}</p>}
        <p class="text-xs text-gray-400 mt-2">{vendorName}</p>
      </div>

      {error && (
        <div class="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{error}</div>
      )}

      <form method="post" action={`/form/${token}`} id="main-form" enctype={hasFile ? 'multipart/form-data' : undefined}>
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
                    <span class="text-xs bg-[var(--form-accent-tint)] text-[var(--form-accent)] px-2 py-0.5 rounded-full">Step {i + 1} of {config.steps!.length}</span>
                  </div>
                  <h2 class="text-lg font-bold text-[var(--form-ink)]">{step.title}</h2>
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
                    <button type="button" class="ml-auto text-sm text-[var(--form-accent-ink)] bg-[var(--form-accent)] hover:bg-[var(--form-accent-hover)] px-4 py-2 rounded-lg font-bold step-next">Continue</button>
                  ) : (
                    <div class="ml-auto flex flex-col items-end gap-3">
                      <div class="cf-turnstile" data-sitekey={siteKey} data-theme="light"></div>
                      <button type="submit" class="text-sm text-[var(--form-accent-ink)] bg-[var(--form-accent)] hover:bg-[var(--form-accent-hover)] px-6 py-2 rounded-lg font-bold">{config.submitLabel}</button>
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
              <button type="submit" class="text-sm text-[var(--form-accent-ink)] bg-[var(--form-accent)] hover:bg-[var(--form-accent-hover)] px-6 py-2 rounded-lg font-bold">{config.submitLabel}</button>
            </div>
          </div>
        )}
      </form>

      {/* Turnstile */}
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>

      {/* Multi-step + conditional logic */}
      <script dangerouslySetInnerHTML={{ __html: formLogicScript() }} />

      {/* Location autocomplete + future-date/countdown helpers */}
      <FormEnhancements mapsKey={configHasAddressField(config) ? mapsKey : undefined} />
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
      ) : field.type === 'multiselect' ? (
        <div class="space-y-2">
          {field.options?.map((opt) => {
            const optValue = typeof opt === 'string' ? opt : opt.value
            const optLabel = typeof opt === 'string' ? opt : opt.label
            const selected = (value ?? '').split(', ').includes(optValue)
            return (
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" name={field.id} value={optValue} checked={selected} />
                {optLabel}
              </label>
            )
          })}
        </div>
      ) : field.type === 'file' ? (
        <>
          <input
            type="file"
            name={field.id}
            required={field.required}
            accept={FILE_ACCEPT}
            data-max-size={String(MAX_UPLOAD_BYTES)}
            class="form-file w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-bold file:bg-[var(--form-accent-tint)] file:text-[var(--form-accent)] cursor-pointer"
          />
          <p class="text-xs text-gray-400 mt-1">{field.accept ? `${field.accept} · ` : ''}Max 10MB</p>
        </>
      ) : field.type === 'rating' ? (
        <div class="rating flex items-center gap-1" data-rating={field.id} data-max={String(field.max ?? 5)}>
          <input type="hidden" name={field.id} value={value ?? ''} />
          {Array.from({ length: field.max ?? 5 }).map((_, i) => (
            <button type="button" data-val={String(i + 1)} aria-label={`${i + 1}`} class="star w-8 h-8 text-gray-300 hover:text-[var(--form-accent)] transition-colors">
              <svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><path d="M11.48 3.5l2.36 4.78 5.28.77-3.82 3.72.9 5.26-4.72-2.48-4.72 2.48.9-5.26L3.84 9.05l5.28-.77z" /></svg>
            </button>
          ))}
        </div>
      ) : field.type === 'scale' ? (
        <div>
          <div class="scale flex flex-wrap gap-2" data-scale={field.id}>
            <input type="hidden" name={field.id} value={value ?? ''} />
            {Array.from({ length: (field.max ?? 10) - (field.min ?? 1) + 1 }).map((_, i) => {
              const n = (field.min ?? 1) + i
              return (
                <button type="button" data-val={String(n)} class="scale-opt w-10 h-10 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:border-[var(--form-accent)]">{n}</button>
              )
            })}
          </div>
          {(field.minLabel || field.maxLabel) && (
            <div class="flex justify-between text-xs text-gray-400 mt-1">
              <span>{field.minLabel ?? ''}</span>
              <span>{field.maxLabel ?? ''}</span>
            </div>
          )}
        </div>
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
      <h2 class="text-xl font-bold text-[var(--form-ink)] mb-2">Submitted successfully</h2>
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
  // File fields: reject an over-size pick immediately rather than on submit.
  document.querySelectorAll('.form-file').forEach(function(inp){
    inp.addEventListener('change', function(){
      var max = parseInt(inp.getAttribute('data-max-size')||'0',10);
      var f = inp.files && inp.files[0];
      if (f && max && f.size > max){ alert('That file is too large (max 10MB). Please choose a smaller file.'); inp.value=''; }
    });
  });

  // Star-rating widgets: clicking a star fills up to it and stores the number
  // in the hidden input. Hover previews; mouse-leave restores the choice.
  document.querySelectorAll('.rating').forEach(function(box){
    var hidden = box.querySelector('input[type=hidden]');
    var stars = box.querySelectorAll('.star');
    function paint(n){ stars.forEach(function(s,i){ s.style.color = (i < n) ? 'var(--form-accent)' : ''; }); }
    function cur(){ return parseInt(hidden.value||'0',10)||0; }
    stars.forEach(function(s){
      s.addEventListener('click', function(){ hidden.value = s.getAttribute('data-val'); paint(cur()); });
      s.addEventListener('mouseenter', function(){ paint(parseInt(s.getAttribute('data-val'),10)); });
    });
    box.addEventListener('mouseleave', function(){ paint(cur()); });
    paint(cur());
  });

  // Linear-scale widgets: clicking a number highlights it and stores the value.
  document.querySelectorAll('.scale').forEach(function(box){
    var hidden = box.querySelector('input[type=hidden]');
    var opts = box.querySelectorAll('.scale-opt');
    function paint(){ var v = hidden.value; opts.forEach(function(o){ var on = o.getAttribute('data-val') === v; o.style.background = on ? 'var(--form-accent)' : ''; o.style.color = on ? 'var(--form-accent-ink)' : ''; o.style.borderColor = on ? 'var(--form-accent)' : ''; }); }
    opts.forEach(function(o){ o.addEventListener('click', function(){ hidden.value = o.getAttribute('data-val'); paint(); }); });
    paint();
  });

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
