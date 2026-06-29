import type { Bindings, VendorProfile, Contact } from '../types'
import { createContact, findContactByEmail, updateContact } from '../storage/contacts'
import { getStorageWithSecrets } from '../storage'
import { createActivity } from '../db/activities'
import { track } from '../services/analytics'
import { draftEnquiryReply } from '../services/ai'
import { resolvePromptTemplate } from '../services/ai-prompts'
import { resolveSecret } from '../services/secrets'
import { getScoreForDate } from '../db/busyness'
import { SQL_CALENDAR_EVENT_NOT_CANCELLED } from '../db/weddings'
import { geocodeContactLocation } from '../services/geocode'
import { isProVendor } from '../db/subscriptions'
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
  input: {
    contactData: ContactData
    formData: Record<string, string>
    source: EnquirySource
    // From the enquiry form's "Send confirmation email to enquirer" option.
    confirmation?: { enabled: boolean; mode: 'ai' | 'template'; template?: string; aiInstructions?: string; aiPrompt?: string }
  }
): Promise<Contact> {
  const { contactData, formData, source } = input

  const storage = await getStorageWithSecrets(env, vendor)

  // Dedup: if we already have a contact with this email (or partner email),
  // update the existing record rather than creating a duplicate. Wedding date
  // and location are always refreshed (couple may have changed them); other
  // fields only fill in blanks so existing CRM data isn't clobbered.
  let contact = contactData.email
    ? await findContactByEmail(env.DB, vendor.id, contactData.email)
    : null

  if (contact) {
    const updates: Parameters<typeof updateContact>[4] = {}
    if (!contact.phone && contactData.phone) updates.phone = contactData.phone
    if (!contact.partner_first_name && contactData.partner_first_name) updates.partner_first_name = contactData.partner_first_name
    if (!contact.partner_last_name && contactData.partner_last_name) updates.partner_last_name = contactData.partner_last_name
    if (contactData.wedding_date) updates.wedding_date = contactData.wedding_date
    if (contactData.wedding_location) updates.wedding_location = contactData.wedding_location
    if (Object.keys(updates).length > 0) {
      try {
        await updateContact(storage, env.DB, vendor.id, contact.id, updates)
        Object.assign(contact, updates)
      } catch (e: any) {
        console.error('[enquiry] dedup contact update failed:', e.message)
      }
    }
  } else {
    contact = await createContact(storage, env.DB, vendor.id, {
      ...contactData,
      source,
      form_data: Object.keys(formData).length > 0 ? JSON.stringify(formData) : null,
    })
  }

  // Canonicalise the wedding's region so demand data buckets by where the
  // wedding happens, not just where the vendor is based.
  try {
    await geocodeContactLocation(env, contact.id)
  } catch (err: any) {
    console.error('[enquiry] geocode failed:', err.message)
  }

  await createActivity(env.DB, contact.id, 'lead', SOURCE_LABEL[source])

  // NOTE: an enquiry intentionally does NOT auto-add the vendor to the couple's
  // wedding. The enquiry email is unverified public input, so matching it to an
  // existing wedding and granting membership would let a vendor self-add to any
  // couple's wedding by typing their email. The couple becoming a CRM contact
  // (above) is the enquiry's outcome; membership is established by a BOOKING
  // (couple-confirmed via the invoice token) — see services/booking-wedding.ts.

  track(env.DB, vendor.id, 'enquiry_received', {
    contactId: contact.id,
    metadata: { source },
  })

  await env.EMAIL_QUEUE.send({
    type: 'new_lead',
    vendorId: vendor.id,
    contactId: contact.id,
    // Embed display fields so the notification doesn't depend on a storage
    // read at delivery time — a storage outage must not drop alerts.
    contactFirst: contact.first_name,
    contactLast: contact.last_name,
    contactEmail: contact.email ?? '',
    contactPhone: contact.phone ?? '',
    partnerFirst: contact.partner_first_name ?? '',
    partnerLast: contact.partner_last_name ?? '',
    weddingDate: contact.wedding_date ?? '',
    weddingLocation: contact.wedding_location ?? '',
    message: contact.notes ?? '',
  })

  // AI auto-reply is a Pro feature — only draft one for Pro vendors.
  if (vendor.availability_sharing === 'ai_reply' && contactData.email && (await isProVendor(env.DB, vendor.id))) {
    try {
      await draftAvailabilityReply(env, vendor, contact.id, contactData)
    } catch (e: any) {
      console.error('[enquiry] AI auto-reply failed', e.message)
    }
  }

  // Confirmation email to the enquirer (if the vendor enabled it on the form).
  if (input.confirmation?.enabled && contactData.email) {
    try {
      await sendEnquiryConfirmation(env, vendor, contactData, input.confirmation)
    } catch (e: any) {
      console.error('[enquiry] confirmation email failed', e.message)
    }
  }

  return contact
}

