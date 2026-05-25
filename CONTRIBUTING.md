# Contributing to Wedding Computer

Thanks for your interest in contributing. This guide covers the workflow and conventions for the project.

## Development Setup

```bash
git clone https://github.com/weddingcomputer/wedding-computer.git
cd wedding-computer
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Visit `http://localhost:8787`. Use `/dev/login/josh@withers.co` to bypass auth locally.

## Pull Request Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npx tsc --noEmit` to ensure the build passes
4. Test locally with `npm run dev`
5. Open a PR with a clear description of the change

## Coding Conventions

These conventions are enforced throughout the codebase. See `CLAUDE.md` for full detail.

### TypeScript

- Explicit `return` in route handlers
- DB functions: first param `db: D1Database`, second param is the scoping ID (vendor_id, wedding_id)
- Error responses: `{ error: string }` with appropriate HTTP status
- HTML responses: `c.html(<Component />)` via Hono JSX

### Naming

- **DB tables**: `snake_case` plural (`wedding_members`, `calendar_events`)
- **TypeScript types**: `PascalCase` singular (`Wedding`, `Contact`)
- **Route files**: `kebab-case.ts(x)` (`booking-form.tsx`)
- **DB functions**: `verbNoun` (`listContacts`, `getContact`, `createContact`)

### Data Access

Every database query must be scoped by a tenant identifier. No unscoped queries exist in this codebase.

```typescript
// Correct: scoped by vendorId
export async function listContacts(db: D1Database, vendorId: string) { ... }

// Never: unscoped
export async function listAllContacts(db: D1Database) { /* forbidden */ }
```

### Frontend

- Server-rendered Hono JSX + htmx for interactivity
- Tailwind CSS via CDN (no build step, no Preflight — use explicit resets like `m-0`)
- Design system: grapefruit-700 nav, papaya-50 backgrounds, horizon-600 buttons
- WCAG: use -600/-700 shades for text and interactive elements

### Commit Messages

- Use imperative mood: "Add daily digest" not "Added daily digest"
- Keep the subject line under 72 characters
- Reference the feature area: "feat(calendar): add availability overrides"

## Project Structure

- `src/routes/` — Hono route handlers (vendor, couple, public)
- `src/db/` — Data access layer (one file per entity)
- `src/services/` — Business logic (email, notifications, AI, Stripe)
- `src/middleware/` — Auth, CSRF, rate limiting
- `src/views/` — Layouts and shared UI components
- `src/lib/` — Utility functions (dates, validation, crypto)
- `schema.sql` — Full database schema
- `migrations/` — Numbered migration files

## Reporting Issues

Open a GitHub issue with:

- Steps to reproduce
- Expected behavior
- Actual behavior
- Browser/environment info if relevant

## License

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 license.
