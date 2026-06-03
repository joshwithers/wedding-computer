-- Seed data for local development

INSERT OR IGNORE INTO users (id, email, name, email_verified)
VALUES ('a1b2c3d4e5f6a1b2c3d4e5f6', 'demo@wedding.computer', 'Demo Vendor', 1);

INSERT OR IGNORE INTO vendor_profiles (id, user_id, business_name, category, location, bio, ceremony_types)
VALUES (
  'v1a2b3c4d5e6v1a2b3c4d5e6',
  'a1b2c3d4e5f6a1b2c3d4e5f6',
  'Demo Celebrant Co',
  'celebrant',
  'Australia',
  'Marriage celebrant making weddings awesome since 2009.',
  '["wedding","elopement","micro wedding","paperwork only"]'
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
INSERT OR IGNORE INTO weddings (id, title, date, time, location, status, ceremony_type, vendor_visibility, created_by_user_id)
VALUES
  ('w001000000000000w0010000', 'Olivia & Ethan', '2026-07-12', '15:00', 'Melbourne', 'confirmed', 'wedding', 'private', 'a1b2c3d4e5f6a1b2c3d4e5f6'),
  ('w002000000000000w0020000', 'Ava & Partner', '2025-12-01', '14:00', 'Brisbane', 'completed', 'elopement', 'private', 'a1b2c3d4e5f6a1b2c3d4e5f6');

INSERT OR IGNORE INTO wedding_members (id, wedding_id, user_id, role, vendor_profile_id, vendor_role, can_manage, status, accepted_at)
VALUES
  ('wm01000000000000wm010000', 'w001000000000000w0010000', 'a1b2c3d4e5f6a1b2c3d4e5f6', 'vendor', 'v1a2b3c4d5e6v1a2b3c4d5e6', 'celebrant', 1, 'active', datetime('now')),
  ('wm02000000000000wm020000', 'w002000000000000w0020000', 'a1b2c3d4e5f6a1b2c3d4e5f6', 'vendor', 'v1a2b3c4d5e6v1a2b3c4d5e6', 'celebrant', 1, 'active', datetime('now'));

-- Couple users
INSERT OR IGNORE INTO users (id, email, name, email_verified)
VALUES
  ('u002000000000000u0020000', 'sarah@example.com', 'Sarah Chen', 1),
  ('u003000000000000u0030000', 'james@example.com', 'James Wilson', 1);

-- Couple members on wedding 1
INSERT OR IGNORE INTO wedding_members (id, wedding_id, user_id, role, status, accepted_at)
VALUES
  ('wm03000000000000wm030000', 'w001000000000000w0010000', 'u002000000000000u0020000', 'couple', 'active', datetime('now')),
  ('wm04000000000000wm040000', 'w001000000000000w0010000', 'u003000000000000u0030000', 'couple', 'active', datetime('now'));

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

-- Couple vendor planning entries for wedding w001
-- Manual vendor (no vendor_profile_id — added by couple, not on platform)
INSERT OR IGNORE INTO couple_vendors (id, wedding_id, name, category, email, phone, website, notes, expected_price_cents, status)
VALUES
  ('cv01000000000000cv010000', 'w001000000000000w0010000', 'Bloom & Wild Florals', 'florist', 'hello@bloomwild.com.au', '0456789012', 'https://bloomwild.com.au', 'Loved their bridal bouquet samples. Meeting next Tuesday.', 350000, 'contacted'),
  ('cv02000000000000cv020000', 'w001000000000000w0010000', 'Snap Happy Photography', 'photographer', null, null, null, 'Recommended by Emma. Need to check availability.', 450000, 'considering'),
  ('cv03000000000000cv030000', 'w001000000000000w0010000', 'Sweet Layers Cakes', 'cake', 'orders@sweetlayers.com', null, 'https://sweetlayers.com', null, 120000, 'booked');

-- Set ical_token for DAV feeds
UPDATE vendor_profiles SET ical_token = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' WHERE id = 'v1a2b3c4d5e6v1a2b3c4d5e6';

-- Sample calendar events
INSERT OR IGNORE INTO calendar_events (id, vendor_id, title, date, start_time, end_time, all_day, type, wedding_id)
VALUES
  ('ev01000000000000ev010000', 'v1a2b3c4d5e6v1a2b3c4d5e6', 'Olivia & Ethan Wedding', '2026-07-12', '15:00', '16:30', 0, 'booking', 'w001000000000000w0010000'),
  ('ev02000000000000ev020000', 'v1a2b3c4d5e6v1a2b3c4d5e6', 'Holiday — Bali', '2026-08-01', null, null, 1, 'personal', null),
  ('ev03000000000000ev030000', 'v1a2b3c4d5e6v1a2b3c4d5e6', 'Blocked', '2026-09-05', null, null, 1, 'blocked', null);

-- Checklist templates
INSERT OR IGNORE INTO todo_templates (id, vendor_id, name, content, is_default)
VALUES
  ('tt01000000000000tt010000', 'v1a2b3c4d5e6v1a2b3c4d5e6', 'Wedding Ceremony', '## Before the wedding

- [ ] Confirm ceremony date and time
- [ ] Meet with couple for planning session
- [ ] Collect legal paperwork (NOIM)
- [ ] Write ceremony draft
- [ ] Send ceremony draft to couple for review
- [ ] Confirm readings and vows
- [ ] Confirm music choices

## Week of wedding

- [ ] Confirm final timeline with couple
- [ ] Confirm venue access and setup
- [ ] Print ceremony script
- [ ] Charge all devices
- [ ] Pack ceremony kit

## On the day

- [ ] Arrive 30 minutes early
- [ ] Check sound system
- [ ] Brief bridal party on positions
- [ ] Conduct rehearsal if needed
- [ ] Perform ceremony

## After the wedding

- [ ] Lodge marriage paperwork
- [ ] Send signed certificate
- [ ] Follow up with couple', 1);

-- Wedding todo (deployed from template to the confirmed wedding)
INSERT OR IGNORE INTO wedding_todos (id, vendor_id, wedding_id, content, template_id)
VALUES
  ('wt01000000000000wt010000', 'v1a2b3c4d5e6v1a2b3c4d5e6', 'w001000000000000w0010000', '## Before the wedding

- [x] Confirm ceremony date and time
- [x] Meet with couple for planning session
- [x] Collect legal paperwork (NOIM)
- [ ] Write ceremony draft
- [ ] Send ceremony draft to couple for review
- [ ] Confirm readings and vows
- [ ] Confirm music choices

## Week of wedding

- [ ] Confirm final timeline with couple
- [ ] Confirm venue access and setup
- [ ] Print ceremony script
- [ ] Charge all devices
- [ ] Pack ceremony kit

## On the day

- [ ] Arrive 30 minutes early
- [ ] Check sound system
- [ ] Brief bridal party on positions
- [ ] Conduct rehearsal if needed
- [ ] Perform ceremony

## After the wedding

- [ ] Lodge marriage paperwork
- [ ] Send signed certificate
- [ ] Follow up with couple', 'tt01000000000000tt010000');
