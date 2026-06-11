# Adding a language to Wedding Computer

This document is written to be handed to an AI model (or a human translator
who codes) as the complete brief for adding a language. Everything you need
is here — you should not need to modify any file other than the ones listed.

## What this app is

Wedding Computer is a CRM for wedding vendors (celebrants, photographers,
planners, venues). The users reading your translations are wedding
professionals managing enquiries, bookings, invoices, and weddings. Use the
natural wedding-industry vocabulary of the target language, not literal
word-for-word renderings. Tone: professional but warm, plain language, no
corporate stiffness.

## How i18n works here (60 seconds)

- `src/i18n/en.ts` is the **source dictionary**. Its keys are the canonical
  set — TypeScript derives `MessageKey` from it. **Never edit en.ts while
  translating.**
- Each language is one file: `src/i18n/<lang>.ts` exporting a
  `Dictionary` — a `Partial<Record<MessageKey, string>>`. Missing keys fall
  back to English at runtime, so a partial translation ships safely.
- Regional variants share a dictionary: `es-ES` and `es-MX` both read the
  `es` dictionary; the full locale tag only changes date/number formatting
  (handled automatically by `Intl` — nothing for you to do).
- The UI picks up a new language automatically once it's registered in
  `src/i18n/index.ts` (the account-page picker renders `SUPPORTED_LOCALES`).

## The task, step by step

To add (for example) Spanish:

### 1. Create `src/i18n/es.ts`

```ts
import type { Dictionary } from './index'

// Español — see docs/TRANSLATING.md for conventions.
export const es: Dictionary = {
  'common.save': 'Guardar',
  'common.saveChanges': 'Guardar cambios',
  // … every key from en.ts, translated
  'common.enquiry.one': '{count} consulta',
  'common.enquiry.other': '{count} consultas',
  // …
}
```

Translate **every key present in `src/i18n/en.ts`** at the time you run.
Open that file and work through it top to bottom.

### 2. Register it in `src/i18n/index.ts`

Two edits:

```ts
import { es } from './es'

const DICTIONARIES: Record<string, Dictionary> = { en, es }
```

and add the regional tag(s) to `SUPPORTED_LOCALES`, labelled in the
language itself (native name — this is what users see in the picker):

```ts
export const SUPPORTED_LOCALES = [
  // … existing entries …
  { tag: 'es-ES', label: 'Español (España)' },
  { tag: 'es-MX', label: 'Español (México)' },
] as const
```

Add the regional variants that matter for the language (e.g. `pt-PT` and
`pt-BR` for Portuguese; just `de-DE` is fine to start for German).

### 3. Verify

```bash
npm run typecheck        # catches misspelled keys — Dictionary is typed
npx vitest run src/i18n  # i18n unit tests must stay green
```

A misspelled or invented key is a **compile error**, which is intentional.

## Hard rules

1. **Placeholders stay exactly as-is.** `{count}`, `{name}` etc. must appear
   unchanged in the translation (reposition them freely for grammar):
   `'common.enquiry.other': '{count} enquiries'` → `'{count} consultas'` ✅,
   `'{contar} consultas'` ❌.
2. **Plural pairs:** keys ending `.one` / `.other` are selected by
   `Intl.PluralRules`. Translate both. If the target language needs more
   plural categories than one/other (e.g. Polish `few`/`many`, Arabic), do
   NOT invent new keys — the key set is currently constrained to English's.
   Translate `.one`/`.other` as best fits and **flag the language in your
   summary** so the plural system can be extended deliberately.
3. **Do not translate:** the product name "Wedding Computer", third-party
   product names (Stripe, Obsidian, Google Calendar), and IANA timezone
   names.
4. **Plain text only.** Dictionary values are JSX-escaped automatically — no
   HTML, no entities (`&` is fine as `&`).
5. **Keep nav labels short.** `nav.*` strings render in a 224px-wide
   sidebar; prefer the concise natural term over the precise long one.
6. **Don't touch call sites.** Routes and components already call
   `t('key')` — translation work never edits `.tsx` route/view files.

## What NOT to do

- Don't edit `src/i18n/en.ts` (source of truth).
- Don't extract new strings from route files into the dictionary — much of
  the app still has hardcoded English that's being migrated progressively;
  that extraction is a separate engineering task, not a translation task.
- Don't change `t()`/`tp()`/locale-resolution logic in `src/i18n/index.ts`
  beyond the two registration edits above.
- Don't reformat or reorder en.ts-mirroring keys — keep your file in the
  same order as en.ts so diffs stay reviewable.

## Deliverable checklist

- [ ] `src/i18n/<lang>.ts` with every current en.ts key translated
- [ ] `DICTIONARIES` + `SUPPORTED_LOCALES` registration
- [ ] `npm run typecheck` clean
- [ ] `npx vitest run src/i18n` green
- [ ] A short summary: anything ambiguous, any keys where the English is
      unclear, and whether the language needs plural categories beyond
      one/other
