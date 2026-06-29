-- Unified forms: one intake system (information / enquiry / booking) + an
-- editable AI auto-reply prompt. Plus the trustworthiness denormalisations.
--
-- ADDITIVE ONLY (ALTER ADD COLUMN / CREATE) — NO table rebuild. Production D1
-- enforces foreign keys during `migrations apply`, and `forms` has three FK
-- children (form_submissions, form_files, form_sends). Recreating `forms` to
-- widen its `type` CHECK would cascade through them and be rejected (the
-- migration-074 lesson). So the new intake intent is a NEW column `forms.kind`
-- with no CHECK (validated at the application layer), NOT a new `type` value.
-- `forms.type` is left exactly as-is ('custom'|'noim'|'contact') and keeps
-- driving the NOIM PDF / template behaviour.

-- The unified intent dimension. Legacy rows become 'information' via the
-- DEFAULT — no row UPDATE needed. App validates it ∈ {information,enquiry,booking}.
ALTER TABLE forms ADD COLUMN kind TEXT NOT NULL DEFAULT 'information';

-- Every intake (enquiry / booking / API / MCP) now writes an immutable
-- form_submissions row. invoice_id links a booking submission back to its
-- invoice for the unified inbox; kind records the intake type at submit time.
-- No FK on invoice_id by design (migration 056 precedent: prod rejects
-- FK-bearing rebuilds; form_submissions.wedding_id is already FK-less for the
-- same reason).
ALTER TABLE form_submissions ADD COLUMN invoice_id TEXT;
ALTER TABLE form_submissions ADD COLUMN kind TEXT;

-- B6: an explicit booking-fee marker replaces the fragile
-- `label LIKE '%booking%'` substring match in the Stripe checkout path.
ALTER TABLE invoice_payments ADD COLUMN is_booking_fee INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_forms_kind ON forms(kind);
CREATE INDEX IF NOT EXISTS idx_form_submissions_invoice ON form_submissions(invoice_id);

-- Editable platform-default AI prompts (admin-managed via /admin/ai-prompts).
-- v1 reads/seeds only the 'default' locale; `locale` is reserved for future
-- per-language defaults. PRIMARY KEY (key, locale) — no FK, no rebuild risk.
-- Per-form overrides live in the form config JSON (confirmationEmail.aiPrompt),
-- so they need no schema. Resolution: per-form → this table → code fallback.
CREATE TABLE IF NOT EXISTS ai_prompts (
  key        TEXT NOT NULL,
  locale     TEXT NOT NULL DEFAULT 'default',
  template   TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (key, locale)
);

-- Seed the enquiry/confirmation auto-reply with the template that reproduces the
-- previously-hardcoded prompt. The availability sentence, instructions block and
-- reply nudge are still assembled in code and passed in as resolved {tokens};
-- interpolatePrompt() strips any unknown token to empty so an edited template
-- can never leak a placeholder. Keep this byte-identical to FALLBACK_ENQUIRY_REPLY
-- in src/services/ai-prompts.ts.
INSERT OR IGNORE INTO ai_prompts (key, locale, template) VALUES
  ('enquiry_reply', 'default', 'You are a wedding {vendorCategory} named {vendorName}. A new enquiry just came in from {contactName}.

{requestedDate}
{location}
{theirMessage}

{availabilityInfo}
{instructionsBlock}
Draft a warm, professional reply acknowledging their enquiry. If available, express enthusiasm. If not available, be gracious and suggest they check back or offer alternative dates. Keep it concise (2-3 paragraphs), friendly, Australian English.{replyNudge} Write just the body — no subject line, no sign-off.');
