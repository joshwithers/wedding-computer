-- Agency team members and wedding assignments

ALTER TABLE vendor_profiles ADD COLUMN is_agency INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  title TEXT,
  avatar_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wedding_team_assignments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  wedding_member_id TEXT NOT NULL REFERENCES wedding_members(id) ON DELETE CASCADE,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  role TEXT,
  notes TEXT,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(wedding_id, team_member_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_vendor ON team_members(vendor_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_active ON team_members(vendor_id, is_active);
CREATE INDEX IF NOT EXISTS idx_wedding_team_wedding ON wedding_team_assignments(wedding_id);
CREATE INDEX IF NOT EXISTS idx_wedding_team_member ON wedding_team_assignments(team_member_id);
CREATE INDEX IF NOT EXISTS idx_wedding_team_wm ON wedding_team_assignments(wedding_member_id);
