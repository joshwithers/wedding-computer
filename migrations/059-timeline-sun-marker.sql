-- Mark astronomical "fact" rows (sunrise/sunset) on the timeline. These are
-- points in time derived from the venue + date, not scheduling sections: no
-- people, no start/stop, no manual time — rendered inline by time. NULL = a
-- normal item. Value mirrors the sun anchor_ref ('sunrise' | 'sunset').
ALTER TABLE timeline_items ADD COLUMN marker TEXT;

-- Backfill markers added by the quick-add button before this column existed:
-- a zero-offset sun anchor with no duration/end is the marker, not a sun-anchored
-- activity (those carry an offset, a duration, or a real title).
UPDATE timeline_items SET marker = anchor_ref
  WHERE anchor_type = 'sun' AND anchor_offset_minutes = 0
    AND duration_minutes IS NULL AND end_time IS NULL
    AND anchor_ref IN ('sunrise', 'sunset') AND slot IS NULL;
