# Subscribable Contacts on a Cloudflare Worker (CardDAV)

This document explains how the `forms-backend` worker (`your-worker.example.com`) exposes
its contacts so they can be **subscribed to** from the iOS / macOS Contacts app and
kept in sync automatically. It is written so another Cloudflare Worker project can
copy the approach.

There are two distinct features here — pick whichever you need (or both):

1. **Static single-contact card** — a `/contact.vcf` download. Trivial. Good for a
   "save my details" button on a website. Not subscribable / not synced.
2. **Read-only CardDAV address book** — a full CardDAV server at `/carddav/...` that
   iOS/macOS can add as an *account* and sync continuously. This is the real feature.

The CardDAV server is **read-only**: the CRM database is the source of truth, and the
phone/Mac just mirrors it. Writes (`PUT`/`DELETE`/`PATCH`/`MKCOL`) are rejected with 403.

---

## 1. The easy one: a static `.vcf` download

A vCard is just text. Serve it with the right content type and a
`Content-Disposition` so the browser offers to add it to Contacts.

```ts
// src/assets/contact-vcf.ts
export const SAMPLE_VCF = `BEGIN:VCARD
VERSION:3.0
N:Doe;Jane;;;
FN:Jane Doe
ORG:Jane Doe Weddings;
EMAIL;type=INTERNET;type=pref:jane@example.com
TEL;type=pref:+61 400 123 456
URL:https://example.com
END:VCARD`
```

```ts
// in src/index.tsx
import { JOSH_VCF } from './assets/contact-vcf'

app.get('/contact.vcf', (c) => {
  return new Response(JOSH_VCF, {
    headers: {
      'Content-Type': 'text/vcard',
      'Content-Disposition': 'attachment; filename="Jane Doe.vcf"',
      'Cache-Control': 'public, max-age=86400',
    },
  })
})
```

That's the whole feature. It downloads a card; it does not sync. Everything below is
about the subscribable, syncing version.

---

## 2. The real one: a read-only CardDAV address book

### What "subscribe" means here

CardDAV is a WebDAV extension (RFC 6352). The iOS/macOS Contacts app can add a
**CardDAV account** pointing at your server. From then on the OS periodically syncs:
it asks "has anything changed?" (via a CTag), and if so pulls the changed cards. Your
worker answers a handful of WebDAV verbs (`OPTIONS`, `PROPFIND`, `REPORT`, `GET`) over
HTTPS with XML bodies. No client library needed — it's just HTTP + XML + vCard text.

### The URL hierarchy the client walks

Apple's client discovers everything by walking a tree of collections. You must
implement each level:

```
/.well-known/carddav                      → RFC 6764 autodiscovery (points to principal)
/                                          → root probe (also points to principal)
/carddav/                                  → points to principal
/carddav/principals/user/                  → the "principal"; advertises addressbook-home-set
/carddav/addressbooks/user/                → the home set; lists available address books
/carddav/addressbooks/user/crm/            → the address book collection itself
/carddav/addressbooks/user/crm/<UID>.vcf   → an individual contact card
```

The client typically does: probe `/.well-known/carddav` → follow to principal → read
`addressbook-home-set` → `PROPFIND` the home set to find books → `PROPFIND` the `crm/`
book (Depth 0) to read its CTag → if CTag changed, `PROPFIND` Depth 1 (or `REPORT`) to
get every card's href + ETag → `REPORT addressbook-multiget` to fetch the card bodies
that changed.

### Sync tokens you must understand

- **CTag** (`CS:getctag`) — a hash of the *whole collection's* state. The client reads
  it cheaply; if it's unchanged since last sync, the client does nothing. We compute it
  as `SHA-256(count : MAX(updated_at))` truncated to 8 bytes. Any insert/update/delete
  changes the count or the max timestamp, which changes the CTag, which triggers a sync.
- **ETag** (`D:getetag`) — per-card version. The client uses it to fetch only the cards
  that changed. We build it from the row id + `updated_at`.

These are the entire sync engine. There is no push; the OS polls on its own schedule
(you can force it by pull-to-refresh in Contacts, or removing/re-adding the account).

---

## 3. Files involved in this project

| File | Role |
|------|------|
| `src/routes/carddav.ts` | The whole CardDAV server: auth, PROPFIND/REPORT/GET handlers, vCard generation, sync tags. Mounted at `/carddav`. |
| `src/index.tsx` | Root-level discovery handlers (`/.well-known/carddav`, `PROPFIND /`, `PROPFIND /carddav/`) that **cannot** live inside the sub-router, plus the `app.route('/carddav', cardDavRoutes)` mount and the static `/contact.vcf`. |
| `src/types.ts` | Adds `CARDDAV_USER` / `CARDDAV_PASS` to `Bindings`. |
| `wrangler.toml` | D1 binding + custom domain. Secrets set via `wrangler secret put`. |
| `schema.sql` | The `contacts` table the address book reads from. |

