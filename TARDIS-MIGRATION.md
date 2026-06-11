# TARDIS → Wedding Computer migration runbook

> **EXECUTED 2026-06-12.** All contacts imported to production: TEC 463/463
> (292 weddings), MBJ 808/808 incl. 6 TEC-overlap couples (159 weddings; one
> transient D1 502 retried successfully). Harrison & Lauren cross-linked (note:
> TEC recorded 2023-09-14, MBJ 2024-09-21 — reconcile manually). `is_organiser=1`
> set on TEC. Zero emails sent. Pre-import backup: `backups/pre-tardis-import-2026-06-12.sql`.
> Method note: large imports were run as ~70-row chunks because the importer
> processes synchronously in one request (subrequest budget); imports executed
> via local `wrangler dev` with `d1_databases.remote = true` (reverted after).
> Known inherited mess: 58 duplicate-email contact pairs in MBJ (53 existed in
> TARDIS, 5 organic collisions). Remaining: Phase 2 images, TARDIS form freeze.

Migrating both businesses out of TARDIS (`~/Websites/forms-project`, prod at `tardis.withers.co`, D1 `forms-db`) into Wedding Computer production.

## Decisions (made 2026-06-11)

**One account per business.** Wedding Computer's data model is one vendor profile per
user (`vendor_profiles.user_id` is UNIQUE), and `wedding_members` is keyed on
`(wedding_id, user_id)` — one user cannot be on the same wedding as two different
businesses. Rather than re-architect that, each TARDIS brand becomes its own account:

| TARDIS brand | Wedding Computer account | Category | Notes |
|---|---|---|---|
| Married By Josh (`mbj`) | `josh@withers.co` (existing) | celebrant | Existing prod vendor with GitHub vault sync |
| The Elopement Collective (`tec`) | `hello@elopementcollective.com` (create) | planner | Set `is_organiser = 1` (see below) |

This is also the better dogfood: TEC inviting MBJ onto a shared wedding exercises the
multi-party collaboration model the product is built around. A "switch business"
feature for one login is a future product idea, not a migration blocker.

**Shared weddings belong to TEC.** Couples that appear in both brands (TEC elopements
where Josh was the celebrant) get their wedding entity created by the TEC import only.
The MBJ copies of those contacts are imported without wedding creation and linked
afterwards (step 6).

**Not imported** (deliberate):
- **Form definitions / form actions / email sequences** — rebuild natively with Wedding
  Computer's forms + enquiry features; TARDIS automation (Xero, Buttondown, GitHub
  markdown, SMS) is operational plumbing, not data.
- **Submissions** — the parsed values already live on each contact; raw payloads stay
  in the TARDIS backup.
- **Invoices / payments** — Xero remains the financial record. `package_price` /
  `travel_fee` are kept on each contact (extra details). Optionally backfill paid
  invoices later (Wedding Computer supports non-Stripe historical invoices with
  `bank_transfer`/`payid` methods).
- **Elopement images** — Phase 2 (see bottom). Contacts with images get a
  `tardis_images` note in their extra details.
- **TARDIS vendor directory** — per-elopement vendor assignments are flattened into
  each contact's `assigned_vendors` extra detail. Re-invite active collaborators as
  real Wedding Computer vendors as new weddings come up.

## What the importer now does (built 2026-06-11)

- `source=tardis` preset maps the real TARDIS contact schema; unmapped columns are
  **kept as extra details** (`contacts.form_data`, shown on the contact page).
- Original `created_at` is preserved (lead-age analytics stay honest).
- **"Create weddings for booked contacts"** option (preview step): booked/completed
  contacts with a wedding date get a wedding (confirmed if future, completed if past),
  the vendor as managing member, a calendar booking, and the contact link.
  **No couple invites are sent, no user accounts are created** — verified end-to-end
  locally on 2026-06-11.

## Runbook

### 1. Pre-flight

- [ ] Backup Wedding Computer prod D1 (nightly backup also runs at 20:00 UTC —
      `joshwithers/wedding-computer-backups`; trigger a manual run or
      `wrangler d1 export wedding-computer-db --remote --output=pre-tardis-import.sql`
      with a CF token that has D1:Edit).
- [ ] TARDIS is the daily-backup source of truth — confirm last night's TARDIS backup
      in the `forms-backups` R2 bucket exists.
