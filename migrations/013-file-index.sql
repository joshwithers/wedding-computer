-- File index: queryable cache of markdown files stored in R2/Git.
-- The source of truth is the files themselves — this index
-- can always be rebuilt by scanning storage.

CREATE TABLE IF NOT EXISTS file_index (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contact', 'wedding')),
  entity_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  etag TEXT NOT NULL,
  cached_data TEXT,
  last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor_id, file_path)
);

-- File conflicts: detected when the stored etag doesn't match
-- what we find on the next read (someone edited externally).

CREATE TABLE IF NOT EXISTS file_conflicts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contact', 'wedding')),
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

-- Storage configuration on vendor profiles
ALTER TABLE vendor_profiles ADD COLUMN storage_type TEXT DEFAULT 'r2';
ALTER TABLE vendor_profiles ADD COLUMN storage_config TEXT;

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_file_index_vendor ON file_index(vendor_id);
CREATE INDEX IF NOT EXISTS idx_file_index_vendor_type ON file_index(vendor_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_file_index_entity ON file_index(vendor_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_file_conflicts_vendor ON file_conflicts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_file_conflicts_pending ON file_conflicts(vendor_id, status);
