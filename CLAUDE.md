# CLAUDE.md — Wedding Computer

> A multi-party wedding collaboration platform. Closed source. Built on Cloudflare Workers. Your data lives as plain-text markdown.

## Project Overview

Wedding Computer is a SaaS platform for the wedding industry. Vendors manage leads, contacts, calendars, and invoicing; couples track their vendors and wedding details; everyone coordinates on a shared wedding entity.

**Live URL:** `wedding.computer` (also `www.wedding.computer`)
**Local dev:** `localhost:8787` (`npm run dev`)

### Licensing & positioning

The project is **closed source** (private repo, proprietary). Do **not** describe it as open source, AGPL, or licensed for reuse — in code comments, docs, or marketing copy. The openness story is **open data**: every vendor's data is a folder of plain markdown files they can read, sync, and take with them (see the open standard at `wedding.computer/standard`).

### Pricing

The core product is **free forever** (not "early access", not a trial). A paid Pro subscription gates power features: device sync (CalDAV/CardDAV), the vault sync API, the JSON intake API, and the MCP server.

### Sibling projects (don't break these)

- **Obsidian plugin** — `github.com/joshwithers/wedding-computer-sync`, separate repo, live in the Obsidian community directory. Talks to this app's vault API (`src/routes/vault-api.ts`), authenticated with the per-vendor sync token.
- **Wedding Institute** — Astro site at `~/Websites/wedding-institute` that consumes this app's public directory API (`/api/directory/*`, served by `src/routes/public/directory.tsx`). Don't change those response shapes without updating that site.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Cloudflare Workers (single Worker serves everything) |
| Framework | Hono (TypeScript, JSX — `jsxImportSource: hono/jsx`) |
| Database | Cloudflare D1 (SQLite) — the queryable **index** |
| Object storage | Cloudflare R2 — markdown files (**source of truth**) |
| Key-value | Cloudflare KV (sessions, magic-link tokens, cache, rate limits) |
| Background jobs | Cloudflare Queues (+ dead-letter queue) |
| Auth | Magic links + Google/Apple OAuth + passkeys (WebAuthn) |
| Payments | Stripe Connect (plus manual methods: bank transfer, PayID) |
| Email out | Resend + Cloudflare Email Routing (`SEND_EMAIL` binding) |
| Email in | Cloudflare Email Routing → Worker `email()` handler |
| AI | Anthropic Claude + Cloudflare Workers AI (`AI` binding) |
| Frontend | Server-rendered Hono JSX + htmx |
| CSS | Tailwind CSS v3 via CLI build (`npm run build:css` → `public/styles.css`) |
| PDFs | pdf-lib (e.g. NOIM generation in `src/forms/noim/`) |
| Protocols | CardDAV, CalDAV, iCal feeds, MCP (Streamable HTTP) |
| CAPTCHA | Cloudflare Turnstile |
| Tests | Vitest (`npm test`) |

---

## Getting Started

### Prerequisites

- Node.js 20+
- Wrangler CLI v4

### Local Development

```bash
npm install
npm run db:schema:local     # Apply full schema.sql to local D1 (fresh setup)
npm run db:migrate:local    # Or apply numbered migrations (existing DB)
npm run db:seed:local       # Seed demo data
npm run dev                 # Builds CSS, starts wrangler dev at localhost:8787
npm run typecheck           # tsc --noEmit
npm test                    # Vitest
```

**Local login bypass:** set `ENABLE_DEV_LOGIN=true` in `.dev.vars`, then visit `/dev/login/:email` to mint a session for any email. The route 404s unless the var is exactly `'true'` — never set it in deployed environments.

### Secrets

Set via `wrangler secret put <NAME>` (full list = `Bindings` in [src/types.ts](src/types.ts)):

