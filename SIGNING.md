# Collaborative PDF Signing — Maintainer Guide

Celebrants (officiants) collect wet signatures on a PDF from the couple, then add their own, producing a final signed PDF kept as a **celebrant-only private** wedding document. Sequential, not real-time. The couple **cannot sign until the celebrant releases the session and witnesses them** — either same-device (hand the tablet over) or on the couple's own logged-in device (released live, with the celebrant present in person or on a call). There is **no unsupervised remote path** and the **couple receives no copy** — the signed PDF is the celebrant's private record.

**Legal stance (do not edit copy to contradict):** a digital wet signature is a valid substitute for in-person NOIM signing. There is **no** "not a legal substitute" disclaimer anywhere, and none should be added. Per-turn evidentiary metadata (signer user id, IP, timestamp, in-person flag) IS captured.

The signer **chrome** (buttons, status pages, prompts) is fully internationalised via the i18n `t()` layer — keys live in `src/i18n/en/signing.ts` (`signing.*`) and are translated in all 9 other language files. The **NOIM document content itself** stays English (it's the prescribed Australian legal form). Client-side annotator strings (alerts, page label, "Saved") are rendered server-side with the viewer's locale and passed into the inline script via `config.strings` — never hardcode user-facing text inside `ANNOTATOR_JS`; add a `signing.*` key and thread it through `config.strings`.

## End-to-end flow

1. Celebrant starts a session — either by uploading a PDF (`POST /app/weddings/:weddingId/sign/new`) or via the NOIM shortcut (`POST /app/forms/:id/submissions/:subId/send-for-signing`). Both call `startSigningSessionFromBytes()` in `src/routes/signing.tsx`. Status `awaiting_couple`, `couple_released = 0`.
2. The celebrant's session page offers two ways to witness the couple: **hand the device over** (`?act=handoff`, renders the couple annotator on the celebrant's own browser, signed via `save-couple`) or **release** (`POST .../release` sets `couple_released = 1`) so the couple signs on their **own logged-in device** while the celebrant watches. Until released, the couple's screen is a locked "ready when your celebrant is" page that polls (`autoRefreshSeconds`). The celebrant can `POST .../lock` to re-lock before they sign.
3. Couple signs — `POST /wedding/:weddingId/sign/:sessionId/save` (own device; **requires `couple_released = 1`**) or `POST /app/weddings/:weddingId/sign/:sessionId/save-couple` (in-person handoff, no release needed — the celebrant is operating). Strokes are burned onto the PDF → `couple.pdf`. Status → `awaiting_celebrant` (so it naturally re-locks). Celebrant is emailed (a backup; signing is live).
4. Celebrant signs — `POST /app/weddings/:weddingId/sign/:sessionId/save-celebrant`. Strokes burned → `final.pdf`, a `documents` row is created (`visibility='private'`, `category='signed'`), status → `complete`, and the couple is emailed a confirmation (no link — they get no copy).

There is currently **no expiry / TTL** on a signing session and **no UI path that cancels one** — `cancelSigningSession()` exists in `src/db/signing.ts` but no route calls it, so the `'cancelled'` status (and its "Signing cancelled" page) is effectively unreachable today. Don't document an expiry window that doesn't exist.

## Data model

### Table — `migrations/077-document-signing.sql` (mirrored in `schema.sql`)

`document_signing_sessions` (additive CREATE only — no table rebuild, since prod D1 enforces FKs during migrations):

| Column | Notes |
|---|---|
| `id` | `lower(hex(randomblob(12)))` |
| `wedding_id` | → `weddings(id)` `ON DELETE CASCADE` |
| `vendor_id` | → `vendor_profiles(id)` — the owning celebrant |
| `created_by_user_id` | → `users(id)` |
| `source_kind` | `CHECK IN ('upload','noim')` |
| `source_ref` | `form_submission.id` for NOIM, else NULL |
| `title` | document title |
| `source_r2_key` | original PDF (never changes) |
| `current_r2_key` | latest burned version; starts == `source_r2_key` |
| `couple_signed_r2_key` | snapshot the couple may re-download (set when couple signs) |
| `final_document_id` | → `documents(id)`, set on `complete` |
| `status` | `CHECK IN ('awaiting_couple','awaiting_celebrant','complete','cancelled')`, default `'awaiting_couple'` |
| `couple_signed_at` / `couple_signed_by_user_id` / `couple_signed_in_person` / `couple_signed_ip` | evidentiary metadata; `couple_signed_in_person=1` means celebrant-facilitated on their device |
| `celebrant_signed_at` / `celebrant_signed_ip` | evidentiary metadata |
| `couple_released` / `couple_released_at` | **migration 078** — live witness gate. `couple_released=1` (set by the celebrant) lets the couple sign; `couple_released_at` stamps when. Re-locks once they sign (status leaves `awaiting_couple`); celebrant can also lock again. |
| `created_at` | `datetime('now')` |