- [ ] Create the TEC account: log in at wedding.computer with
      `hello@elopementcollective.com` (magic link), onboard as
      **The Elopement Collective**, category **planner**, timezone Australia/Brisbane.
- [ ] Optional future-proofing (no app behaviour today):
      `wrangler d1 execute wedding-computer-db --remote --command "UPDATE vendor_profiles SET is_organiser = 1 WHERE business_name = 'The Elopement Collective'"`

### 2. Export from TARDIS prod

```bash
cd ~/Websites/wedding-computer
node scripts/tardis-export.mjs --brand tec --remote --out tardis-tec.json
node scripts/tardis-export.mjs --brand mbj --remote --out tardis-mbj.json --overlap-with tardis-tec.json
```

The second command writes `tardis-mbj.json` (MBJ-only couples) and
`tardis-mbj-overlap.json` (couples also in TEC, matched by either partner's email).
**Record the printed stats** — status breakdown, bookable count, date range — they are
the expected numbers for verification. Heed the warning about unbranded contacts: rows
with no `brand_id` are in neither file.

### 3. Dry run locally (recommended)

`npm run dev`, log in via `/dev/login/demo@wedding.computer`, import the real
`tardis-tec.json` at `/app/import/upload?source=tardis`, eyeball mapping/preview, tick
"Create weddings for booked contacts", import, and spot-check a few contacts and
weddings. Reset local data afterwards if you care.

### 4. Import TEC (production)

As `hello@elopementcollective.com`:
1. `/app/import/upload?source=tardis` → upload `tardis-tec.json`.
2. Mapping screen: defaults are correct (every TARDIS column is pre-mapped); continue.
3. Preview: tick **Create weddings for booked contacts** → Import.
4. Results page should show imported = the script's contact count, and weddings
   created = the script's "bookable" count.

### 5. Import MBJ (production)

As `josh@withers.co`:
1. Import `tardis-mbj.json` **with** "Create weddings" ticked (solo celebrant gigs).
2. Import `tardis-mbj-overlap.json` **without** the tick (TEC owns those weddings).

### 6. Cross-link shared weddings (the dogfood moment)

For each overlap couple, MBJ should sit on TEC's wedding as the celebrant:

- UI path (does a handful fine, exercises the product): as TEC, open the wedding →
  add vendor → `josh@withers.co`, role celebrant. Accept from the MBJ account.
- Batch path: match `tardis-mbj-overlap.json` couples to TEC weddings by couple email
  → `INSERT INTO wedding_members (wedding_id, user_id, role, vendor_profile_id,
  vendor_role, can_manage, status, accepted_at) VALUES (..., 'vendor', <MBJ profile>,
  'celebrant', 0, 'active', datetime('now'))` and point the MBJ contact's `wedding_id`
  at the TEC wedding. Write/verify against the local dry-run DB first.

### 7. Verify

- [ ] Contact counts per account match the script output (check `/app/contacts` totals
      and the import results page).
- [ ] Status pipeline distribution matches the script's breakdown (statuses are
      identical between systems — no values are remapped).
- [ ] Spot-check 3 contacts per account: extra details block (venue, package price,
      touchpoints, checklist), original created date, linked wedding.
- [ ] Calendar shows historical bookings; upcoming weddings appear on the dashboard.
- [ ] No stray invite emails went out (`email_queue` should have nothing new from the
      import window).
- [ ] MBJ GitHub vault sync (5-min cron) picks up the imported contacts/weddings —
      check `joshwithers/obsidian-joshwithersco-wedding-computer` for the new files.
- [ ] TARDIS stays read-only from here: point new enquiries at Wedding Computer
      enquiry forms/keys, then freeze TARDIS form actions when ready.

### Phase 2 — images

`elopement_images` live in TARDIS R2 (`forms-backups`). Each imported contact keeps its
TARDIS id in extra details (`id`), so images can be joined later:
copy objects to the Wedding Computer `STORAGE` bucket and insert `documents` rows
against the matching wedding (`rclone`/`wrangler r2 object get|put` + a small script).
Do this only if the historical galleries matter — TEC local count was 0; check prod
with `SELECT COUNT(*) FROM elopement_images` before bothering.
