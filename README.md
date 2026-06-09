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
| `SIGNUP_INVITE_CODE` | Optional — gates new signups behind an invite code when set (see [Invite-only signups](#invite-only-signups)) |

Public vars are in `wrangler.toml`: `TURNSTILE_SITE_KEY`, `APP_URL`.

### Invite-only signups

New self-signups via the public `/login` page can be gated behind a shared invite code.
The feature is always deployed in the app; it switches **on** whenever the
`SIGNUP_INVITE_CODE` secret is set to a non-empty value, and **off** when the secret
is unset. No redeploy is needed either way — setting the secret rolls a new Worker
version automatically.

**Turn it on / set the code:**

```bash
wrangler secret put SIGNUP_INVITE_CODE   # type the code at the prompt
```

Takes effect within seconds. Open `/login` to confirm the **Invite code** field appears.

**Change the code:** run `wrangler secret put SIGNUP_INVITE_CODE` again (it overwrites).

**Turn it off (reopen signups):**

```bash
wrangler secret delete SIGNUP_INVITE_CODE
```

Behaviour:

- One shared code, matched case-insensitively.
- Existing users sign in as normal — no code required.
- Invited couples and vendors bypass the gate (their magic link lands on `/login/verify`, not the public form).
- Visitors without a code are pointed to the `/notify` waitlist.

### Deploy

```bash
npm run db:migrate:remote   # Migrate production D1
wrangler deploy             # Deploy to Cloudflare Workers
```

### Tests

```bash
npm test                    # Run all tests (253 across 13 suites)
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
    enquire.tsx          Public enquiry form + AI auto-reply
    vendor/
      dashboard.tsx      Vendor home
      contacts.tsx       CRM contacts & pipeline
      weddings.tsx       Wedding list & detail
      calendar.tsx       Calendar & availability
      invoices.tsx       Invoicing with Stripe Connect
      settings.tsx       Profile, tax, location picker, availability sharing
      analytics.tsx      Analytics, benchmarks, busyness heatmaps
      run-sheet.tsx      Day-of run sheet builder
      quotes.tsx         Quote calculator config
      team.tsx           Team & agency management
      import.tsx         CSV/JSON import wizard
      emails.tsx         Built-in email
      booking-form.tsx   Custom booking forms
      contracts.tsx      Service contracts
      checklists.tsx     Wedding checklists
      places.tsx         Google Places autocomplete + geocoding
    public/
      availability.tsx   Public availability calendar
      quote.tsx          Embeddable quote calculator
      directory.tsx      JSON API for wedding.institute directory
    couple.tsx           Couple dashboard, vendor tracking, wedding editing
    stripe.ts            Stripe webhooks
    carddav.ts           CardDAV contact sync
    caldav.ts            CalDAV calendar sync
    feed.ts              iCal feed
    mcp.ts               MCP server (AI agent access)
  middleware/             Auth, CSRF, rate limiting, audit
  db/
    vendors.ts           Vendor profile CRUD
    contacts.ts          CRM contacts
    invoices.ts          Invoice records + tax calculations
    calendar.ts          Events & availability
    analytics.ts         Event tracking & aggregate queries
    busyness.ts          Date busyness score aggregation (daily cron)
    quotes.ts            Quote calculator CRUD
    run-sheet.ts         Run sheet item CRUD
    team-members.ts      Team member CRUD & wedding assignment
    imports.ts           Import job & record tracking
    subscriptions.ts     Pro subscription management
  storage/               Markdown file storage layer
    markdown.ts          YAML frontmatter parser/serializer
    contacts.ts          Contact ↔ markdown + CRUD
    weddings.ts          Wedding ↔ markdown + file ops
    slug.ts              Human-readable filename generation
    r2.ts                R2 StorageBackend implementation
    github.ts            GitHub StorageBackend (Contents API)
    sync.ts              Scan-and-index engine (ETag-based)
    migrate.ts           Lazy D1→markdown migration
    __tests__/           Storage module tests
  services/
    ai.ts                Claude/Workers AI (email drafts, run sheets, enquiry replies)
    email.ts             Transactional email via Resend
    notifications.ts     Email notifications for wedding events
    analytics.ts         Event tracking
    import/              CSV parser, AI text extraction, import processing
  views/                 Layouts, shared components
  lib/                   Utilities (dates, validation, crypto, DAV)
schema.sql               Full database schema
migrations/              Numbered migration files (001–030)
```

## Features

### For Vendors
- **CRM**: Lead capture forms, eight-stage contact pipeline, activity logging, search
- **Calendar**: Monthly view, availability settings, CardDAV/CalDAV/iCal sync
- **Public availability calendar**: Opt-in to share your availability publicly, with vendors only, or via AI auto-replies
- **Invoicing**: ATO-compliant tax invoices with GST/ABN, line items, payment schedules, booking fees, Stripe Connect
- **Quote calculator**: Configurable pricing tool, embeddable on your website via iframe
- **Booking forms**: Custom form builder, service contracts, e-signatures
- **Email**: Inbound/outbound email with AI-assisted drafting
- **AI enquiry auto-replies**: When a new enquiry arrives, AI drafts an availability-aware response for your review
- **Day-of run sheet**: Timeline planner for each wedding with AI generation from wedding details
- **Analytics & benchmarks**: Business analytics with anonymised industry benchmarks at city/state/country/global levels
- **Date busyness scores**: See how busy any date is for enquiries and bookings in your area
- **Team management**: Agency rosters with member assignment to individual weddings
- **Import from anywhere**: CSV/JSON import from Dubsado, Studio Ninja, HoneyBook, VSCO Workspace, or any spreadsheet — plus AI-powered text extraction
- **Weddings**: Multi-vendor collaboration on shared wedding entities
- **Directory listing**: Opt in to the wedding.institute vendor directory
- **Plain text data**: All contacts/weddings stored as markdown files you can access anywhere
- **GitHub sync**: Connect a private repo and your data syncs automatically — open in Obsidian or VS Code

### For Couples
- **Wedding dashboard**: Budget tracking, vendor management, payment overview
- **Wedding details**: Edit ceremony, reception, getting-ready logistics
- **Vendor tracking**: Add any vendor (on or off platform), set budgets
- **Privacy controls**: Toggle vendor-to-vendor visibility

### Public API
- **Directory API**: JSON endpoints at `/api/directory/vendors`, `/api/directory/categories`, `/api/directory/locations` for the wedding.institute directory (CORS-enabled)
- **Public availability**: `/v/:vendorId/availability` — calendar view for vendors who opt in
- **Embeddable quote**: `/quote/:token` — standalone quote calculator with enquiry form

### Platform
- **Zero-JS frontend**: Server-rendered HTML with htmx for interactivity
- **Global edge**: Sub-50ms responses via Cloudflare Workers
- **Protocol support**: CardDAV, CalDAV, iCal for native app integration
- **MCP server**: AI agent access to contacts, weddings, checklists, and calendar
- **GitHub sync**: Auto-push markdown files to a private repo for local access
- **Open data format**: [Wedding CRM Markdown Standard](https://wedding.computer/standard) (CC0)
- **Multi-ceremony**: Weddings, elopements, vow renewals, commitments
- **Busyness aggregation**: Daily cron computes enquiry/booking density at city/state/country/global levels
- **Open source**: AGPL-3.0 — audit the code, self-host, or contribute

## License

This project is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE) for the full text.

Anyone modifying and deploying this software must share their changes under the same license.
