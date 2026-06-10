# CLAUDE.md — Wedding Computer

> A multi-party wedding collaboration platform. Open source (AGPL-3.0). Built on Cloudflare Workers.

## Project Overview

Wedding Computer is a SaaS platform for the wedding industry. It starts as a vendor CRM (managing leads, contacts, calendar, invoicing) and evolves into a multi-party collaboration tool where vendors, couples, and venues coordinate on a shared wedding entity.

**Live URL:** `weddingcomputer.com`
**License:** AGPL-3.0
**Repo:** `github.com/joshwithers/wedding-computer`
**Obsidian plugin:** `github.com/joshwithers/wedding-computer-sync` — first-party vault sync plugin in its own repo (releases built by its CI on version tags), live in the Obsidian community directory at `community.obsidian.md/plugins/wedding-computer-sync`. It talks to this app's vault API (`src/routes/vault-api.ts`), authenticated with the device-sync token.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Cloudflare Workers |
| Framework | Hono (TypeScript, JSX) |
| Database | Cloudflare D1 (SQLite) |
| Object Storage | Cloudflare R2 |
| Key-Value Store | Cloudflare KV (sessions, OAuth tokens, cache) |
| Background Jobs | Cloudflare Queues |
| Real-time (future) | Cloudflare Durable Objects |
| Auth | Magic links + Google/Apple OAuth |
| Payments | Stripe Connect |
| Email | Resend |
| AI | Anthropic Claude (Haiku for fast, Sonnet for complex) |
| Frontend | Server-rendered Hono JSX + htmx |
| CSS | Tailwind CSS (via CDN, no build step) |
| CAPTCHA | Cloudflare Turnstile |

---

## Getting Started

### Prerequisites

- Node.js 20+
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account with D1, KV, R2, and Queues access

### Local Development

```bash
npm install
npm run db:migrate:local    # Creates local D1 tables
npm run db:seed:local       # Seed demo data (vendor account, sample wedding)
npm run dev                 # Starts local dev server at localhost:8787
```

### Environment Secrets

Set via `wrangler secret put <NAME>`:

| Secret | Purpose |
|--------|---------|
| `SESSION_SECRET` | Session cookie signing (32+ random bytes) |
| `RESEND_API_KEY` | Transactional email (magic links, notifications) |
| `ANTHROPIC_API_KEY` | AI features (email drafting, recommendations) |
| `STRIPE_SECRET_KEY` | Platform Stripe key (Connect) |
| `STRIPE_WEBHOOK_SECRET` | Stripe event verification |
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `APPLE_CLIENT_ID` | Apple Sign-In |
| `APPLE_CLIENT_SECRET` | Apple Sign-In (JWT) |
| `TURNSTILE_SECRET_KEY` | CAPTCHA verification |

Public vars (in `wrangler.toml`): `TURNSTILE_SITE_KEY`, `APP_URL`

---

## Directory Structure

