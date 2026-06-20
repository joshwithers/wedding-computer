-- Files uploaded through a custom form's file-upload field. The binary lives in
-- R2 (key = r2_key); this row records ownership + metadata so downloads can be
-- gated to the owning vendor + the wedding's members. One row per uploaded file.
CREATE TABLE IF NOT EXISTS form_files (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  submission_id TEXT NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  vendor_id     TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  field_id      TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  filename      TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_form_files_submission ON form_files(submission_id);
