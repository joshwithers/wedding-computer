export type Bindings = {
  DB: D1Database
  KV: KVNamespace
  STORAGE?: R2Bucket
  EMAIL_QUEUE: Queue
  AI: Ai
  SEND_EMAIL: SendEmail
  SESSION_SECRET: string
  RESEND_API_KEY: string
  ANTHROPIC_API_KEY?: string
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  APPLE_CLIENT_ID: string
  APPLE_CLIENT_SECRET: string
  TURNSTILE_SECRET_KEY: string
  TURNSTILE_SITE_KEY: string
  GOOGLE_MAPS_API_KEY?: string
  APP_URL: string
}

export type Env = {
  Bindings: Bindings
  Variables: {
    user: User
    vendor?: VendorProfile
    csrfToken: string
  }
}

export type User = {
  id: string
  email: string
  name: string
  phone: string | null
  date_of_birth: string | null
  address_line_1: string | null
  address_line_2: string | null
  city: string | null
  state: string | null
  postcode: string | null
  country: string | null
  instagram: string | null
  facebook: string | null
  tiktok: string | null
  linkedin: string | null
  website: string | null
  avatar_url: string | null
  avatar_r2_key: string | null
  email_verified: number
  is_admin: number
  created_at: string
  updated_at: string
}

export type VendorProfile = {
  id: string
  user_id: string
  business_name: string
  category: string
  phone: string | null
  website: string | null
  instagram: string | null
  bio: string | null
  location: string | null
  timezone: string
  stripe_account_id: string | null
  stripe_onboarding_complete: number
  availability_default: string | null
  is_organiser: number
  enquiry_form: string | null
  booking_form: string | null
  ceremony_types: string | null
  ical_token: string | null
  anthropic_api_key: string | null
  email_handle: string | null
  storage_type: string | null
  storage_config: string | null
  tax_label: string | null
  tax_rate: number
  tax_inclusive: number
  tax_number: string | null
  tax_number_label: string | null
  business_address: string | null
  invoice_prefix: string
  next_invoice_number: number
  card_fee_enabled: number
  card_fee_percent: number
  service_templates: string | null
  invoice_defaults: string | null
  created_at: string
  updated_at: string
}

export type ServiceTemplate = {
  name: string
  description: string
  price_cents: number
}

export type InvoiceDefaults = {
  booking_fee_type: 'fixed' | 'percentage'
  booking_fee_value: number
  installments: number
  notes: string
  include_card_fee: boolean
}

export type Email = {
  id: string
  vendor_id: string | null
  contact_id: string | null
  direction: 'inbound' | 'outbound'
  from_email: string
  from_name: string | null
  to_email: string
  to_name: string | null
  reply_to: string | null
  subject: string
  body_text: string | null
  body_html: string | null
  message_id: string | null
  in_reply_to: string | null
  thread_id: string | null
  status: 'draft' | 'queued' | 'sent' | 'failed' | 'received'
  is_read: number
  is_system: number
  error: string | null
  created_at: string
}

export type Wedding = {
  id: string
  title: string
  date: string | null
  time: string | null
  duration_hours: number | null
  location: string | null
  location_lat: number | null
  location_lng: number | null
  status: 'planning' | 'confirmed' | 'completed' | 'cancelled'
  ceremony_type: string | null
  vendor_visibility: 'private' | 'visible'
  ceremony_location: string | null
  reception_location: string | null
  reception_time: string | null
  getting_ready_location: string | null
  getting_ready_time: string | null
  getting_ready_1_label: string | null
  getting_ready_2_location: string | null
  getting_ready_2_label: string | null
  getting_ready_2_time: string | null
  portrait_location: string | null
  portrait_time: string | null
  emoji: string | null
  bump_in_time: string | null
  bump_out_time: string | null
  timeline_notes: string | null
  dress_code: string | null
  guest_count: number | null
  notes: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
}

export type WeddingLogEntry = {
  id: string
  wedding_id: string
  user_id: string | null
  action: string
  detail: string | null
  created_at: string
}

export type TodoTemplate = {
  id: string
  vendor_id: string
  name: string
  content: string
  is_default: number
  created_at: string
  updated_at: string
}

export type WeddingTodo = {
  id: string
  vendor_id: string
  wedding_id: string
  content: string
  template_id: string | null
  created_at: string
  updated_at: string
}

export type ServiceContract = {
  id: string
  vendor_id: string
  title: string
  body: string
  is_template: number
  wedding_id: string | null
  invoice_id: string | null
  signed_at: string | null
  signed_by_name: string | null
  signed_by_email: string | null
  signed_ip: string | null
  created_at: string
  updated_at: string
}

export type WeddingMember = {
  id: string
  wedding_id: string
  user_id: string
  role: 'vendor' | 'couple' | 'guest'
  vendor_profile_id: string | null
  vendor_role: string | null
  can_manage: number
  is_financial_party: number
  permissions: string
  status: 'invited' | 'active' | 'removed'
  invited_at: string
  accepted_at: string | null
  created_at: string
}

export type Contact = {
  id: string
  vendor_id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  partner_first_name: string | null
  partner_last_name: string | null
  partner_email: string | null
  partner_phone: string | null
  source: string | null
  status: 'new' | 'contacted' | 'meeting' | 'quoted' | 'booked' | 'completed' | 'lost' | 'archived'
  wedding_id: string | null
  wedding_date: string | null
  wedding_location: string | null
  notes: string | null
  tags: string | null
  form_data: string | null
  last_contacted_at: string | null
  created_at: string
  updated_at: string
}

