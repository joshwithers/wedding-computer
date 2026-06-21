-- Per-user temperature unit preference for the weather forecast.
-- 'c' (Celsius) | 'f' (Fahrenheit); NULL = default to Celsius (most of the world).
ALTER TABLE users ADD COLUMN temperature_unit TEXT;
