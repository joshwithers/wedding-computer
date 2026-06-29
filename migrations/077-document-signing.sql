-- Collaborative PDF signing (NOIM & any PDF). A celebrant starts a signing
-- session against a source PDF; the couple draws their signature, then the
-- celebrant draws theirs, producing a final signed PDF kept as a private
-- (celebrant-only) wedding document.
--
-- Additive only (CREATE) — no table rebuild (prod D1 enforces FK during
-- migrations). The signature is legally valid (digital wet signature), so the
-- row also captures evidentiary metadata: who signed, when, from where.

CREATE TABLE IF NOT EXISTS document_signing_sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id),       -- owning celebrant
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('upload', 'noim')),
  source_ref TEXT,                          -- form_submission id for 'noim', else NULL
  title TEXT NOT NULL,
  source_r2_key TEXT NOT NULL,              -- original PDF
  current_r2_key TEXT NOT NULL,             -- latest burned version (starts == source)
  couple_signed_r2_key TEXT,               -- snapshot the couple may re-download
  final_document_id TEXT REFERENCES documents(id),  -- set on complete
  status TEXT NOT NULL DEFAULT 'awaiting_couple'
    CHECK (status IN ('awaiting_couple', 'awaiting_celebrant', 'complete', 'cancelled')),
  -- Signing integrity / evidentiary metadata.
  couple_signed_at TEXT,
  couple_signed_by_user_id TEXT REFERENCES users(id),  -- couple member, or facilitating celebrant in-person
  couple_signed_in_person INTEGER NOT NULL DEFAULT 0,  -- 1 = celebrant-facilitated on their device
  couple_signed_ip TEXT,
  celebrant_signed_at TEXT,
  celebrant_signed_ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_signing_sessions_wedding ON document_signing_sessions(wedding_id);
CREATE INDEX IF NOT EXISTS idx_signing_sessions_vendor ON document_signing_sessions(vendor_id);
