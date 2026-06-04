-- Per-wedding emoji prefix for calendar events
ALTER TABLE weddings ADD COLUMN emoji TEXT;

-- Bump in/out times for vendor setup and packdown
ALTER TABLE weddings ADD COLUMN bump_in_time TEXT;
ALTER TABLE weddings ADD COLUMN bump_out_time TEXT;
