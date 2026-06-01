-- Remove 'owner' role from wedding_members.
-- Replace with 'vendor' role + can_manage flag.
-- Planners, venues, and the creating vendor get can_manage = 1.

-- Add can_manage flag
ALTER TABLE wedding_members ADD COLUMN can_manage INTEGER NOT NULL DEFAULT 0;

-- Migrate existing owners to vendors with can_manage
UPDATE wedding_members SET role = 'vendor', can_manage = 1 WHERE role = 'owner';

-- Give couples can_manage by default (they should be able to edit their own wedding)
UPDATE wedding_members SET can_manage = 1 WHERE role = 'couple';
