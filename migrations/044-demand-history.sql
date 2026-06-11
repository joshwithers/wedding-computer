-- Historical demand patterns: past enquiry/booking activity bucketed by
-- month ('09'), season ('spring'), and Nth-weekend-of-month ('09-w3'),
-- per location level, keyed by year. Calendar dates don't line up across
-- years, but "the 3rd weekend of September" does — these buckets let the
-- Date demand card show year-on-year context, and they get richer as more
-- years of data accumulate. Rebuilt nightly by the busyness cron.
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
