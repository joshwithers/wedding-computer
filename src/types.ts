export type Bindings = {
  ASSETS?: Fetcher
  DB: D1Database
  KV: KVNamespace
  STORAGE?: R2Bucket
  EMAIL_QUEUE: Queue
  AI: Ai
  SEND_EMAIL: SendEmail
  SESSION_SECRET: string
  RESEND_API_KEY: string
  // Svix signing secret for the Resend delivery webhook (POST /webhooks/resend).
  // Set via: wrangler secret put RESEND_WEBHOOK_SECRET
  RESEND_WEBHOOK_SECRET?: string
  ANTHROPIC_API_KEY?: string
  STRIPE_SECRET_KEY: string
  // Signing secret for the dashboard endpoint listening to events on the
  // platform account (Pro subscriptions: checkout.session.completed,
  // customer.subscription.*). Set via: wrangler secret put STRIPE_WEBHOOK_SECRET
  STRIPE_WEBHOOK_SECRET: string
  // Signing secret for the second dashboard endpoint listening to events on
  // Connected accounts (account.updated, payment_intent.succeeded). Both
  // endpoints deliver to POST /webhooks/stripe; verification tries each
  // secret. Set via: wrangler secret put STRIPE_CONNECT_WEBHOOK_SECRET
  STRIPE_CONNECT_WEBHOOK_SECRET?: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  APPLE_CLIENT_ID: string
  APPLE_CLIENT_SECRET: string
  TURNSTILE_SECRET_KEY: string
  TURNSTILE_SITE_KEY: string
  GOOGLE_MAPS_API_KEY?: string
  // Dedicated server-side geocoding key (Geocoding API enabled, NOT Referer-
  // restricted). When set, classicGeocode uses it instead of falling through to
  // the much pricier Places searchText. See services/geocode.ts.
  GOOGLE_GEOCODING_KEY?: string
  // Open-Meteo commercial API key. When set, forecasts use the paid
  // customer-api.open-meteo.com endpoint (commercial licence, BoM ACCESS via
  // best_match for AU); when unset, the free api.open-meteo.com endpoint is used
  // (local dev only — the free tier is non-commercial). Set via:
  // wrangler secret put WEATHER_API_KEY
  WEATHER_API_KEY?: string
  // When set (non-empty), new self-signups via the public login form must supply
  // this invite code. Existing users and invite-link arrivals are unaffected.
  // Unset/empty = open signups. Set via: wrangler secret put SIGNUP_INVITE_CODE
  SIGNUP_INVITE_CODE?: string
  // Enables the /dev/login/:email session-minting bypass. MUST be unset in
  // any deployed environment — set to 'true' only in local .dev.vars. The
  // route 404s unless this is exactly 'true', so deployed environments are
  // safe by default regardless of proxy/header behaviour.
  ENABLE_DEV_LOGIN?: string
  // Where inbound mail to a RESERVED @wedding.computer handle (admin, support,
  // our brand words, generic terms — see lib/reserved-handles.ts) is forwarded.
  // MUST be a VERIFIED Cloudflare Email Routing destination (e.g. the real inbox
  // hello@wedding.computer already forwards to). Unset → reserved mail is
  // rejected (no silent drop). Set via: wrangler secret put RESERVED_FORWARD_EMAIL
  RESERVED_FORWARD_EMAIL?: string
  APP_URL: string
}

export type Env = {
  Bindings: Bindings
  Variables: {
    user: User
    vendor?: VendorProfile
    csrfToken: string
    // Per-request Server-Timing collector (src/lib/timing.ts), wired in index.tsx.
    timing?: import('./lib/timing').TimingCollector
    // Per-request D1 read session (src/middleware/d1-session.ts). Heavy read-only
    // GET queries route through this (via dbOf) so they can use a read replica;
    // auth + writes stay on the primary binding. Undefined outside the app.
    db?: D1DatabaseSession
  }
}

/**
 * The subset of D1 that both the primary binding (`D1Database`) and a read
 * replica session (`D1DatabaseSession`) satisfy. DB functions that should be
 * able to run against either accept this instead of the concrete `D1Database`,
 * so passing a session is a non-breaking widening (every existing `c.env.DB`
 * caller still type-checks).
 */
export type D1Like = Pick<D1Database, 'prepare' | 'batch'>

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
  /** BCP 47 locale preference ('en-AU'); null = resolve from Accept-Language. */
  locale: string | null
  /** IANA timezone preference; null = fall back to vendor timezone / default. */
  timezone: string | null
  /** Weather forecast unit: 'c' | 'f'; null = default Celsius. */
  temperature_unit: string | null
  /** JSON { [notificationKey]: boolean }; missing key = enabled. See services/notification-prefs.ts. */
  notification_prefs: string
  /** Set when soft-deleted; cleared on restore; hard-purged 30 days later. */
  deleted_at: string | null
  /** Personal calendar feed token (hashed 'sha256:...'), lazily minted. */
  feed_token: string | null
  created_at: string
  updated_at: string
}

