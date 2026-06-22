-- In some countries a celebrant is called an "officiant". The canonical vendor
-- type stays 'celebrant' (so directory/matching/credits/analytics are unchanged);
-- this per-vendor preference only changes how that one role is LABELLED for the
-- vendor. NULL = "Celebrant", 'officiant' = "Officiant".
ALTER TABLE vendor_profiles ADD COLUMN celebrant_term TEXT;
