-- Light branding for a vendor's public forms (enquiry, booking, custom).
-- Stored as a small JSON blob: { accent, background, ink, font, logo }.
-- NULL = house default theme. See src/lib/form-theme.ts.
ALTER TABLE vendor_profiles ADD COLUMN brand_theme TEXT;
