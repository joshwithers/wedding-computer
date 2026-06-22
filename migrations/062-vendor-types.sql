-- Admin-managed list of vendor types, used for the "type of vendor" dropdown
-- when adding a vendor to a wedding (wedding_members.vendor_role). Seeded from
-- the canonical VENDOR_CATEGORIES; admins can add/remove (deactivate) more.
-- The role itself is still stored as a free string on the membership, so
-- deactivating a type never breaks existing weddings.
CREATE TABLE IF NOT EXISTS vendor_types (
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  is_system INTEGER NOT NULL DEFAULT 0,  -- seeded default (translatable via onboarding.category.<slug>)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO vendor_types (slug, label, sort_order, is_system) VALUES
  ('celebrant', 'Celebrant', 0, 1),
  ('photographer', 'Photographer', 1, 1),
  ('videographer', 'Videographer', 2, 1),
  ('florist', 'Florist', 3, 1),
  ('planner', 'Planner', 4, 1),
  ('venue', 'Venue', 5, 1),
  ('stylist', 'Stylist', 6, 1),
  ('caterer', 'Caterer', 7, 1),
  ('dj', 'DJ', 8, 1),
  ('band', 'Band', 9, 1),
  ('hair', 'Hair', 10, 1),
  ('makeup', 'Makeup', 11, 1),
  ('cake', 'Cake', 12, 1),
  ('stationery', 'Stationery', 13, 1),
  ('other', 'Other', 14, 1);
