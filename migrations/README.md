# Database migrations

Migrations are tracked by Cloudflare's D1 migrations framework. The
`d1_migrations` table records which files have been applied, so each one runs
exactly once. `migrations_dir = "migrations"` is set in `wrangler.toml`.

## Adding a change

1. Create the next numbered file, e.g. `041-add-thing.sql` (keep the
   `NNN-name.sql` convention; they apply in sorted order).
2. Mirror the change into `schema.sql` so it stays the canonical full schema.
3. Apply it:

   ```bash
   npm run db:migrate:local     # apply pending migrations to the local DB
   npm run db:migrate:remote    # ...and to production
   npm run db:migrate:status    # list applied vs pending (remote)
   ```

`migrations apply` only runs files not yet in `d1_migrations`, so it's safe to
run repeatedly.

## Fresh database

For a brand-new local DB, load the full schema then mark existing migrations as
applied so only future ones run:

```bash
npm run db:schema:local
# then bootstrap the tracking table (one-off): insert every current
# migrations/*.sql filename into d1_migrations, OR run `db:migrate:local`
# against an empty DB if the migrations are self-contained from zero.
```

> Note: the existing local + production databases were bootstrapped on
> 2026-06-11 — `d1_migrations` already lists 001–040 as applied, so
> `migrations apply` will only run 041 onward.
