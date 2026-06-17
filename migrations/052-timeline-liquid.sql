-- Liquid timeline: relative anchoring + durations + live actuals.
--
-- All columns are nullable or defaulted, so every existing row stays a plain
-- absolute item (anchor_type NULL → use start_time as before). Nothing is
-- rewritten; the solver simply treats un-anchored rows as fixed points.
--
--   duration_minutes      explicit length; end = start + duration
--   anchor_type           'after' | 'before' | 'sun' (NULL = absolute)
--   anchor_ref            timeline_items.id (after/before) or a sun event
--                         ('sunrise' | 'sunset' | 'golden_hour')
--   anchor_offset_minutes signed offset from the anchor
--   pinned                1 = a fixed point a reflow must never move
--   actual_start          'HH:MM' real start recorded on the day (live mode)

ALTER TABLE timeline_items ADD COLUMN duration_minutes INTEGER;
ALTER TABLE timeline_items ADD COLUMN anchor_type TEXT;
ALTER TABLE timeline_items ADD COLUMN anchor_ref TEXT;
ALTER TABLE timeline_items ADD COLUMN anchor_offset_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE timeline_items ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE timeline_items ADD COLUMN actual_start TEXT;
