# Scaling, Costs & Infrastructure

Living notes on how this app behaves as it grows: deferred performance work,
Cloudflare cost exposure, and how portable the stack is. See also
[CLAUDE.md](CLAUDE.md) (architecture) and the per-feature memory notes.

---

## Deferred follow-up: "truly instant" contact saves

**Status:** deliberately NOT built (2026-06-21). Documented here so we don't lose the thread.

### Where we are today
After the contact perf work (commit `00643b1`):

| | Read a contact | Save a contact (git-backed vault) | Save (R2 vault) |
|---|---|---|---|
| Now | D1 cache, ~5–10ms | **1 conditional PUT, ~200–400ms** | ~20–40ms |

Reads are served from the D1 index (`getContactCached`); a save merges from that
cache and writes **conditionally** on the indexed etag (one PUT, no read GET),
with atomic conflict detection (GitHub SHA precondition / R2 `onlyIf`).

### What "truly instant" would mean
The save returns the moment **D1** is written (~10–30ms); the GitHub/R2 PUT moves
to the background — the same model the timeline + wedding edits already use.

### Why it isn't trivial (the missing machinery)
There is **no contact push-sweep** today (`services/storage-push.ts` only pushes
*weddings*) and **no dirty flag** on `file_index`. So a deferred push that failed
would leave D1 silently ahead of storage with nothing to reconcile it → risk of
**silent data loss**, and a quick second save would conflict on a stale etag.
Building it safely needs:

1. A `dirty` / `pending-push` column on `file_index` (migration).
2. A **contact push-sweep** background job (push dirty rows, retry on failure).
3. Etag-chain handling so a second save before the push lands doesn't false-conflict.
4. **Background** conflict detection + a way to surface a conflict *after* the user
   already saw "saved" (conflicts become asynchronous; no data loss — both kept).

### Cost / benefit
- **Benefit:** ~200–400ms off each save **for git-backed vaults only** (R2 vendors
  are already ~instant). The stronger benefit is **reliability**: saves would
  succeed even when GitHub is slow/down, syncing when it recovers.
- **Cost:** ~½–1 day of data-integrity-sensitive sync-engine work, plus adversarial
  verification (the external-edit race is hard to test locally).

### When to build it
When git-backed vaults are common (today it's effectively one vendor), when GitHub
flakiness actually bites, or when "saves never fail" becomes a selling point.

---

## Cloudflare cost forecast at scale

Modelled 2026-06-21 from actual usage in the code (8 CF products in use: Workers,
D1, R2, KV, Queues, Workers AI, Email Routing inbound, Workers Logs). Pricing
verified against current Cloudflare docs (rates + arithmetic confirmed correct by
an adversarial pass). **Per active vendor / month** assumptions (tune freely —
totals scale linearly): ~1,500 authenticated requests, ~20 D1 rows-read/request,
200 saves, ~85 outbound emails; Workers AI only fires for the ~30% of vendors who
use an AI action *and* haven't supplied their own Anthropic key.

### Monthly bill (Cloudflare only)

| Product | 1,000 vendors | 5,000 | 10,000 | Notes |
|---|---|---|---|---|
| Workers (base+CPU+req) | $5 | $6 | $10 | $5 floor until ~10k |
| **Workers AI** | **$16** | **$92** | **$187** | optional; collapses to ~$0 with BYO keys |
| R2 (Class-A writes + storage) | $1 | $24 | $52 | reads never bill; **egress is free** |
| D1 | $0 | $0 | $0 | 300M reads at 10k is ~80× under the free 25B |
| KV | $0 | $0 | $4 | |
| Queues | $0 | $1 | $1 | |
| Email Routing (inbound) | $0 | $0 | $0 | free |
| Workers Logs | ~$0 | ~$0 | ~$0 | under 20M free; 100% sampled — bills first if requests grow |
| **Cloudflare total** | **~$22** | **~$122** | **~$254** | **~2–3¢ per vendor/mo** |
| *+ Resend (external email)* | *~$90* | *~$350* | *~$650* | *the largest single line; not Cloudflare* |
| **All-in** | **~$112** | **~$472** | **~$904** | |

### Caveats (from the adversarial pass — keep the numbers honest)
- **The request count is under-counted.** The model only counts authenticated
  *vendor* page loads. It omits CalDAV/CardDAV/iCal device-sync polling, the
  *couple*-facing app, and public/API traffic (directory, enquiry, MCP, vault).
  Real blended load is higher, which pushes Workers CPU-ms + Logs up and brings
  the 10M-request threshold sooner. **Partly offset:** R2 Class-A is *over*-counted
  — `writeCompanion` skips unchanged files (a typical edit writes ~2 objects, not
  6), and the 5-min sync sweep only touches *git* vendors, not the R2 default.
  Net: treat the CF subtotals as **order-of-magnitude right**; the one assumption
  most worth re-estimating is all-surfaces request volume.

### Top cost drivers (ranked)
1. **Workers AI** — the #1 Cloudflare line, and almost entirely *controllable* (it's
   the no-BYO-key llama-3.3-70b fallback, billed ~8× more for output tokens).
