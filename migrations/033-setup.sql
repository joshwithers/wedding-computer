-- In-app onboarding: let a vendor permanently dismiss the dashboard "Get set up"
-- checklist. The checklist also auto-hides once every item is complete.
ALTER TABLE vendor_profiles ADD COLUMN setup_dismissed INTEGER NOT NULL DEFAULT 0;
