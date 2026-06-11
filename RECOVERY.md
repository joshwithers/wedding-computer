# Backup & Recovery Strategy

> We hold people's weddings — vendor businesses, couples' plans, money, and
> documents. Losing or corrupting that data is the worst thing that can happen
> to this product. This is the plan to make sure it can't, and the runbook for
> when something still goes wrong.

Status legend: ✅ in place · 🟡 partial · 🔴 to build

---

## 1. Principles

- **3-2-1.** At least **3** copies of critical data, on **2** kinds of storage,
  with **1** copy **offsite** (outside our Cloudflare account). A single bad
  deploy, a fat-fingered delete, or a compromised Cloudflare account must never
  be able to destroy the only copy.
- **Test restores, not just backups.** A backup you've never restored is a
  hope, not a backup. Every layer below has a verification step.
- **Recovery targets** (what we hold ourselves to):
  - **RPO (max data loss): ≤ 24 hours** for a full-disaster restore, **≈ 0**
    for the common cases (Time Travel / git are continuous).
  - **RTO (max downtime): ≤ 1 hour** for a bad deploy/migration, **≤ 1 day**
    for a full rebuild from offsite.
- **Lean on the architecture.** Contacts and weddings are plain markdown files,
  and git-backed vendors already keep a live copy in **their own GitHub repo**.
  That's a backup the user owns and we can't accidentally delete. We should push
  more vendors onto git storage and treat it as a first-class recovery source.
- **Deletes are reversible.** Accidental deletion is the most likely
  "disaster". Soft-delete + a grace period beats restoring a whole database.

---

## 2. Where the data lives (and how recoverable it is today)

| Store | What's in it | Criticality | Recoverable today? |
|---|---|---|---|
| **D1** (SQLite) | users, vendor_profiles, weddings, wedding_members, contacts, invoices, calendar_events, couple_vendors, documents (refs), emails, audit_log, file_index | 🔴 Crown jewels | ✅ Time Travel (30 days, automatic) |
| **R2** — git vendors | their markdown vault (`vendors/<id>/…`) | 🟡 High | ✅ Also in the vendor's own GitHub repo |
| **R2** — R2 vendors | their markdown vault | 🔴 High | 🔴 **R2 is the only copy** |
| **R2** — documents / avatars / logos | uploaded files (contracts, photos), profile images | 🟡 High | 🔴 Only copy in R2 |
| **KV** | vendor secrets (GitHub PAT, API keys), sessions, sync tokens, magic-link tokens, rate counters, broadcast bodies | 🟡 Mixed | 🔴 Secrets are the only copy; the rest is regenerable |
| **GitHub repos** (git vendors) | the vault, with full history | — | ✅ Offsite + versioned, user-owned |
| **Stripe** | payment/connect state, card data | — | ✅ Stripe is the system of record; we never store cards |

**Takeaways:** D1 is well-covered for 30 days. The exposed surfaces are
**R2-only vendors**, **uploaded documents/images**, **KV secrets**, and the lack
of any **offsite** copy of D1 + R2.

---

## 3. The backup layers

### Layer 0 — Architecture (already our best backup)  ✅
- Markdown is the source of truth; it's human-readable and rebuildable.
- Git-backed vendors keep a live, versioned copy in their own GitHub repo. The
  sync engine can **re-pull** to rebuild R2 + `file_index` from git.
- **Action:** make git storage the recommended default at onboarding; surface
  "your data is mirrored to your GitHub" as a feature *and* a safety net.

### Layer 1 — Cloudflare-native, automatic  ✅
- **D1 Time Travel** — continuous, 30-day point-in-time restore. No setup.
  - Inspect: `wrangler d1 time-travel info wedding-computer-db`
  - Restore: `wrangler d1 time-travel restore wedding-computer-db --timestamp=<ISO>`
- **Worker versioning** — every deploy is a version; roll back instantly.
  - `wrangler deployments list` → `wrangler rollback [<version-id>]`