2. **Resend** — the largest line on the whole bill, but **external** (driven by the
   daily per-vendor digest fan-out).
3. **R2 Class-A writes** — the only core CF product that meaningfully bills (~6 PUTs
   per save before the unchanged-file skip).
4. **Workers base/overage** — effectively the $5 floor until ~10k.
   *Negligible at every tier: D1, KV, Queues.* The intuition holds — Workers/D1/R2/KV
   are cheap, R2 egress is free, and the money is in AI (optional) + email (external).

### Where it stops being cheap — and the caps
1. **Workers AI runaway** (bulk CSV/URL import, run-sheet gen). Cap: require BYO
   Anthropic key for heavy actions, hard-limit free AI actions/vendor/day, keep
   `max_tokens` tight. This is the difference between ~$20 and ~$250+/mo of CF at 10k.
2. **Daily digest fan-out** — `SELECT id FROM vendor_profiles` is unsharded
   ([index.tsx](src/index.tsx)) and emails *every* vendor incl. dormant. Cap: shard
   it like the 5-min sync, suppress digests for inactive accounts, offer weekly/opt-out.
3. **R2 write fan-out** on write-heavy vendors (folder renames move every companion).
   Cap: push only changed files; coalesce rapid edits.
4. **D1 row-read amplification** — doesn't bill (25B free is enormous) but raises
   CPU-ms + latency. Fix the wedding-detail double-fetches and gate `needsMigration`'s
   2 COUNTs (run on every contacts-list load) behind a flag.

---

## Infrastructure portability

**Verdict: 7/10 — moderately portable, leaning easy. No hard, irreplaceable
Cloudflare lock-in.** Entry point is a plain `export default { fetch, queue, email,
scheduled }`; zero Durable Objects, zero `cloudflare:workers` imports, no Hono CF
adapter, `request.cf` unused, every binding a thin isolated dependency. A port to
**Node/Bun + libSQL(Turso) + S3 + Redis + a queue (BullMQ/SQS)** is **~3–5 weeks of
mechanical work, not a rewrite.**

### Difficulty by dependency
- **Trivial:** Workers AI (3 sites, all already have an Anthropic HTTP fallback) ·
  KV → Redis `SETEX/GET/DEL` 1:1 (code already tolerates eventual consistency) ·
  cron → node-cron · `waitUntil` (~33 sites) → no-op on a long-lived server.
- **Easy/moderate:** R2 → one S3 class behind the existing `StorageBackend` interface
  (but **~10 sites bypass it** for binary blobs — avatars, file up/download, logos,
  form files — each needs an individual S3 swap) · Queues → SQS/BullMQ.
- **Moderate:** D1 and the inbound email handler.

### The three hardest parts
1. **D1 → Postgres — *only if you choose Postgres.*** The query layer is hand-rolled
   raw SQLite SQL with no ORM, so **libSQL/Turso is near-verbatim**. Postgres is the
   expensive fork: `lower(hex(randomblob(12)))` ID defaults (52 of them), the
   `unicode(substr(id,-1,1)) % ?` cron shard filter, `json_extract(cached_data,…)`
   used for indexed contact search, and 14 `db.batch()` sites that rely on D1's
   implicit-transaction semantics. **This is the single biggest fork in migration cost.**
2. **The inbound `email()` handler** — the most Cloudflare-shaped piece. Mail arrives
   as a runtime `ForwardableEmailMessage` (`.to/.raw/.rawSize/.setReject`). Off-CF you
   swap it for an inbound-MIME webhook (Resend Inbound / Mailgun / SES→SNS) feeding the
   *same* parser; only the transport envelope changes.
3. **Queue idempotency** (the adversarial catch). The email handlers `ack()` after
   sending with no dedup, trusting Cloudflare's low redelivery rate + a stable
   `msg.id` (used as Resend's idempotency key for broadcasts). SQS/BullMQ redeliver
   more aggressively, so you must add an explicit per-send idempotency key or vendors
   get duplicate notification emails. Also preserve the 5-min cron-boundary alignment
   the shard math depends on.

### To preserve optionality cheaply (without paying for it now)
- Funnel the ~10 direct `c.env.STORAGE` bypass sites through `StorageBackend` —
  cheapest portability win, and tidies the code.
- If a move is ever likely, target **libSQL/Turso, not Postgres** — it makes the
  largest migration cost nearly vanish.
- Keep inbound-email parsing decoupled from the `ForwardableEmailMessage` envelope
  (it mostly is).

**Bottom line:** the platform is *very* cheap (≈2–3¢ of Cloudflare per vendor/month
at every tier) and genuinely portable (weeks, not a rewrite). Spend governance
effort on **Workers AI and email**, not on the core Workers/D1/R2/KV stack — that
will not be what binds you, technically or financially.

