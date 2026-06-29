export type FieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'date'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'number'
  | 'heading'
  | 'address'
  | 'country'
  // Builder additions (custom forms):
  | 'url' // website
  | 'time' // time-of-day picker
  | 'rating' // star rating (1..max)
  | 'scale' // linear/opinion scale (min..max)
  | 'multiselect' // checkboxes — choose many
  | 'file' // file upload

// Field types whose answer is one of a fixed list of options.
export const OPTION_FIELD_TYPES: FieldType[] = ['select', 'radio', 'multiselect']

export type ContactMapping =
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'partner_first_name'
  | 'partner_last_name'
  | 'wedding_date'
  | 'wedding_location'
  | 'notes'

export type FieldCondition = {
  field: string
  operator: 'eq' | 'neq' | 'in'
  value: string | string[]
}

export type FormField = {
  id: string
  type: FieldType
  label: string
  placeholder?: string
  required?: boolean
  options?: string[] | { value: string; label: string }[]
  width?: 'full' | 'half'
  mapTo?: ContactMapping
  helpText?: string
  conditions?: FieldCondition[]
  titleCase?: boolean
  // rating: number of stars (default 5). scale: highest value (default 10).
  max?: number
  // scale: lowest value (default 1).
  min?: number
  // scale: optional endpoint labels.
  minLabel?: string
  maxLabel?: string
  // file: optional accept hint shown to the uploader (e.g. "PDFs and images").
  accept?: string
}

export type FormStep = {
  id: string
  title: string
  description?: string
  fields: FormField[]
}

export type FormAction = {
  type: 'notify_vendor' | 'email_submitter' | 'email_recipient' | 'ai_email' | 'create_contact' | 'generate_pdf'
  enabled: boolean
  emailField?: string
  recipientEmail?: string
  aiPrompt?: string
  template?: string
}

export type FormActions = {
  notifyVendor: boolean
  // Create/update a CRM contact from the submission. Optional in the unified
  // model (forced on for enquiry/booking kinds at resolve time). Information
  // forms opt in.
  createContact?: boolean
  // Forward each submission to another address (a field name or a literal email).
  emailRecipient?: string
  confirmationEmail: {
    enabled: boolean
    mode: 'ai' | 'template'
    template?: string
    // Pro: extra guidance APPENDED to the prompt when drafting the confirmation
    // (tone, things to mention, booking link). Ignored for mode 'template'.
    aiInstructions?: string
    // Pro: a full replacement for the AI prompt template (migration 075). When
    // set, it overrides the admin platform default entirely. Uses {token}
    // placeholders — see src/services/ai-prompts.ts. Ignored for mode 'template'.
    aiPrompt?: string
  }
  // Legacy granular action list (pre-migration-075 custom forms). Still READ as
  // a fallback by resolveFormActions so old configs keep working; the unified
  // editor writes the flat fields above instead.
  actions?: FormAction[]
}

export type ResolvedActions = {
  notifyVendor: boolean
  createContact: boolean
  emailRecipient?: string
  confirmationEmail: FormActions['confirmationEmail']
  generatePdf: boolean
}

// Resolve the effective actions for a submission, reading the unified fields
// with a fallback to the legacy actions[] list, and forcing contact-creation
// for the lead-generating kinds. One place so every channel behaves identically.
export function resolveFormActions(
  config: FormConfig,
  kind: 'information' | 'enquiry' | 'booking',
  formType: string,
): ResolvedActions {
  const a = config.actions
  const legacy = a.actions ?? []
  const hasLegacy = (tp: FormAction['type']) => legacy.some((x) => x.type === tp && x.enabled)
  return {
    notifyVendor: a.notifyVendor !== false,
    createContact: kind === 'enquiry' || kind === 'booking' || a.createContact === true || hasLegacy('create_contact'),
    emailRecipient: a.emailRecipient?.trim() || legacy.find((x) => x.type === 'email_recipient' && x.enabled)?.recipientEmail,
    confirmationEmail: a.confirmationEmail,
    generatePdf: formType === 'noim',
  }
}

