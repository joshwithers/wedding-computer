-- Structured region for the wedding itself (vector 2 of demand data: where
-- the wedding happens, vs where the vendor is based). Populated by geocoding
-- the free-text location via Google Places; *_geocoded_from records the text
-- that was geocoded so externally-edited rows can be re-geocoded by the
-- nightly catch-up pass.
ALTER TABLE weddings ADD COLUMN location_city TEXT;
ALTER TABLE weddings ADD COLUMN location_state TEXT;
ALTER TABLE weddings ADD COLUMN location_country TEXT;
ALTER TABLE weddings ADD COLUMN location_geocoded_from TEXT;

ALTER TABLE contacts ADD COLUMN wedding_location_city TEXT;
ALTER TABLE contacts ADD COLUMN wedding_location_state TEXT;
ALTER TABLE contacts ADD COLUMN wedding_location_country TEXT;
ALTER TABLE contacts ADD COLUMN wedding_location_geocoded_from TEXT;
