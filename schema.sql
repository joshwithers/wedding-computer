-- Wedding Computer — Full Schema

-- Users (central identity — can be vendor, couple, or both)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  date_of_birth TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  state TEXT,
  postcode TEXT,
  country TEXT,
  instagram TEXT,
  facebook TEXT,
  tiktok TEXT,
  linkedin TEXT,
  website TEXT,
  avatar_url TEXT,
  avatar_r2_key TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  -- i18n preferences: BCP 47 locale ('en-AU') and IANA timezone. Nullable —
  -- resolution falls back through Accept-Language / vendor timezone / defaults.
  locale TEXT,
  timezone TEXT,
  -- Weather forecast unit: 'c' | 'f'; NULL = default Celsius (most of the world).
  temperature_unit TEXT,
  -- JSON { [notificationKey]: boolean }; missing key = enabled (opt-out model).
  -- Keys defined in src/services/notification-prefs.ts.
  notification_prefs TEXT NOT NULL DEFAULT '{}',
  -- Set when the account is soft-deleted; nightly cron hard-purges after 30 days.
  deleted_at TEXT,
  -- Personal calendar feed token (hashed 'sha256:...'), lazily minted. Lets any
  -- member (incl. the couple) subscribe to their assigned timeline sections.
  feed_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_feed_token ON users(feed_token) WHERE feed_token IS NOT NULL;

-- Vendor profiles (a user who is a vendor has one of these)
CREATE TABLE IF NOT EXISTS vendor_profiles (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  category TEXT NOT NULL,
  categories TEXT, -- JSON array of all vendor types; category is the primary
  phone TEXT,
  website TEXT,
  instagram TEXT,
  bio TEXT,
  location TEXT,
  timezone TEXT NOT NULL DEFAULT 'Australia/Sydney',
  stripe_account_id TEXT,
  stripe_onboarding_complete INTEGER NOT NULL DEFAULT 0,
  availability_default TEXT,
  is_organiser INTEGER NOT NULL DEFAULT 0,
  is_agency INTEGER NOT NULL DEFAULT 0,
  enquiry_form TEXT,
  booking_form TEXT,
  ceremony_types TEXT,
  ical_token TEXT,
  enquiry_key TEXT,
  anthropic_api_key TEXT,
  email_handle TEXT,
  storage_type TEXT DEFAULT 'r2',
  storage_config TEXT,
  tax_label TEXT,
  tax_rate INTEGER NOT NULL DEFAULT 0,
  tax_inclusive INTEGER NOT NULL DEFAULT 1,
  tax_number TEXT,
  tax_number_label TEXT,
  business_address TEXT,
  invoice_prefix TEXT NOT NULL DEFAULT 'INV-',
  next_invoice_number INTEGER NOT NULL DEFAULT 1,
  card_fee_enabled INTEGER NOT NULL DEFAULT 0,
  card_fee_percent REAL NOT NULL DEFAULT 0,
  service_templates TEXT,
  invoice_defaults TEXT,
  location_city TEXT,
  location_state TEXT,
  location_country TEXT,
  location_lat REAL,
  location_lng REAL,
  location_place_id TEXT,
  logo_r2_key TEXT,
  brand_theme TEXT,
  availability_sharing TEXT NOT NULL DEFAULT 'private',
  directory_listed INTEGER NOT NULL DEFAULT 0,
  referral_code TEXT,
  referred_by_vendor_id TEXT REFERENCES vendor_profiles(id),
  free_months INTEGER NOT NULL DEFAULT 0,
  setup_dismissed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The Wedding entity (central object)
CREATE TABLE IF NOT EXISTS weddings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  title TEXT NOT NULL,
  date TEXT,
  time TEXT,
  duration_hours REAL,
  location TEXT,
  location_lat REAL,
  location_lng REAL,
  location_city TEXT,
  location_state TEXT,
  location_country TEXT,
  location_geocoded_from TEXT,
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning','confirmed','completed','cancelled')),
  ceremony_type TEXT DEFAULT 'wedding',
  vendor_visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (vendor_visibility IN ('private', 'visible')),
  ceremony_location TEXT,
  reception_location TEXT,
  reception_time TEXT,
  getting_ready_location TEXT,
  getting_ready_time TEXT,
  getting_ready_1_label TEXT,
  getting_ready_2_location TEXT,
  getting_ready_2_label TEXT,
  getting_ready_2_time TEXT,
  portrait_location TEXT,
  portrait_time TEXT,
  emoji TEXT,
  bump_in_time TEXT,
  bump_out_time TEXT,
  reception_duration_hours REAL,
  timeline_notes TEXT,
  dress_code TEXT,
  guest_count INTEGER,
  notes TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  -- Sample/onboarding data (migration 060); scoped per vendor via created_by_user_id.
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Wedding permissions (who can access a wedding and in what role)
CREATE TABLE IF NOT EXISTS wedding_members (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('vendor','couple','guest')),
  vendor_profile_id TEXT REFERENCES vendor_profiles(id),
  vendor_role TEXT,
  can_manage INTEGER NOT NULL DEFAULT 0,
  is_financial_party INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited','active','removed')),
  bump_in_time TEXT,
  bump_out_time TEXT,
  vendor_notes TEXT,
  invited_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(wedding_id, user_id)
);

