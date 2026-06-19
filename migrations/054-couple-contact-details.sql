-- Couple contact details on contacts: postal address + social links, so a
-- vendor can store and surface the couple's full details on the wedding page.
ALTER TABLE contacts ADD COLUMN address TEXT;
ALTER TABLE contacts ADD COLUMN instagram TEXT;
ALTER TABLE contacts ADD COLUMN facebook TEXT;
ALTER TABLE contacts ADD COLUMN tiktok TEXT;
ALTER TABLE contacts ADD COLUMN website TEXT;
