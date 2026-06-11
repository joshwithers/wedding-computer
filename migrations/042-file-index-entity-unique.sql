-- Enforce one file_index row per (vendor_id, entity_type, entity_id) so the
-- single-row lookups (writeWeddingFile / writeCompanion / pushes) can't pick
-- the wrong row when an entity's file moved. SQLite can't add a UNIQUE in
-- place, so rebuild. The ingest path was updated in the same change to delete
-- a stale-path row for an entity before inserting the new one, so this
-- constraint won't be violated at runtime.
--
-- file_index is a rebuildable cache and a leaf table (nothing references it).
-- The copy dedupes defensively (keeps the most-recent row per entity), though
-- there are no duplicates today.

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
  UNIQUE(vendor_id, file_path),
  UNIQUE(vendor_id, entity_type, entity_id)
);

INSERT INTO file_index_new (id, vendor_id, entity_type, entity_id, file_path, etag, cached_data, last_synced_at, created_at)
  SELECT id, vendor_id, entity_type, entity_id, file_path, etag, cached_data, last_synced_at, created_at
  FROM file_index
  WHERE rowid IN (
    SELECT MAX(rowid) FROM file_index GROUP BY vendor_id, entity_type, entity_id
  );

DROP TABLE file_index;
ALTER TABLE file_index_new RENAME TO file_index;

CREATE INDEX IF NOT EXISTS idx_file_index_vendor ON file_index(vendor_id);
CREATE INDEX IF NOT EXISTS idx_file_index_vendor_type ON file_index(vendor_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_file_index_entity ON file_index(vendor_id, entity_type, entity_id);
