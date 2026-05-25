-- Add booking fee and payment plan fields to invoices
ALTER TABLE invoices ADD COLUMN booking_fee_type TEXT DEFAULT 'fixed' CHECK (booking_fee_type IN ('fixed', 'percentage'));
ALTER TABLE invoices ADD COLUMN booking_fee_value INTEGER DEFAULT 0;
ALTER TABLE invoices ADD COLUMN notes TEXT;

-- Update status to include 'partial' for partially paid invoices
-- SQLite doesn't support ALTER CHECK, so we drop and recreate isn't possible.
-- We'll enforce the new status values at the application layer.

-- Payment schedule table
CREATE TABLE IF NOT EXISTS invoice_payments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'overdue')),
  method TEXT CHECK (method IN ('stripe', 'cash', 'bank_transfer', 'payid')),
  stripe_payment_intent_id TEXT,
  paid_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE INDEX idx_invoice_payments_vendor ON invoice_payments(vendor_id);
CREATE INDEX idx_invoice_payments_status ON invoice_payments(status, due_date);