### Why some handlers live in `index.tsx` and not the sub-router

Apple's client probes a few paths **before** auth and **at the server root**, and it
does *not* reliably follow 301 redirects for `PROPFIND`. So these must be answered at
the top level, outside the `/carddav` Hono sub-router (which also has a trailing-slash
quirk for its own mount path):

- `PROPFIND /.well-known/carddav` — **no auth** (iOS's first probe is unauthenticated;
  requiring auth makes it give up before discovery). Returns principal location.
- `GET /.well-known/carddav` — 301 redirect to the principal (for browsers).
- `PROPFIND /` — **no auth**; root probe per RFC 6764 §6. Returns principal location.
- `PROPFIND /carddav` and `/carddav/` — authed; returns principal location.

Everything deeper (`/carddav/principals/...`, `/carddav/addressbooks/...`) is handled
inside `src/routes/carddav.ts`.

---

## 4. Authentication

HTTP **Basic Auth** over HTTPS, checked against two secrets. That's all Apple's client
needs and supports cleanly for this use case.

```ts
function checkAuth(authHeader: string | undefined, user: string, pass: string): boolean {
  if (!authHeader?.startsWith('Basic ')) return false
  try {
    const decoded = atob(authHeader.slice(6))
    const colonIdx = decoded.indexOf(':')
    if (colonIdx < 0) return false
    return decoded.slice(0, colonIdx) === user && decoded.slice(colonIdx + 1) === pass
  } catch {
    return false
  }
}

function unauthorized(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="CardDAV"', ...DAV_HEADERS },
  })
}
```

Note `indexOf(':')` rather than `split(':')` — passwords may contain colons. Use a long
random password; there is no rate limiting on Basic Auth here, so the password is your
only protection. (Cloudflare's platform sits in front, but treat the password as the
secret.)

Set the secrets:

```bash
wrangler secret put CARDDAV_USER
wrangler secret put CARDDAV_PASS
```

---

## 5. The DAV headers every response needs

```ts
const DAV_HEADERS = {
  DAV: '1, 3, addressbook',                          // advertise CardDAV capability
  Allow: 'OPTIONS, GET, HEAD, PROPFIND, REPORT',
  'MS-Author-Via': 'DAV',
}
```

`OPTIONS *` returns 204 with these headers; the client uses it to confirm the server
speaks `addressbook`.

---

## 6. Required correctness details (these are the things that break)

These are the non-obvious bits that took iteration to get right. Copy them exactly.

### 6a. vCard line folding — count **bytes**, not characters (RFC 6350 §3.2)

vCard lines must be ≤ 75 octets, with continuation lines starting with a single space.
You **must** fold on UTF-8 byte boundaries, never mid-codepoint, or emoji/accents
corrupt the stream.

```ts
function foldLine(line: string): string {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(line)
  if (bytes.length <= 75) return line

  const chunks: string[] = []
  let offset = 0
  let isFirst = true

  while (offset < bytes.length) {
    const maxBytes = isFirst ? 75 : 74 // continuation lines lose 1 byte to the leading space
    let end = Math.min(offset + maxBytes, bytes.length)
    // Don't split inside a multi-byte UTF-8 sequence:
    // continuation bytes are 10xxxxxx (0x80..0xBF)
    while (end > offset && end < bytes.length && (bytes[end] & 0xC0) === 0x80) {
      end--
    }
    const chunk = new TextDecoder().decode(bytes.slice(offset, end))
    chunks.push(isFirst ? chunk : ' ' + chunk)
    offset = end
    isFirst = false
  }
  return chunks.join('\r\n')
}
```

### 6b. vCard value escaping (RFC 6350 §3.4)

Escape backslash, newline, comma, semicolon **in values** (not in the structural
separators of `N:`/`ORG:`):

```ts
function escVCard(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}
```

### 6c. Line endings and trailing CRLF

vCards use **CRLF** between lines (`lines.join('\r\n')`) and a trailing `\r\n` at the
end of the card.

### 6d. XML escaping

All dynamic text injected into the WebDAV XML (hrefs, etags, **and the embedded vCard
inside `<C:address-data>`**) must be XML-escaped:

```ts
function escXml(str: string | null | undefined): string {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
```

### 6e. Always send an explicit `Content-Length`

Compute it from the encoded bytes, not the string length:

```ts
function xmlResponse(xml: string, status = 207): Response {
  const body = new TextEncoder().encode(xml)
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Content-Length': String(body.byteLength),
      ...DAV_HEADERS,
    },
  })
}
```

### 6f. macOS needs `current-user-privilege-set`

Without an explicit read-privilege block on the address-book collection, macOS decides
it has no access and silently skips the book:

