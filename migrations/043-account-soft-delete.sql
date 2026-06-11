-- Reversible account deletion: a 30-day grace period. Deleting an account now
-- sets deleted_at (and logs the user out everywhere); signing back in within
-- the window restores it; the nightly cron hard-purges (R2/KV/D1) after 30 days.
-- This turns the single most catastrophic, irreversible action into a non-event.
ALTER TABLE users ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);