| Secret | Purpose |
|--------|---------|
| `SESSION_SECRET` | Session cookie signing |
| `RESEND_API_KEY` | Transactional email |
| `RESEND_WEBHOOK_SECRET` | Svix signature for `POST /webhooks/resend` (bounce suppression) |
| `ANTHROPIC_API_KEY` | AI features (optional — vendors can bring their own key) |
| `STRIPE_SECRET_KEY` | Stripe API (platform account) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret — dashboard endpoint for platform-account events (subscriptions) |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Signing secret — dashboard endpoint for Connected-account events (onboarding, payments); both deliver to `/webhooks/stripe` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET` | Apple Sign-In |
| `TURNSTILE_SECRET_KEY` | CAPTCHA verification |
| `GOOGLE_MAPS_API_KEY` | Geocoding (optional) |
| `SIGNUP_INVITE_CODE` | When set, public self-signup requires this code |
| `ENABLE_DEV_LOGIN` | Local only — see above |

Public vars (in `wrangler.toml`): `APP_URL`, `TURNSTILE_SITE_KEY`.
Bindings: `DB` (D1), `KV`, `STORAGE` (R2), `EMAIL_QUEUE`, `AI` (Workers AI), `SEND_EMAIL`.

---

## Repository Map

```
src/
├── index.tsx               # App entry: route mounting, global middleware, onError,
│                           # queue consumer, email() handler, scheduled() crons
├── types.ts                # Bindings, Env, and model types
│
├── routes/
│   ├── marketing.tsx       # Public website (home, pricing, blog, /standard, …)
│   ├── auth.tsx            # Login, magic links, OAuth, passkeys, /dev/login
│   ├── onboarding.tsx      # First-login vendor setup
│   ├── account.tsx         # User account (profile, locale/timezone, deletion)
│   ├── couple.tsx          # Couple-facing wedding view (/wedding/:id)
│   ├── admin.tsx           # Platform admin (requireAdmin → 404 for non-admins)
│   ├── enquire.tsx         # Public enquiry form (Turnstile + rate limited)
│   ├── book.tsx            # Public booking flow
│   ├── form.tsx            # Public custom-form renderer
│   ├── files.tsx           # File browser / raw markdown access
│   ├── notify.tsx          # Notification endpoints
│   ├── api.ts              # Public JSON API v1 (lead intake; Pro, bearer enquiry key)
│   ├── mcp.ts              # MCP server (POST /mcp; Pro, bearer sync token)
│   ├── vault-api.ts        # Vault sync API /vault/v1/* (Obsidian plugin; Pro)
│   ├── feed.ts             # iCal feed /cal/:token
│   ├── caldav.ts / carddav.ts  # CalDAV + CardDAV servers (device sync; Pro)
│   ├── stripe.ts           # Stripe webhooks + Connect onboarding
│   ├── webhooks.ts         # Resend delivery webhooks, etc.
│   ├── public/             # index, directory (Wedding Institute API),
│   │                       # availability, quote (public quote calculators)
│   └── vendor/             # Authenticated vendor app (/app/*):
│       ├── dashboard, contacts, weddings, calendar, invoices, emails,
│       ├── settings, analytics, subscription, team, import, run-sheet,
│       ├── quotes, forms, form (editor), booking-form, contracts,
│       └── checklists, places, refer
│
├── middleware/
│   ├── auth.ts             # requireAuth — session → user, seeds i18n
│   ├── tenant.ts           # requireVendor — loads vendor profile or redirects
│   ├── admin.ts            # requireAdmin
│   ├── csrf.ts             # CSRF token generation + validation
│   ├── rate-limit.ts       # Per-IP/per-user limits, auth-failure throttling
│   └── audit.ts            # auditLog() helper → audit_log table
│
├── storage/                # Markdown-first storage layer (see below)
│   ├── index.ts            # getStorage()/getStorageWithSecrets() factory
│   ├── r2.ts / github.ts   # Backends: R2 (default) or vendor's GitHub repo
│   ├── markdown.ts         # Entity ↔ markdown (YAML frontmatter) serialisation
│   ├── contacts.ts / weddings.ts  # Entity CRUD through storage + D1 index
│   ├── sync.ts             # Background sweep: storage ↔ D1 reconciliation
│   ├── etag.ts / conflicts.ts / slug.ts / migrate.ts
│   └── types.ts            # StorageBackend interface
│
├── db/                     # D1 access, one file per domain — all functions
│                           # scoped by vendor/user/wedding ID (see Multi-Tenancy)
│
├── services/               # auth, email, enquiry, ai, ical, webauthn, geocode,
│                           # notifications, notification-prefs, inbound-email,
│                           # storage-sync, storage-push, secrets, account,
│                           # analytics, couple-contact, free-months,
│                           # wedding-credits, turnstile, import/ (CSV import engine)
│
├── i18n/                   # Locale context + dictionaries (see i18n section)
│
├── lib/                    # date (i18n-aware), crypto, validation, dav, log,
│                           # mime, redaction, busyness, onboarding, form-schema,
│                           # todo-parser
│
├── forms/                  # countries list, noim/ (Notice of Intended Marriage
│                           # PDF generation for celebrants)
│
├── views/
│   ├── layouts/            # marketing.tsx, app.tsx, auth.tsx
│   ├── head.tsx, logo.tsx
│   └── (page components live beside their routes)
│
└── styles.css              # Tailwind input → built to public/styles.css

