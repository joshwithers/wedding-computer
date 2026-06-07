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