### Layer 2 — Automated offsite D1 backup  ✅ (built — needs 2 secrets set)
A **GitHub Action** (`.github/workflows/backup.yml`), chosen over a Worker cron
because it uses the official `wrangler d1 export`, has no Worker memory limit on
large dumps, and keeps backup logic out of the production app. Nightly
(`0 3 * * *`, plus manual `workflow_dispatch`) it:
1. Exports the production D1 to a SQL dump and gzips it.
2. Commits it to the private **`joshwithers/wedding-computer-backups`** repo as
   `d1/<YYYY-MM-DD>.sql.gz` — **offsite** (separate repo, outside our Cloudflare
   account) and **versioned** (git history).
3. Keeps the newest 30 dumps in the working tree; older remain in git history.

**One-time setup (required before it runs):** add two repo secrets to the main
repo (Settings → Secrets and variables → Actions):
- `CLOUDFLARE_API_TOKEN` — a Cloudflare token with **D1 read/export** on the
  account (dash → My Profile → API Tokens; the "D1 Read" template, or a custom
  token with `Account › D1 › Read`).
- `BACKUP_REPO_TOKEN` — a GitHub PAT (fine-grained) with **Contents: write** on
  `joshwithers/wedding-computer-backups`.

Failures email the repo admin (GitHub's default) — that's the miss alert. A
true dead-man's-switch (alert if a run never starts) is a later add.

> Still to build (Phase 3): R2-vendor vault + document snapshot, and an
> encrypted KV-secrets snapshot, into a dedicated `wedding-computer-backups`
> **R2 bucket**. Git-vendor vaults are already offsite in their own repos.

### Layer 3 — User & admin export / import  🟡
- **Vendor:** markdown vault export `/app/settings/export-markdown` ✅, JSON
  export `/app/settings/export` ✅, live git sync ✅.
- **User (GDPR):** `/account/export` (JSON) ✅.
- **Couple:** 🔴 a "download my wedding" export (details, vendors, documents,
  budget, timeline) — to build.
- **Admin:** 🔴 a one-click **full-platform export** (D1 dump + R2 archive) and a
  visible **backup status** panel.
- **Import / restore-in:** CSV/JSON contact import ✅; extend to a "restore from
  export" path so a vendor's exported JSON/markdown can be re-imported.

---

## 4. Make deletion reversible  🔴 (high-value, cheap)

D1 Time Travel restores the **whole database** to a point in time — it can't
surgically undo one couple deleting their wedding without rolling back
*everyone's* last N hours. The fix is **soft-delete + grace period** on the
things people most regret deleting:

- Add `deleted_at` to `weddings`, `contacts`, and treat account deletion as a
  30-day soft-delete (anonymise/hard-purge after the window via the retention
  cron we already run).
- Deleting hides the record and starts the clock; an admin (or the user) can
  **restore within 30 days** with one action; after that it's purged for real
  (GDPR-clean).
- This turns the single most common "disaster" into a non-event, with no DB
  rollback and no collateral damage to other users.

---

## 5. Recovery runbook (by scenario)

| # | Scenario | Procedure | RTO |
|---|---|---|---|
| 1 | **Bad deploy** (code bug, data intact) | `wrangler rollback` to the previous version. | minutes |
| 2 | **Bad migration / D1 corruption** | `wrangler d1 time-travel restore … --timestamp=<just before>`; redeploy matching code if needed. | < 1 hr |
| 3 | **Accidental mass R2 deletion** | Git vendors: trigger a re-pull (sync rebuilds R2 + index from GitHub). R2 vendors / documents: restore from the backups bucket (Layer 2) or the last Time-Traveled `file_index` + re-push. | < 1 hr |
| 4 | **One record deleted by a user** | With soft-delete (§4): restore the row, clear `deleted_at`. Without it: restore Time Travel into a **clone** DB, extract just that record, re-insert. | minutes (soft) / hours (clone) |
| 5 | **Vendor leaving / GDPR export** | Vendor self-serves markdown + JSON export; or they already hold the GitHub mirror. | self-serve |
| 6 | **Couple wants their data** | Couple export (§3, to build). | self-serve |
| 7 | **Full disaster** (Cloudflare account lost/compromised) | Recreate D1/R2/KV; restore D1 from the offsite GitHub dump; restore R2 vaults from the offsite snapshot (git vendors re-pull from their own repos); re-issue KV secrets (or restore from the encrypted snapshot). | ≤ 1 day |
| 8 | **Stripe/payments question** | Stripe dashboard is the source of truth; reconcile our `invoices`/`subscriptions` against it. | — |

> Keep this table current. Each row should have someone who has actually *run*
> it in a drill (§6).

---

## 6. Testing & cadence

- **Monthly restore drill:** restore the latest D1 dump into a throwaway
  database, run `npm run typecheck` + a smoke query count per table, confirm row
  counts are sane. Restore one R2 backup object and diff it.
- **Quarterly DR drill:** stand up the whole stack from offsite backups in a
  scratch Cloudflare account/namespace and load the app.
- **Per-deploy:** confirm `wrangler rollback` is available (it always is post-
  deploy) and that migrations are tracked (`npm run db:migrate:status`).
- **Continuous:** the nightly backup job emits `backup.completed`; a missed
  night pages someone.

| Asset | Method | Frequency | Retention | Offsite? |
|---|---|---|---|---|
| D1 | Time Travel | continuous | 30 days | no (Cloudflare) |
| D1 | SQL dump → R2 backups + GitHub | nightly | 7d/4w/6m | ✅ GitHub |
| R2 (R2-vendors, docs) | snapshot → backups bucket (+offsite) | nightly | 7d/4w/6m | ✅ |
| R2 (git-vendors) | their GitHub repo | continuous | full history | ✅ user-owned |
| KV secrets | encrypted snapshot → backup set | nightly | 7d | ✅ |
| Code | git + Worker versions | per commit/deploy | git history | ✅ GitHub |

---

## 7. Implementation plan (prioritised)

**Phase 1 — close the offsite gap (highest value):**  ✅ built
1. ✅ Private GitHub backup repo `joshwithers/wedding-computer-backups` created.
2. ✅ Nightly D1 backup Action (`.github/workflows/backup.yml`) → gzipped dump
   committed offsite, 30-dump working-tree retention + full git history.
3. 🟡 **Action required from Josh:** set the two repo secrets above
   (`CLOUDFLARE_API_TOKEN`, `BACKUP_REPO_TOKEN`), then run the workflow once
   manually (Actions → "Nightly D1 backup" → Run workflow) to confirm it pushes
   a dump.

**Phase 2 — make deletion safe:**
4. 🔴 Soft-delete + 30-day grace for weddings, contacts, accounts (§4); restore UI for admin + user.

**Phase 3 — R2 + KV coverage:**
5. 🔴 R2-vendor vault + document snapshot into the backups bucket.
6. 🔴 Encrypted KV-secret snapshot (depends on M15 secret encryption).

**Phase 4 — user/admin surfaces:**
7. 🔴 Couple "download my wedding" export.
8. 🔴 Admin full-platform export + backup-status panel.
9. 🟡 "Restore from export" import path.

**Phase 5 — assurance:**
10. 🔴 Wire up the monthly restore drill (script it) + quarterly DR drill checklist.

---

## 8. Commands cheat-sheet

```bash
# D1 point-in-time
wrangler d1 time-travel info wedding-computer-db
wrangler d1 time-travel restore wedding-computer-db --timestamp=2026-06-11T00:00:00Z

# D1 manual export (ad-hoc backup)
wrangler d1 export wedding-computer-db --remote --output=backup-$(date +%F).sql

# Worker rollback
wrangler deployments list
wrangler rollback

# Migrations are tracked (see migrations/README.md)
npm run db:migrate:status

# Remote D1/R2 may prompt for account — pin it:
export CLOUDFLARE_ACCOUNT_ID=56eb0a25e23b5ed8e20b17842ccc14df
```

---

_Last updated 2026-06-11. Owner: Josh. Review this doc whenever a new data store
or external dependency is added._
