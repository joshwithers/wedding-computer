import type { Bindings, AiPrompt } from '../types'

// ─── Editable AI prompts (migration 075) ───
//
// Auto-reply prompts are no longer hardcoded. They resolve in three layers:
//   1. a per-form override (config.actions.confirmationEmail.aiPrompt)
//   2. the admin-editable platform default (ai_prompts table)
//   3. a code fallback (the FALLBACK_* constants below)
// so the platform always has *something* even with an empty DB, and a vendor or
// admin can change the wording without a deploy.
//
// Templates use {token} placeholders. The runtime assembles the dynamic parts
// (availability sentence, the vendor's extra guidance, etc.) as resolved strings
// in src/services/ai.ts and passes them in; interpolatePrompt() substitutes the
// known tokens, drops any unknown {token} to empty (so a mistyped/edited
// placeholder can never leak braces or a raw name into the email), and collapses
// the blank lines that empty tokens leave behind.

// Keep byte-identical to the migration 075 seed for 'enquiry_reply'.
export const FALLBACK_ENQUIRY_REPLY = `You are a wedding {vendorCategory} named {vendorName}. A new enquiry just came in from {contactName}.

{requestedDate}
{location}
{theirMessage}

{availabilityInfo}
{instructionsBlock}
Draft a warm, professional reply acknowledging their enquiry. If available, express enthusiasm. If not available, be gracious and suggest they check back or offer alternative dates. Keep it concise (2-3 paragraphs), friendly, Australian English.{replyNudge} Write just the body — no subject line, no sign-off.`

// The prompt keys the platform knows about, with their fallback + a human
// description for the admin editor. Add a row here to expose a new editable
// prompt; seed its default in a migration too.
export const PROMPT_KEYS = {
  enquiry_reply: {
    label: 'Enquiry / booking auto-reply',
    description: 'Drafts the confirmation reply sent (or saved as a draft) when a couple submits an enquiry or booking form.',
    fallback: FALLBACK_ENQUIRY_REPLY,
  },
} as const

export type PromptKey = keyof typeof PROMPT_KEYS

// Placeholders available to the enquiry_reply template, for the admin legend.
export const ENQUIRY_REPLY_PLACEHOLDERS: { token: string; description: string }[] = [
  { token: 'vendorName', description: "The vendor's business name" },
  { token: 'vendorCategory', description: 'The vendor category (e.g. photographer)' },
  { token: 'contactName', description: "The enquirer's full name" },
  { token: 'requestedDate', description: 'Their requested date, or "No date specified"' },
  { token: 'location', description: 'Their wedding location line (may be blank)' },
  { token: 'theirMessage', description: 'Their message (may be blank)' },
  { token: 'availabilityInfo', description: 'Whether the vendor is available on the date' },
  { token: 'instructionsBlock', description: "The vendor's extra per-form guidance (may be blank)" },
  { token: 'replyNudge', description: 'An optional sentence inviting them to reply' },
]

const TOKEN_RE = /\{(\w+)\}/g

// Substitute known {token}s, drop unknown ones, and tidy the blank lines that
// empty tokens leave behind. Never throws — a bad template degrades gracefully.
export function interpolatePrompt(template: string, vars: Record<string, string>): string {
  return template
    .replace(TOKEN_RE, (_, key: string) => (Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ─── Admin store (ai_prompts table) ───

export async function getSystemPrompt(
  db: D1Database,
  key: string,
  locale = 'default'
): Promise<AiPrompt | null> {
  return db
    .prepare('SELECT * FROM ai_prompts WHERE key = ? AND locale = ?')
    .bind(key, locale)
    .first<AiPrompt>()
}

export async function setSystemPrompt(
  db: D1Database,
  key: string,
  template: string,
  updatedBy: string | null,
  locale = 'default'
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ai_prompts (key, locale, template, updated_by, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(key, locale) DO UPDATE SET
         template = excluded.template,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`
    )
    .bind(key, locale, template, updatedBy)
    .run()
}

// Reset a prompt to its code fallback (used by the admin "Reset to default").
export async function resetSystemPrompt(
  db: D1Database,
  key: PromptKey,
  updatedBy: string | null,
  locale = 'default'
): Promise<void> {
  await setSystemPrompt(db, key, PROMPT_KEYS[key].fallback, updatedBy, locale)
}

// Resolve the template to use, honouring (per-form override → admin default →
// code fallback). Reads the DB only when there's no per-form override.
export async function resolvePromptTemplate(
  env: Bindings,
  key: PromptKey,
  perFormTemplate?: string | null
): Promise<string> {
  const perForm = perFormTemplate?.trim()
  if (perForm) return perForm
  try {
    const row = await getSystemPrompt(env.DB, key)
    if (row?.template?.trim()) return row.template
  } catch (e: any) {
    console.error('[ai-prompts] system prompt lookup failed, using fallback', e?.message)
  }
  return PROMPT_KEYS[key].fallback
}
