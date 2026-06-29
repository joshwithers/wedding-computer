import type { Context } from 'hono'
import type { Env, Bindings, VendorProfile, Contact, Form, FormSend, FormKind } from '../types'
import type { FormConfig, FormField, ContactMapping } from '../lib/form-schema'
import { parseFormConfig, parseBookingFormConfig, defaultFormConfig, resolveFormActions } from '../lib/form-schema'
import { verifyTurnstile } from './turnstile'
import {
  createFormSubmission,
  createFormFile,
  incrementSubmissionCount,
  getFormByVendorSlug,
  createForm,
  updateForm,
  formSubmissionFields,
} from '../db/forms'
import { createEnquiry, sendEnquiryConfirmation, type ContactData } from './enquiry'
import { getStorageWithSecrets } from '../storage'
import { createContact, findContactByEmail, updateContact, getContact } from '../storage/contacts'
import { attachVendorToCoupleWedding } from './booking-wedding'
import { createActivity } from '../db/activities'
import { isAllowedUpload, uploadExt } from '../lib/upload'
import { isValidEmail } from '../lib/validation'
import { t } from '../i18n'

// The single public-submission funnel. EVERY hosted intake (information /
// enquiry / standalone booking) flows through createSubmission, which:
//   1. guards (honeypot + Turnstile),
//   2. maps fields through the config,
//   3. ALWAYS persists an immutable form_submissions row (the B3 keystone),
//   4. runs a per-kind side-effect policy.
// Only the booking arm can grant wedding membership, so the enquiry "no wedding"
// boundary is structural. Returns a discriminated union so callers re-render
// with {error, values} on failure (no redirect-and-lose-data).

export type SubmitResult =
  | { ok: true; redirectUrl?: string; submissionId?: string }
  | { ok: false; error: string; values: Record<string, string> }

export type SubmitContext = {
  vendor: VendorProfile
  kind: FormKind
  config: FormConfig
  // Reserved slug for the vendor's singleton form of this kind ('enquiry' |
  // 'booking'); used to get-or-create the backing forms row when `form` is absent.
  slug: string
  // Raw config JSON to seed the forms row on first submission (read-both bridge).
  configJson: string
  // A pre-resolved forms row (e.g. /form/:token or /book-form/:token resolved by
  // token). When present it's used directly instead of get-or-create by slug.
  form?: Form
  // The form.type discriminator (for NOIM, etc.).
  formType?: string
  // A "send to a couple" context (wedding-scoped submission).
  send?: FormSend | null
}

const FIELD_MAX = 2000

type Mapped = {
  dataById: Record<string, string>
  mapped: Partial<Record<ContactMapping, string>>
  extraByLabel: Record<string, string>
  fileFields: FormField[]
}

function mapFields(config: FormConfig, body: Record<string, unknown>): { ok: true; value: Mapped } | { ok: false; error: string } {
  const allFields = config.steps ? config.steps.flatMap((s) => s.fields) : config.fields
  const dataById: Record<string, string> = {}
  const mapped: Partial<Record<ContactMapping, string>> = {}
  const extraByLabel: Record<string, string> = {}
  const fileFields: FormField[] = []

  for (const field of allFields) {
    if (field.type === 'heading') continue
    if (field.type === 'file') { fileFields.push(field); continue }

    let value = ''
    const raw = body[field.id]
    if (field.type === 'multiselect') {
      const arr = Array.isArray(raw) ? raw : raw !== undefined && raw !== '' ? [raw] : []
      const allowed = new Set((field.options ?? []).map((o) => (typeof o === 'string' ? o : o.value)))
      value = arr
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter((x) => x && allowed.has(x))
        .slice(0, 50)
        .join(', ')
        .slice(0, FIELD_MAX)
    } else if (typeof raw === 'string') {
      value = raw.slice(0, FIELD_MAX).trim()
    }

    if (field.required && !field.conditions && !value) {
      return { ok: false, error: t('forms.public.required', { label: field.label }) }
    }
    if (!value) continue

    dataById[field.id] = value
    if (field.mapTo) {
      if (field.mapTo === 'email') {
        if (!isValidEmail(value)) return { ok: false, error: t('forms.public.invalidEmail') }
        mapped.email = value.toLowerCase()
      } else {
        mapped[field.mapTo] = value
      }
    } else {
      extraByLabel[field.label] = value
    }
  }

  return { ok: true, value: { dataById, mapped, extraByLabel, fileFields } }
}

