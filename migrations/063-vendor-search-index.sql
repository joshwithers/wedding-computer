-- Speeds up the add-vendor typeahead (business-name lookup of existing vendors).
-- Case-insensitive so prefix matches + ORDER BY business_name use the index.
CREATE INDEX IF NOT EXISTS idx_vendor_profiles_business_name
  ON vendor_profiles (business_name COLLATE NOCASE);
