-- Add duration_hours to weddings so calendar events have proper end times.
-- Stored as REAL to support half-hour increments (e.g. 1.5 = 1h30m).
ALTER TABLE weddings ADD COLUMN duration_hours REAL;
