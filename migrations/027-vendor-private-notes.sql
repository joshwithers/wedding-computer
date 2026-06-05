-- Per-vendor private notes on a wedding (only visible to that vendor)
ALTER TABLE wedding_members ADD COLUMN vendor_notes TEXT;
