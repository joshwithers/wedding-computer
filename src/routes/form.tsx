import { Hono } from 'hono'
import type { Bindings, Env, VendorProfile } from '../types'
import { SharedHead } from '../views/head'
import type { HeadMeta } from '../views/head'
import { getFormByToken, getFormSendByToken, createFormSubmission, createFormFile, formSubmissionFields, incrementSubmissionCount, getFormSubmission } from '../db/forms'
import type { Form, FormSend } from '../types'
import { isAllowedUpload, uploadExt } from '../lib/upload'
import { getVendorById } from '../db/vendors'
import { embedFrameAncestors } from '../lib/csp'
import { verifyTurnstile } from '../services/turnstile'
import { rateLimit } from '../middleware/rate-limit'
import { isValidEmail } from '../lib/validation'
import type { FormConfig, FormField, ContactMapping } from '../lib/form-schema'
import { PublicFormBody, ThankYou } from '../lib/form-render'
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
    return c.html(<FormShell embed={c.req.query('embed') === '1'}><p class="text-gray-600">{t('forms.public.unavailable')}</p></FormShell>, 404)
  }
  const formRecord = resolved.form

  // Booking forms create a contact AND join the wedding — they must go through
  // the booking funnel at /book-form, never the information-form handler here.
  if (formRecord.kind === 'booking') return c.redirect(`/book-form/${token}`)

  const vendor = await getVendorById(c.env.DB, formRecord.vendor_id)
  if (!vendor) return c.html(<FormShell embed={false}><p class="text-gray-600">{t('forms.public.unavailable')}</p></FormShell>, 404)
  // When embedded, scope frame-ancestors to the vendor's own site.
  const fa = embedFrameAncestors(vendor.website)
  if (fa) c.set('embedFrameAncestors', fa)

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
      <FormHeader config={config} vendorName={vendor.business_name} />
      <PublicFormBody
        config={config}
        action={`/form/${token}`}
        formType={formRecord.type}
        siteKey={c.env.TURNSTILE_SITE_KEY}
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

  // Booking forms submit through the booking funnel, not this handler.
  if (formRecord.kind === 'booking') return c.redirect(`/book-form/${c.req.param('token')}`)

  const vendor = await getVendorById(c.env.DB, formRecord.vendor_id)
  if (!vendor) return c.text('Not found', 404)

  const config = JSON.parse(formRecord.config) as FormConfig
  // all:true so multi-select checkboxes arrive as arrays; file fields arrive as File objects.
  const body = await c.req.parseBody({ all: true })
  const embed = c.req.query('embed') === '1'
  const theme = parseBrandTheme(vendor.brand_theme)
  const logoUrl = formLogoUrl(vendor)

  const reRender = (error: string) => c.html(
    <FormShell embed={embed} theme={theme} logoUrl={logoUrl}>
      <FormHeader config={config} vendorName={vendor.business_name} />
      <PublicFormBody
        config={config}
        action={`/form/${token}`}
        formType={formRecord.type}
        siteKey={c.env.TURNSTILE_SITE_KEY}
        error={error}
        values={toStringValues(body)}
        mapsKey={c.env.GOOGLE_MAPS_API_KEY}
      />
    </FormShell>
  )

  // Honeypot
  if (body.website_url) {
    return c.html(<FormShell embed={embed} theme={theme} logoUrl={logoUrl}><ThankYou vendorName={vendor.business_name} /></FormShell>)
  }

  // Turnstile verification
  const turnstileToken = typeof body['cf-turnstile-response'] === 'string' ? body['cf-turnstile-response'] : ''
  const ip = c.req.header('cf-connecting-ip') ?? null
  const turnstileOk = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, turnstileToken, ip)

  if (!turnstileOk) {
    return reRender(t('forms.public.verificationFailed'))
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
      else errors.push(t('forms.public.fileTooLarge', { label: field.label }))
    } else if (field.required && !field.conditions) {
      errors.push(t('forms.public.required', { label: field.label }))
    }
  }

  // Server-side "required" enforcement for the widget types whose hidden inputs
  // the browser can't validate (rating/scale/multiselect). Skip conditional
  // fields, whose visibility is decided client-side.
  for (const field of allFields) {
    if (field.type !== 'rating' && field.type !== 'scale' && field.type !== 'multiselect') continue
    if (field.required && !field.conditions && !formData[field.id]) {
      errors.push(t('forms.public.required', { label: field.label }))
    }
  }

  if (errors.length > 0) {
    return reRender(errors[0])
  }

  // Store submission. When this came through a "send to a couple" link, stamp
  // the wedding so it surfaces on the wedding page for the couple + vendor.
  const submission = await createFormSubmission(c.env.DB, vendor.id, {
    form_id: formRecord.id,
    data: JSON.stringify(formData),
    kind: formRecord.kind,
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
      const { resolvePromptTemplate } = await import('../services/ai-prompts')
      const { resolveSecret } = await import('../services/secrets')
      const anthropicKey = await resolveSecret(c.env.KV, vendor.anthropic_api_key)
      const contactName = [formData.first_name || formData.p1_first_name, formData.last_name || formData.p1_last_name].filter(Boolean).join(' ')
      const template = await resolvePromptTemplate(c.env, 'enquiry_reply', config.actions.confirmationEmail?.aiPrompt)
      const draft = await draftEnquiryReply(c.env.AI, {
        vendorName: vendor.business_name,
        vendorCategory: vendor.category,
        contactName,
        weddingDate: formData.wedding_date ?? null,
        weddingLocation: formData.wedding_location ?? null,
        isAvailable: null,
        busynessScore: null,
        notes: null,
        template,
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

  return c.html(
    <FormShell embed={embed} theme={theme} logoUrl={logoUrl}>
      <ThankYou
        vendorName={vendor.business_name}
        showPdfLink={formRecord.type === 'noim' && actions.some(a => a.type === 'generate_pdf' && a.enabled)}
        pdfAction={`/form/${formRecord.public_token}/pdf`}
        submissionId={submission.id}
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

  const { createContact, findContactByEmail, updateContact } = await import('../storage/contacts')
  const { getStorageWithSecrets } = await import('../storage')
  const storage = await getStorageWithSecrets(env, vendor)

  const email = mapped.email ?? null

  // Dedup by email: same approach as the enquiry form — update the existing
  // contact rather than creating a duplicate for the same person.
  let existing = email ? await findContactByEmail(env.DB, vendor.id, email) : null
  let contact

  if (existing) {
    const updates: Parameters<typeof updateContact>[4] = {}
    if (!existing.phone && mapped.phone) updates.phone = mapped.phone
    if (!existing.partner_first_name && mapped.partner_first_name) updates.partner_first_name = mapped.partner_first_name
    if (!existing.partner_last_name && mapped.partner_last_name) updates.partner_last_name = mapped.partner_last_name
    if (mapped.wedding_date) updates.wedding_date = mapped.wedding_date
    if (mapped.wedding_location) updates.wedding_location = mapped.wedding_location
    if (Object.keys(updates).length > 0) {
      try {
        await updateContact(storage, env.DB, vendor.id, existing.id, updates)
        Object.assign(existing, updates)
      } catch (e: any) {
        console.error('[form] dedup contact update failed:', e.message)
      }
    }
    contact = existing
  } else {
    contact = await createContact(storage, env.DB, vendor.id, {
      first_name: firstName,
      last_name: mapped.last_name ?? '',
      email,
      phone: mapped.phone ?? null,
      partner_first_name: mapped.partner_first_name ?? null,
      partner_last_name: mapped.partner_last_name ?? null,
      wedding_date: mapped.wedding_date ?? null,
      wedding_location: mapped.wedding_location ?? null,
      notes: mapped.notes ?? null,
      source: 'form',
      form_data: Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
    })
  }

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

function FormHeader({ config, vendorName }: { config: FormConfig; vendorName: string }) {
  return (
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-[var(--form-ink)]">{config.title}</h1>
      {config.subtitle && <p class="text-sm text-[var(--form-ink-muted)] mt-1">{config.subtitle}</p>}
      <p class="text-xs text-gray-400 mt-2">{vendorName}</p>
    </div>
  )
}

export default form
