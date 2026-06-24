# Wedding Computer

A multi-party wedding collaboration platform for the wedding industry. Vendors manage leads, contacts, calendars, invoicing, quotes, forms, contracts, timelines, files, and email. Couples get a planning hub for vendors, wedding details, budgets, forms, messages, files, links, weather, timelines, and opt-in community rooms. Everyone coordinates on a shared wedding workspace.

Wedding Computer is live at [wedding.computer](https://wedding.computer).

This project is closed source and proprietary. The openness story is open data: every vendor's contacts and weddings are represented as plain-text markdown files with YAML frontmatter, and the file format is published as an open standard at [wedding.computer/standard](https://wedding.computer/standard).

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Framework | Hono with TypeScript and server-rendered JSX |
| Database | Cloudflare D1 (SQLite) as the queryable index |
| Storage | Cloudflare R2 markdown files as the source of truth |
| KV | Cloudflare KV for sessions, tokens, cache, and rate limits |
| Jobs | Cloudflare Queues plus scheduled Worker cron jobs |
| Auth | Magic links and passkeys (WebAuthn) |
| Payments | Stripe Connect Standard, plus manual payment records |
| Email | Resend and Cloudflare Email Routing |
| AI | Anthropic Claude, Cloudflare Workers AI, MCP, and native handoff support |
| Frontend | Server-rendered Hono JSX plus htmx |
| CSS | Tailwind CSS v3 CLI build into `public/styles.css` |
| Protocols | MCP, vault sync API, CardDAV, CalDAV, and iCal feeds |

## Data Model

`schema.sql` and `src/types.ts` are the source of truth for the data model. Numbered files in `migrations/` must stay in step with `schema.sql`.

The application is markdown-first:

- Contacts are stored as markdown files under `contacts/`.
- Weddings are stored as folders with `wedding.md`, `todo.md`, `timeline.md`, `notes.md`, `vendors.md`, `log.md`, and uploads.
- D1 is a rebuildable index and query layer, not the canonical record.
- Web app writes, vault API writes, MCP writes, imports, and sync jobs must preserve the markdown source-of-truth promise.
- Conflicts are ETag-detected and recorded instead of silently overwritten.

## Getting Started

### Requirements

- Node.js 20+
- Wrangler CLI v4
- Cloudflare account with D1, KV, R2, Queues, Email Routing, and Worker bindings configured

### Local Development

```bash
npm install
npm run db:schema:local     # fresh local D1 from schema.sql
npm run db:migrate:local    # or apply numbered migrations to an existing DB
npm run db:seed:local
npm run dev                 # builds CSS, then starts wrangler dev on localhost:8787
```

For local auth bypass, set `ENABLE_DEV_LOGIN=true` in `.dev.vars`, then visit `/dev/login/:email`. The route 404s unless the value is exactly `true`; do not set it in deployed environments.

### Verification

```bash
npm run build:css
npm run typecheck
npm test
npx wrangler deploy --dry-run
```

## Environment

Set secrets with `wrangler secret put <NAME>`. Public vars such as `APP_URL` and `TURNSTILE_SITE_KEY` live in `wrangler.toml`.

Core secrets and bindings include:

| Name | Purpose |
|---|---|
| `SESSION_SECRET` | Session and CSRF signing |
| `RESEND_API_KEY` | Transactional email |
| `RESEND_WEBHOOK_SECRET` | Resend delivery webhook verification |
| `ANTHROPIC_API_KEY` | Optional AI provider key |
| `STRIPE_SECRET_KEY` | Stripe platform API |
| `STRIPE_WEBHOOK_SECRET` | Platform-account Stripe webhook signing |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Connected-account Stripe webhook signing |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile verification |
| `GOOGLE_MAPS_API_KEY` | Browser Places autocomplete |
| `GOOGLE_GEOCODING_KEY` | Server-side geocoding fallback |
| `WEATHER_API_KEY` | Optional Open-Meteo commercial API key |
| `SIGNUP_INVITE_CODE` | Optional public signup gate |
| `ENABLE_DEV_LOGIN` | Local-only login bypass |
| `RESERVED_FORWARD_EMAIL` | Forwarding destination for reserved email handles |

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_ID`, and `APPLE_CLIENT_SECRET` are reserved bindings. Google and Apple social sign-in are not a shipped auth surface yet.

## Repository Map

```text
src/
  index.tsx                 App entry, middleware, route mounting, queues, email, cron
  types.ts                  Bindings and domain types
  routes/
    marketing.tsx           Public site, /about, /pricing, /standard, docs
    auth.tsx                Login, magic links, passkeys, dev login
    onboarding.tsx          First-login setup
    account.tsx             Account settings, export, deletion, OAuth grants
    couple.tsx              Couple-facing wedding dashboard
    community.tsx           Authenticated couples/vendor community rooms
    enquire.tsx             Public enquiry form
    book.tsx                Public booking, payments, e-signatures
    form.tsx                Public custom form renderer
    files.tsx               Authenticated file access
    native.ts               Native app web-session handoff
    oauth.tsx               OAuth 2.1 authorization server for MCP
    mcp.tsx                 MCP Streamable HTTP server
    api.ts                  JSON lead intake API
    vault-api.ts            Vault sync API used by the Obsidian plugin
    caldav.ts, carddav.ts   Device sync protocols
    feed.ts                 iCal feeds
    stripe.ts, webhooks.ts  Webhooks
    public/                 Directory, availability, and quote endpoints
    vendor/                 Authenticated vendor app modules
  db/                       Tenant-scoped D1 access
  storage/                  Markdown/R2 storage, sync, conflicts, serialization
  services/                 Business logic, email, AI, imports, pricing, sync, weather
  middleware/               Auth, tenant, CSRF, rate limiting, audit
  i18n/                     Dictionaries and request locale context
  lib/                      Date, crypto, validation, DAV, region, season, OAuth helpers
  views/                    Layouts and shared components

schema.sql                  Full database schema
migrations/                 Numbered D1 migrations
public/                     Static assets and built CSS
scripts/                    Operational scripts
```

## Product Surfaces

### Vendors

- CRM contacts with an eight-stage pipeline, activity history, search, imports, and lead capture.
- Custom enquiry forms, booking forms, file uploads, NOIM support, and configurable form sends.
- Calendar, availability, public availability pages, personal feeds, CalDAV, CardDAV, and iCal.
- Invoicing with tax settings, payment schedules, Stripe Connect, manual payments, contracts, booking fees, and e-signatures.
- Built-in email with vendor handles, inbound mail, outbound mail, notifications, and AI-assisted drafts.
- Shared wedding workspaces with timelines, checklists, notes, files, web links, weather, sun markers, live run-sheet mode, vendor credits, and approval flows.
- Quotes, public quote calculators, team/agency management, per-wedding assignments, analytics, goals, demand scores, referrals, subscription management, and directory listing.
- MCP, JSON lead intake, vault sync, native handoff, and Obsidian sync for Pro vendors.

### Couples

- Wedding dashboard with date, location, vendors, budget, invoices, payments, files, links, weather, and timeline.
- Couple-owned wedding creation and vendor invitation flows.
- Vendor-to-vendor visibility controls.
- Vendor forms and messages collected in the wedding workspace.
- Opt-in seasonal community rooms based on country, season, and year.

### Community

Community rooms are authenticated and opt-in. Cohorts are keyed by country, season, and year; state/province is a filter tag rather than a separate room. The feature is designed to avoid exposing exact wedding dates, venues, or contact details:

- Couples join from their wedding date and broad location.
- Vendors can join explicitly and are badged as vendors.
- Posts are markdown stored in D1 and rendered client-side through DOMPurify.
- Posting, replying, editing, deleting, and reporting are CSRF-protected and rate-limited.
- Post-level actions require active membership in the post's cohort.
- Reports are de-duplicated per user and post for moderation follow-up.

## External Interfaces

Stable external surfaces:

| Surface | Route | Consumer / auth |
|---|---|---|
| Public directory | `/api/directory/*` | Wedding Institute, public JSON |
| Vault sync | `/vault/v1/*` | Obsidian plugin, Pro bearer sync token |
| MCP | `POST /mcp` | MCP clients, OAuth access token or Pro bearer sync token |
| Lead intake API | `POST /api/v1/enquiries` | Webhooks, Zapier, agents, Pro bearer enquiry key |
| Calendar feed | `/cal/:token`, user feeds | Tokenized iCal |
| Device sync | `/caldav`, `/carddav` | Pro sync token |
| Discovery | `/.well-known/*` | Agent, MCP, OAuth, DAV metadata |
| Webhooks | `/webhooks/*`, `/webhooks/stripe` | Resend and Stripe signatures |

## Security And Privacy Notes

- All state-changing authenticated routes require CSRF protection.
- Vendor routes must pass `requireAuth`, `csrf`, and `requireVendor`.
- Couple and community routes use wedding membership or active community membership checks instead of vendor tenancy.
- Every DB helper should be scoped by vendor ID, user ID, wedding ID, or another ownership boundary.
- Public/token routes use rate limits, auth-failure throttling, Turnstile, signed URLs, or bearer tokens as appropriate.
- User-facing strings go through `src/i18n` and dates through `src/lib/date.ts`.
- No project copy should describe Wedding Computer itself as open source, AGPL, or licensed for reuse.

## License

Wedding Computer is proprietary software. All rights are reserved. The Wedding CRM Markdown Standard is separately published as a CC0 public-domain/open data specification.