```
src/
├── index.tsx                    # App entry, route mounting, cron/queue handlers
├── types.ts                     # All TypeScript interfaces (Bindings, Env, models)
│
├── routes/
│   ├── marketing.tsx            # Public website (home, about, blog, pricing)
│   ├── auth.ts                  # Login, magic-link verify, OAuth callbacks, logout
│   ├── vendor/
│   │   ├── dashboard.tsx        # Vendor home (upcoming weddings, tasks)
│   │   ├── crm.tsx              # Leads, contacts, pipeline
│   │   ├── weddings.tsx         # Wedding list + detail
│   │   ├── calendar.tsx         # Calendar views, availability settings
│   │   ├── invoices.tsx         # Invoicing (Stripe Connect)
│   │   ├── settings.tsx         # Profile, business details, integrations
│   │   └── api.ts              # Vendor REST API (htmx partials + JSON)
│   ├── couple/
│   │   ├── dashboard.tsx        # Couple home (wedding overview)
│   │   ├── vendors.tsx          # Their vendor list, booking
│   │   ├── budget.tsx           # Budget tracker
│   │   ├── documents.tsx        # Shared documents
│   │   └── api.ts              # Couple REST API
│   ├── wedding/
│   │   └── api.ts              # Wedding entity CRUD (shared between vendor/couple)
│   ├── stripe.ts               # Webhooks (Connect onboarding, payments, invoices)
│   └── webhooks.ts             # External webhooks (email events, etc.)
│
├── middleware/
│   ├── auth.ts                  # Session validation, user loading
│   ├── tenant.ts               # Tenant context injection (vendor or couple)
│   ├── wedding-access.ts       # Wedding-level permission checking
│   ├── csrf.ts                  # CSRF token generation + validation
│   ├── rate-limit.ts           # Per-IP + per-user rate limiting
│   └── audit.ts                # Audit log middleware for sensitive operations
│
├── db/
│   ├── users.ts                 # User CRUD
│   ├── vendors.ts              # Vendor profile CRUD
│   ├── weddings.ts             # Wedding entity + permissions
│   ├── contacts.ts             # CRM contacts (leads, clients)
│   ├── invoices.ts             # Invoice records
│   ├── calendar.ts             # Availability, events
│   ├── documents.ts            # R2 document references
│   ├── audit.ts                # Audit log queries
│   └── sessions.ts            # Session management
│
├── services/
│   ├── auth.ts                  # Magic link generation, OAuth token exchange
│   ├── email.ts                # Send transactional emails (Resend)
│   ├── stripe-connect.ts      # Stripe Connect account management
│   ├── ai.ts                   # Claude API wrapper (email drafts, summaries)
│   ├── calendar-sync.ts       # Google Calendar OAuth + sync
│   └── permissions.ts         # Permission resolution logic
│
├── views/
│   ├── layouts/
│   │   ├── marketing.tsx       # Public site layout (nav, footer)
│   │   ├── app.tsx             # Authenticated app layout (sidebar, user menu)
│   │   └── auth.tsx            # Auth pages layout (minimal, centered)
│   ├── marketing/
│   │   ├── home.tsx
│   │   ├── about.tsx
│   │   ├── pricing.tsx
│   │   └── blog.tsx
│   ├── vendor/                 # Vendor page components
│   ├── couple/                 # Couple page components
│   └── shared/                 # Shared UI components (tables, forms, modals)
│
├── lib/
│   ├── id.ts                    # ID generation (nanoid or hex)
│   ├── crypto.ts               # Session signing, CSRF tokens, magic link tokens
│   ├── validation.ts           # Input validation helpers
│   ├── date.ts                 # Date formatting (AEST-aware)
│   └── email-templates.ts     # HTML email rendering
│
├── jobs/
│   ├── send-magic-link.ts      # Queue consumer: send magic link email
│   ├── send-notification.ts   # Queue consumer: send notification emails
│   ├── sync-calendar.ts       # Queue consumer: sync vendor calendar
│   └── daily-digest.ts        # Cron: daily activity digest
│
└── assets/
    ├── logo.svg
    └── favicons/

# Root files
schema.sql                      # Full database schema
migrations/                     # Numbered migration files
├── 001-initial.sql
├── 002-stripe-connect.sql
└── ...
wrangler.toml                   # Cloudflare Workers config
package.json
tsconfig.json
```

---

## Core Data Model: The Wedding Entity

A **wedding** is the central entity. Users (identified by email) are given permission to a wedding with specific roles.

### Ownership Rules

- The vendor who creates a wedding is the **owner**
- Owners can invite other vendors and couples
- Some vendors are "organising vendors" (venues, planners, elopement planners) — when they are the owner, financial transactions flow to them, not the couple
- Couples can also create their own wedding and invite vendors (they become the owner)
- A wedding always has exactly one owner

### Permission Model

Roles on a wedding:
- **owner**: Full control. Can invite/remove members. Can delete. Financial responsibility if vendor.
- **vendor**: Can view wedding details relevant to their service. Can manage their own invoices. Cannot see other vendors unless couple grants permission.
- **couple**: Can view all their vendors, budget, timeline. Can approve inter-vendor visibility.
- **guest**: Read-only (future phase).

### Wedding Lifecycle

```
CRM Contact (new → contacted → quoted → booked)
    │
    ▼ (on status change to 'booked')
Wedding entity created (or linked to existing)
    │
    ▼
wedding_members entries created (vendor as owner, couple invited)
    │
    ▼
Couple accepts invite → joins wedding → sees their dashboard
    │
    ▼
Vendor invites other vendors → they join with 'vendor' role
```

### Entity Relationships

