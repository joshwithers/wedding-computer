-- Waitlist: people interested in Wedding Computer who aren't yet vendors or
-- couples. Captured via the public "be notified when it's live" form.
CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  country TEXT,
  status TEXT NOT NULL DEFAULT 'subscribed'
    CHECK (status IN ('subscribed','unsubscribed')),
  unsubscribe_token TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);
CREATE INDEX IF NOT EXISTS idx_waitlist_country ON waitlist(country);
