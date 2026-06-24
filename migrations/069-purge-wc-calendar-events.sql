-- The legacy per-vendor wc:* calendar anchors (wc:ceremony et al.) are no longer
-- generated or read: the iCal/CalDAV feed and the dashboard render the shared
-- timeline_items directly and explicitly skip wc:* rows. Purge the dead rows.
--
-- Self-protecting: only delete wc:* rows for weddings that actually HAVE a real
-- timeline item — for those, the timeline is the schedule source and the wc:*
-- anchor is pure duplicate. A wedding with no timeline_items (shouldn't exist —
-- the projection shim materialises one for any ceremony time) keeps its anchor so
-- its dashboard never goes blank. Vendors' own manual bookings / blocked dates
-- (no wc: tag) are untouched.
DELETE FROM calendar_events
WHERE notes LIKE 'wc:%'
  AND wedding_id IN (SELECT DISTINCT wedding_id FROM timeline_items WHERE marker IS NULL);
