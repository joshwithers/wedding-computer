-- Referral program + gifted free months
-- A "free month" is a billing credit toward the Pro subscription (not comped access).
-- free_months is a single per-vendor balance, app-capped at 9, fed by referrals + admin gifts.

-- vendor_profiles: shareable referral code, who referred this vendor, banked free-month balance
ALTER TABLE vendor_profiles ADD COLUMN referral_code TEXT;
ALTER TABLE vendor_profiles ADD COLUMN referred_by_vendor_id TEXT;
ALTER TABLE vendor_profiles ADD COLUMN free_months INTEGER NOT NULL DEFAULT 0;

-- Backfill referral codes for existing vendors (ADD COLUMN can't use an expression default)
UPDATE vendor_profiles SET referral_code = lower(hex(randomblob(8))) WHERE referral_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_referral_code ON vendor_profiles(referral_code);
CREATE INDEX IF NOT EXISTS idx_vendor_referred_by ON vendor_profiles(referred_by_vendor_id);

-- Referral relationships (one referrer per referred vendor)
CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  referrer_vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  referred_vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'converted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  converted_at TEXT,
  UNIQUE(referred_vendor_id)
);

-- Append-only ledger of free-month grants (audit + admin/vendor display)
CREATE TABLE IF NOT EXISTS free_month_grants (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  months INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('referral_reward', 'referred_signup', 'admin_gift')),
  granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_vendor_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_vendor_id);
CREATE INDEX IF NOT EXISTS idx_free_month_grants_vendor ON free_month_grants(vendor_id);
