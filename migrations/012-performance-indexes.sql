-- Performance: composite index for contacts filtered by vendor + status
CREATE INDEX IF NOT EXISTS idx_contacts_vendor_status ON contacts(vendor_id, status);

-- Performance: composite index for invoices filtered by vendor + status
CREATE INDEX IF NOT EXISTS idx_invoices_vendor_status ON invoices(vendor_id, status);

-- Performance: composite index for emails unread count query
CREATE INDEX IF NOT EXISTS idx_emails_vendor_unread ON emails(vendor_id, direction, is_read, is_system);
