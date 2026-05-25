-- Add optional vendor AI API key
ALTER TABLE vendor_profiles ADD COLUMN anthropic_api_key TEXT;