// Build and queue a confirmation email to the enquirer. The body is AI-written
// for Pro vendors (mode 'ai'); otherwise (or if AI returns nothing) it falls
// back to the vendor's template or a sensible default — so a ticked box always
// sends something rather than silently doing nothing.
// Per-recipient daily cap on the submitter-facing confirmation email. The public
// submitter chooses this recipient, so bound how much mail any one address can be
// sent from our domain (stops the receipt being used to spam a chosen victim).
// Generous for legitimate re-submits. Returns true when over.
async function confirmationCapReached(kv: KVNamespace, email: string, limit = 5): Promise<boolean> {
  const key = `rl:formconf:${new Date().toISOString().slice(0, 10)}:${email.toLowerCase()}`
  const n = parseInt((await kv.get(key)) ?? '0', 10)
  if (n >= limit) return true
  await kv.put(key, String(n + 1), { expirationTtl: 60 * 60 * 25 })
  return false
}

// Build + queue the confirmation email to the couple. Exported so the unified
// booking + information funnels reuse the exact same AI/template resolution path.
export async function sendEnquiryConfirmation(
  env: Bindings,
  vendor: VendorProfile,
  contactData: ContactData,
  conf: { enabled: boolean; mode: 'ai' | 'template'; template?: string; aiInstructions?: string; aiPrompt?: string }
): Promise<void> {
  if (!contactData.email || (await confirmationCapReached(env.KV, contactData.email))) return
  let bodyText = ''

  if (conf.mode === 'ai' && (await isProVendor(env.DB, vendor.id))) {
    try {
      const anthropicKey = await resolveSecret(env.KV, vendor.anthropic_api_key)
      const template = await resolvePromptTemplate(env, 'enquiry_reply', conf.aiPrompt)
      bodyText = await draftEnquiryReply(env.AI, {
        vendorName: vendor.business_name,
        vendorCategory: vendor.category,
        contactName: `${contactData.first_name} ${contactData.last_name}`.trim(),
        weddingDate: contactData.wedding_date,
        weddingLocation: contactData.wedding_location,
        isAvailable: null,
        busynessScore: null,
        notes: contactData.notes,
        instructions: conf.aiInstructions ?? null,
        template,
        // Nudge a reply so the enquirer confirms the email arrived (not in spam).
        inviteReply: true,
      }, anthropicKey)
    } catch (e: any) {
      console.error('[enquiry] AI confirmation generation failed, using fallback', e.message)
    }
  }

  // Template mode, non-Pro, or AI failure → the vendor's custom message if set,
  // otherwise a friendly default that recaps what they sent and asks them to
  // reply (so they notice it landed, and we know it cleared their spam filter).
  if (!bodyText.trim()) {
    bodyText = conf.template?.trim() || defaultConfirmationBody(vendor.business_name, contactData)
  }

  await env.EMAIL_QUEUE.send({
    type: 'enquiry_confirmation',
    to: contactData.email,
    vendorName: vendor.business_name,
    contactName: contactData.first_name,
    bodyText,
    // Pro white-label: drop the Wedding Computer logo/footer for this vendor.
    hideBranding: vendor.hide_branding === 1,
    // Replies go to the vendor's inbox so "just hit reply" actually reaches them.
    replyTo: vendor.email_handle ? `${vendor.email_handle}@wedding.computer` : null,
  })
}

function defaultConfirmationBody(vendorName: string, contactData: ContactData): string {
  const recap = [
    contactData.wedding_date ? `Date: ${contactData.wedding_date}` : null,
    contactData.wedding_location ? `Location: ${contactData.wedding_location}` : null,
    contactData.notes ? `Your message: ${contactData.notes}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  return [
    `Thanks so much for reaching out — we've received your enquiry and ${vendorName} will be in touch with you very soon.`,
    recap ? `Here's what you sent us:\n${recap}` : '',
    `If you have a moment, just hit reply to this email so we know it reached you — and that it didn't land in your spam folder.`,
  ]
    .filter(Boolean)
    .join('\n\n')
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
      .prepare(`SELECT COUNT(*) as count FROM calendar_events WHERE vendor_id = ? AND date = ? AND type IN ('booking', 'blocked') AND ${SQL_CALENDAR_EVENT_NOT_CANCELLED('calendar_events')}`)
      .bind(vendor.id, weddingDate)
      .first<{ count: number }>()
    isAvailable = (events?.count ?? 0) === 0

    const score = await getScoreForDate(env.DB, weddingDate, 'global', 'global')
    busynessScore = score?.score ?? null
  }

  const anthropicKey = await resolveSecret(env.KV, vendor.anthropic_api_key)
  const template = await resolvePromptTemplate(env, 'enquiry_reply')
  const draft = await draftEnquiryReply(env.AI, {
    vendorName: vendor.business_name,
    vendorCategory: vendor.category,
    contactName: `${contactData.first_name} ${contactData.last_name}`.trim(),
    weddingDate,
    weddingLocation: contactData.wedding_location ?? null,
    isAvailable,
    busynessScore,
    notes: null,
    template,
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
