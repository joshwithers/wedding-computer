-- Move bump in/out times to wedding_members (per-vendor, not per-wedding)
ALTER TABLE wedding_members ADD COLUMN bump_in_time TEXT;
ALTER TABLE wedding_members ADD COLUMN bump_out_time TEXT;

-- Copy existing wedding-level bump times to the managing vendor's member row
UPDATE wedding_members SET
  bump_in_time = (SELECT bump_in_time FROM weddings WHERE id = wedding_members.wedding_id),
  bump_out_time = (SELECT bump_out_time FROM weddings WHERE id = wedding_members.wedding_id)
WHERE can_manage = 1
  AND (SELECT bump_in_time FROM weddings WHERE id = wedding_members.wedding_id) IS NOT NULL;