export type Invoice = {
  id: string
  vendor_id: string
  contact_id: string | null
  wedding_id: string | null
  stripe_invoice_id: string | null
  stripe_payment_intent_id: string | null
  title: string
  description: string | null
  amount_cents: number
  currency: string
  status: 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'cancelled' | 'refunded'
  due_date: string | null
  paid_at: string | null
  line_items: string | null
  booking_fee_type: 'fixed' | 'percentage'
  booking_fee_value: number
  public_token: string | null
  notes: string | null
  booking_form_data: string | null
  invoice_number: string | null
  tax_label: string | null
  tax_rate: number
  tax_inclusive: number
  subtotal_cents: number
  tax_amount_cents: number
  card_fee_cents: number
  card_fee_percent: number
  vendor_tax_number: string | null
  vendor_business_name: string | null
  vendor_business_address: string | null
  created_at: string
  updated_at: string
}

export type LineItem = {
  description: string
  amount_cents: number
  quantity: number
}

export type InvoicePayment = {
  id: string
  invoice_id: string
  vendor_id: string
  label: string
  amount_cents: number
  due_date: string | null
  status: 'pending' | 'paid' | 'overdue'
  method: 'stripe' | 'cash' | 'bank_transfer' | 'payid' | null
  stripe_payment_intent_id: string | null
  paid_at: string | null
  notes: string | null
  created_at: string
}

export type CoupleVendor = {
  id: string
  wedding_id: string
  name: string
  category: string | null
  email: string | null
  phone: string | null
  website: string | null
  instagram: string | null
  notes: string | null
  expected_price_cents: number | null
  vendor_profile_id: string | null
  status: 'considering' | 'contacted' | 'booked' | 'removed'
  created_at: string
  updated_at: string
}

export const COUPLE_VENDOR_CATEGORIES = [
  'celebrant', 'photographer', 'videographer', 'florist', 'planner',
  'venue', 'stylist', 'caterer', 'dj', 'band', 'hair', 'makeup',
  'cake', 'stationery', 'photo booth', 'transport', 'accommodation', 'other',
] as const

export type CalendarEvent = {
  id: string
  vendor_id: string
  wedding_id: string | null
  title: string
  date: string
  start_time: string | null
  end_time: string | null
  all_day: number
  type: 'booking' | 'blocked' | 'personal' | 'other'
  google_event_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type EnrichedCalendarEvent = CalendarEvent & {
  wedding_title: string | null
  wedding_date: string | null
  wedding_time: string | null
  wedding_location: string | null
  ceremony_type: string | null
  ceremony_location: string | null
  reception_location: string | null
  reception_time: string | null
  getting_ready_location: string | null
  getting_ready_time: string | null
  getting_ready_1_label: string | null
  getting_ready_2_location: string | null
  getting_ready_2_label: string | null
  getting_ready_2_time: string | null
  portrait_location: string | null
  portrait_time: string | null
  dress_code: string | null
  guest_count: number | null
  duration_hours: number | null
  wedding_notes: string | null
  timeline_notes: string | null
  contact_first_name: string | null
  contact_last_name: string | null
  contact_email: string | null
  contact_phone: string | null
  partner_first_name: string | null
  partner_last_name: string | null
  partner_email: string | null
  partner_phone: string | null
}

export type Document = {
  id: string
  wedding_id: string | null
  vendor_id: string | null
  uploaded_by_user_id: string
  r2_key: string
  filename: string
  mime_type: string
  size_bytes: number
  category: string | null
  description: string | null
  visibility: 'private' | 'wedding' | 'public'
  created_at: string
}

export type DocumentShare = {
  id: string
  document_id: string
  user_id: string
  created_at: string
}

export type Session = {
  id: string
  user_id: string
  expires_at: string
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export type AuditEntry = {
  id: string
  user_id: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  metadata: string | null
  ip_address: string | null
  created_at: string
}

export const VENDOR_CATEGORIES = [
  'celebrant',
  'photographer',
  'videographer',
  'florist',
  'planner',
  'venue',
  'stylist',
  'caterer',
  'dj',
  'band',
  'hair',
  'makeup',
  'cake',
  'stationery',
  'other',
] as const

export type VendorCategory = (typeof VENDOR_CATEGORIES)[number]

export type PasskeyCredential = {
  id: string
  user_id: string
  credential_id: string
  public_key: string
  counter: number
  device_name: string | null
  transports: string | null
  backed_up: number
  created_at: string
  last_used_at: string | null
}

export type AnalyticsEvent = {
  id: string
  vendor_id: string
  event_type: string
  contact_id: string | null
  wedding_id: string | null
  invoice_id: string | null
  metadata: string | null
  created_at: string
}

export const ANALYTICS_EVENT_TYPES = [
  'enquiry_received',
  'contact_created',
  'status_change',
  'booking_confirmed',
  'invoice_created',
  'invoice_sent',
  'payment_received',
  'wedding_created',
  'couple_invited',
  'couple_joined',
] as const

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number]

export type BusinessGoal = {
  id: string
  vendor_id: string
  period_type: 'year' | 'season' | 'month'
  period_value: string
  goal_type: 'enquiries' | 'bookings' | 'revenue'
  target: number
  created_at: string
  updated_at: string
}

export type Subscription = {
  id: string
  vendor_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  plan: 'free' | 'pro'
  status: 'active' | 'past_due' | 'cancelled' | 'trialing'
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: number
  created_at: string
  updated_at: string
}

export const SEASONS = ['summer', 'autumn', 'winter', 'spring'] as const
export type Season = (typeof SEASONS)[number]
