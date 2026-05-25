-- Add custom enquiry form config to vendor profiles
ALTER TABLE vendor_profiles ADD COLUMN enquiry_form TEXT;

-- Add form submission data to contacts (stores custom field responses as JSON)
ALTER TABLE contacts ADD COLUMN form_data TEXT;
