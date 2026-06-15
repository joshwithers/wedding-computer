-- Collaborative, visibility-scoped wedding documents ("Notes" surface).
--
-- Each wedding gains up to three rich-text docs, scoped by who can see them:
--   • shared  — visible to all vendors + the couple (backed by weddings.notes /
--               wedding.md body; NOT stored here — kept for forward-compat in the
--               CHECK so a later migration can move it in)
--   • vendors — all vendors, couple cannot see (exported to team.md per vendor)
--   • couple  — both partners, vendors cannot see (D1-only; couples have no vault)
--
-- wedding_docs is the live source of truth for the vendors/couple scopes. The
-- web editor edits these rows; the storage layer mirrors the vendors scope to a
-- team.md companion file. doc_presence backs live presence + the soft editing
-- lock (Rung 2) — ephemeral rows, pruned opportunistically on poll/heartbeat.

CREATE TABLE IF NOT EXISTS wedding_docs (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id         TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  scope              TEXT NOT NULL CHECK (scope IN ('shared','vendors','couple')),
  content            TEXT NOT NULL DEFAULT '',
  version            INTEGER NOT NULL DEFAULT 1,
  updated_by_user_id TEXT REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(wedding_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_wedding_docs_wedding ON wedding_docs(wedding_id);

CREATE TABLE IF NOT EXISTS doc_presence (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id   TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  scope        TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name    TEXT NOT NULL,
  role         TEXT NOT NULL,
  is_editing   INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(wedding_id, scope, user_id)
);

CREATE INDEX IF NOT EXISTS idx_doc_presence_doc ON doc_presence(wedding_id, scope);

-- Widen the sync index/conflict CHECK to admit the new 'doc' companion
-- (team.md). SQLite can't ALTER a CHECK, so rebuild both tables — same shape as
-- migration 048, with 'doc' appended. Neither table is referenced by anything
-- else, so no FK juggling.

CREATE TABLE file_index_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contact', 'wedding', 'todo', 'log', 'timeline', 'notes', 'vendors', 'doc')),
  entity_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  etag TEXT NOT NULL,
  cached_data TEXT,
  last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor_id, file_path),
  UNIQUE(vendor_id, entity_type, entity_id)
);

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
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contact', 'wedding', 'todo', 'log', 'timeline', 'notes', 'vendors', 'doc')),
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
