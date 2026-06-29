-- Live "release" gate for collaborative signing. The couple cannot sign until the
-- celebrant releases the session and witnesses them (in person or on a call). It
-- re-locks naturally once the couple signs (status leaves 'awaiting_couple'); the
-- celebrant can also lock again manually before they sign.
--
-- Additive ALTERs only (ADD COLUMN) — FK-safe, no table rebuild. Applied on top of
-- migration 077 (which creates the table).
ALTER TABLE document_signing_sessions ADD COLUMN couple_released INTEGER NOT NULL DEFAULT 0;
ALTER TABLE document_signing_sessions ADD COLUMN couple_released_at TEXT;
