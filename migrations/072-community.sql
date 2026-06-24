-- Couples community — season + year cohorts, one room per country.
--
-- Couples (and vendors, who help with a badge) opt into a room keyed by
-- (year, season, country) derived from the wedding date + hemisphere. The
-- state/province rides along as a per-member / per-thread TAG powering an
-- in-room filter — it is never its own room. Cohorts are created lazily on the
-- first join, so empty rooms never exist.
--
-- Posts reuse the wedding-docs model: raw markdown stored in D1, rendered
-- client-side via marked + DOMPurify (no server-side HTML → no server XSS),
-- with the FNV-1a content token (db/wedding-docs.ts contentToken) guarding
-- optimistic-concurrency edits. Author identity is snapshotted on every post so
-- a renamed / departed / deleted member still renders correctly.

CREATE TABLE IF NOT EXISTS community_cohorts (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  cohort_key    TEXT NOT NULL UNIQUE,                   -- '2027-autumn-australia' (year-season-countrySlug)
  year          INTEGER NOT NULL,
  season        TEXT NOT NULL CHECK (season IN ('summer','autumn','winter','spring')),
  country       TEXT NOT NULL,                          -- country slug, e.g. 'australia'
  country_name  TEXT NOT NULL,                          -- display name, e.g. 'Australia'
  member_count  INTEGER NOT NULL DEFAULT 0,             -- denormalised liveliness signals
  thread_count  INTEGER NOT NULL DEFAULT 0,
  last_activity_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(year, season, country)
);
CREATE INDEX IF NOT EXISTS idx_community_cohorts_year ON community_cohorts(year);
CREATE INDEX IF NOT EXISTS idx_community_cohorts_country ON community_cohorts(country, year, season);

CREATE TABLE IF NOT EXISTS community_members (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  cohort_id     TEXT NOT NULL REFERENCES community_cohorts(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('couple','vendor')),
  display_name  TEXT NOT NULL,                          -- defaults to first name; never exposes date/venue
  subdivision_code  TEXT,                               -- state/province slug, e.g. 'new-south-wales' (filter tag)
  subdivision_label TEXT,                               -- display label, e.g. 'New South Wales'
  -- Vendor badge snapshot (vendors help freely, badged). NULL for couples.
  vendor_profile_id       TEXT REFERENCES vendor_profiles(id) ON DELETE SET NULL,
  vendor_business_name    TEXT,
  vendor_type_label       TEXT,
  vendor_directory_listed INTEGER NOT NULL DEFAULT 0,   -- snapshot; gates whether the badge links out
  wedding_id    TEXT REFERENCES weddings(id) ON DELETE SET NULL,  -- provenance (a user may have several)
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','left','banned')),
  joined_at     TEXT NOT NULL DEFAULT (datetime('now')),
  left_at       TEXT,
  UNIQUE(cohort_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_community_members_cohort ON community_members(cohort_id, status);
CREATE INDEX IF NOT EXISTS idx_community_members_user ON community_members(user_id);

CREATE TABLE IF NOT EXISTS community_threads (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  cohort_id        TEXT NOT NULL REFERENCES community_cohorts(id) ON DELETE CASCADE,
  subdivision_code TEXT,                                -- author's state tag, for the in-room filter
  subdivision_label TEXT,                               -- display label for the tag (snapshot)
  author_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_member_id TEXT REFERENCES community_members(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  reply_count      INTEGER NOT NULL DEFAULT 0,
  last_reply_at    TEXT,
  is_locked        INTEGER NOT NULL DEFAULT 0,          -- moderator lock (no new replies)
  is_removed       INTEGER NOT NULL DEFAULT 0,          -- moderator soft-remove (audit preserved)
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_community_threads_cohort
  ON community_threads(cohort_id, is_removed, last_reply_at);
CREATE INDEX IF NOT EXISTS idx_community_threads_cohort_sub
  ON community_threads(cohort_id, subdivision_code, last_reply_at);

CREATE TABLE IF NOT EXISTS community_posts (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  thread_id        TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  cohort_id        TEXT NOT NULL REFERENCES community_cohorts(id) ON DELETE CASCADE,
  reply_to_post_id TEXT REFERENCES community_posts(id) ON DELETE SET NULL,
  author_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_member_id TEXT REFERENCES community_members(id) ON DELETE SET NULL,
  author_display_name TEXT NOT NULL,                    -- identity snapshot (survives rename/leave/delete)
  author_role      TEXT NOT NULL CHECK (author_role IN ('couple','vendor')),
  author_vendor_business_name TEXT,
  author_vendor_type_label    TEXT,
  author_vendor_profile_id    TEXT,                     -- badge → /directory (only if listed snapshot)
  body             TEXT NOT NULL DEFAULT '',            -- raw markdown
  version          INTEGER NOT NULL DEFAULT 1,
  is_removed       INTEGER NOT NULL DEFAULT 0,
  edited_at        TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_community_posts_thread
  ON community_posts(thread_id, is_removed, created_at);

CREATE TABLE IF NOT EXISTS community_reports (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  post_id          TEXT REFERENCES community_posts(id) ON DELETE CASCADE,
  thread_id        TEXT REFERENCES community_threads(id) ON DELETE CASCADE,
  cohort_id        TEXT NOT NULL REFERENCES community_cohorts(id) ON DELETE CASCADE,
  reporter_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason           TEXT NOT NULL CHECK (reason IN ('spam','harassment','inappropriate','other')),
  detail           TEXT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','actioned','dismissed')),
  resolved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(reporter_user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_community_reports_status ON community_reports(status, created_at);