export type VendorProfile = {
  id: string
  user_id: string
  business_name: string
  category: string
  /** JSON array of all vendor types; `category` is the primary. */
  categories: string | null
  /** Display preference for the 'celebrant' role: null = "Celebrant", 'officiant' = "Officiant". */
  celebrant_term: string | null
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
  is_agency: number
  enquiry_form: string | null
  booking_form: string | null
  ceremony_types: string | null
  ical_token: string | null
  enquiry_key: string | null
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
  location_city: string | null
  location_state: string | null
  location_country: string | null
  location_lat: number | null
  location_lng: number | null
  location_place_id: string | null
  logo_r2_key: string | null
  brand_theme: string | null
  availability_sharing: 'private' | 'vendors_only' | 'public' | 'ai_reply'
  directory_listed: number
  referral_code: string | null
  referred_by_vendor_id: string | null
  free_months: number
  setup_dismissed: number
  demo_dismissed: number
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
  location_city: string | null
  location_state: string | null
  location_country: string | null
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
  reception_duration_hours: number | null
  timeline_notes: string | null
  dress_code: string | null
  guest_count: number | null
  notes: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
  // Lifecycle (migration 074)
  confirmed_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  postponed_at: string | null
  cancellation_reason: string | null
  cancellation_note: string | null
  original_date: string | null
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
  vendor_roles: string | null // JSON array of vendor-type slugs for this wedding (NULL → use vendor_role)
  invited_instagram: string | null // sanitized handle for an email-invited vendor with no profile yet
  can_manage: number
  is_financial_party: number
  permissions: string
  status: 'invited' | 'active' | 'removed'
  vendor_notes: string | null
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
  address: string | null
  instagram: string | null
  facebook: string | null
  tiktok: string | null
  website: string | null
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
  // Why a lead was lost or its booking cancelled (migration 074)
  lost_reason: string | null
  lost_note: string | null
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
  // Couple identity from the shared wedding membership — available even when the
  // viewing vendor owns no contact for this wedding (e.g. a vendor ADDED to
  // someone else's wedding). Used for the event title + a contact fallback.
  couple_names: string | null
  couple_email: string | null
  // The real run-sheet item behind a wc:* slot event (NULL for the synthetic
  // ceremony-prep block + legacy rows) so the title/description match the timeline.
  timeline_item_title: string | null
  timeline_item_description: string | null
  // Wedding venue location → its IANA timezone (so times show in venue-local time).
  wedding_location_state: string | null
  wedding_location_country: string | null
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

export type WebLink = {
  id: string
  wedding_id: string
  url: string
  title: string
  site_name: string | null
  image_url: string | null
  added_by_user_id: string | null
  added_by_name: string
  added_by_role: string
  pinned: number
  pinned_at: string | null
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

export type Referral = {
  id: string
  referrer_vendor_id: string
  referred_vendor_id: string
  status: 'pending' | 'converted'
  created_at: string
  converted_at: string | null
}

export type FreeMonthGrant = {
  id: string
  vendor_id: string
  months: number
  source: 'referral_reward' | 'referred_signup' | 'admin_gift'
  granted_by_user_id: string | null
  note: string | null
  created_at: string
}

export const SEASONS = ['summer', 'autumn', 'winter', 'spring'] as const
export type Season = (typeof SEASONS)[number]

export type TeamMember = {
  id: string
  vendor_id: string
  user_id: string | null
  name: string
  email: string | null
  phone: string | null
  title: string | null
  avatar_url: string | null
  is_active: number
  notes: string | null
  created_at: string
  updated_at: string
}

export type WeddingTeamAssignment = {
  id: string
  wedding_id: string
  wedding_member_id: string
  team_member_id: string
  role: string | null
  notes: string | null
  assigned_at: string
}

export type ImportJob = {
  id: string
  vendor_id: string
  source: string
  entity_type: 'contact' | 'wedding' | 'invoice'
  status: 'uploading' | 'mapping' | 'previewing' | 'processing' | 'completed' | 'failed' | 'cancelled'
  filename: string | null
  column_mapping: string | null
  total_records: number
  imported_count: number
  skipped_count: number
  failed_count: number
  error_log: string | null
  config: string | null
  raw_data: string | null
  preview_data: string | null
  created_at: string
  completed_at: string | null
}

export type TimelineChangeRequest = {
  id: string
  wedding_id: string
  requested_by_user_id: string
  requested_by_label: string | null
  target: 'wedding' | 'run_sheet'
  op: 'create' | 'update' | 'delete'
  run_sheet_item_id: string | null
  vendor_profile_id: string | null
  payload: string
  summary: string | null
  status: 'pending' | 'approved' | 'declined'
  decided_by_user_id: string | null
  decided_at: string | null
  created_at: string
}

export type ImportRecord = {
  id: string
  import_job_id: string
  record_index: number
  entity_type: string
  entity_id: string | null
  raw_data: string
  mapped_data: string | null
  status: 'pending' | 'imported' | 'skipped' | 'failed' | 'duplicate'
  error: string | null
  created_at: string
}

export const IMPORT_SOURCES = [
  'csv', 'json', 'dubsado', 'studio_ninja', 'honeybook', 'vsco_workspace', 'tardis', 'text', 'web_scrape',
] as const
export type ImportSource = (typeof IMPORT_SOURCES)[number]

export type RunSheetItem = {
  id: string
  wedding_id: string
  vendor_id: string
  time: string | null
  end_time: string | null
  title: string
  description: string | null
  location: string | null
  assigned_to: string | null
  category: 'getting_ready' | 'ceremony' | 'portraits' | 'reception' | 'other'
  sort_order: number
  created_at: string
  updated_at: string
}

export const RUN_SHEET_CATEGORIES = [
  'getting_ready', 'ceremony', 'portraits', 'reception', 'other',
] as const

// ── Unified wedding timeline (replaces run_sheet_items + structured times) ──

export const TIMELINE_CATEGORIES = [
  'getting_ready', 'ceremony', 'portraits', 'reception', 'other',
] as const
export type TimelineCategory = (typeof TIMELINE_CATEGORIES)[number]

export type TimelineVisibility = 'couple' | 'vendors' | 'private'

/** A named headline slot backfilled from the old structured wedding fields. */
export type TimelineSlot =
  | 'getting_ready_1' | 'getting_ready_2' | 'ceremony' | 'portraits' | 'reception'

export type TimelineItem = {
  id: string
  wedding_id: string
  start_time: string | null
  end_time: string | null
  title: string
  description: string | null
  location: string | null
  category: TimelineCategory
  owner_vendor_id: string | null
  created_by_user_id: string | null
  visibility: TimelineVisibility
  slot: TimelineSlot | null
  sort_order: number
  // Liquid timeline (migration 052). anchor_type null = plain absolute item
  // keyed off start_time; otherwise start is computed relative to another item
  // or a sun event. start_time/end_time are materialised from the solver on
  // every write so all the downstream readers (calendar, markdown, MCP) see
  // concrete times.
  duration_minutes: number | null
  anchor_type: 'after' | 'before' | 'sun' | null
  anchor_ref: string | null
  anchor_offset_minutes: number
  pinned: number
  actual_start: string | null
  // Astronomical fact row ('sunrise' | 'sunset'); null = a normal item. Facts are
  // points in time (no people, no start/stop, time derived from the sun anchor).
  marker: TimelineMarker | null
  created_at: string
  updated_at: string
}

export type TimelineMarker = 'sunrise' | 'sunset'

export type TimelineItemAssignee = {
  id: string
  timeline_item_id: string
  wedding_member_id: string | null
  team_member_id: string | null
  label: string | null
  created_at: string
}

export type BusynessScore = {
  id: string
  date: string
  level: 'city' | 'state' | 'country' | 'global'
  level_value: string
  enquiry_count: number
  booking_count: number
  score: number
  created_at: string
}

export type QuoteCalculator = {
  id: string
  vendor_id: string
  title: string
  description: string | null
  config: string
  is_active: number
  public_token: string | null
  created_at: string
  updated_at: string
}

export type QuoteCalculatorConfig = {
  base_price_cents: number
  currency: string
  options: QuoteOption[]
}

export type QuoteOption = {
  name: string
  description?: string
  price_cents: number
  type: 'addon' | 'upgrade' | 'hourly'
}

export type Form = {
  id: string
  vendor_id: string
  title: string
  slug: string | null
  type: 'custom' | 'noim' | 'contact'
  config: string
  is_active: number
  public_token: string
  wedding_id: string | null
  contact_id: string | null
  submission_count: number
  created_at: string
  updated_at: string
}

export type FormSubmission = {
  id: string
  form_id: string
  vendor_id: string
  data: string
  contact_id: string | null
  status: 'submitted' | 'reviewed' | 'archived'
  ip_address: string | null
  user_agent: string | null
  wedding_id: string | null
  form_send_id: string | null
  shared_with_team: number
  created_at: string
}

export type FormSend = {
  id: string
  form_id: string
  wedding_id: string
  vendor_id: string
  token: string
  created_by_user_id: string | null
  created_at: string
}

export type FormFile = {
  id: string
  submission_id: string
  vendor_id: string
  field_id: string
  r2_key: string
  filename: string
  mime_type: string | null
  size_bytes: number | null
  created_at: string
}

export type WaitlistEntry = {
  id: string
  email: string
  name: string | null
  country: string | null
  status: 'subscribed' | 'unsubscribed'
  unsubscribe_token: string
  source: string | null
  created_at: string
  updated_at: string
}

// A resolved broadcast recipient (deduped across vendors / couples / waitlist).
export type BroadcastRecipient = {
  email: string
  name: string | null
  country: string | null
  audience: 'vendor' | 'couple' | 'waitlist'
  unsubscribeToken: string | null
  /** Platform user id when the recipient is a user (vendor/couple audiences). */
  userId: string | null
}
