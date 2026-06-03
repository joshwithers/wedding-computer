-- Todo checklist templates and per-wedding checklists
-- Stored as markdown task lists: - [ ] item / - [x] done

CREATE TABLE IF NOT EXISTS todo_templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wedding_todos (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  template_id TEXT REFERENCES todo_templates(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor_id, wedding_id)
);

CREATE INDEX IF NOT EXISTS idx_todo_templates_vendor ON todo_templates(vendor_id);
CREATE INDEX IF NOT EXISTS idx_wedding_todos_vendor ON wedding_todos(vendor_id);
CREATE INDEX IF NOT EXISTS idx_wedding_todos_wedding ON wedding_todos(wedding_id);
