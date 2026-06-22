-- Per-wedding vendor types + prefilled Instagram for email-invited vendors.
--
-- vendor_roles: JSON array of vendor-type slugs a vendor is credited/employed as
--   on THIS wedding (a vendor may declare many types on their profile but work
--   as one or several here). NULL/empty → fall back to the singular vendor_role
--   (kept in sync as the first chosen role for backward compatibility).
--
-- invited_instagram: a sanitized Instagram handle captured when a vendor is
--   invited by email before they have a profile, so wedding credits show their
--   @handle immediately. Merged into vendor_profiles.instagram on onboarding.
ALTER TABLE wedding_members ADD COLUMN vendor_roles TEXT;
ALTER TABLE wedding_members ADD COLUMN invited_instagram TEXT;
