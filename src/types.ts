export type Bindings = {
  DB: D1Database
  KV: KVNamespace
  STORAGE?: R2Bucket
  EMAIL_QUEUE: Queue
  SESSION_SECRET: string
  RESEND_API_KEY: string
  ANTHROPIC_API_KEY: string
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  APPLE_CLIENT_ID: string
  APPLE_CLIENT_SECRET: string
  TURNSTILE_SECRET_KEY: string
  TURNSTILE_SITE_KEY: string
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
  avatar_url: string | null
  email_verified: number
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
  ical_token: string | null
  created_at: string
  updated_at: string
}

export type Wedding = {
  id: string
  title: string
  date: string | null
  time: string | null
  location: string | null
  location_lat: number | null
  location_lng: number | null
  status: 'planning' | 'confirmed' | 'completed' | 'cancelled'
  notes: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
}

export type WeddingMember = {
  id: string
  wedding_id: string
  user_id: string
  role: 'owner' | 'vendor' | 'couple' | 'guest'
  vendor_profile_id: string | null
  vendor_role: string | null
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
  notes: string | null
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
