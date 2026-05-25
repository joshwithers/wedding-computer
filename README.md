# Wedding Computer

A multi-party wedding collaboration platform for the wedding industry. Vendors manage leads, contacts, calendars, and invoicing. Couples track vendors, budgets, and wedding details. Everyone coordinates on a shared wedding entity.

**Live:** [wedding.computer](https://wedding.computer)
**License:** AGPL-3.0

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Framework | Hono (TypeScript, JSX) |
| Database | Cloudflare D1 (SQLite) |
| Storage | Cloudflare R2 |
| KV | Cloudflare KV (sessions, cache) |
| Jobs | Cloudflare Queues |
| Auth | Magic links + OAuth |
| Payments | Stripe Connect |
| Email | Resend + Cloudflare Email Routing |
| AI | Anthropic Claude + Cloudflare Workers AI |
| Frontend | Server-rendered JSX + htmx |
| CSS | Tailwind CSS (CDN) |
| Protocols | CardDAV, CalDAV, iCal feeds |

## Getting Started

### Prerequisites

- Node.js 20+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)
- Cloudflare account with D1, KV, R2, and Queues enabled

### Install and Run

```bash
npm install
npm run db:migrate:local    # Create local D1 tables
npm run db:seed:local       # Seed demo data
npm run dev                 # http://localhost:8787
```

Use `/dev/login/josh@withers.co` to bypass auth in local development.

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

## Directory Overview

```
src/
  index.tsx              Entry point, route mounting, cron/queue handlers
  types.ts               All TypeScript interfaces
  routes/
    marketing.tsx        Public website
    auth.ts              Login, magic links, OAuth
    book.tsx             Public booking page (contracts, payments)
    vendor/              Vendor dashboard, CRM, calendar, invoicing
    couple.tsx           Couple dashboard, vendor tracking, wedding editing
    stripe.ts            Stripe webhooks
    carddav.ts           CardDAV contact sync
    caldav.ts            CalDAV calendar sync
    feed.ts              iCal feed
  middleware/             Auth, CSRF, rate limiting
  db/                    Data access layer (all queries scoped by tenant)
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

### For Couples
- **Wedding dashboard**: Budget tracking, vendor management, payment overview
- **Wedding details**: Edit ceremony, reception, getting-ready logistics
- **Vendor tracking**: Add any vendor (on or off platform), set budgets
- **Privacy controls**: Toggle vendor-to-vendor visibility
- **Safety**: Remove vendors silently with admin notification

### Platform
- **Zero-JS frontend**: Server-rendered HTML with htmx for interactivity
- **Global edge**: Sub-50ms responses via Cloudflare Workers
- **Protocol support**: CardDAV, CalDAV, iCal for native app integration
- **Daily digest**: Automated vendor summary emails
- **Multi-ceremony**: Weddings, elopements, vow renewals, commitments

## License

This project is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE) for the full text.

Anyone modifying and deploying this software must share their changes under the same license.
