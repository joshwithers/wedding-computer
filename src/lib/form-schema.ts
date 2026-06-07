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
  confirmationEmail: {
    enabled: boolean
    mode: 'ai' | 'template'
    template?: string
  }
  actions?: FormAction[]
}

export type FormConfig = {
  version: 1
  title: string
  subtitle?: string
  submitLabel: string
  fields: FormField[]
  steps?: FormStep[]
  actions: FormActions
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
      { id: 'wedding_location', type: 'text', label: 'Wedding location', placeholder: 'City or venue name', width: 'half', mapTo: 'wedding_location' },
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
