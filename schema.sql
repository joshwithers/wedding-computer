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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Vendor profiles (a user who is a vendor has one of these)
CREATE TABLE IF NOT EXISTS vendor_profiles (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  category TEXT NOT NULL,
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
  enquiry_form TEXT,
  booking_form TEXT,
  ceremony_types TEXT,
  ical_token TEXT,
  anthropic_api_key TEXT,
  email_handle TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The Wedding entity (central object)
CREATE TABLE IF NOT EXISTS weddings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  title TEXT NOT NULL,
  date TEXT,
  time TEXT,
  location TEXT,
  location_lat REAL,
  location_lng REAL,
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning','confirmed','completed','cancelled')),
  ceremony_type TEXT DEFAULT 'wedding',
  vendor_visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (vendor_visibility IN ('private', 'visible')),
  reception_location TEXT,
  reception_time TEXT,
  getting_ready_location TEXT,
  getting_ready_time TEXT,
  timeline_notes TEXT,
  dress_code TEXT,
  guest_count INTEGER,
  notes TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Wedding permissions (who can access a wedding and in what role)
CREATE TABLE IF NOT EXISTS wedding_members (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','vendor','couple','guest')),
  vendor_profile_id TEXT REFERENCES vendor_profiles(id),
  vendor_role TEXT,
  is_financial_party INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited','active','removed')),
  invited_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(wedding_id, user_id)
);

-- CRM Contacts (vendor's leads/clients)
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  partner_first_name TEXT,
  partner_last_name TEXT,
  partner_email TEXT,
  partner_phone TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','contacted','meeting','quoted','booked','completed','lost','archived')),
  wedding_id TEXT REFERENCES weddings(id),
  wedding_date TEXT,
  wedding_location TEXT,
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
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','wedding','public')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

-- Indexes
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
CREATE INDEX IF NOT EXISTS idx_contact_activities_contact ON contact_activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_invoices_wedding ON invoices(wedding_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_calendar_events_vendor_date ON calendar_events(vendor_id, date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_wedding ON calendar_events(wedding_id);
CREATE INDEX IF NOT EXISTS idx_availability_overrides_vendor ON availability_overrides(vendor_id, date);
CREATE INDEX IF NOT EXISTS idx_documents_wedding ON documents(wedding_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_vendor ON invoice_payments(vendor_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_status ON invoice_payments(status, due_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_profiles_ical_token ON vendor_profiles(ical_token);
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
