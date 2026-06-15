-- Web links on a wedding: any member (vendor or couple) can add a URL — a
-- delivered-photo gallery, a Pinterest board, a playlist, etc. The title is
-- auto-filled from the page's OpenGraph metadata. Links list newest-first;
-- a pinned link floats to the top (most recently pinned first).

CREATE TABLE IF NOT EXISTS web_links (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id       TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  url              TEXT NOT NULL,
  title            TEXT NOT NULL,
  site_name        TEXT,
  image_url        TEXT,
  added_by_user_id TEXT REFERENCES users(id),
  added_by_name    TEXT NOT NULL,
  added_by_role    TEXT NOT NULL,
  pinned           INTEGER NOT NULL DEFAULT 0,
  pinned_at        TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_web_links_wedding ON web_links(wedding_id);