```ts
const PRIVILEGE_SET = `<D:current-user-privilege-set>
  <D:privilege><D:read/></D:privilege>
  <D:privilege><D:read-current-user-privilege-set/></D:privilege>
</D:current-user-privilege-set>`
```

### 6g. Advertise the reports you support

```ts
const SUPPORTED_REPORT_SET = `<D:supported-report-set>
  <D:supported-report><D:report><C:addressbook-multiget/></D:report></D:supported-report>
  <D:supported-report><D:report><C:addressbook-query/></D:report></D:supported-report>
</D:supported-report-set>`
```

### 6h. Return unknown PROPFIND props as 404, not by omitting them

When a client asks for props you don't support, return them in a separate `propstat`
with `HTTP/1.1 404 Not Found` so iOS knows they're unsupported (rather than retrying).
See `buildPropfindResponse` / `mapPropName` in `carddav.ts`.

### 6i. SQLite variable limit

D1/SQLite caps bound variables at 999. When fetching cards by id for a multiget, batch
the `IN (...)` lists (this project uses `DB_BATCH = 99`).

---

## 7. The request handlers (what each verb returns)

All of these live in `src/routes/carddav.ts`, mounted at `/carddav`.

### `OPTIONS *`
204 + `DAV_HEADERS`. Capability probe.

### Block writes
`PUT`/`DELETE`/`PATCH`/`MKCOL` → 403 "Read-only address book".

### `PROPFIND /principals/user/`
Returns the principal: `resourcetype = collection + principal`, `current-user-principal`,
`principal-URL`, and crucially `C:addressbook-home-set → /carddav/addressbooks/user/`.

### `PROPFIND /addressbooks/user/`
Lists the home set and the one address book inside it (`crm/`), with its CTag,
`supported-address-data` (vCard 3.0), supported reports, privilege set and owner.

### `PROPFIND /addressbooks/user/crm/`
- **Depth 0** → collection properties only (CTag). The client reads the CTag and stops
  if nothing changed.
- **Depth 1** → collection props **plus** one `<D:response>` per card (href + ETag +
  content-type, no body). This is the card listing.

### `REPORT /addressbooks/user/crm/`
Two shapes, detected by sniffing the body:
- `addressbook-multiget` → body contains specific `<href>`s; parse them, fetch those
  rows, and return each card **with its body** in `<C:address-data>`.
- `addressbook-query` → return **all** cards with bodies.

### `GET /addressbooks/user/crm/<UID>.vcf`
Returns a single card body with `Content-Type: text/vcard; charset=utf-8`, an `ETag`,
and `DAV_HEADERS`.

---

## 8. The data model and a useful pattern: one row → two cards

In this project the `contacts` table stores a *couple* (a wedding client and their
partner) in one row. The CardDAV layer expands each active row into **one or two**
vCards:

- The **primary** card always: UID = `<row id>`, href `<id>.vcf`.
- A **partner** card *conditionally*: UID = `<row id>-partner`, href `<id>-partner.vcf`.
  Only emitted when the booking is `booked`/`completed` **or** the partner has their own
  email/phone. Otherwise the partner's name is folded into the primary card's NOTE.

This "synthetic second card from one row" trick is worth understanding because it shows
how UIDs/hrefs are *derived* rather than stored: the GET/REPORT handlers detect the
`-partner` suffix, strip it (`raw.slice(0, -8)`), load the base row, and build the
partner card on the fly. If your own data is one-contact-per-row, ignore all of this and
just emit a single card per row.

**Which rows are visible** is controlled by one shared SQL filter so the listing, the
CTag, and the single-card GET all agree:

```ts
const ACTIVE_CONTACT_WHERE =
  `status NOT IN ('archived', 'lost') AND NOT (status = 'completed' AND updated_at < datetime('now', '-6 months'))`
```

If a card is excluded by this filter it is excluded everywhere — which is how
"unsubscribing" / removing a contact from the synced book works: change its status, the
CTag changes, the client drops it on next sync.

### vCard fields emitted

`FN`, `N`, `ORG`, `EMAIL;TYPE=INTERNET`, `TEL;TYPE=CELL`,
`X-SOCIALPROFILE;type=instagram`, a multi-line `NOTE` (status, dates, venue, price,
etc.), `UID`, and `REV` (from `updated_at`, formatted `YYYYMMDDTHHMMSSZ`). A brand emoji
is prefixed to the display name. See `buildPrimaryVCard` / `buildPartnerVCard`.

---

## 9. Sync tag implementations (copy these)

