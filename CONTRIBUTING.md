# Internal Development Notes

Wedding Computer is a closed-source, proprietary project. This file is for maintainers and approved collaborators working in the private repository.

For the complete agent/developer guide, read `CLAUDE.md` first.

## Development Setup

```bash
npm install
npm run db:schema:local
npm run db:seed:local
npm run dev
```

Visit `http://localhost:8787`. For local auth bypass, set `ENABLE_DEV_LOGIN=true` in `.dev.vars`, then use `/dev/login/:email`.

## Change Workflow

1. Work from a branch off the current mainline.
2. Keep schema changes in both `schema.sql` and a numbered migration.
3. Route new UI strings through `src/i18n` and dates through `src/lib/date.ts`.
4. Keep DB helpers scoped by the relevant tenant/user/wedding identifier.
5. Run the focused tests for your change, then `npm run typecheck` and `npm test` before deploy handoff.

## Coding Conventions

- Route handlers should return explicitly.
- Error JSON should be shaped as `{ error: string }` with an appropriate status.
- HTML responses should use `c.html(<Component />)` through Hono JSX.
- Storage-backed contacts and weddings should go through `src/storage/`, not direct R2 calls.
- Authenticated vendor routes should use `requireAuth`, `csrf`, and `requireVendor`.
- Sensitive operations should call `auditLog()`.

## Frontend

- Server-rendered Hono JSX plus htmx for interaction.
- Tailwind CSS is built with `npm run build:css` into `public/styles.css`.
- Match the existing grapefruit, papaya, and horizon design language unless the product direction changes.
- Check mobile layouts directly when touching public pages, app navigation, forms, or community screens.

## License

All rights are reserved. Do not describe this project as open source, AGPL, or licensed for reuse.
