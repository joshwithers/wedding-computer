-- Vendor location fields (extracted from Google Places)
ALTER TABLE vendor_profiles ADD COLUMN location_city TEXT;
ALTER TABLE vendor_profiles ADD COLUMN location_state TEXT;
ALTER TABLE vendor_profiles ADD COLUMN location_country TEXT;
ALTER TABLE vendor_profiles ADD COLUMN location_lat REAL;
ALTER TABLE vendor_profiles ADD COLUMN location_lng REAL;
ALTER TABLE vendor_profiles ADD COLUMN location_place_id TEXT;

-- Availability sharing preference
ALTER TABLE vendor_profiles ADD COLUMN availability_sharing TEXT NOT NULL DEFAULT 'private';

-- Directory listing opt-in
ALTER TABLE vendor_profiles ADD COLUMN directory_listed INTEGER NOT NULL DEFAULT 0;

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