```
                    ┌──────────────────┐
                    │      Wedding     │
                    │                  │
                    │  id, title,      │
                    │  date, location, │
                    │  status          │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
    ┌─────────▼──────┐ ┌────▼─────┐ ┌─────▼──────────┐
    │ wedding_members │ │ invoices │ │ calendar_events │
    │                │ │          │ │                 │
    │ user + role    │ │ vendor → │ │ vendor          │
    │ (owner/vendor/ │ │ couple   │ │ date/time       │
    │  couple/guest) │ │          │ │                 │
    └────────────────┘ └──────────┘ └─────────────────┘
                             │
                      ┌──────▼──────┐
                      │  documents  │
                      │             │
                      │  R2 files   │
                      │  visibility │
                      └─────────────┘
```

---

## Database Schema (Phase 1)

### Design Principles

- IDs: `TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12))))` (24 hex chars)
- Timestamps: ISO 8601 strings via `datetime('now')`
- Booleans: `INTEGER NOT NULL DEFAULT 0`
- JSON columns: `TEXT` with application-layer parsing
- Every tenant-scoped table has explicit ownership columns
- Foreign keys: `ON DELETE CASCADE` where parent removal should cascade

```sql
-- Users (identified by email, can be vendor or couple or both)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Vendor profiles (a user who is a vendor has one of these)
CREATE TABLE IF NOT EXISTS vendor_profiles (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  category TEXT NOT NULL,  -- 'celebrant','photographer','florist','planner','venue','videographer','stylist','caterer','other'
  phone TEXT,
  website TEXT,
  instagram TEXT,
  bio TEXT,
  location TEXT,
  timezone TEXT NOT NULL DEFAULT 'Australia/Sydney',
  stripe_account_id TEXT,
  stripe_onboarding_complete INTEGER NOT NULL DEFAULT 0,
  availability_default TEXT, -- JSON: default weekly availability
  is_organiser INTEGER NOT NULL DEFAULT 0,  -- venue/planner who manages weddings and receives payments
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The Wedding entity (central object)
CREATE TABLE IF NOT EXISTS weddings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  title TEXT NOT NULL,
  date TEXT,
  time TEXT,
  location TEXT,
  location_lat REAL,
  location_lng REAL,
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning','confirmed','completed','cancelled')),
  notes TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Wedding permissions (who can access a wedding and in what role)
CREATE TABLE IF NOT EXISTS wedding_members (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','vendor','couple','guest')),
  vendor_profile_id TEXT REFERENCES vendor_profiles(id),
  vendor_role TEXT,        -- their service: 'celebrant','photographer', etc.
  is_financial_party INTEGER NOT NULL DEFAULT 0,  -- receives payments for this wedding
  permissions TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited','active','removed')),
  invited_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(wedding_id, user_id)
);

-- CRM Contacts (vendor's leads/clients)
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  partner_first_name TEXT,
  partner_last_name TEXT,
  partner_email TEXT,
  partner_phone TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','contacted','meeting','quoted','booked','completed','lost','archived')),
  wedding_id TEXT REFERENCES weddings(id),
  wedding_date TEXT,
  wedding_location TEXT,
  notes TEXT,
  tags TEXT,               -- JSON array
  last_contacted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Contact activity log
CREATE TABLE IF NOT EXISTS contact_activities (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,      -- 'email_sent','email_received','note','call','meeting','status_change','invoice_sent','payment_received'
  summary TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Invoices (vendor → client, via Stripe Connect)
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id),
  wedding_id TEXT REFERENCES weddings(id),
  stripe_invoice_id TEXT,
  stripe_payment_intent_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'aud',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','paid','overdue','cancelled','refunded')),
  due_date TEXT,
  paid_at TEXT,
  line_items TEXT,         -- JSON: [{description, amount_cents, quantity}]
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Calendar events
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  wedding_id TEXT REFERENCES weddings(id),
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  all_day INTEGER NOT NULL DEFAULT 1,
  type TEXT NOT NULL DEFAULT 'booking'
    CHECK (type IN ('booking','blocked','personal','other')),
  google_event_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Vendor availability overrides
CREATE TABLE IF NOT EXISTS availability_overrides (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor_id, date)
);

-- Documents (R2 references)
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  wedding_id TEXT REFERENCES weddings(id) ON DELETE CASCADE,
  vendor_id TEXT REFERENCES vendor_profiles(id),
  uploaded_by_user_id TEXT NOT NULL REFERENCES users(id),
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  category TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','wedding','public')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Email queue
CREATE TABLE IF NOT EXISTS email_queue (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  to_email TEXT NOT NULL,
  to_name TEXT,
  from_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed')),
  error TEXT,
  scheduled_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX idx_vendor_profiles_user_id ON vendor_profiles(user_id);
CREATE INDEX idx_vendor_profiles_category ON vendor_profiles(category);
CREATE INDEX idx_weddings_created_by ON weddings(created_by_user_id);
CREATE INDEX idx_weddings_date ON weddings(date);
CREATE INDEX idx_wedding_members_wedding ON wedding_members(wedding_id);
CREATE INDEX idx_wedding_members_user ON wedding_members(user_id);
CREATE INDEX idx_contacts_vendor ON contacts(vendor_id);
CREATE INDEX idx_contacts_status ON contacts(status);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_wedding ON contacts(wedding_id);
CREATE INDEX idx_contact_activities_contact ON contact_activities(contact_id);
CREATE INDEX idx_invoices_vendor ON invoices(vendor_id);
CREATE INDEX idx_invoices_wedding ON invoices(wedding_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_calendar_events_vendor_date ON calendar_events(vendor_id, date);
CREATE INDEX idx_calendar_events_wedding ON calendar_events(wedding_id);
CREATE INDEX idx_availability_overrides_vendor ON availability_overrides(vendor_id, date);
CREATE INDEX idx_documents_wedding ON documents(wedding_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_email_queue_status ON email_queue(status, scheduled_at);
```

