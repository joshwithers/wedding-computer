-- Couple-added vendors (vendors not on the platform, tracked by the couple)
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

CREATE INDEX IF NOT EXISTS idx_couple_vendors_wedding ON couple_vendors(wedding_id);
CREATE INDEX IF NOT EXISTS idx_couple_vendors_vendor_profile ON couple_vendors(vendor_profile_id);
CREATE INDEX IF NOT EXISTS idx_couple_vendors_status ON couple_vendors(status);