export type FormConfig = {
  version: 1
  title: string
  subtitle?: string
  submitLabel: string
  fields: FormField[]
  steps?: FormStep[]
  actions: FormActions
  // Optional success URL. When set, a successful public submission redirects
  // here instead of showing the hosted thank-you page — lets a raw HTML form
  // on the vendor's own site keep the visitor on that site. Vendor-controlled
  // (set in the editor), never taken from the request, so it's not an open redirect.
  redirectUrl?: string
}

export const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Phone' },
  { value: 'date', label: 'Date' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Dropdown' },
  { value: 'radio', label: 'Radio buttons' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'number', label: 'Number' },
  { value: 'heading', label: 'Section heading' },
  { value: 'address', label: 'Address (autocomplete)' },
  { value: 'country', label: 'Country' },
]

export const CONTACT_MAPPINGS: { value: ContactMapping; label: string }[] = [
  { value: 'first_name', label: 'First name' },
  { value: 'last_name', label: 'Last name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'partner_first_name', label: "Partner's first name" },
  { value: 'partner_last_name', label: "Partner's last name" },
  { value: 'wedding_date', label: 'Wedding date' },
  { value: 'wedding_location', label: 'Wedding location' },
  { value: 'notes', label: 'Notes / message' },
]

export function defaultFormConfig(): FormConfig {
  return {
    version: 1,
    title: 'Get in touch',
    submitLabel: 'Send enquiry',
    fields: [
      { id: 'heading_wedding', type: 'heading', label: 'About your wedding' },
      { id: 'wedding_date', type: 'date', label: 'Wedding date', width: 'half', mapTo: 'wedding_date' },
      { id: 'wedding_location', type: 'address', label: 'Wedding location', placeholder: 'City or venue name', width: 'half', mapTo: 'wedding_location' },
      { id: 'ceremony_type', type: 'select', label: 'Ceremony type', options: ['Traditional', 'Elopement', 'Micro wedding', 'Destination', 'Other'], width: 'half' },
      { id: 'guest_count', type: 'select', label: 'Expected guests', options: ['Just us', 'Under 20', '20–50', '50–100', '100–200', '200+'], width: 'half' },
      { id: 'message', type: 'textarea', label: 'Tell us about your plans', placeholder: "What's your vision for the day?", mapTo: 'notes' },
      { id: 'heading_contact', type: 'heading', label: 'Your details' },
      { id: 'first_name', type: 'text', label: 'Your first name', required: true, width: 'half', mapTo: 'first_name' },
      { id: 'last_name', type: 'text', label: 'Your last name', required: true, width: 'half', mapTo: 'last_name' },
      { id: 'email', type: 'email', label: 'Email', required: true, width: 'half', mapTo: 'email' },
      { id: 'phone', type: 'tel', label: 'Phone', width: 'half', mapTo: 'phone' },
      { id: 'partner_first', type: 'text', label: "Partner's first name", width: 'half', mapTo: 'partner_first_name' },
      { id: 'partner_last', type: 'text', label: "Partner's last name", width: 'half', mapTo: 'partner_last_name' },
    ],
    actions: {
      notifyVendor: true,
      confirmationEmail: { enabled: false, mode: 'ai' },
    },
  }
}

export function defaultBookingFormConfig(): FormConfig {
  return {
    version: 1,
    title: 'Confirm your booking',
    submitLabel: 'Confirm booking',
    fields: [
      { id: 'heading_details', type: 'heading', label: 'Booking details' },
      { id: 'ceremony_style', type: 'select', label: 'Ceremony style', options: ['Traditional', 'Modern', 'Non-traditional', 'Not sure yet'], width: 'half' },
      { id: 'guest_count', type: 'select', label: 'Expected guests', options: ['Just us', 'Under 20', '20–50', '50–100', '100–200', '200+'], width: 'half' },
      { id: 'special_requests', type: 'textarea', label: 'Special requests or notes', placeholder: 'Anything we should know?' },
      { id: 'heading_terms', type: 'heading', label: 'Terms' },
      { id: 'terms', type: 'checkbox', label: 'I agree to the terms and conditions', required: true },
    ],
    actions: {
      notifyVendor: true,
      confirmationEmail: { enabled: false, mode: 'ai' },
    },
  }
}

export function parseBookingFormConfig(json: string | null): FormConfig {
  if (!json) return defaultBookingFormConfig()
  try {
    const parsed = JSON.parse(json) as FormConfig
    if (parsed.version !== 1 || !Array.isArray(parsed.fields)) return defaultBookingFormConfig()
    return parsed
  } catch {
    return defaultBookingFormConfig()
  }
}

export function validateBookingFormConfig(config: FormConfig): string | null {
  if (!config.title?.trim()) return 'Form title is required'
  if (!config.submitLabel?.trim()) return 'Submit button label is required'
  if (!config.fields || config.fields.length === 0) return 'Form must have at least one field'

  const ids = new Set<string>()
  for (const field of config.fields) {
    if (!field.id?.trim()) return 'Every field must have an ID'
    if (ids.has(field.id)) return `Duplicate field ID: ${field.id}`
    ids.add(field.id)
    if (!field.label?.trim()) return `Field "${field.id}" must have a label`
    if ((field.type === 'select' || field.type === 'radio') && (!field.options || field.options.length === 0)) {
      return `Field "${field.label}" needs at least one option`
    }
  }

  return null
}

export function parseFormConfig(json: string | null): FormConfig {
  if (!json) return defaultFormConfig()
  try {
    const parsed = JSON.parse(json) as FormConfig
    if (parsed.version !== 1 || !Array.isArray(parsed.fields)) return defaultFormConfig()
    return parsed
  } catch {
    return defaultFormConfig()
  }
}

export function validateFormConfig(config: FormConfig): string | null {
  if (!config.title?.trim()) return 'Form title is required'
  if (!config.submitLabel?.trim()) return 'Submit button label is required'
  if (!config.fields || config.fields.length === 0) return 'Form must have at least one field'

  const hasEmail = config.fields.some((f) => f.mapTo === 'email')
  const hasFirstName = config.fields.some((f) => f.mapTo === 'first_name')
  const hasLastName = config.fields.some((f) => f.mapTo === 'last_name')

  if (!hasEmail) return 'Form must include a field mapped to Email'
  if (!hasFirstName) return 'Form must include a field mapped to First name'
  if (!hasLastName) return 'Form must include a field mapped to Last name'

  const ids = new Set<string>()
  for (const field of config.fields) {
    if (!field.id?.trim()) return 'Every field must have an ID'
    if (ids.has(field.id)) return `Duplicate field ID: ${field.id}`
    ids.add(field.id)
    if (!field.label?.trim()) return `Field "${field.id}" must have a label`
    if ((field.type === 'select' || field.type === 'radio') && (!field.options || field.options.length === 0)) {
      return `Field "${field.label}" needs at least one option`
    }
  }

  return null
}

export function generateFieldId(): string {
  return 'f_' + Math.random().toString(36).slice(2, 8)
}

// ─── Modern form builder (custom forms) ───
//
// The builder is a client-side editor (src/routes/vendor/forms.tsx) that posts
// the whole fields array as JSON. BUILDER_FIELD_TYPES drives its "add field"
// menu; each entry carries a group + an SVG path so the picker can show icons.

export type BuilderFieldType = {
  value: FieldType
  label: string
  group: string
  icon: string // single SVG path `d` (24x24, currentColor stroke)
  hint?: string
}

export const BUILDER_FIELD_TYPES: BuilderFieldType[] = [
  // Text
  { value: 'text', label: 'Short text', group: 'Text', icon: 'M4 7h16M4 12h9' },
  { value: 'textarea', label: 'Long text', group: 'Text', icon: 'M4 6h16M4 10h16M4 14h10' },
  { value: 'email', label: 'Email', group: 'Text', icon: 'M3 8l9 6 9-6M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z' },
  { value: 'tel', label: 'Phone', group: 'Text', icon: 'M5 3h3l2 5-2 1a11 11 0 005 5l1-2 5 2v3a2 2 0 01-2 2A16 16 0 013 5a2 2 0 012-2z' },
  { value: 'number', label: 'Number', group: 'Text', icon: 'M9 4L7 20M17 4l-2 16M4 9h16M3 15h16' },
  { value: 'url', label: 'Website', group: 'Text', icon: 'M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1' },
  // Choice
  { value: 'select', label: 'Dropdown', group: 'Choice', icon: 'M6 9l6 6 6-6' },
  { value: 'radio', label: 'Multiple choice', group: 'Choice', icon: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 15a3 3 0 100-6 3 3 0 000 6z' },
  { value: 'multiselect', label: 'Checkboxes', group: 'Choice', icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11' },
  { value: 'checkbox', label: 'Single checkbox', group: 'Choice', icon: 'M5 13l4 4L19 7' },
  // Date & time
  { value: 'date', label: 'Date', group: 'Date & time', icon: 'M8 7V3m8 4V3M3 11h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z' },
  { value: 'time', label: 'Time', group: 'Date & time', icon: 'M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  // Rating
  { value: 'rating', label: 'Star rating', group: 'Rating', icon: 'M11.48 3.5l2.36 4.78 5.28.77-3.82 3.72.9 5.26-4.72-2.48-4.72 2.48.9-5.26L3.84 9.05l5.28-.77z' },
  { value: 'scale', label: 'Linear scale', group: 'Rating', icon: 'M4 18h16M5 18v-3m5 3V9m5 9v-6m4 6V6' },
  // Media
  { value: 'file', label: 'File upload', group: 'Media', icon: 'M15.5 8.5V16a3.5 3.5 0 01-7 0V6a2.25 2.25 0 014.5 0v9a1 1 0 01-2 0V8.5' },
  // Contact
  { value: 'address', label: 'Address', group: 'Contact', icon: 'M12 11a3 3 0 100-6 3 3 0 000 6zM12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11z' },
  { value: 'country', label: 'Country', group: 'Contact', icon: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3a15 15 0 010 18 15 15 0 010-18z' },
  // Layout
  { value: 'heading', label: 'Section heading', group: 'Layout', icon: 'M6 4v16M18 4v16M6 12h12' },
]

const BUILDER_TYPE_SET = new Set<string>(BUILDER_FIELD_TYPES.map((t) => t.value))

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  if (!Number.isFinite(n)) return dflt
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

// Take the untrusted fields array a client builder posted and return a clean,
// whitelisted FormField[]. Drops unknown props, coerces per-type settings, and
// fills/repairs ids so the saved config always matches the FormField shape.
export function sanitizeBuilderFields(input: unknown): FormField[] {
  if (!Array.isArray(input)) return []
  const out: FormField[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const type = (BUILDER_TYPE_SET.has(String(r.type)) ? r.type : 'text') as FieldType
    const label = String(r.label ?? '').trim()
    if (!label) continue
    let id = String(r.id ?? '').trim()
    // Ids flow into HTML attributes + a client-rendered builder; keep them to a
    // safe charset (and regenerate empties/dupes) so they can never inject.
    if (!id || seen.has(id) || !/^[A-Za-z0-9_-]+$/.test(id)) id = generateFieldId()
    seen.add(id)

    const field: FormField = { id, type, label }

    if (type !== 'heading') {
      const placeholder = String(r.placeholder ?? '').trim()
      if (placeholder) field.placeholder = placeholder
      if (r.required === true || r.required === 'true' || r.required === 'on') field.required = true
      field.width = r.width === 'half' ? 'half' : 'full'
      const helpText = String(r.helpText ?? '').trim()
      if (helpText) field.helpText = helpText
      const mapTo = String(r.mapTo ?? '').trim()
      if (mapTo && CONTACT_MAPPINGS.some((m) => m.value === mapTo)) field.mapTo = mapTo as ContactMapping
    }

    if (OPTION_FIELD_TYPES.includes(type)) {
      const opts = Array.isArray(r.options)
        ? (r.options as unknown[]).map((o) => String(typeof o === 'string' ? o : (o as any)?.value ?? '').trim()).filter(Boolean)
        : String(r.options ?? '').split('\n').map((o) => o.trim()).filter(Boolean)
      field.options = opts
    }
    if (type === 'rating') field.max = clampInt(r.max, 3, 10, 5)
    if (type === 'scale') {
      field.min = clampInt(r.min, 0, 1, 1)
      field.max = clampInt(r.max, field.min + 1, 11, 10)
      const minLabel = String(r.minLabel ?? '').trim()
      const maxLabel = String(r.maxLabel ?? '').trim()
      if (minLabel) field.minLabel = minLabel
      if (maxLabel) field.maxLabel = maxLabel
    }
    if (type === 'file') {
      const accept = String(r.accept ?? '').trim()
      if (accept) field.accept = accept
    }
    out.push(field)
  }
  return out
}

// Validate a sanitised builder fields array. Custom forms are general-purpose,
// so (unlike the enquiry form) no contact mapping is required.
export function validateBuilderFields(fields: FormField[]): string | null {
  if (fields.length === 0) return 'Add at least one field'
  for (const f of fields) {
    if (!f.label?.trim()) return 'Every field needs a label'
    if (OPTION_FIELD_TYPES.includes(f.type) && (!f.options || (f.options as unknown[]).length === 0)) {
      return `"${f.label}" needs at least one option`
    }
  }
  return null
}

// Unified-forms validation (migration 075). A form's `kind` decides what its
// fields MUST capture so the per-kind side effects can actually run:
//   - enquiry / booking create or update a CRM contact, so they need a field
//     mapped to email + first name + last name (otherwise the contact silently
//     never gets created — the B2 bug). 'booking' may run against an existing
//     invoice contact, but a standalone booking form must be self-sufficient.
//   - information collects data only, so it needs no mapping.
// Always runs the structural field checks first.
export function validateFormForType(
  kind: 'information' | 'enquiry' | 'booking',
  config: FormConfig
): string | null {
  const fields = config.steps ? config.steps.flatMap((s) => s.fields) : config.fields
  const structural = validateBuilderFields(fields)
  if (structural) return structural
  if (kind === 'enquiry' || kind === 'booking') {
    if (!fields.some((f) => f.mapTo === 'email')) return 'Add a field mapped to Email so leads are captured'
    if (!fields.some((f) => f.mapTo === 'first_name')) return 'Add a field mapped to First name'
    if (!fields.some((f) => f.mapTo === 'last_name')) return 'Add a field mapped to Last name'
  }
  return null
}

// Does any field in the config accept a file upload? Drives the public form's
// multipart encoding.
export function configHasFileField(config: FormConfig): boolean {
  const all = config.steps ? config.steps.flatMap((s) => s.fields) : config.fields
  return all.some((f) => f.type === 'file')
}

// Does any field need Google Places autocomplete? Used so public custom forms
// with dates/text/uploads don't pay for the Maps JavaScript payload.
export function configHasAddressField(config: FormConfig): boolean {
  const all = config.steps ? config.steps.flatMap((s) => s.fields) : config.fields
  return all.some((f) => f.type === 'address')
}
