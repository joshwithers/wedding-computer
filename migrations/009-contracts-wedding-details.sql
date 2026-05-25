-- Migration 009: Wedding detail fields, user phone, service contracts

-- Wedding detail fields for couple editing
ALTER TABLE weddings ADD COLUMN reception_location TEXT;
ALTER TABLE weddings ADD COLUMN reception_time TEXT;
ALTER TABLE weddings ADD COLUMN getting_ready_location TEXT;
ALTER TABLE weddings ADD COLUMN getting_ready_time TEXT;
ALTER TABLE weddings ADD COLUMN timeline_notes TEXT;
ALTER TABLE weddings ADD COLUMN dress_code TEXT;
ALTER TABLE weddings ADD COLUMN guest_count INTEGER;

-- User phone number (so couples can share contact info)
ALTER TABLE users ADD COLUMN phone TEXT;

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

CREATE INDEX IF NOT EXISTS idx_service_contracts_vendor ON service_contracts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_service_contracts_invoice ON service_contracts(invoice_id);
CREATE INDEX IF NOT EXISTS idx_service_contracts_wedding ON service_contracts(wedding_id);
