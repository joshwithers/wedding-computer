-- Expand file_index entity_type to track todo.md and log.md sync state.
-- The background sync uses these rows to detect stale todo/log files and
-- to skip no-op pushes (etag comparison). SQLite cannot alter a CHECK
-- constraint, so rebuild the table.

CREATE TABLE file_index_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contact', 'wedding', 'todo', 'log')),
  entity_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  etag TEXT NOT NULL,
  cached_data TEXT,
  last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor_id, file_path)
);

INSERT INTO file_index_new (id, vendor_id, entity_type, entity_id, file_path, etag, cached_data, last_synced_at, created_at)
  SELECT id, vendor_id, entity_type, entity_id, file_path, etag, cached_data, last_synced_at, created_at FROM file_index;

DROP TABLE file_index;

ALTER TABLE file_index_new RENAME TO file_index;

CREATE INDEX IF NOT EXISTS idx_file_index_vendor ON file_index(vendor_id);
CREATE INDEX IF NOT EXISTS idx_file_index_vendor_type ON file_index(vendor_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_file_index_entity ON file_index(vendor_id, entity_type, entity_id);
