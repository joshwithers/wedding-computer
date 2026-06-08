-- Write-only enquiry intake key for the API / webhook / Zapier / agent channels.
-- Separate from ical_token (the read-only sync/MCP credential) so a key pasted
-- into a third-party automation can ONLY create leads, never read vendor data.
-- Pro-gated at the endpoint; the column exists for all vendors.
ALTER TABLE vendor_profiles ADD COLUMN enquiry_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_profiles_enquiry_key ON vendor_profiles(enquiry_key);
