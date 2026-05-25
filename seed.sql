-- Seed data for local development

INSERT OR IGNORE INTO users (id, email, name, email_verified)
VALUES ('a1b2c3d4e5f6a1b2c3d4e5f6', 'josh@withers.co', 'Josh Withers', 1);

INSERT OR IGNORE INTO vendor_profiles (id, user_id, business_name, category, location, bio)
VALUES (
  'v1a2b3c4d5e6v1a2b3c4d5e6',
  'a1b2c3d4e5f6a1b2c3d4e5f6',
  'Josh Withers Celebrant',
  'celebrant',
  'Australia',
  'Marriage celebrant making weddings awesome since 2009.'
);

-- Sample contacts
INSERT OR IGNORE INTO contacts (id, vendor_id, first_name, last_name, email, phone, partner_first_name, partner_last_name, partner_email, source, status, wedding_date, wedding_location)
VALUES
  ('c001000000000000c0010000', 'v1a2b3c4d5e6v1a2b3c4d5e6', 'Sarah', 'Chen', 'sarah@example.com', '0412345678', 'James', 'Wilson', 'james@example.com', 'Instagram', 'new', '2026-11-15', 'Byron Bay'),
  ('c002000000000000c0020000', 'v1a2b3c4d5e6v1a2b3c4d5e6', 'Emma', 'Taylor', 'emma.t@example.com', '0423456789', 'Liam', 'Brown', null, 'Website', 'contacted', '2027-03-20', 'Gold Coast'),
  ('c003000000000000c0030000', 'v1a2b3c4d5e6v1a2b3c4d5e6', 'Mia', 'Johnson', 'mia.j@example.com', null, 'Noah', 'Davis', 'noah@example.com', 'Referral', 'quoted', '2026-09-05', 'Sydney'),
  ('c004000000000000c0040000', 'v1a2b3c4d5e6v1a2b3c4d5e6', 'Olivia', 'Martin', 'olivia@example.com', '0434567890', 'Ethan', 'Garcia', null, 'Instagram', 'booked', '2026-07-12', 'Melbourne'),
  ('c005000000000000c0050000', 'v1a2b3c4d5e6v1a2b3c4d5e6', 'Ava', 'Thompson', 'ava@example.com', '0445678901', null, null, null, 'Website', 'completed', '2025-12-01', 'Brisbane');

-- Sample weddings
INSERT OR IGNORE INTO weddings (id, title, date, time, location, status, created_by_user_id)
VALUES
  ('w001000000000000w0010000', 'Olivia & Ethan', '2026-07-12', '15:00', 'Melbourne', 'confirmed', 'a1b2c3d4e5f6a1b2c3d4e5f6'),
  ('w002000000000000w0020000', 'Ava & Partner', '2025-12-01', '14:00', 'Brisbane', 'completed', 'a1b2c3d4e5f6a1b2c3d4e5f6');

INSERT OR IGNORE INTO wedding_members (id, wedding_id, user_id, role, vendor_profile_id, vendor_role, status, accepted_at)
VALUES
  ('wm01000000000000wm010000', 'w001000000000000w0010000', 'a1b2c3d4e5f6a1b2c3d4e5f6', 'owner', 'v1a2b3c4d5e6v1a2b3c4d5e6', 'celebrant', 'active', datetime('now')),
  ('wm02000000000000wm020000', 'w002000000000000w0020000', 'a1b2c3d4e5f6a1b2c3d4e5f6', 'owner', 'v1a2b3c4d5e6v1a2b3c4d5e6', 'celebrant', 'active', datetime('now'));

-- Link booked/completed contacts to weddings
UPDATE contacts SET wedding_id = 'w001000000000000w0010000' WHERE id = 'c004000000000000c0040000';
UPDATE contacts SET wedding_id = 'w002000000000000w0020000' WHERE id = 'c005000000000000c0050000';

INSERT OR IGNORE INTO contact_activities (id, contact_id, type, summary)
VALUES
  ('a001000000000000a0010000', 'c001000000000000c0010000', 'note', 'Contact created'),
  ('a002000000000000a0020000', 'c002000000000000c0020000', 'note', 'Contact created'),
  ('a003000000000000a0030000', 'c002000000000000c0020000', 'status_change', 'Status changed from new to contacted'),
  ('a004000000000000a0040000', 'c003000000000000c0030000', 'note', 'Contact created'),
  ('a005000000000000a0050000', 'c004000000000000c0040000', 'note', 'Contact created'),
  ('a006000000000000a0060000', 'c004000000000000c0040000', 'status_change', 'Status changed from new to booked'),
  ('a007000000000000a0070000', 'c005000000000000c0050000', 'note', 'Contact created');
