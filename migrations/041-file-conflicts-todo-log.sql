-- Widen file_conflicts.entity_type to include 'todo' and 'log' so conflict
-- records can be created for those file types too (the sync engine now syncs
-- todo.md / log.md). SQLite can't ALTER a CHECK, so rebuild the table.
-- file_conflicts is a leaf table (nothing references it), so no FK juggling.

CREATE TABLE file_conflicts_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contact', 'wedding', 'todo', 'log')),
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
  FROM file_conflicts;

DROP TABLE file_conflicts;
ALTER TABLE file_conflicts_new RENAME TO file_conflicts;

CREATE INDEX IF NOT EXISTS idx_file_conflicts_vendor ON file_conflicts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_file_conflicts_pending ON file_conflicts(vendor_id, status);