function toStringValues(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'string') out[k] = v
    else if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string').join(', ')
  }
  return out
}

function contactDataFrom(mapped: Partial<Record<ContactMapping, string>>): ContactData {
  return {
    first_name: mapped.first_name ?? '',
    last_name: mapped.last_name ?? '',
    email: mapped.email ?? null,
    phone: mapped.phone ?? null,
    partner_first_name: mapped.partner_first_name ?? null,
    partner_last_name: mapped.partner_last_name ?? null,
    wedding_date: mapped.wedding_date ?? null,
    wedding_location: mapped.wedding_location ?? null,
    notes: mapped.notes ?? null,
  }
}

function isValidRedirect(url: string | undefined): url is string {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

export async function createSubmission(c: Context<Env>, ctx: SubmitContext): Promise<SubmitResult> {
  const { vendor, kind, config } = ctx
  const formType = ctx.formType ?? 'custom'
  const body = await c.req.parseBody({ all: true })
  const ip = c.req.header('cf-connecting-ip') ?? null

  // Honeypot — a filled hidden field means a bot; show success without work.
  if (body.website_url) return { ok: true }

  const turnstileToken = typeof body['cf-turnstile-response'] === 'string' ? body['cf-turnstile-response'] : ''
  if (!(await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, turnstileToken, ip))) {
    return { ok: false, error: t('forms.public.verificationFailed'), values: toStringValues(body) }
  }

  const mapResult = mapFields(config, body)
  if (!mapResult.ok) return { ok: false, error: mapResult.error, values: toStringValues(body) }
  const { dataById, mapped, extraByLabel, fileFields } = mapResult.value

  // Validate files before committing anything.
  const validFiles = new Map<string, File>()
  for (const field of fileFields) {
    const raw = body[field.id]
    const file = Array.isArray(raw) ? raw.find((x) => x instanceof File && x.size > 0) : raw
    if (file instanceof File && file.size > 0) {
      if (isAllowedUpload(file)) validFiles.set(field.id, file)
      else return { ok: false, error: t('forms.public.fileTooLarge', { label: field.label }), values: toStringValues(body) }
    } else if (field.required && !field.conditions) {
      return { ok: false, error: t('forms.public.required', { label: field.label }), values: toStringValues(body) }
    }
  }

  const actions = resolveFormActions(config, kind, formType)

  // Lead-generating kinds need a contact, so they require name + email.
  if ((kind === 'enquiry' || kind === 'booking') && (!mapped.email || !mapped.first_name)) {
    return { ok: false, error: t('forms.public.invalidEmail'), values: toStringValues(body) }
  }

  const contactData = contactDataFrom(mapped)

  // Always persist an immutable submission row (B3).
  const form = ctx.form ?? await ensureSingletonForm(c.env.DB, vendor, kind, ctx.slug, config.title, ctx.configJson)
  const submission = await createFormSubmission(c.env.DB, vendor.id, {
    form_id: form.id,
    data: JSON.stringify(dataById),
    kind,
    ip_address: ip,
    user_agent: c.req.header('user-agent') ?? null,
    wedding_id: ctx.send?.wedding_id ?? null,
    form_send_id: ctx.send?.id ?? null,
  })
  await incrementSubmissionCount(c.env.DB, form.id)

  // Upload validated files now that the submission id exists.
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
      dataById[fieldId] = JSON.stringify({ id: rec.id, name: file.name })
    }
    await c.env.DB.prepare('UPDATE form_submissions SET data = ? WHERE id = ?').bind(JSON.stringify(dataById), submission.id).run()
  }

  // ── Per-kind side effects ──
  let contactId: string | null = null
  try {
    if (kind === 'enquiry') {
      // Reuse the enquiry pipeline verbatim: contact (NO wedding), new-lead
      // notify, geocode, AI draft, confirmation. The no-wedding boundary lives
      // here — this arm never calls attachVendorToCoupleWedding.
      const contact = await createEnquiry(c.env, vendor, {
        contactData,
        formData: extraByLabel,
        source: 'website',
        confirmation: actions.confirmationEmail,
      })
      contactId = contact.id
    } else if (kind === 'booking') {
      const contact = await createOrUpdateContact(c.env, vendor, contactData, extraByLabel, 'booking', 'Booking form submitted')
      contactId = contact.id
      // Deliberate, couple-initiated wedding membership grant (backgrounded).
      c.executionCtx.waitUntil(
        (async () => {
          const storage = await getStorageWithSecrets(c.env, vendor)
          const res = await getContact(storage, c.env.DB, vendor.id, contact.id)
          if (res) await attachVendorToCoupleWedding(c.env, vendor, res.contact, { createIfMissing: true })
        })().catch((e: any) => console.error('[form-submit] booking wedding attach failed', e?.message)),
      )
      await notifyAndConfirm(c, vendor, form, config, kind, actions, submission.id, contactData, extraByLabel)
    } else {
      // information: optional contact creation + notify + confirmation.
      if (actions.createContact && mapped.first_name) {
        const contact = await createOrUpdateContact(c.env, vendor, contactData, extraByLabel, 'form', `Submitted form: ${config.title}`)
        contactId = contact.id
      }
      await notifyAndConfirm(c, vendor, form, config, kind, actions, submission.id, contactData, extraByLabel)
    }
    if (contactId) {
      await c.env.DB.prepare('UPDATE form_submissions SET contact_id = ? WHERE id = ?').bind(contactId, submission.id).run()
    }
  } catch (e: any) {
    // The submission row already captured their input; a side-effect failure is
    // logged, not surfaced to the couple.
    console.error(`[form-submit] ${kind} side effect failed`, e?.message)
  }

  return isValidRedirect(config.redirectUrl)
    ? { ok: true, redirectUrl: config.redirectUrl, submissionId: submission.id }
    : { ok: true, submissionId: submission.id }
}

