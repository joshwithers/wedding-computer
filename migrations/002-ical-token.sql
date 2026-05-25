ALTER TABLE vendor_profiles ADD COLUMN ical_token TEXT;
CREATE UNIQUE INDEX idx_vendor_profiles_ical_token ON vendor_profiles(ical_token);
