-- Tax & invoicing compliance fields on vendor profiles
ALTER TABLE vendor_profiles ADD COLUMN tax_label TEXT;
ALTER TABLE vendor_profiles ADD COLUMN tax_rate INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vendor_profiles ADD COLUMN tax_inclusive INTEGER NOT NULL DEFAULT 1;
ALTER TABLE vendor_profiles ADD COLUMN tax_number TEXT;
ALTER TABLE vendor_profiles ADD COLUMN tax_number_label TEXT;
ALTER TABLE vendor_profiles ADD COLUMN business_address TEXT;
ALTER TABLE vendor_profiles ADD COLUMN invoice_prefix TEXT NOT NULL DEFAULT 'INV-';
ALTER TABLE vendor_profiles ADD COLUMN next_invoice_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE vendor_profiles ADD COLUMN card_fee_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vendor_profiles ADD COLUMN card_fee_percent REAL NOT NULL DEFAULT 0;

-- Snapshot tax config on each invoice at creation time
ALTER TABLE invoices ADD COLUMN invoice_number TEXT;
ALTER TABLE invoices ADD COLUMN tax_label TEXT;
ALTER TABLE invoices ADD COLUMN tax_rate INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN tax_inclusive INTEGER NOT NULL DEFAULT 1;
ALTER TABLE invoices ADD COLUMN subtotal_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN tax_amount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN card_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN card_fee_percent REAL NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN vendor_tax_number TEXT;
ALTER TABLE invoices ADD COLUMN vendor_business_name TEXT;
ALTER TABLE invoices ADD COLUMN vendor_business_address TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(vendor_id, invoice_number);