// Vendor notification + submitter confirmation + email-forward, shared by the
// information and booking arms (enquiry handles these inside createEnquiry).
async function notifyAndConfirm(
  c: Context<Env>,
  vendor: VendorProfile,
  form: Form,
  config: FormConfig,
  kind: FormKind,
  actions: ReturnType<typeof resolveFormActions>,
  submissionId: string,
  contactData: ContactData,
  extra: Record<string, string>,
): Promise<void> {
  const submittedFields = formSubmissionFields(form.config, JSON.stringify({
    ...Object.fromEntries(Object.entries(contactData).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])),
    ...extra,
  }))

  // A wedding-scoped send notifies via the richer wedding flow elsewhere.
  if (form.wedding_id) {
    try { await c.env.EMAIL_QUEUE.send({ type: 'wedding_form_submission', submissionId }) }
    catch (e: any) { console.error('[form-submit] wedding notify failed', e?.message) }
  } else if (actions.notifyVendor) {
    try {
      await c.env.EMAIL_QUEUE.send({
        type: 'form_submission', vendorId: vendor.id, formId: form.id, submissionId,
        formTitle: config.title, fields: submittedFields,
      })
    } catch (e: any) { console.error('[form-submit] vendor notify failed', e?.message) }
  }

  if (actions.emailRecipient) {
    const to = isValidEmail(actions.emailRecipient) ? actions.emailRecipient : extra[actions.emailRecipient]
    if (to && isValidEmail(to)) {
      try {
        await c.env.EMAIL_QUEUE.send({
          type: 'form_notification', to, formTitle: config.title, vendorName: vendor.business_name,
          submissionId, fields: submittedFields, hideBranding: vendor.hide_branding === 1,
        })
      } catch (e: any) { console.error('[form-submit] email_recipient failed', e?.message) }
    }
  }

  if (actions.confirmationEmail?.enabled && contactData.email) {
    try { await sendEnquiryConfirmation(c.env, vendor, contactData, actions.confirmationEmail) }
    catch (e: any) { console.error(`[form-submit] ${kind} confirmation failed`, e?.message) }
  }
}

