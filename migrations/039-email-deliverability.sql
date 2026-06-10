-- Email deliverability hardening.
--
-- email_suppressions: addresses that hard-bounced or filed a spam complaint
-- (via the Resend webhook). sendEmailMessage checks this before every send so
-- we stop re-mailing dead/hostile addresses, which protects the shared
-- sending domain's reputation that magic-link auth depends on.
--
-- broadcasts: the body of an admin broadcast, stored once and referenced by
-- id from the per-recipient queue messages, so a 5k-recipient broadcast does
-- not embed full HTML in every message (which overruns the 256KB queue batch
-- limit and re-sends on resubmit).

CREATE TABLE IF NOT EXISTS email_suppressions (
  email TEXT PRIMARY KEY,                 -- always stored lowercased
  reason TEXT NOT NULL,                   -- 'bounce' | 'complaint' | 'manual'
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by_user_id TEXT REFERENCES users(id),
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