```ts
// CTag — collection-level change detector
async function makeCTag(db: D1Database): Promise<string> {
  const row = await db
    .prepare(`SELECT COUNT(*) as cnt, MAX(updated_at) as ts FROM contacts WHERE ${ACTIVE_CONTACT_WHERE}`)
    .first<{ cnt: number; ts: string | null }>()
  const raw = `${row?.cnt ?? 0}:${row?.ts ?? ''}`
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(hash)).slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

// ETag — per-card version
function makeETag(contact: { id: string; updated_at: string }, partner = false): string {
  const ts = contact.updated_at.replace(/[ :]/g, '_')
  return partner ? `"${contact.id}-partner-${ts}"` : `"${contact.id}-${ts}"`
}

// SQLite "2024-01-15 10:30:00" → vCard REV "20240115T103000Z"
function toVCardRev(sqliteDate: string): string {
  return sqliteDate.replace(/[-:]/g, '').replace(' ', 'T') + 'Z'
}
```

The only requirement for `updated_at` to drive sync correctly: it must change whenever
the row changes. A `updated_at TEXT` column set on every write (or a trigger) is enough.

---

## 10. Wiring it into the worker

```ts
// src/types.ts — add the two secrets to your Bindings
export type Bindings = {
  DB: D1Database
  // ...your other bindings...
  CARDDAV_USER: string
  CARDDAV_PASS: string
}
```

```ts
// src/index.tsx
import { cardDavRoutes } from './routes/carddav'

// Root-level discovery handlers — see §3 for why these can't be in the sub-router.
app.on('PROPFIND', '/.well-known/carddav', (c) => principalDiscoveryXml('/.well-known/carddav'))
app.get('/.well-known/carddav', (c) => c.redirect('/carddav/principals/user/', 301))
app.on('PROPFIND', '/', (c) => principalDiscoveryXml('/'))
app.on('PROPFIND', ['/carddav', '/carddav/'], (c) => {
  if (!cardDavCheckAuth(c)) return cardDavUnauth()
  return principalDiscoveryXml('/carddav/')
})

// Mount the CardDAV sub-router (it does its own Basic Auth; no admin middleware).
app.route('/carddav', cardDavRoutes)
```

`principalDiscoveryXml(href)` returns a 207 whose body points at
`current-user-principal = /carddav/principals/user/` and
`addressbook-home-set = /carddav/addressbooks/user/`. (Full source in `index.tsx`.)

```toml
# wrangler.toml — D1 binding + a real HTTPS hostname (CardDAV requires HTTPS)
name = "forms-backend"
main = "src/index.tsx"
compatibility_date = "2025-02-01"

[[d1_databases]]
binding = "DB"
database_name = "forms-db"
database_id = "..."

[[routes]]
pattern = "your-worker.example.com"
custom_domain = true
```

A `*.workers.dev` host works too, but a custom domain is tidier for `/.well-known`.

---

## 11. How the user actually subscribes

**iOS:** Settings → Apps → Contacts → Contacts Accounts → Add Account → Other →
**Add CardDAV Account**. Server: `your-worker.example.com` (just the host; iOS finds
`/.well-known/carddav`). Username/Password = your `CARDDAV_USER`/`CARDDAV_PASS`.

**macOS:** Contacts → Settings → Accounts → **+** → Other Contacts Account →
CardDAV → Account Type **Manual** → same server/user/pass.

After it connects, a "CRM Contacts" group appears and syncs read-only. To "unsubscribe",
delete the account.

---

## 12. Debugging

Every CardDAV request is logged (`[CardDAV] >>> METHOD path Depth:n`). There's also a
JSON debug endpoint that shows what the server *would* serve without going through a
client:

```
GET /carddav/debug   (Basic Auth)
→ { ctag, totalContacts, activeContacts, sampleContacts[], sampleVCard, activeFilter }
```

`wrangler tail` while you add the account on a device shows the exact discovery walk and
where it stops if something's wrong. Common failure modes map directly to §6: a skipped
address book on macOS → missing `current-user-privilege-set` (§6f); corrupted names →
byte-folding bug (§6a); iOS giving up immediately → auth required on `/.well-known`
(should be unauthenticated, §3).

---

## 13. Checklist to port this to another worker

1. `wrangler secret put CARDDAV_USER` and `CARDDAV_PASS`; add both to `Bindings`.
2. Ensure a D1 table with a stable `id` and an `updated_at` that changes on every write.
3. Copy `src/routes/carddav.ts`. Change:
   - `ContactRow` / `CONTACT_COLS` / `ACTIVE_CONTACT_WHERE` to match your table.
   - `buildPrimaryVCard` (and drop the partner-card logic if one row = one contact).
   - The collection name (`crm`) and display names if you like.
4. Copy the root-level discovery handlers + `app.route('/carddav', cardDavRoutes)` from
   `index.tsx`.
5. Deploy to an HTTPS host. Add the account on a device. Watch `wrangler tail`.
6. (Optional) Add the static `/contact.vcf` from §1.

The full, working reference implementation is `forms-project/src/routes/carddav.ts`
(~725 lines) and the discovery handlers in `forms-project/src/index.tsx` (lines ~76–153).