-- Collaborative, visibility-scoped wedding documents (the "Notes" surface).
-- scope: 'shared' (all vendors + couple), 'vendors' (vendors only),
-- 'couple' (couple only). Live source of truth for the vendors/couple scopes;
-- shared is mirrored from weddings.notes / wedding.md. The vendors scope is
-- exported to a team.md companion file.
CREATE TABLE IF NOT EXISTS wedding_docs (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id         TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  scope              TEXT NOT NULL CHECK (scope IN ('shared','vendors','couple')),
  content            TEXT NOT NULL DEFAULT '',
  version            INTEGER NOT NULL DEFAULT 1,
  updated_by_user_id TEXT REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(wedding_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_wedding_docs_wedding ON wedding_docs(wedding_id);

-- Live presence + soft editing-lock for collaborative docs (Rung 2).
-- Ephemeral: rows are pruned opportunistically on poll/heartbeat.
CREATE TABLE IF NOT EXISTS doc_presence (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id   TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  scope        TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name    TEXT NOT NULL,
  role         TEXT NOT NULL,
  is_editing   INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(wedding_id, scope, user_id)
);

CREATE INDEX IF NOT EXISTS idx_doc_presence_doc ON doc_presence(wedding_id, scope);

-- Web links on a wedding (delivered galleries, Pinterest boards, playlists…).
-- Any member adds a URL; title auto-filled from OpenGraph. Newest-first, with
-- pinned links floated to the top.
CREATE TABLE IF NOT EXISTS web_links (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id       TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  url              TEXT NOT NULL,
  title            TEXT NOT NULL,
  site_name        TEXT,
  image_url        TEXT,
  added_by_user_id TEXT REFERENCES users(id),
  added_by_name    TEXT NOT NULL,
  added_by_role    TEXT NOT NULL,
  pinned           INTEGER NOT NULL DEFAULT 0,
  pinned_at        TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_web_links_wedding ON web_links(wedding_id);

-- Unified wedding timeline / run sheet — one wedding-wide ordered list of timed
-- sections (replaces the per-vendor run_sheet_items + the structured time fields
-- on weddings). Named slots (ceremony/getting-ready/portraits/reception) are
-- first-class 'system rows' (slot column); freeform rows have slot=NULL.
CREATE TABLE IF NOT EXISTS timeline_items (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id         TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  start_time         TEXT,
  end_time           TEXT,
  title              TEXT NOT NULL,
  description        TEXT,
  location           TEXT,
  category           TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('getting_ready','ceremony','portraits','reception','other')),
  owner_vendor_id    TEXT REFERENCES vendor_profiles(id) ON DELETE SET NULL,
  created_by_user_id TEXT REFERENCES users(id),
  visibility         TEXT NOT NULL DEFAULT 'couple'
    CHECK (visibility IN ('couple','vendors','private')),
  slot               TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  -- Liquid timeline. NULL anchor_type = a plain absolute item keyed off
  -- start_time (the original model). Otherwise the start is computed relative
  -- to another item (after/before) or a sun event, plus an offset; duration
  -- gives the end. pinned marks a fixed point a reflow must not move;
  -- actual_start overlays the real time on the day (live mode).
  duration_minutes      INTEGER,
  anchor_type           TEXT
    CHECK (anchor_type IS NULL OR anchor_type IN ('after','before','sun')),
  anchor_ref            TEXT,
  anchor_offset_minutes INTEGER NOT NULL DEFAULT 0,
  pinned                INTEGER NOT NULL DEFAULT 0,
  actual_start          TEXT,
  -- Astronomical fact row ('sunrise' | 'sunset'); NULL = a normal item. Facts
  -- are points in time (no people, no start/stop), rendered inline by time.
  marker                TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_timeline_items_wedding ON timeline_items(wedding_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_items_slot ON timeline_items(wedding_id, slot) WHERE slot IS NOT NULL;

-- People involved in a timeline section. Exactly one of (wedding_member_id,
-- team_member_id, label) identifies the assignee; added_to_calendar is that
-- person's opt-in to receive this section in their personal calendar feed.
CREATE TABLE IF NOT EXISTS timeline_item_assignees (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  timeline_item_id  TEXT NOT NULL REFERENCES timeline_items(id) ON DELETE CASCADE,
  wedding_member_id TEXT REFERENCES wedding_members(id) ON DELETE CASCADE,
  team_member_id    TEXT REFERENCES team_members(id) ON DELETE CASCADE,
  label             TEXT,
  added_to_calendar INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tia_item ON timeline_item_assignees(timeline_item_id);
CREATE INDEX IF NOT EXISTS idx_tia_member ON timeline_item_assignees(wedding_member_id);

-- CRM Contacts (vendor's leads/clients)
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  is_demo INTEGER NOT NULL DEFAULT 0,  -- sample/onboarding data (migration 060)
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  partner_first_name TEXT,
  partner_last_name TEXT,
  partner_email TEXT,
  partner_phone TEXT,
  address TEXT,
  instagram TEXT,
  facebook TEXT,
  tiktok TEXT,
  website TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','contacted','meeting','quoted','booked','completed','lost','archived')),
  wedding_id TEXT REFERENCES weddings(id),
  wedding_date TEXT,
  wedding_location TEXT,
  wedding_location_city TEXT,
  wedding_location_state TEXT,
  wedding_location_country TEXT,
  wedding_location_geocoded_from TEXT,
  notes TEXT,
  tags TEXT,
  form_data TEXT,
  last_contacted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Contact activity log
CREATE TABLE IF NOT EXISTS contact_activities (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  summary TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Invoices (vendor -> client)
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id),
  wedding_id TEXT REFERENCES weddings(id),
  stripe_invoice_id TEXT,
  stripe_payment_intent_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'aud',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','partial','paid','overdue','cancelled','refunded')),
  due_date TEXT,
  paid_at TEXT,
  line_items TEXT,
  booking_fee_type TEXT DEFAULT 'fixed' CHECK (booking_fee_type IN ('fixed', 'percentage')),
  booking_fee_value INTEGER DEFAULT 0,
  public_token TEXT UNIQUE,
  notes TEXT,
  booking_form_data TEXT,
  invoice_number TEXT,
  tax_label TEXT,
  tax_rate INTEGER NOT NULL DEFAULT 0,
  tax_inclusive INTEGER NOT NULL DEFAULT 1,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_amount_cents INTEGER NOT NULL DEFAULT 0,
  card_fee_cents INTEGER NOT NULL DEFAULT 0,
  card_fee_percent REAL NOT NULL DEFAULT 0,
  vendor_tax_number TEXT,
  vendor_business_name TEXT,
  vendor_business_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Invoice payment schedule (installments)
CREATE TABLE IF NOT EXISTS invoice_payments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'overdue')),
  method TEXT CHECK (method IN ('stripe', 'cash', 'bank_transfer', 'payid')),
  stripe_payment_intent_id TEXT,
  paid_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Calendar events
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  wedding_id TEXT REFERENCES weddings(id),
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  all_day INTEGER NOT NULL DEFAULT 1,
  type TEXT NOT NULL DEFAULT 'booking'
    CHECK (type IN ('booking','blocked','personal','other')),
  google_event_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Vendor availability overrides
CREATE TABLE IF NOT EXISTS availability_overrides (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor_id, date)
);

-- Documents (R2 references)
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id TEXT REFERENCES weddings(id) ON DELETE CASCADE,
  vendor_id TEXT REFERENCES vendor_profiles(id),
  uploaded_by_user_id TEXT NOT NULL REFERENCES users(id),
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  category TEXT,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','wedding','public')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Document sharing: per-member visibility for wedding files
CREATE TABLE IF NOT EXISTS document_shares (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(document_id, user_id)
);

-- Couple vendor planning entries
CREATE TABLE IF NOT EXISTS couple_vendors (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  email TEXT,
  phone TEXT,
  website TEXT,
  instagram TEXT,
  notes TEXT,
  expected_price_cents INTEGER,
  vendor_profile_id TEXT REFERENCES vendor_profiles(id),
  status TEXT NOT NULL DEFAULT 'considering'
    CHECK (status IN ('considering', 'contacted', 'booked', 'removed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Service contracts
CREATE TABLE IF NOT EXISTS service_contracts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Service Agreement',
  body TEXT NOT NULL,
  is_template INTEGER NOT NULL DEFAULT 1,
  wedding_id TEXT REFERENCES weddings(id),
  invoice_id TEXT REFERENCES invoices(id),
  signed_at TEXT,
  signed_by_name TEXT,
  signed_by_email TEXT,
  signed_ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Forms: vendor-created forms with configurable actions. Supports custom forms,
-- predefined templates (NOIM, contact), and multi-step workflows. (Migration 031.)
CREATE TABLE IF NOT EXISTS forms (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT,
  type TEXT NOT NULL DEFAULT 'custom'
    CHECK (type IN ('custom', 'noim', 'contact')),
  config TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  public_token TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  wedding_id TEXT REFERENCES weddings(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  submission_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS form_submissions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'reviewed', 'archived')),
  ip_address TEXT,
  user_agent TEXT,
  -- A submission made through a "send to a couple" link belongs to a wedding
  -- (migration 056). Default visibility is owning vendor + couple; when
  -- shared_with_team = 1 it's visible to every vendor on the wedding.
  wedding_id TEXT,
  form_send_id TEXT,
  shared_with_team INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Files uploaded through a form's file-upload field (migration 057). Binary in
-- R2 (r2_key); downloads gated to the owning vendor + the wedding's members.
CREATE TABLE IF NOT EXISTS form_files (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  submission_id TEXT NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  vendor_id     TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  field_id      TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  filename      TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sending a reusable form to a specific wedding's couple (migration 056).
CREATE TABLE IF NOT EXISTS form_sends (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  form_id            TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  wedding_id         TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  vendor_id          TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  token              TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_forms_vendor ON forms(vendor_id);
CREATE INDEX IF NOT EXISTS idx_forms_type ON forms(type);
CREATE INDEX IF NOT EXISTS idx_forms_public_token ON forms(public_token);
CREATE INDEX IF NOT EXISTS idx_forms_wedding ON forms(wedding_id);
CREATE INDEX IF NOT EXISTS idx_forms_contact ON forms(contact_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_vendor ON form_submissions(vendor_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_contact ON form_submissions(contact_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_wedding ON form_submissions(wedding_id);
CREATE INDEX IF NOT EXISTS idx_form_sends_wedding ON form_sends(wedding_id);
CREATE INDEX IF NOT EXISTS idx_form_sends_form ON form_sends(form_id);
CREATE INDEX IF NOT EXISTS idx_form_files_submission ON form_files(submission_id);

-- Timeline change requests: when a wedding has a managing planner/venue, other
-- members' timeline edits are stored here until a controller approves them.
CREATE TABLE IF NOT EXISTS timeline_change_requests (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  requested_by_label TEXT,
  target TEXT NOT NULL CHECK (target IN ('wedding', 'run_sheet')),
  op TEXT NOT NULL DEFAULT 'update' CHECK (op IN ('create', 'update', 'delete')),
  run_sheet_item_id TEXT,
  vendor_profile_id TEXT REFERENCES vendor_profiles(id),
  payload TEXT NOT NULL DEFAULT '{}',
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  decided_by_user_id TEXT REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Email queue
CREATE TABLE IF NOT EXISTS email_queue (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  to_email TEXT NOT NULL,
  to_name TEXT,
  from_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed')),
  error TEXT,
  scheduled_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Emails
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_email TEXT NOT NULL,
  to_name TEXT,
  reply_to TEXT,
  subject TEXT NOT NULL,
  body_text TEXT,
  body_html TEXT,
  message_id TEXT UNIQUE,
  in_reply_to TEXT,
  thread_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('draft', 'queued', 'sent', 'failed', 'received')),
  is_read INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Passkey credentials (WebAuthn)
CREATE TABLE IF NOT EXISTS passkey_credentials (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  device_name TEXT,
  transports TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

-- Analytics events
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  contact_id TEXT,
  wedding_id TEXT,
  invoice_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Business goals
CREATE TABLE IF NOT EXISTS business_goals (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL CHECK (period_type IN ('year', 'season', 'month')),
  period_value TEXT NOT NULL,
  goal_type TEXT NOT NULL CHECK (goal_type IN ('enquiries', 'bookings', 'revenue')),
  target INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor_id, period_type, period_value, goal_type)
);

-- Vendor subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL UNIQUE REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'cancelled', 'trialing')),
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Referral relationships (one referrer per referred vendor)
CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  referrer_vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  referred_vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'converted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  converted_at TEXT,
  UNIQUE(referred_vendor_id)
);

-- Append-only ledger of free-month grants (audit + display)
CREATE TABLE IF NOT EXISTS free_month_grants (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  months INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('referral_reward', 'referred_signup', 'admin_gift')),
  granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_referral_code ON vendor_profiles(referral_code);
CREATE INDEX IF NOT EXISTS idx_vendor_referred_by ON vendor_profiles(referred_by_vendor_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_vendor_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_vendor_id);
CREATE INDEX IF NOT EXISTS idx_free_month_grants_vendor ON free_month_grants(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_profiles_user_id ON vendor_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_vendor_profiles_category ON vendor_profiles(category);
CREATE INDEX IF NOT EXISTS idx_weddings_created_by ON weddings(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_weddings_date ON weddings(date);
CREATE INDEX IF NOT EXISTS idx_wedding_members_wedding ON wedding_members(wedding_id);
CREATE INDEX IF NOT EXISTS idx_wedding_members_user ON wedding_members(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_vendor ON contacts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_wedding ON contacts(wedding_id);
CREATE INDEX IF NOT EXISTS idx_contacts_wedding_date ON contacts(wedding_date);
CREATE INDEX IF NOT EXISTS idx_contact_activities_contact ON contact_activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_invoices_wedding ON invoices(wedding_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(vendor_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_calendar_events_vendor_date ON calendar_events(vendor_id, date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_wedding ON calendar_events(wedding_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(date);
CREATE INDEX IF NOT EXISTS idx_availability_overrides_vendor ON availability_overrides(vendor_id, date);
CREATE INDEX IF NOT EXISTS idx_documents_wedding ON documents(wedding_id);
CREATE INDEX IF NOT EXISTS idx_document_shares_document ON document_shares(document_id);
CREATE INDEX IF NOT EXISTS idx_document_shares_user ON document_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_timeline_requests_wedding ON timeline_change_requests(wedding_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_vendor ON invoice_payments(vendor_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_status ON invoice_payments(status, due_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_profiles_ical_token ON vendor_profiles(ical_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_profiles_enquiry_key ON vendor_profiles(enquiry_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_email_handle ON vendor_profiles(email_handle);
CREATE INDEX IF NOT EXISTS idx_emails_vendor ON emails(vendor_id);
CREATE INDEX IF NOT EXISTS idx_emails_contact ON emails(contact_id);
CREATE INDEX IF NOT EXISTS idx_emails_direction ON emails(vendor_id, direction, created_at);
CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id);
CREATE INDEX IF NOT EXISTS idx_couple_vendors_wedding ON couple_vendors(wedding_id);
CREATE INDEX IF NOT EXISTS idx_couple_vendors_vendor_profile ON couple_vendors(vendor_profile_id);
CREATE INDEX IF NOT EXISTS idx_couple_vendors_status ON couple_vendors(status);
CREATE INDEX IF NOT EXISTS idx_service_contracts_vendor ON service_contracts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_service_contracts_invoice ON service_contracts(invoice_id);
CREATE INDEX IF NOT EXISTS idx_service_contracts_wedding ON service_contracts(wedding_id);
CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user ON passkey_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_vendor ON analytics_events(vendor_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_vendor_created ON analytics_events(vendor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_vendor_type ON analytics_events(vendor_id, event_type);
CREATE INDEX IF NOT EXISTS idx_business_goals_vendor ON business_goals(vendor_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_vendor ON subscriptions(vendor_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);

-- File index: queryable cache of markdown files in R2/Git
CREATE TABLE IF NOT EXISTS file_index (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contact', 'wedding', 'todo', 'log', 'timeline', 'notes', 'vendors', 'doc')),
  entity_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  etag TEXT NOT NULL,
  cached_data TEXT,
  last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor_id, file_path),
  UNIQUE(vendor_id, entity_type, entity_id)
);

-- File conflicts detected during sync
CREATE TABLE IF NOT EXISTS file_conflicts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contact', 'wedding', 'todo', 'log', 'timeline', 'notes', 'vendors', 'doc')),
  entity_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  local_content TEXT NOT NULL,
  remote_content TEXT NOT NULL,
  local_etag TEXT NOT NULL,
  remote_etag TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved')),
  resolved_at TEXT,
  resolution TEXT CHECK (resolution IN ('keep_remote', 'keep_local', 'merge')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_file_index_vendor ON file_index(vendor_id);
CREATE INDEX IF NOT EXISTS idx_file_index_vendor_type ON file_index(vendor_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_file_index_entity ON file_index(vendor_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_file_conflicts_vendor ON file_conflicts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_file_conflicts_pending ON file_conflicts(vendor_id, status);

-- Append-only wedding changelog
CREATE TABLE IF NOT EXISTS wedding_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wedding_log_wedding ON wedding_log(wedding_id, created_at);

-- Todo checklist templates and per-wedding checklists
CREATE TABLE IF NOT EXISTS todo_templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wedding_todos (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  template_id TEXT REFERENCES todo_templates(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor_id, wedding_id)
);

CREATE INDEX IF NOT EXISTS idx_todo_templates_vendor ON todo_templates(vendor_id);
CREATE INDEX IF NOT EXISTS idx_wedding_todos_vendor ON wedding_todos(vendor_id);
CREATE INDEX IF NOT EXISTS idx_wedding_todos_wedding ON wedding_todos(wedding_id);

-- Performance composite indexes
CREATE INDEX IF NOT EXISTS idx_contacts_vendor_status ON contacts(vendor_id, status);

-- Team members belonging to an agency vendor
CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  title TEXT,
  avatar_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Assignments of team members to weddings
CREATE TABLE IF NOT EXISTS wedding_team_assignments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  wedding_member_id TEXT NOT NULL REFERENCES wedding_members(id) ON DELETE CASCADE,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  role TEXT,
  notes TEXT,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(wedding_id, team_member_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_vendor ON team_members(vendor_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_active ON team_members(vendor_id, is_active);
CREATE INDEX IF NOT EXISTS idx_wedding_team_wedding ON wedding_team_assignments(wedding_id);
CREATE INDEX IF NOT EXISTS idx_wedding_team_member ON wedding_team_assignments(team_member_id);
CREATE INDEX IF NOT EXISTS idx_wedding_team_wm ON wedding_team_assignments(wedding_member_id);

-- Data import job tracking
CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'contact'
    CHECK (entity_type IN ('contact', 'wedding', 'invoice')),
  status TEXT NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'mapping', 'previewing', 'processing', 'completed', 'failed', 'cancelled')),
  filename TEXT,
  column_mapping TEXT,
  total_records INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_log TEXT,
  config TEXT,
  raw_data TEXT,
  preview_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS import_records (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  import_job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  record_index INTEGER NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'contact',
  entity_id TEXT,
  raw_data TEXT NOT NULL,
  mapped_data TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'imported', 'skipped', 'failed', 'duplicate')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_vendor ON import_jobs(vendor_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_import_records_job ON import_records(import_job_id);
CREATE INDEX IF NOT EXISTS idx_import_records_status ON import_records(import_job_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor_status ON invoices(vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_emails_vendor_unread ON emails(vendor_id, direction, is_read, is_system);

-- Run sheet items (day-of timeline for a wedding)
CREATE TABLE IF NOT EXISTS run_sheet_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  time TEXT,
  end_time TEXT,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  assigned_to TEXT,
  category TEXT DEFAULT 'other'
    CHECK (category IN ('getting_ready', 'ceremony', 'portraits', 'reception', 'other')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_run_sheet_items_wedding ON run_sheet_items(wedding_id);
CREATE INDEX IF NOT EXISTS idx_run_sheet_items_vendor ON run_sheet_items(vendor_id);
CREATE INDEX IF NOT EXISTS idx_run_sheet_items_order ON run_sheet_items(wedding_id, sort_order);

-- Busyness scores (aggregated daily by cron)
CREATE TABLE IF NOT EXISTS busyness_scores (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  date TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('city', 'state', 'country', 'global')),
  level_value TEXT NOT NULL,
  enquiry_count INTEGER NOT NULL DEFAULT 0,
  booking_count INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, level, level_value)
);

CREATE INDEX IF NOT EXISTS idx_busyness_scores_date ON busyness_scores(date);
CREATE INDEX IF NOT EXISTS idx_busyness_scores_level ON busyness_scores(level, level_value);
CREATE INDEX IF NOT EXISTS idx_busyness_scores_lookup ON busyness_scores(date, level, level_value);

-- Historical demand patterns: past activity bucketed by month ('09'),
-- season ('spring'), and Nth-weekend-of-month ('09-w3') per location level,
-- keyed by year, for year-on-year context on the Date demand card.
-- Rebuilt nightly by the busyness cron.
CREATE TABLE IF NOT EXISTS demand_history (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  level TEXT NOT NULL CHECK (level IN ('city', 'state', 'country', 'global')),
  level_value TEXT NOT NULL,
  bucket_type TEXT NOT NULL CHECK (bucket_type IN ('month', 'season', 'weekend')),
  bucket_value TEXT NOT NULL,
  year TEXT NOT NULL,
  enquiry_count INTEGER NOT NULL DEFAULT 0,
  booking_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(level, level_value, bucket_type, bucket_value, year)
);

CREATE INDEX IF NOT EXISTS idx_demand_history_lookup
  ON demand_history(level, level_value, bucket_type, bucket_value);

-- Quote calculators (vendor-configurable pricing tools)
CREATE TABLE IF NOT EXISTS quote_calculators (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  config TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  public_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quote_calculators_vendor ON quote_calculators(vendor_id);
CREATE INDEX IF NOT EXISTS idx_quote_calculators_token ON quote_calculators(public_token);

-- Waitlist (people interested ahead of launch — not yet vendors or couples)
CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  country TEXT,
  status TEXT NOT NULL DEFAULT 'subscribed'
    CHECK (status IN ('subscribed','unsubscribed')),
  unsubscribe_token TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);
CREATE INDEX IF NOT EXISTS idx_waitlist_country ON waitlist(country);

-- Email deliverability (migration 039) ──────────────────────────────────────
-- Addresses that hard-bounced or complained; checked before every send.
CREATE TABLE IF NOT EXISTS email_suppressions (
  email TEXT PRIMARY KEY,                 -- always stored lowercased
  reason TEXT NOT NULL,                   -- 'bounce' | 'complaint' | 'manual'
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Broadcast bodies stored once, referenced by id from per-recipient queue jobs.
CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by_user_id TEXT REFERENCES users(id),
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI "expected weather" notes, cached globally by (location_key, month).
CREATE TABLE IF NOT EXISTS climate_notes (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  location_key TEXT NOT NULL,
  month        INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  note         TEXT NOT NULL,
  source       TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_climate_notes_key ON climate_notes(location_key, month);
