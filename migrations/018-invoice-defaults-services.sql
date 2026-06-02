-- Service templates and invoice defaults on vendor profiles
ALTER TABLE vendor_profiles ADD COLUMN service_templates TEXT;
ALTER TABLE vendor_profiles ADD COLUMN invoice_defaults TEXT;
