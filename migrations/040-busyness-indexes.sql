-- Support the busyness aggregation's per-date grouping without full scans.
-- contacts.wedding_date had no index; calendar_events only had a
-- (vendor_id, date) composite, which a date-only filter can't use well.
CREATE INDEX IF NOT EXISTS idx_contacts_wedding_date ON contacts(wedding_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(date);
