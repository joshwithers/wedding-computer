-- Unified wedding timeline / run sheet.
--
-- One wedding-wide, ordered list of timed "sections" replaces BOTH the
-- per-vendor run_sheet_items rows AND the structured time fields on weddings
-- (ceremony/getting-ready/portraits/reception). Each section has assignees
-- (members, a vendor's staff, or free text) and a visibility scope. The named
-- structured slots are backfilled here as first-class "system rows" (slot set);
-- the legacy weddings.* time columns are kept as a derived cache (written by
-- projectTimelineToWedding) until later phases repoint calendar/iCal/MCP/Obsidian
-- and drop them. The free-text run_sheet_items rows are backfilled by
-- scripts/backfill-timeline.mjs (their times need parsing).

CREATE TABLE IF NOT EXISTS timeline_items (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id         TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  start_time         TEXT,                       -- 'HH:MM' 24h; display localised via lib/date
  end_time           TEXT,
  title              TEXT NOT NULL,
  description        TEXT,
  location           TEXT,
  category           TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('getting_ready','ceremony','portraits','reception','other')),
  owner_vendor_id    TEXT REFERENCES vendor_profiles(id) ON DELETE SET NULL,  -- null = couple/shared/system row
  created_by_user_id TEXT REFERENCES users(id),
  visibility         TEXT NOT NULL DEFAULT 'couple'
    CHECK (visibility IN ('couple','vendors','private')),                     -- couple=everyone, vendors=all vendors, private=owner only
  slot               TEXT,                        -- null=freeform; else ceremony|getting_ready_1|getting_ready_2|portraits|reception
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_timeline_items_wedding ON timeline_items(wedding_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_items_slot ON timeline_items(wedding_id, slot) WHERE slot IS NOT NULL;

-- Who is involved in a section. Exactly one of (wedding_member_id, team_member_id, label) identifies the assignee.
CREATE TABLE IF NOT EXISTS timeline_item_assignees (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  timeline_item_id  TEXT NOT NULL REFERENCES timeline_items(id) ON DELETE CASCADE,
  wedding_member_id TEXT REFERENCES wedding_members(id) ON DELETE CASCADE,
  team_member_id    TEXT REFERENCES team_members(id) ON DELETE CASCADE,
  label             TEXT,
  added_to_calendar INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tia_item ON timeline_item_assignees(timeline_item_id);
CREATE INDEX IF NOT EXISTS idx_tia_member ON timeline_item_assignees(wedding_member_id);

-- Per-user calendar feed token so non-vendor members (the couple!) can subscribe.
ALTER TABLE users ADD COLUMN feed_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_feed_token ON users(feed_token) WHERE feed_token IS NOT NULL;

-- ── Backfill the structured headline slots as system rows (clean HH:MM times) ──

INSERT INTO timeline_items (wedding_id, start_time, title, location, category, visibility, slot, sort_order, created_by_user_id)
  SELECT id, getting_ready_time, COALESCE(NULLIF(getting_ready_1_label,''), 'Getting ready'),
         getting_ready_location, 'getting_ready', 'couple', 'getting_ready_1', 10, created_by_user_id
  FROM weddings WHERE getting_ready_time IS NOT NULL AND getting_ready_time != '';

INSERT INTO timeline_items (wedding_id, start_time, title, location, category, visibility, slot, sort_order, created_by_user_id)
  SELECT id, getting_ready_2_time, COALESCE(NULLIF(getting_ready_2_label,''), 'Getting ready'),
         getting_ready_2_location, 'getting_ready', 'couple', 'getting_ready_2', 20, created_by_user_id
  FROM weddings WHERE getting_ready_2_time IS NOT NULL AND getting_ready_2_time != '';

INSERT INTO timeline_items (wedding_id, start_time, title, location, category, visibility, slot, sort_order, created_by_user_id)
  SELECT id, time, 'Ceremony', ceremony_location, 'ceremony', 'couple', 'ceremony', 30, created_by_user_id
  FROM weddings WHERE time IS NOT NULL AND time != '';

INSERT INTO timeline_items (wedding_id, start_time, title, location, category, visibility, slot, sort_order, created_by_user_id)
  SELECT id, portrait_time, 'Portraits', portrait_location, 'portraits', 'couple', 'portraits', 40, created_by_user_id
  FROM weddings WHERE portrait_time IS NOT NULL AND portrait_time != '';

INSERT INTO timeline_items (wedding_id, start_time, title, location, category, visibility, slot, sort_order, created_by_user_id)
  SELECT id, reception_time, 'Reception', reception_location, 'reception', 'couple', 'reception', 50, created_by_user_id
  FROM weddings WHERE reception_time IS NOT NULL AND reception_time != '';
