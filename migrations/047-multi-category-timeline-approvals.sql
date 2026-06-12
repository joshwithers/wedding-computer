-- Multi-category vendors + timeline change approvals.
--
-- categories: JSON array of all vendor types (category stays as the primary
-- type — analytics, AI context, and the public directory API keep their shape).
ALTER TABLE vendor_profiles ADD COLUMN categories TEXT;
UPDATE vendor_profiles SET categories = json_array(category) WHERE categories IS NULL;

-- Timeline change requests: when a wedding has a managing planner/venue, other
-- members' timeline edits are stored here until a controller approves them.
CREATE TABLE IF NOT EXISTS timeline_change_requests (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  requested_by_label TEXT,
  target TEXT NOT NULL CHECK (target IN ('wedding', 'run_sheet')),
  op TEXT NOT NULL DEFAULT 'update' CHECK (op IN ('create', 'update', 'delete')),
  run_sheet_item_id TEXT,
  vendor_profile_id TEXT REFERENCES vendor_profiles(id),
  payload TEXT NOT NULL DEFAULT '{}',
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  decided_by_user_id TEXT REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_timeline_requests_wedding
  ON timeline_change_requests(wedding_id, status);
