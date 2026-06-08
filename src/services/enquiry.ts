import type { Bindings, VendorProfile, Contact } from '../types'
import { createContact } from '../storage/contacts'
import { getStorageWithSecrets } from '../storage'
import { createActivity } from '../db/activities'
import { track } from '../services/analytics'
import { draftEnquiryReply } from '../services/ai'
import { resolveSecret } from '../services/secrets'
import { getScoreForDate } from '../db/busyness'
import { isValidEmail } from '../lib/validation'
import type { FormConfig, ContactMapping } from '../lib/form-schema'

// The normalised lead payload every channel (hosted form, raw HTML, JSON API,
// MCP agent tool) reduces to before it hits the shared creation pipeline.
export type ContactData = {
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  partner_first_name: string | null
  partner_last_name: string | null
  wedding_date: string | null
  wedding_location: string | null
  notes: string | null
}

export type EnquirySource = 'website' | 'api' | 'agent'

const SOURCE_LABEL: Record<EnquirySource, string> = {
  website: 'Enquiry submitted via website form',
  api: 'Enquiry submitted via API',
  agent: 'Enquiry submitted via AI agent',
}

const FIELD_MAX = 2000

// ─── Form-encoded submission (hosted + raw HTML channels) ───
// Maps a posted form body through the vendor's FormConfig (which assigns each
// field id a contact mapping). Throws Error(message) on validation failure.
export function processSubmission(
  config: FormConfig,
  body: Record<string, string>
): { contactData: ContactData; formData: Record<string, string> } {
  const mapped: Partial<Record<ContactMapping, string>> = {}
  const formData: Record<string, string> = {}

  for (const field of config.fields) {
    if (field.type === 'heading') continue

    const raw = body[field.id]
    const value = typeof raw === 'string' ? raw.trim() : ''

    if (field.required && !value) {
      throw new Error(`${field.label} is required`)
    }
    if (!value) continue
    if (value.length > FIELD_MAX) {
      throw new Error(`${field.label} is too long`)
    }

    // Store raw text (trimmed). Output is escaped at render time by JSX (app UI)
    // and by escapeHtml in email templates. Encoding here would double-encode.
    if (field.mapTo) {
      if (field.mapTo === 'email' && !isValidEmail(value)) {
        throw new Error('Please enter a valid email address')
      }
      mapped[field.mapTo] = field.mapTo === 'email' ? value.toLowerCase() : value
    } else {
      formData[field.label] = value
    }
  }

  return { contactData: contactDataFromMapped(mapped), formData }
}

// ─── JSON submission (API / webhook / agent channels) ───
// Accepts a flat JSON object with named fields plus an optional `fields` map of
// extra custom data. Throws Error(message) on validation failure.
export type EnquiryJson = {
  first_name?: unknown
  last_name?: unknown
  email?: unknown
  phone?: unknown
  partner_first_name?: unknown
  partner_last_name?: unknown
  wedding_date?: unknown
  wedding_location?: unknown
  notes?: unknown
  message?: unknown
  fields?: unknown
}

export function processJsonSubmission(
  payload: EnquiryJson
): { contactData: ContactData; formData: Record<string, string> } {
  const str = (v: unknown, label: string): string | undefined => {
    if (v === undefined || v === null) return undefined
    if (typeof v !== 'string') throw new Error(`${label} must be a string`)
    const t = v.trim()
    if (!t) return undefined
    if (t.length > FIELD_MAX) throw new Error(`${label} is too long`)
    return t
  }

  const mapped: Partial<Record<ContactMapping, string>> = {}
  mapped.first_name = str(payload.first_name, 'first_name')
  mapped.last_name = str(payload.last_name, 'last_name')
  const email = str(payload.email, 'email')
  if (email) mapped.email = email.toLowerCase()
  mapped.phone = str(payload.phone, 'phone')
  mapped.partner_first_name = str(payload.partner_first_name, 'partner_first_name')
  mapped.partner_last_name = str(payload.partner_last_name, 'partner_last_name')
  mapped.wedding_date = str(payload.wedding_date, 'wedding_date')
  mapped.wedding_location = str(payload.wedding_location, 'wedding_location')
  mapped.notes = str(payload.notes ?? payload.message, 'notes')

  if (mapped.email && !isValidEmail(mapped.email)) {
    throw new Error('Please provide a valid email address')
  }

  // Extra custom fields → stored as form_data
  const formData: Record<string, string> = {}
  if (payload.fields !== undefined) {
    if (typeof payload.fields !== 'object' || payload.fields === null || Array.isArray(payload.fields)) {
      throw new Error('`fields` must be an object of label/value pairs')
    }
    for (const [label, v] of Object.entries(payload.fields as Record<string, unknown>)) {
      const val = str(v, label)
      if (val) formData[label.slice(0, 200)] = val
    }
  }

  return { contactData: contactDataFromMapped(mapped), formData }
}

