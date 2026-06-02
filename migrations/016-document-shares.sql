-- Document sharing: per-member visibility for wedding files
CREATE TABLE IF NOT EXISTS document_shares (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(document_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_document_shares_document ON document_shares(document_id);
CREATE INDEX IF NOT EXISTS idx_document_shares_user ON document_shares(user_id);

-- Add description column for user-provided label
ALTER TABLE documents ADD COLUMN description TEXT;