`couple_signed_r2_key` still stores the couple-signed intermediate (the celebrant draws on it); the couple is **not** given any route to download it.

Indexes: `idx_signing_sessions_wedding(wedding_id)`, `idx_signing_sessions_vendor(vendor_id)`.

Type: `DocumentSigningSession` in `src/types.ts`. `couple_signed_in_person` is `number` (0/1).

### DB layer — `src/db/signing.ts`

- `createSigningSession()` — inserts, with `current_r2_key` bound equal to `source_r2_key`.
- `getSigningSessionForMember(db, sessionId, userId)` — returns the session only if the user is an **active** `wedding_members` row on its wedding (avoids a 403-vs-404 oracle). Turn / owning-celebrant checks are layered on top by callers.
- `getSigningSessionById(db, sessionId)` — **unscoped**; only for server-side jobs (notifications) that already established trust. Never call from a request handler without an auth check.
- `listSigningSessionsForWedding(db, weddingId)` — all non-cancelled sessions, newest first.
- `recordCoupleSigned()` / `recordCelebrantSigned()` — status-guarded transitions (see below).
- `setCoupleReleased(db, sessionId, vendorId, released)` — vendor-scoped; flips `couple_released` (stamping `couple_released_at` on release), only while `status='awaiting_couple'`.
- `cancelSigningSession(db, sessionId, vendorId)` — vendor-scoped soft cancel; not wired to any route yet.

## R2 key layout

```
weddings/{weddingId}/signing/{uuid}/source.pdf   -- original (source_r2_key)
weddings/{weddingId}/signing/{uuid}/couple.pdf   -- after couple signs (current + couple_signed)
weddings/{weddingId}/signing/{uuid}/final.pdf    -- after celebrant signs (current)
```

`{uuid}` = `crypto.randomUUID()`, fixed for the session's life. `siblingKey()` (`src/routes/signing.tsx`) derives `couple.pdf` / `final.pdf` by replacing only the trailing `source.pdf` — R2 has no rename, so the prefix is stable. PDFs are read/written through `c.env.STORAGE` (R2) directly in this feature, not via the higher-level `src/storage/` markdown layer.

## Routes & turn/auth — `src/routes/signing.tsx`

Mount guards:
```
signing.use('/wedding/:weddingId/sign/*', requireAuth, csrf)
signing.use('/app/weddings/:weddingId/sign/*', requireAuth, csrf, requireVendor)
```

**Couple surface** (`requireAuth` + `csrf`; membership `role === 'couple'` checked per handler):

| Route | Method | Guard / condition |
|---|---|---|
| `/wedding/:weddingId/sign/:sessionId` | GET | member of wedding; if `awaiting_couple` + `couple_released` → annotator, else a locked/status page (locked page polls via `autoRefreshSeconds`). Non-couple members get a "Signing link" notice. |
| `/wedding/:weddingId/sign/:sessionId/pdf` | GET | couple member **and `couple_released=1`**; serves `current_r2_key` inline |
| `/wedding/:weddingId/sign/:sessionId/save` | POST | couple member, `status='awaiting_couple'`, **`couple_released=1`**, valid strokes, PDF loads |

There is **no couple download route** — the couple does not receive a copy.

**Celebrant surface** (`requireAuth` + `csrf` + `requireVendor`; `ownedSession()` enforces `hasCategory(vendor,'celebrant')` AND `session.vendor_id === vendor.id`):

| Route | Method | Guard / condition |
|---|---|---|
| `/app/weddings/:weddingId/sign/:sessionId` | GET | owned session. `awaiting_couple` → release/handoff prompt (released state shows "Lock again" + polls); `?act=handoff` → couple annotator on this device; `awaiting_celebrant` → celebrant annotator; `complete` → status page with View/Download |
| `/app/weddings/:weddingId/sign/:sessionId/pdf` | GET | owned session; serves `current_r2_key` inline (any status) |
| `/app/weddings/:weddingId/sign/:sessionId/release` | POST | owned session, `status='awaiting_couple'`, not already released; sets `couple_released=1` |
| `/app/weddings/:weddingId/sign/:sessionId/lock` | POST | owned session, `status='awaiting_couple'`, released; sets `couple_released=0` |
| `/app/weddings/:weddingId/sign/:sessionId/save-couple` | POST | owned session, `status='awaiting_couple'` (in-person handoff; sets `inPerson:true`; no release needed) |
| `/app/weddings/:weddingId/sign/:sessionId/save-celebrant` | POST | owned session, `status='awaiting_celebrant'`; creates the final `documents` row |
| `/app/weddings/:weddingId/sign/new` | POST | celebrant + on the wedding (`membership.vendor_profile_id === vendor.id`); PDF, `0 < size ≤ 10 MB` |

