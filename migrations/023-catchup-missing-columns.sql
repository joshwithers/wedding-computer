-- Catch-up: columns from migration 007 that were never applied to production
ALTER TABLE weddings ADD COLUMN ceremony_type TEXT DEFAULT 'wedding';
ALTER TABLE weddings ADD COLUMN vendor_visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE vendor_profiles ADD COLUMN ceremony_types TEXT;
