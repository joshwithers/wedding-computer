-- The per-assignee "add to my calendar" opt-in is gone: every member of a
-- wedding now sees the whole shared timeline in their iCal/CalDAV feed, so the
-- flag had no effect (the calendar query no longer joins assignees). The UI
-- toggle, handler, routes and helpers are removed alongside this migration.
ALTER TABLE timeline_item_assignees DROP COLUMN added_to_calendar;
