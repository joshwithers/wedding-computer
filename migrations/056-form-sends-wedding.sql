-- "Send a custom form to a couple": a vendor sends one of their reusable forms
-- to a specific wedding. Each send gets its own token/link; responses are
-- stamped with the wedding so they surface on the wedding page for the couple
-- and the vendor, optionally shared with the whole vendor team.

CREATE TABLE IF NOT EXISTS form_sends (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  form_id            TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  wedding_id         TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  vendor_id          TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  token              TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_form_sends_wedding ON form_sends(wedding_id);
CREATE INDEX IF NOT EXISTS idx_form_sends_form ON form_sends(form_id);

-- Submissions can belong to a wedding (when made through a send link). Default
-- visibility is the owning vendor + the couple; shared_with_team = 1 opens it to
-- every vendor on the wedding.
ALTER TABLE form_submissions ADD COLUMN wedding_id TEXT;
ALTER TABLE form_submissions ADD COLUMN form_send_id TEXT;
ALTER TABLE form_submissions ADD COLUMN shared_with_team INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_form_submissions_wedding ON form_submissions(wedding_id);
