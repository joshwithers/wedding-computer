-- bump_in_time / bump_out_time are vestigial: nothing displays, calendars,
-- MCP, or otherwise reads them (only a wedding.md frontmatter-parse remnant,
-- now removed). The per-vendor bump-in concept lives elsewhere. Drop the dead
-- columns from both tables.
ALTER TABLE weddings DROP COLUMN bump_in_time;
ALTER TABLE weddings DROP COLUMN bump_out_time;
ALTER TABLE wedding_members DROP COLUMN bump_in_time;
ALTER TABLE wedding_members DROP COLUMN bump_out_time;
