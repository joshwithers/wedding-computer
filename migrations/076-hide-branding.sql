-- Pro white-label: let Pro vendors hide the "Wedding Computer" branding on their
-- public forms (the "Powered by" footer) and on the couple-facing emails sent on
-- their behalf (the logo + footer in the email shell).
-- Additive only. Enforced as a Pro feature at the toggle in settings.
ALTER TABLE vendor_profiles ADD COLUMN hide_branding INTEGER NOT NULL DEFAULT 0;
