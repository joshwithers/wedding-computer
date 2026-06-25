-- Wedding/contact lifecycle: make status a real relationship state, FK-safely.
--
-- Additive only (ALTER ADD COLUMN) — NO table rebuild. Production D1 enforces
-- foreign keys during `migrations apply`, so recreating weddings/contacts to
-- widen a CHECK constraint cascades through their children and is rejected. So
-- the two new "states" are modelled with columns, not new CHECK enum values:
--   * postponed  → weddings.postponed_at IS NOT NULL (status stays a real value;
--                  displayed + treated as "Postponed"). original_date keeps the
--                  date it moved from.
--   * cancelled wedding → its contact goes to the existing 'lost' status + a
--                  cancellation reason, displayed as "Cancelled".
-- ('cancelled' is already a valid weddings.status; only postponed was new there.)
--
-- Reason + timestamp columns capture WHY/WHEN for win/loss + cancellation-rate
-- reporting, on top of the existing wedding_log / contact_activities trail.

ALTER TABLE weddings ADD COLUMN confirmed_at TEXT;
ALTER TABLE weddings ADD COLUMN completed_at TEXT;
ALTER TABLE weddings ADD COLUMN cancelled_at TEXT;
ALTER TABLE weddings ADD COLUMN postponed_at TEXT;
ALTER TABLE weddings ADD COLUMN cancellation_reason TEXT;
ALTER TABLE weddings ADD COLUMN cancellation_note TEXT;
ALTER TABLE weddings ADD COLUMN original_date TEXT;

ALTER TABLE contacts ADD COLUMN lost_reason TEXT;
ALTER TABLE contacts ADD COLUMN lost_note TEXT;