`startSigningSessionFromBytes()` is exported and reused by the NOIM shortcut in `src/routes/vendor/forms.tsx`. The caller authorises the celebrant + membership first.

## State machine — status-guarded writes

`recordCoupleSigned()` and `recordCelebrantSigned()` UPDATE with a `WHERE id = ? AND status = '<expected>'` clause and return `true` only if `meta.changes > 0`. Concurrent double-saves no-op: the first wins, the second matches 0 rows and the route returns 409. No locks/transactions — SQLite applies the guard atomically. Callers MUST check the boolean and return 409 on `false`.

- `recordCoupleSigned`: `awaiting_couple → awaiting_celebrant`; sets `current_r2_key`, `couple_signed_r2_key`, and all couple evidentiary columns.
- `recordCelebrantSigned`: `awaiting_celebrant → complete`; sets `current_r2_key`, `final_document_id`, celebrant evidentiary columns. The `documents` row is created **before** this UPDATE; if the UPDATE no-ops (lost race) the route returns 409 (an orphan final.pdf/documents row can result — acceptable, but note it if you harden this path).

## PDF rendering & annotation

### Self-hosted pdf.js — `src/lib/assets.ts`

`PDFJS_VERSION = '3.11.174'` (last UMD build; v4+ is ESM). Served same-origin at `/assets/pdfjs-3.11.174.min.js` and `.worker.min.js` (mapped via `VERSIONED_ASSETS`, cache-busted with `ASSET_VERSION`). Same-origin keeps the worker within `worker-src 'self'` — no CSP directive changes. The `<script>` is nonced (`getCspNonce()`); `pdfjsLib.GlobalWorkerOptions.workerSrc` is set at runtime to `PDFJS_WORKER_SRC`.

### Annotator — `src/views/sign-pdf.tsx`

Full-page self-contained UI (its own minimal chrome, not the app/couple nav) for max screen on phones/tablets. Two stacked canvases: `#pdf-canvas` (pdf.js render) and `#ink-canvas` (freehand). Inline config is passed via a `application/json` script block; the annotator JS and `<style>` are nonced.

Stroke model: `strokes[pageIndex0based] = [{ color, width, pts: [[nx,ny], …] }]`. `pts` are normalized [0..1] against the **visible** (rendered, rotation-aware) canvas, top-left origin, y-down. `width` = `PEN_CSS(2.4px) / visibleCanvasWidth`. Normalization keeps strokes resolution- and zoom-independent. Save POSTs `{ strokes }` with `x-csrf-token`; on `{ ok, redirect }` it shows a brief "Saved ✓" overlay (`#sign-overlay` + tick) then navigates, else surfaces the error in the inline `#sign-banner` (not a browser `alert()`). The empty-save guard also uses the banner. All these strings come from `config.strings` (localised).

Pointer detail: `pointerleave` deliberately does **not** end a stroke for touch/pen (a finger/stylus may briefly leave the canvas mid-signature); mouse ends normally via `pointerup`.

### Stroke burning — `src/forms/signing/burn.ts`

`burnStrokes(pdfBytes, strokesByPage)` uses **pdf-lib** to draw each stroke as round-capped line segments. Per page it reads the unrotated size (`getSize()`) and `/Rotate` angle, computes `visibleW` (= H for 90/270, else W) for thickness scaling, and maps each normalized point to PDF user space (origin bottom-left, y-up) via `toUserSpace(nx, ny, W, H, angle)` which has a distinct transform per 0/90/180/270. Thickness = `max(0.5, width * visibleW)`. A global budget of `MAX_TOTAL_POINTS = 60_000` caps Worker CPU/memory; once exhausted it returns the PDF as-is. Coordinate math is unit-tested in `src/forms/signing/burn.test.ts` (all four rotations, corner mappings).

## Notifications & email

`notifyDocumentReady(env, { sessionId, event })` in `src/services/notifications.ts` (called from the queue consumer; payload `type:'notify_document_ready'`). It loads the session unscoped via `getSigningSessionById`, then the wedding + vendor.

Signing is witnessed live, so these are backups/records, not the primary nudge. There is **no** "please sign" email to the couple — the celebrant releases each turn while they're together.

