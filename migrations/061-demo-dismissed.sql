-- Lets a vendor permanently dismiss the "Load sample data" first-run invite.
-- The Remove control still appears whenever demo data is actually loaded.
ALTER TABLE vendor_profiles ADD COLUMN demo_dismissed INTEGER NOT NULL DEFAULT 0;