// Dedup by email, fill blanks, refresh date/location — the shared contact write
// used by the information + booking arms (enquiry uses createEnquiry's own copy).
async function createOrUpdateContact(
  env: Bindings,
  vendor: VendorProfile,
  contactData: ContactData,
  extra: Record<string, string>,
  source: string,
  activity: string,
): Promise<Contact> {
  const storage = await getStorageWithSecrets(env, vendor)
  let contact = contactData.email ? await findContactByEmail(env.DB, vendor.id, contactData.email) : null
  if (contact) {
    const updates: Parameters<typeof updateContact>[4] = {}
    if (!contact.phone && contactData.phone) updates.phone = contactData.phone
    if (!contact.partner_first_name && contactData.partner_first_name) updates.partner_first_name = contactData.partner_first_name
    if (!contact.partner_last_name && contactData.partner_last_name) updates.partner_last_name = contactData.partner_last_name
    if (contactData.wedding_date) updates.wedding_date = contactData.wedding_date
    if (contactData.wedding_location) updates.wedding_location = contactData.wedding_location
    if (Object.keys(updates).length > 0) {
      try { await updateContact(storage, env.DB, vendor.id, contact.id, updates); Object.assign(contact, updates) }
      catch (e: any) { console.error('[form-submit] contact dedup update failed', e?.message) }
    }
  } else {
    contact = await createContact(storage, env.DB, vendor.id, {
      ...contactData,
      source,
      form_data: Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
    })
  }
  await createActivity(env.DB, contact.id, source === 'form' ? 'lead' : 'note', activity)
  return contact
}

// Get-or-create a vendor's singleton forms row for a kind (read-both bridge),
// keeping its config in sync with the (blob-sourced) config it was rendered from.
export async function ensureSingletonForm(
  db: D1Database,
  vendor: VendorProfile,
  kind: FormKind,
  slug: string,
  title: string,
  configJson: string,
): Promise<Form> {
  const existing = await getFormByVendorSlug(db, vendor.id, slug)
  if (existing) {
    if (existing.config !== configJson) {
      await updateForm(db, vendor.id, existing.id, { config: configJson })
      existing.config = configJson
    }
    return existing
  }
  return createForm(db, vendor.id, { title, slug, type: 'custom', kind, config: configJson })
}

// Read-both resolver for a vendor's singleton enquiry form. The legacy editor
// still writes vendor_profiles.enquiry_form, so the blob is the source of truth
// during the transition; the forms row is the submission anchor, kept in sync by
// the funnel. Shared by /enquire, the JSON API and MCP so all resolve identically.
export async function resolveEnquiryFormConfig(
  db: D1Database,
  vendor: VendorProfile,
): Promise<{ config: FormConfig; configJson: string }> {
  const row = await getFormByVendorSlug(db, vendor.id, 'enquiry')
  const json = vendor.enquiry_form ?? row?.config ?? null
  return { config: parseFormConfig(json), configJson: json ?? JSON.stringify(defaultFormConfig()) }
}

// Read-both resolver for a vendor's singleton standalone booking form.
export async function resolveBookingFormConfig(
  db: D1Database,
  vendor: VendorProfile,
): Promise<{ config: FormConfig; configJson: string } | null> {
  const row = await getFormByVendorSlug(db, vendor.id, 'booking-form')
  const json = row?.config ?? null
  if (!json) return null
  const config = parseBookingFormConfig(json)
  if (!config.fields || config.fields.length === 0) return null
  return { config, configJson: json }
}

// Record an immutable form_submissions row for a JSON-channel enquiry (the
// public JSON API + MCP agent tool), which reduce to createEnquiry directly, so
// they get the same B3 durable record. Best-effort.
export async function recordJsonEnquiry(
  db: D1Database,
  vendor: VendorProfile,
  contactData: ContactData,
  formData: Record<string, string>,
  contactId: string | null,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<void> {
  try {
    const { config, configJson } = await resolveEnquiryFormConfig(db, vendor)
    const form = await ensureSingletonForm(db, vendor, 'enquiry', 'enquiry', config.title, configJson)
    const data: Record<string, string> = {}
    for (const [k, v] of Object.entries(contactData)) if (v != null) data[k] = String(v)
    Object.assign(data, formData)
    await createFormSubmission(db, vendor.id, {
      form_id: form.id, data: JSON.stringify(data), kind: 'enquiry',
      contact_id: contactId, ip_address: ipAddress ?? null, user_agent: userAgent ?? null,
    })
    await incrementSubmissionCount(db, form.id)
  } catch (e: any) {
    console.error('[form-submit] recordJsonEnquiry failed', e?.message)
  }
}
