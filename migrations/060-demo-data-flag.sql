-- Tag sample/onboarding data so a vendor can load a demo "week" and remove it
-- cleanly later. Only the two top-level entities need the flag — children are
-- discovered by joining to the demo wedding ids (and cascade with the wedding).
-- weddings has no vendor_id (multi-party): scope demo weddings via created_by_user_id.
ALTER TABLE weddings ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