function contactDataFromMapped(
  mapped: Partial<Record<ContactMapping, string>>
): ContactData {
  if (!mapped.first_name) throw new Error('first_name is required')
  if (!mapped.last_name) throw new Error('last_name is required')
  if (!mapped.email) throw new Error('email is required')

  return {
    first_name: mapped.first_name,
    last_name: mapped.last_name,
    email: mapped.email ?? null,
    phone: mapped.phone ?? null,
    partner_first_name: mapped.partner_first_name ?? null,
    partner_last_name: mapped.partner_last_name ?? null,
    wedding_date: mapped.wedding_date ?? null,
    wedding_location: mapped.wedding_location ?? null,
    notes: mapped.notes ?? null,
  }
}

// ─── Shared creation pipeline ───
// Creates the contact, logs activity + analytics, queues the new-lead email,
// and (if enabled) drafts an AI availability-aware reply. Used by every channel.
export async function createEnquiry(
  env: Bindings,
  vendor: VendorProfile,
  input: { contactData: ContactData; formData: Record<string, string>; source: EnquirySource }
): Promise<Contact> {
  const { contactData, formData, source } = input

  const storage = await getStorageWithSecrets(env, vendor)
  const contact = await createContact(storage, env.DB, vendor.id, {
    ...contactData,
    source,
    form_data: Object.keys(formData).length > 0 ? JSON.stringify(formData) : null,
  })

  await createActivity(env.DB, contact.id, 'lead', SOURCE_LABEL[source])

  track(env.DB, vendor.id, 'enquiry_received', {
    contactId: contact.id,
    metadata: { source },
  })

  await env.EMAIL_QUEUE.send({
    type: 'new_lead',
    vendorId: vendor.id,
    contactId: contact.id,
  })

  if (vendor.availability_sharing === 'ai_reply' && contactData.email) {
    try {
      await draftAvailabilityReply(env, vendor, contact.id, contactData)
    } catch (e: any) {
      console.error('[enquiry] AI auto-reply failed', e.message)
    }
  }

  return contact
}

async function draftAvailabilityReply(
  env: Bindings,
  vendor: VendorProfile,
  contactId: string,
  contactData: ContactData
): Promise<void> {
  const weddingDate = contactData.wedding_date ?? null
  let isAvailable: boolean | null = null
  let busynessScore: number | null = null

  if (weddingDate) {
    const events = await env.DB
      .prepare("SELECT COUNT(*) as count FROM calendar_events WHERE vendor_id = ? AND date = ? AND type IN ('booking', 'blocked')")
      .bind(vendor.id, weddingDate)
      .first<{ count: number }>()
    isAvailable = (events?.count ?? 0) === 0

    const score = await getScoreForDate(env.DB, weddingDate, 'global', 'global')
    busynessScore = score?.score ?? null
  }

  const anthropicKey = await resolveSecret(env.KV, vendor.anthropic_api_key)
  const draft = await draftEnquiryReply(env.AI, {
    vendorName: vendor.business_name,
    vendorCategory: vendor.category,
    contactName: `${contactData.first_name} ${contactData.last_name}`.trim(),
    weddingDate,
    weddingLocation: contactData.wedding_location ?? null,
    isAvailable,
    busynessScore,
    notes: null,
  }, anthropicKey)

  if (draft) {
    await env.DB.prepare(
      `INSERT INTO emails (vendor_id, contact_id, direction, from_email, from_name, to_email, subject, body_text, status, is_system)
       VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?, 'draft', 1)`
    ).bind(
      vendor.id,
      contactId,
      vendor.email_handle ? `${vendor.email_handle}@wedding.computer` : 'noreply@wedding.computer',
      vendor.business_name,
      contactData.email,
      `Re: Enquiry from ${contactData.first_name}`,
      draft,
    ).run()
  }
}