| `event` | Recipient | Notification key | Template (`src/services/email.ts`) | Link |
|---|---|---|---|---|
| `awaiting_celebrant` | owning celebrant | `vendor_collaboration` | `documentAwaitingCelebrantEmail` | `/app/weddings/:id/sign/:sid` (CTA "Add your signature") |
| `completed` | each couple member | `wedding_updates` | `documentSignedEmail` | **no CTA / no link** — the couple gets no copy |

Deliveries go through `deliver()` (preference-gated, signed unsubscribe link, never throws unless a retryable `EmailSendError`). All templates `esc()` user data and carry no legal disclaimer.

Queue sends (`c.env.EMAIL_QUEUE.send`): after couple signs → `awaiting_celebrant`; after celebrant signs → `completed`. The consumer branch is `notify_document_ready` in `src/index.tsx`.

## Entry points & UI surfaces

- **Upload** — `WeddingSigning` block in `src/routes/vendor/weddings.tsx`, rendered inside `WeddingFiles` only when `isCelebrant`. Lists non-cancelled sessions with status badges and an upload form posting to `/app/weddings/:id/sign/new`.
- **NOIM shortcut** — `src/routes/vendor/forms.tsx`: a "Send for signing" button on a NOIM submission (only when `sub.wedding_id` is set; otherwise a disabled hint). `POST .../send-for-signing` regenerates the NOIM PDF (`noimPdfResponse`), then `startSigningSessionFromBytes(... sourceKind:'noim', sourceRef:sub.id, title:'Notice of Intended Marriage')`.
- **Couple dashboard** — `src/routes/couple.tsx`: lists `awaiting_couple` sessions as a prominent "Your signature is needed" card linking to `/wedding/:id/sign/:sid`.

## Access control

- Couple: GET `/pdf` and POST `/save` BOTH require `couple_released=1` (the witness gate) on top of couple membership + `status='awaiting_couple'`. **No download route** — the couple receives no copy.
- Celebrant (owning): GET `/pdf` (current, any status), `release` / `lock` (`awaiting_couple`), `save-couple` (in-person, `awaiting_couple`), `save-celebrant` (`awaiting_celebrant`).
- **Final PDF** is a `documents` row with `visibility='private'`; it is reachable only via `/files/:id` and `/files/:id/download`, which enforce document visibility (`canUserAccessDocument`). The couple is **never** given a route to `final.pdf` (or to `couple.pdf`) and gets 403 on the files endpoint. The signed PDF is the celebrant's private record only.

## Audit log

`auditLog()` records: `signing_session_created`, `signing_released`, `signing_locked`, `signing_couple_signed` (with `in_person`), `signing_celebrant_signed`, `signing_completed`.

## Extending

- **New source type:** widen the `source_kind` CHECK in a new migration + `schema.sql`, update the `DocumentSigningSession` union in `src/types.ts`, and call `startSigningSessionFromBytes()` with the new kind (store a back-reference in `source_ref`). Add a UI entry point.
- **New signer/turn (e.g. witness):** add `witness_signed_*` columns and an `awaiting_witness` status (via migration; remember prod D1 enforces FKs so CHECK-widening rebuilds fail — keep additive), add a status-guarded `recordWitnessSigned()`, a `save-witness` route, a new email template/event, and a status page. `burnStrokes()` needs no change.
- **Captured fields beyond strokes:** extend the POST body and `readStrokes()` parsing, optionally `page.drawText()` in burn, and persist queryable values on the session row.

## Limits

- PDF upload ≤ 10 MB; `application/pdf` only.
- Stroke budget 60,000 points per burn call.
- Up to 3 PDFs per session in R2 (source / couple / final).

## Debugging quick hits

| Symptom | Look at |
|---|---|
| Blank canvas / no PDF | `current_r2_key` exists in R2; pdf.js fetch (`getDocument`, withCredentials) in `sign-pdf.tsx`; worker URL same-origin |
| Strokes mis-positioned on rotated PDF | `toUserSpace()` angle handling in `burn.ts` vs `page.getRotation().angle` |
| Couple signs but celebrant sees old PDF | `recordCoupleSigned` set `current_r2_key=couple.pdf`; `burnStrokes` returned; couple.pdf in R2 |
| Final PDF missing from wedding | `createDocument` ran with `category:'signed'`, `visibility:'private'`; `final_document_id` set by `recordCelebrantSigned` |
| Couple can open final PDF | `visibility:'private'` on the documents row; files endpoint visibility check |
| Couple stuck on the locked "ready when your celebrant is" screen | `couple_released` is still 0 — the celebrant must POST `/release`; the page polls via `autoRefreshSeconds` and unlocks once released |
| Couple's `/save` returns 403 | witness gate: `couple_released=0`. Celebrant must release first |
| CSP error loading pdf.js worker | worker must be same-origin (`/assets/...worker.min.js`); never point `workerSrc` at a CDN |