schema.sql                  # Full schema — THE source of truth for the data model
migrations/                 # Numbered migrations (wrangler d1 migrations)
seed.sql                    # Local demo data
public/                     # Static assets (built styles.css, favicons, …)
scripts/                    # One-off operational scripts (e.g. tardis-export.mjs)
```

Tests are colocated: `*.test.ts` next to the code and `__tests__/` directories.

---

## Data Model

**`schema.sql` is the source of truth** — read it (and `src/types.ts`) rather than trusting any doc, including this one. It currently defines ~39 tables: the core CRM/wedding entities plus emails, forms, quotes, contracts, run sheets, todos, team members, import jobs, subscriptions, referrals, analytics, busyness/demand scoring, file index/conflicts, waitlist, broadcasts, and more.

Schema conventions:

- IDs: `TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12))))` (24 hex chars)
- Timestamps: ISO 8601 strings via `datetime('now')`; booleans: `INTEGER NOT NULL DEFAULT 0`
- JSON columns: `TEXT`, parsed at the application layer
- Every tenant-scoped table has explicit ownership columns
- Schema changes = a new numbered file in `migrations/` **and** the same change applied to `schema.sql`

### The wedding entity

A **wedding** is the central object. Users join it via `wedding_members`:

- `role` is one of `'vendor' | 'couple' | 'guest'` — there is **no `'owner'` role** (removed in migration 015). Management rights come from the `can_manage` flag; the creator is recorded in `weddings.created_by_user_id`.
- `is_financial_party` marks who payments flow through (e.g. an organiser venue/planner with `vendor_profiles.is_organiser = 1`).
- Vendors are linked via `vendor_profile_id` + `vendor_role` (their service).
- Lifecycle: CRM contact (`new → contacted → … → booked`) is promoted to a wedding; the couple is invited by email; other vendors join with `role='vendor'`.

### Markdown first, D1 as index

Vendor data (contacts, weddings, checklists, logs) is stored as **markdown files with YAML frontmatter** in a pluggable storage backend (`src/storage/`): R2 by default, or the vendor's own GitHub repo (`storage_type='git'`). D1 holds a queryable index of the same data (`file_index`, `file_conflicts` track sync state).

- Writes from the web app go through the storage backend and D1 together.
- External edits (Obsidian, GitHub, vault API) are ingested into D1 — immediately for vault-API writes, otherwise by the background sync sweep (every 5 minutes, one shard of vendors is enqueued).
- Conflicts are etag-detected (`If-Match`), never silently overwritten: both versions are kept and a `file_conflicts` row is recorded. `StorageConflictError` is handled globally in `index.tsx`.

---

## External Interfaces

Stable surfaces with outside consumers — change shapes carefully:

| Surface | Route file | Consumer / auth |
|---------|-----------|-----------------|
| `/api/directory/*` | `routes/public/directory.tsx` | Wedding Institute site (public) |
| `/vault/v1/*` | `routes/vault-api.ts` | Obsidian plugin (bearer sync token, Pro) |
| `POST /mcp` | `routes/mcp.ts` | MCP clients (bearer sync token, Pro) |
| `POST /api/v1/enquiries` | `routes/api.ts` | Zapier/webhooks/agents (bearer enquiry key, Pro) |
| `/cal/:token`, `/caldav`, `/carddav` | `routes/feed.ts`, `caldav.ts`, `carddav.ts` | Calendar/contacts apps |
| `/webhooks/*`, Stripe webhooks | `routes/webhooks.ts`, `stripe.ts` | Resend, Stripe (signature-verified) |
| `/.well-known/*` | `index.tsx` | Agent/MCP/OAuth discovery |

---

## Authentication

No passwords. Three ways in:

1. **Magic links** (primary): token in KV with 15-minute TTL, single-use, emailed via Resend.
2. **Google / Apple OAuth**: standard OAuth2 → email + name from ID token.
3. **Passkeys** (WebAuthn): `services/webauthn.ts`, `passkey_credentials` table.

Sessions: random token in KV (30-day rolling TTL) + D1 `sessions` row for revocation, `wc_session` cookie (HttpOnly, Secure, SameSite=Lax). New session ID on every login.

---

## Multi-Tenancy

Shared D1 database with strict application-layer isolation:

1. **`requireAuth`** (`middleware/auth.ts`): validates session, loads `user`, applies their locale/timezone to the i18n context.
2. **`requireVendor`** (`middleware/tenant.ts`): loads `vendor` for `/app/*` routes; redirects couples to their wedding and new users to onboarding.
3. **Data access layer** (`db/*.ts`, `storage/*.ts`): every function takes a scoping ID as a required parameter. No unscoped queries exist.

Each vendor route file mounts its own guard chain:

```typescript
dashboard.use('/app', requireAuth, csrf, requireVendor)
dashboard.use('/app/*', requireAuth, csrf, requireVendor)
```

```typescript
// CORRECT: always scoped
export async function listContacts(db: D1Database, vendorId: string): Promise<Contact[]> { … }

// NEVER: unscoped
export async function listAllContacts(db: D1Database) { /* FORBIDDEN */ }
```

Admin routes use `requireAdmin` (404, not 403, for non-admins). Sensitive operations call `auditLog()` (`middleware/audit.ts`) into the `audit_log` table.

---

## Payments

Stripe **Connect Standard**: each vendor connects their own Stripe account; invoices are created on the connected account (`Stripe-Account` header); webhooks update local status. Invoices also support non-Stripe records (`bank_transfer`, `payid`, historical imports) — see `invoices` + `invoice_payments` tables. Organiser vendors (`is_financial_party`) can route a wedding's billing through their account.

Subscriptions (Pro) live in the `subscriptions` table with referral rewards (`referrals`, `free_month_grants`) handled by `services/free-months.ts`.

---

## Background Work

All in `src/index.tsx`'s default export:

- **`queue()`** — consumer for `wedding-computer-emails` (magic links, notifications, digests, storage-sync jobs). Failures retry up to 3× then land in the `wedding-computer-emails-dlq` dead-letter queue.
- **`email()`** — inbound email via Cloudflare Email Routing (`services/inbound-email.ts`).
- **`scheduled()`** — two crons: `0 20 * * *` (daily vendor digests, ~6am AEST) and `*/5 * * * *` (storage sync, one vendor shard per tick).

Code running outside a request gets platform-default i18n — wrap recipient-facing work in `runWithI18n()` (see below).

---

## Conventions

### Code Style
- Explicit `return` in route handlers
- DB functions: first param `db: D1Database`, second param the scoping ID
- Storage-backed entities: get the backend via `getStorageWithSecrets(c.env, vendor)` and use `src/storage/` functions, not raw R2
- Error responses: `{ error: string }` with HTTP status; HTML via `c.html(<Component />)`
- Global `app.onError()`; never expose stack traces; structured logs via `lib/log.ts`

### Naming
- DB tables: `snake_case` plural · TypeScript types: `PascalCase` singular
- Route files: `kebab-case.ts(x)` · DB functions: `verbNoun` (`listContacts`, `getContact`)

### Internationalisation (REQUIRED for all new/edited UI)

The platform is multilingual/multi-timezone by design. Every request runs in
an AsyncLocalStorage i18n context (`src/i18n`) carrying the viewer's locale,
language, and timezone — resolved from `users.locale`/`users.timezone`, then
the vendor's timezone, then Accept-Language, then defaults (en-AU,
Australia/Sydney).

- **User-facing strings**: never hardcode. Add a key to `src/i18n/en.ts`
  (dot-namespaced: `contacts.title`, assembled from fragments in `src/i18n/en/`)
  and render with `t('key')` / `t('key', { name })`. Plurals: `.one`/`.other`
  key pairs via `tp(base, count)`. `t()` works in any component or service —
  no prop-drilling.
- **Dates/times**: always through `src/lib/date.ts` (`formatDate`,
  `formatDateTime`, `formatDayLabel`, `monthLabel`, `todayString`). Never call
  `toLocaleDateString`/`toLocaleString` with a hardcoded locale or timezone in
  routes. `todayString()` is the viewer's "today", not the server's.
- **Adding a language**: create `src/i18n/<lang>.ts` satisfying `Dictionary`,
  register it in `DICTIONARIES`, add regional tags to `SUPPORTED_LOCALES`.
  Untranslated keys fall back to English at runtime. Current languages:
  de, el, en, es, fr, it, ja, nl, pt, zh.
- **Jobs/cron/email**: code outside a request gets platform defaults; wrap in
  `runWithI18n({ locale, timezone }, fn)` with the recipient's preferences.

### Security checklist (steady state)

- CSRF token on all state-changing requests (bound to session)
- Every query scoped by vendor/user/wedding; no admin endpoints that bypass scoping
- Rate limiting + auth-failure throttling on public and token-auth endpoints
- Turnstile on public forms; MIME/size validation on uploads
- R2 access via the storage layer / signed flows, never public bucket access
- Audit log for logins, exports, deletions, invitations, payments
- Account deletion = soft delete then purge (see `services/account.ts`, RECOVERY.md)
- Secrets via `wrangler secret` only; no PII in URLs; no tracking cookies

---

## Other Docs

- [README.md](README.md) — public-facing overview
- [RECOVERY.md](RECOVERY.md) — backup/restore regime (nightly offsite D1 backup)
- [TARDIS-MIGRATION.md](TARDIS-MIGRATION.md) — runbook for migrating Josh's businesses out of TARDIS
- [CARDDAV-CONTACTS-GUIDE.md](CARDDAV-CONTACTS-GUIDE.md) — device sync setup
- [AUDIT-2026-06-10.md](AUDIT-2026-06-10.md) — security audit findings
- [migrations/README.md](migrations/README.md) — migration workflow
