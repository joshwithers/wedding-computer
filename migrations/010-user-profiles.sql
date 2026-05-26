-- Migration 010: Expand user profiles
-- Users become the central identity with rich profile data

ALTER TABLE users ADD COLUMN date_of_birth TEXT;
ALTER TABLE users ADD COLUMN address_line_1 TEXT;
ALTER TABLE users ADD COLUMN address_line_2 TEXT;
ALTER TABLE users ADD COLUMN city TEXT;
ALTER TABLE users ADD COLUMN state TEXT;
ALTER TABLE users ADD COLUMN postcode TEXT;
ALTER TABLE users ADD COLUMN country TEXT;
ALTER TABLE users ADD COLUMN instagram TEXT;
ALTER TABLE users ADD COLUMN facebook TEXT;
ALTER TABLE users ADD COLUMN tiktok TEXT;
ALTER TABLE users ADD COLUMN linkedin TEXT;
ALTER TABLE users ADD COLUMN website TEXT;
ALTER TABLE users ADD COLUMN avatar_r2_key TEXT;