---

## Authentication Flow

### Magic Links (Primary)

1. User enters email on `/login`
2. Server generates a random token (32 hex bytes), stores in KV with 15-minute TTL: `magic:{token} → {email, redirect}`
3. Email sent via Resend with link: `weddingcomputer.com/login/verify?token=xxx`
4. User clicks link → server validates token from KV → deletes token (one-time use)
5. Server looks up or creates user by email
6. Server creates session: random token in KV (`session:{token} → {userId, expiresAt}`), set as `HttpOnly; Secure; SameSite=Lax` cookie
7. Redirect to `/app/`

### Google/Apple OAuth (Secondary)

Standard OAuth2 flow → extract email + name from ID token → look up or create user → create session.

### No Passwords

No passwords in this system. Magic links + OAuth eliminates credential stuffing, password reuse, bcrypt CPU cost, and password reset flows.

### Session Management

- Stored in KV with 30-day TTL (rolling — extended on each request)
- Cookie: `wc_session` (HttpOnly, Secure, SameSite=Lax, Path=/)
- Session record in D1 `sessions` table for revocation
- Logout: delete KV entry + clear cookie

---

## Multi-Tenancy Approach

Shared D1 database with strict application-layer tenant isolation.

### Isolation Layers

1. **Session Auth (middleware/auth.ts)**: Every `/app/*` and `/api/*` request has a valid session. Loads user into context.
2. **Vendor Context (middleware/tenant.ts)**: For vendor routes, loads `vendor_profile` for the user. Rejects if none exists.
3. **Data Access Layer (db/*.ts)**: ALL functions take scoping ID as required parameter. No unscoped queries exist.
4. **Wedding Access (middleware/wedding-access.ts)**: Checks `wedding_members` before any wedding data access.

```typescript
// CORRECT: always scoped
export async function listContacts(db: D1Database, vendorId: string): Promise<Contact[]> {
  return db.prepare('SELECT * FROM contacts WHERE vendor_id = ? ORDER BY created_at DESC')
    .bind(vendorId).all<Contact>().then(r => r.results)
}

// NEVER: unscoped
export async function listAllContacts(db: D1Database) { /* FORBIDDEN */ }
```

### Data Boundaries

| Data | Who can see it |
|------|----------------|
| Vendor's CRM contacts | Only that vendor |
| Vendor's calendar | Only that vendor |
| Vendor's invoices for a wedding | The vendor + the couple on that wedding |
| Wedding details | All active members |
| Other vendors on a wedding | Only if couple enables inter-vendor visibility (Phase 3) |

---

## Stripe Connect Integration

### Standard Connect Accounts

Each vendor connects their own Stripe account. They maintain full control of their Stripe dashboard.

### Onboarding

1. Vendor clicks "Connect Stripe" → server creates Account Link
2. Vendor completes Stripe's hosted onboarding
3. Webhook `account.updated` confirms `charges_enabled: true`
4. Vendor can now create invoices

### Invoice Flow

1. Vendor creates invoice in-app (amount, line items, due date)
2. Server creates Stripe Invoice on vendor's connected account (using `Stripe-Account` header)
3. Stripe emails the invoice to the couple
4. Couple pays via Stripe's hosted invoice page
5. Webhook `invoice.paid` → update DB status

### Organiser Vendors (Financial Party)

When a venue or planner is the `is_financial_party` on a wedding, invoices from ALL vendors on that wedding can optionally be routed through the organiser's Stripe account. The organiser then pays individual vendors. This supports the common pattern where a venue/planner packages everything and handles all couple-facing billing.

### Platform Fee

Optional application fee on payments for sustainability:
```typescript
application_fee_amount: 500, // $5 per transaction
```

---

## Phase 1 Implementation Order

### Step 1: Project Scaffold
- Hono project, wrangler.toml, D1/KV/R2 bindings
- Schema with users + vendor_profiles + sessions only
- Health check endpoint, deploy to Workers

### Step 2: Authentication
- Magic link flow (KV tokens, session creation)
- Google OAuth flow
- Session middleware, logout
- Login page (server-rendered)
- New vendor onboarding (first login → ask business name, category)

### Step 3: Marketing Site
- Home, about, pricing pages
- Blog (markdown files)
- Responsive layout, navigation

### Step 4: Vendor Dashboard Shell
- App layout (sidebar, user menu)
- Dashboard (empty state / getting started)
- Settings (profile, business details)
- CSRF middleware, htmx setup

### Step 5: CRM - Contacts
- Contacts CRUD
- Status pipeline (filter tabs, click-to-change)
- Contact detail (edit, notes, activity log)
- Search

### Step 6: Lead Capture Forms
- Public embeddable enquiry form
- Turnstile CAPTCHA, rate limiting
- Auto-creates contact with `source='website'`
- Email notification to vendor

### Step 7: Wedding Entity
- Wedding CRUD + wedding_members
- "Promote to booking" (contact → wedding)
- Wedding detail page
- Invite couple via email
- Wedding list for vendor

### Step 8: Calendar & Availability
- Calendar events CRUD
- Monthly calendar view (htmx navigation)
- Availability settings (default days + overrides)
- Auto-link weddings to calendar on booking

### Step 9: Stripe Connect & Invoicing
- Connect onboarding flow
- Invoice creation + list
- Stripe API integration
- Webhook handler (payment events)

### Step 10: AI Email Drafting
- Draft email button on contact detail
- Claude Haiku for personalised drafts
- Preview + send via Resend
- Log in activity

### Step 11: Polish & Launch
- Error handling, rate limiting
- Audit logging
- Data export (CSV, JSON)
- Account deletion (GDPR)
- README, CONTRIBUTING, LICENSE

---

## Security Checklist

- [ ] Magic link tokens: 32 bytes random, 15-minute TTL, single-use
- [ ] Session tokens: 32 bytes random, HttpOnly, Secure, SameSite=Lax
- [ ] New session ID on every login (no fixation)
- [ ] CSRF token on all POST/PUT/DELETE (bound to session)
- [ ] Every DB query scoped by vendor_id or wedding membership
- [ ] No admin endpoints that bypass tenant scoping
- [ ] All user input validated before DB insertion
- [ ] HTML stripped from text inputs
- [ ] File uploads: MIME validation, size limits
- [ ] Rate limiting: 10/min public, 5/min auth, 60/min authenticated
- [ ] OAuth refresh tokens in KV only (not D1)
- [ ] No PII in URL parameters
- [ ] Stripe handles all card data (PCI compliance)
- [ ] R2 documents via signed URLs (time-limited)
- [ ] Audit log for: login, data export, data delete, invitations, payments
- [ ] Account deletion removes all data, anonymizes audit entries
- [ ] Data export endpoint (GDPR)
- [ ] No tracking cookies (session-only, no consent banner needed)
- [ ] Secrets via `wrangler secret` only

---

## Key Technical Decisions

### 1. Hono + Server-Rendered JSX + htmx (not React SPA)

Proven in Tardis. Server rendering = zero client JS bundle. htmx adds interactivity without client-side state management. Workers respond in <50ms globally. When complex interactive UIs are needed later (timeline editor, real-time collab), use Preact Islands for those pages only.

### 2. Single Worker Serves Everything

One Worker handles marketing, auth, vendor app, couple app, webhooks. Eliminates deployment coordination. Split only if hitting 1MB compressed limit or needing Durable Objects.

### 3. D1 (SQLite) as Primary Database

Fast for read-heavy CRM workloads. D1 replicates globally. 10GB max is sufficient for years. If performance requires it later, shard by vendor group.

### 4. Shared Database (Not Per-Tenant)

Simpler ops, one schema to migrate, cross-tenant queries possible (date finder in Phase 4). Protected by strict application-layer isolation.

### 5. No Passwords (Magic Links + OAuth Only)

Eliminates credential stuffing, password reuse, bcrypt cost, reset flows. Session is 30 days so re-auth is rare.

### 6. Stripe Connect Standard (Not Express)

Vendors get full Stripe dashboard control. Less support burden. Existing Stripe accounts connect directly.

### 7. Cloudflare Queues (Not waitUntil)

Guaranteed delivery, automatic retries, dead letter queue, failure visibility. Use for email, calendar sync, webhooks.

### 8. Tailwind CSS via CDN (No Build Step)

Instant deploys. No CSS build step slowing iteration. Replace with CLI build later if needed.

### 9. AGPL-3.0 License

Open source with teeth. Anyone modifying and deploying must share changes. Prevents hosted competitors without contribution.

---

## Conventions

### Code Style
- Explicit `return` in route handlers
- DB functions: first param `db: D1Database`, second param scoping ID
- Error responses: `{ error: string }` with HTTP status
- HTML responses: `c.html(<Component />)` via Hono JSX

### Naming
- DB tables: `snake_case` plural
- TypeScript types: `PascalCase` singular
- Route files: `kebab-case.ts(x)`
- DB functions: `verbNoun` (`listContacts`, `getContact`, `createContact`)

### Error Handling
- Route handlers try/catch known errors
- Global `app.onError()` for unhandled errors
- Never expose stack traces in production
- Log: `console.error('[ROUTE]', method, path, error.message)`

---

## Future Phase Notes

These ensure Phase 1 scaffolding accommodates future features.

**Phase 2 (Couple Dashboard):** `wedding_members` with `role='couple'` already supports this. New routes in `src/routes/couple/`. No schema changes.

**Phase 3 (Inter-Vendor Collaboration):** Add `vendor_visibility` to wedding_members or a separate table. Middleware checks before exposing vendor lists.

**Phase 4 (Available Date Finder):** `availability_overrides` + `calendar_events` already capture availability. Add public search endpoint. Vendors opt-in to visibility.

**Phase 5 (AI Everything):** `services/ai.ts` wrapper already abstracted. Add recommendation, budget optimisation, automated follow-up functions.

---

## Wrangler Configuration

```toml
name = "wedding-computer"
main = "src/index.tsx"
compatibility_date = "2025-05-01"
workers_dev = true

