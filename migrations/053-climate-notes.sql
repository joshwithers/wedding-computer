-- AI-generated "expected weather" notes for a location + time of year.
--
-- Cached globally by (location_key, month) — climate is seasonal, so any two
-- weddings at the same place in the same month share one generation, and a note
-- is only generated once per location/month pair. Changing a wedding's location
-- or its month moves it to a different key, which lazily regenerates.

CREATE TABLE IF NOT EXISTS climate_notes (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  location_key TEXT NOT NULL,                       -- normalised city/region
  month        INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  note         TEXT NOT NULL,                       -- the generated statement
  source       TEXT,                                -- Wikipedia page title used (if any)
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_climate_notes_key ON climate_notes(location_key, month);
