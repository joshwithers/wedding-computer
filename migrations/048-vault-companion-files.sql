-- The vault grows three new per-wedding companion files: timeline.md (run
-- sheet, two-way), notes.md (vendor's private notes, two-way) and vendors.md
-- (generated wedding-team list, read-only). The sync index and conflict
-- tables gate entity_type with a CHECK, and SQLite can't ALTER a CHECK, so
-- rebuild both tables with the widened list. Neither table is referenced by
-- anything else, so no FK juggling.

CREATE TABLE file_index_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contact', 'wedding', 'todo', 'log', 'timeline', 'notes', 'vendors')),
  entity_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  etag TEXT NOT NULL,
  cached_data TEXT,
  last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor_id, file_path),
  UNIQUE(vendor_id, entity_type, entity_id)
);

-- Skip orphaned rows (vendor deleted before FK enforcement existed) —
-- they are unreachable garbage and would fail the new table's FK.
INSERT INTO file_index_new
  SELECT id, vendor_id, entity_type, entity_id, file_path, etag, cached_data,
         last_synced_at, created_at
  FROM file_index
  WHERE vendor_id IN (SELECT id FROM vendor_profiles);

DROP TABLE file_index;
ALTER TABLE file_index_new RENAME TO file_index;

CREATE INDEX IF NOT EXISTS idx_file_index_vendor ON file_index(vendor_id);
CREATE INDEX IF NOT EXISTS idx_file_index_vendor_type ON file_index(vendor_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_file_index_entity ON file_index(vendor_id, entity_type, entity_id);

CREATE TABLE file_conflicts_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contact', 'wedding', 'todo', 'log', 'timeline', 'notes', 'vendors')),
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

INSERT INTO file_conflicts_new
  SELECT id, vendor_id, entity_type, entity_id, file_path, local_content, remote_content,
         local_etag, remote_etag, status, resolved_at, resolution, created_at
  FROM file_conflicts
  WHERE vendor_id IN (SELECT id FROM vendor_profiles);

DROP TABLE file_conflicts;
ALTER TABLE file_conflicts_new RENAME TO file_conflicts;

CREATE INDEX IF NOT EXISTS idx_file_conflicts_vendor ON file_conflicts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_file_conflicts_pending ON file_conflicts(vendor_id, status);
