-- Forms system: vendor-created forms with configurable actions
-- Supports custom forms, predefined templates (NOIM, contact), and multi-step workflows

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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_forms_vendor ON forms(vendor_id);
CREATE INDEX IF NOT EXISTS idx_forms_type ON forms(type);
CREATE INDEX IF NOT EXISTS idx_forms_public_token ON forms(public_token);
CREATE INDEX IF NOT EXISTS idx_forms_wedding ON forms(wedding_id);
CREATE INDEX IF NOT EXISTS idx_forms_contact ON forms(contact_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_vendor ON form_submissions(vendor_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_contact ON form_submissions(contact_id);
