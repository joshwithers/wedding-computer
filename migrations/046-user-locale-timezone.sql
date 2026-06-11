-- Per-user language/region and timezone preferences (i18n bedrock).
-- locale is a BCP 47 tag ('en-AU'); timezone is an IANA zone. Both nullable —
-- resolution falls back through Accept-Language / vendor timezone / platform
-- defaults (see src/i18n).
ALTER TABLE users ADD COLUMN locale TEXT;
ALTER TABLE users ADD COLUMN timezone TEXT;
