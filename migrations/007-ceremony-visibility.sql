-- Add ceremony type to weddings (vendor-configurable term for the event)
ALTER TABLE weddings ADD COLUMN ceremony_type TEXT DEFAULT 'wedding';

-- Vendor visibility: whether vendors on a wedding can see each other
-- 'private' = only couple sees full vendor list (default, privacy-first)
-- 'visible' = vendors can see other vendors on this wedding
ALTER TABLE weddings ADD COLUMN vendor_visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (vendor_visibility IN ('private', 'visible'));

-- Vendor-configurable ceremony type labels (JSON array of strings)
ALTER TABLE vendor_profiles ADD COLUMN ceremony_types TEXT;
