-- Five specific venue/location fields per wedding, each with a start time
-- getting_ready_location + getting_ready_time already exist → party 1
ALTER TABLE weddings ADD COLUMN getting_ready_1_label TEXT;
ALTER TABLE weddings ADD COLUMN getting_ready_2_location TEXT;
ALTER TABLE weddings ADD COLUMN getting_ready_2_label TEXT;
ALTER TABLE weddings ADD COLUMN getting_ready_2_time TEXT;
ALTER TABLE weddings ADD COLUMN ceremony_location TEXT;
ALTER TABLE weddings ADD COLUMN portrait_location TEXT;
ALTER TABLE weddings ADD COLUMN portrait_time TEXT;
