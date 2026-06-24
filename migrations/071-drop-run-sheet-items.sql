-- The legacy per-vendor run_sheet_items table was unified into timeline_items
-- (migration 051) and its data backfilled (scripts/backfill-timeline.mjs). No
-- live code reads or writes it anymore — the vault timeline.md two-way sync, the
-- web UI, MCP, and the calendar feeds all work through timeline_items. Drop it.
DROP TABLE IF EXISTS run_sheet_items;