[[d1_databases]]
binding = "DB"
database_name = "wedding-computer-db"
database_id = ""

[[kv_namespaces]]
binding = "KV"
id = ""

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "wedding-computer-storage"

[[queues.producers]]
binding = "EMAIL_QUEUE"
queue = "wedding-computer-emails"

[[queues.consumers]]
queue = "wedding-computer-emails"
max_batch_size = 10
max_retries = 3

[vars]
APP_URL = "https://weddingcomputer.com"
TURNSTILE_SITE_KEY = ""

[observability.logs]
enabled = true
invocation_logs = true

[triggers]
crons = ["0 20 * * *"]

[[routes]]
pattern = "weddingcomputer.com"
custom_domain = true
```

---

## Package.json

```json
{
  "name": "wedding-computer",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "db:migrate:local": "wrangler d1 execute wedding-computer-db --local --file=./schema.sql",
    "db:migrate:remote": "wrangler d1 execute wedding-computer-db --remote --file=./schema.sql",
    "db:seed:local": "wrangler d1 execute wedding-computer-db --local --file=./seed.sql",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.12.10"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250501.0",
    "typescript": "^5.8.0",
    "wrangler": "^4.0.0"
  }
}
```

Minimal dependencies. Hono is the only runtime dep. Stripe, Resend, Google OAuth all via raw `fetch()`.

---

## TypeScript Types

```typescript
export type Bindings = {
  DB: D1Database
  KV: KVNamespace
  STORAGE: R2Bucket
  EMAIL_QUEUE: Queue
  SESSION_SECRET: string
  RESEND_API_KEY: string
  ANTHROPIC_API_KEY: string
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  APPLE_CLIENT_ID: string
  APPLE_CLIENT_SECRET: string
  TURNSTILE_SECRET_KEY: string
  TURNSTILE_SITE_KEY: string
  APP_URL: string
}

export type Env = {
  Bindings: Bindings
  Variables: {
    user: User
    vendor?: VendorProfile
    weddingMember?: WeddingMember
    csrfToken: string
  }
}
```
