# Wedding Computer

A multi-party wedding collaboration platform for the wedding industry. Vendors manage leads, contacts, calendars, and invoicing. Couples track vendors, budgets, and wedding details. Everyone coordinates on a shared wedding entity.

Your data is stored as **plain text markdown files** — not trapped in a proprietary database. Read the [open standard](https://wedding.computer/standard).

**Live:** [wedding.computer](https://wedding.computer)
**Source:** [github.com/joshwithers/wedding-computer](https://github.com/joshwithers/wedding-computer)
**License:** AGPL-3.0

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Framework | Hono (TypeScript, JSX) |
| Database | Cloudflare D1 (SQLite) — queryable index |
| Storage | Cloudflare R2 — markdown files (source of truth) |
| KV | Cloudflare KV (sessions, cache) |
| Jobs | Cloudflare Queues |
| Auth | Magic links + OAuth + Passkeys |
| Payments | Stripe Connect |
| Email | Resend + Cloudflare Email Routing |
| AI | Anthropic Claude + Cloudflare Workers AI |
| Frontend | Server-rendered JSX + htmx |
| CSS | Tailwind CSS (CDN) |
| Protocols | CardDAV, CalDAV, iCal feeds |

## Data Philosophy

Wedding Computer stores contacts and weddings as plain text markdown files with YAML frontmatter. The D1 database is a queryable index — a cache that can always be rebuilt from the files. If the app disappears, your data still makes perfect sense in any text editor.

**GitHub sync** lets you connect a private GitHub repository. Your contacts and weddings are pushed to the repo automatically — clone it to your computer and open the files in Obsidian, VS Code, or any text editor. Changes made in the app sync to GitHub in real time.

We published the file format as an [open standard](https://wedding.computer/standard) (CC0 / public domain) so other tools can read and write the same files. See [how to access your files](https://wedding.computer/docs/plain-text) for detailed instructions on using GitHub sync, rclone, Obsidian, the AWS CLI, or any text editor with your data.

## Getting Started

### Prerequisites

- Node.js 20+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)
- Cloudflare account with D1, KV, R2, and Queues enabled

### Install and Run

```bash
git clone https://github.com/joshwithers/wedding-computer.git
cd wedding-computer
npm install
npm run db:migrate:local    # Create local D1 tables
npm run db:seed:local       # Seed demo data
npm run dev                 # http://localhost:8787
```

In local development, use `/dev/login/<email>` (with the seeded email from `seed.sql`) to bypass auth.

### Environment Secrets

Set via `wrangler secret put <NAME>`:

| Secret | Purpose |
|---|---|
| `SESSION_SECRET` | Session cookie signing (32+ random bytes) |
| `RESEND_API_KEY` | Transactional email |
| `ANTHROPIC_API_KEY` | AI email drafting (optional) |
| `STRIPE_SECRET_KEY` | Platform Stripe key |
| `STRIPE_WEBHOOK_SECRET` | Stripe event verification |
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `APPLE_CLIENT_ID` | Apple Sign-In |
| `APPLE_CLIENT_SECRET` | Apple Sign-In (JWT) |
| `TURNSTILE_SECRET_KEY` | CAPTCHA verification |

Public vars are in `wrangler.toml`: `TURNSTILE_SITE_KEY`, `APP_URL`.

### Deploy

```bash
npm run db:migrate:remote   # Migrate production D1
wrangler deploy             # Deploy to Cloudflare Workers
```

### Tests

```bash
npm test                    # Run all tests (149 across 7 suites)
npm run test:watch          # Watch mode
```

## Directory Overview

```
src/
  index.tsx              Entry point, route mounting, cron/queue handlers
  types.ts               All TypeScript interfaces
  routes/
    marketing.tsx        Public website, /standard, /docs/plain-text
    auth.ts              Login, magic links, OAuth, passkeys
    book.tsx             Public booking page (contracts, payments)
    vendor/              Vendor dashboard, CRM, calendar, invoicing
    couple.tsx           Couple dashboard, vendor tracking, wedding editing
    stripe.ts            Stripe webhooks
    carddav.ts           CardDAV contact sync
    caldav.ts            CalDAV calendar sync
    feed.ts              iCal feed
  middleware/             Auth, CSRF, rate limiting, audit
  db/                    Data access layer (all queries scoped by tenant)
  storage/               Markdown file storage layer
    markdown.ts          YAML frontmatter parser/serializer
    contacts.ts          Contact ↔ markdown + CRUD
    weddings.ts          Wedding ↔ markdown + file ops
    slug.ts              Human-readable filename generation
    r2.ts                R2 StorageBackend implementation
    github.ts            GitHub StorageBackend (Contents API)
    sync.ts              Scan-and-index engine (ETag-based)
    migrate.ts           Lazy D1→markdown migration
    __tests__/           149 tests covering all storage modules
  services/              Email, notifications, AI, Stripe Connect
  views/                 Layouts, shared components
  lib/                   Utilities (dates, validation, crypto)
schema.sql               Full database schema
migrations/              Numbered migration files
```

## Features

### For Vendors
- **CRM**: Lead capture forms, contact pipeline, activity logging
- **Calendar**: Monthly view, availability settings, CardDAV/CalDAV/iCal sync
- **Invoicing**: Line items, payment schedules, booking fees, Stripe Connect
- **Booking forms**: Custom form builder, service contracts, e-signatures
- **Email**: Inbound/outbound email with AI-assisted drafting
- **Weddings**: Multi-vendor collaboration on shared wedding entities
- **Plain text data**: All contacts/weddings stored as markdown files you can access anywhere
- **GitHub sync**: Connect a private repo and your data syncs automatically — open in Obsidian or VS Code

### For Couples
- **Wedding dashboard**: Budget tracking, vendor management, payment overview
- **Wedding details**: Edit ceremony, reception, getting-ready logistics
- **Vendor tracking**: Add any vendor (on or off platform), set budgets
- **Privacy controls**: Toggle vendor-to-vendor visibility

### Platform
- **Zero-JS frontend**: Server-rendered HTML with htmx for interactivity
- **Global edge**: Sub-50ms responses via Cloudflare Workers
- **Protocol support**: CardDAV, CalDAV, iCal for native app integration
- **GitHub sync**: Auto-push markdown files to a private repo for local access
- **Open data format**: [Wedding CRM Markdown Standard](https://wedding.computer/standard) (CC0)
- **Multi-ceremony**: Weddings, elopements, vow renewals, commitments
- **Open source**: AGPL-3.0 — audit the code, self-host, or contribute

## License

This project is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE) for the full text.

Anyone modifying and deploying this software must share their changes under the same license.
