-- Email storage for sent and received emails
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

CREATE INDEX IF NOT EXISTS idx_emails_vendor ON emails(vendor_id);
CREATE INDEX IF NOT EXISTS idx_emails_contact ON emails(contact_id);
CREATE INDEX IF NOT EXISTS idx_emails_direction ON emails(vendor_id, direction, created_at);
CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id);

-- Add email handle to vendor profiles for receiving
ALTER TABLE vendor_profiles ADD COLUMN email_handle TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_email_handle ON vendor_profiles(email_handle);
