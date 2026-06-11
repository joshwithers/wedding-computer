# Auth.md — Wedding Computer

## Human Authentication

Wedding Computer uses **magic links** for authentication — no passwords.

1. Visit [wedding.computer/login](https://wedding.computer/login)
2. Enter your email address
3. Click the link sent to your inbox
4. You're signed in (session lasts 30 days)

Google and Apple OAuth are also supported as secondary login methods.

## Agent Registration

To register an AI agent with Wedding Computer:

1. **Create an account** — visit [wedding.computer/login](https://wedding.computer/login) and sign in with your email
2. **Complete onboarding** — set up your business name, category, and email handle
3. **Get your token** — go to **Settings → Calendar & Sync** and copy your **sync token** (a 32-character hex string)
4. **Configure your agent** — add the MCP server to your agent's configuration:

```json
{
  "mcpServers": {
    "wedding-computer": {
      "url": "https://wedding.computer/mcp",
      "headers": {
        "Authorization": "Bearer {your-token}"
      }
    }
  }
}
```

No separate agent registration endpoint is required — agents authenticate using the same Bearer token the human user generates in Settings.

### Identity and Credential Types

| Type | Value |
|------|-------|
| Identity | `bearer_token` |
| Credential | `api_key` (sync token from Settings) |
| Token format | 32-character lowercase hex string |
| Token lifetime | Does not expire; revocable by regeneration |

### Registration URI

`https://wedding.computer/login` — sign in to create an account, then retrieve your token from Settings.

## Agent Authentication

Include the token as a Bearer token in the Authorization header:

```
Authorization: Bearer {your-token}
```

### Available Protocols

| Protocol | Endpoint | Auth | Description |
|----------|----------|------|-------------|
| MCP | `https://wedding.computer/mcp` | Bearer token | Full agent access to contacts, weddings, checklists, calendar |
| CardDAV | `https://wedding.computer/.well-known/carddav` | Basic (token:token) | Contact sync |
| CalDAV | `https://wedding.computer/.well-known/caldav` | Basic (token:token) | Calendar sync |
| iCal feed | `https://wedding.computer/feed/{token}.ics` | Token in URL | Read-only calendar |

### Token Scope

A single token grants read access to all data belonging to the authenticated vendor:
contacts, weddings, checklists, calendar events, activity logs, and vendor credits.

### Revocation

Regenerate your token in **Settings → Calendar & Sync** to immediately revoke the old one.
All agents using the old token will lose access.

### Claim URL

Token is self-service: [wedding.computer/app/settings](https://wedding.computer/app/settings) → Calendar & Sync section.

## Enquiry Intake (lead capture)

Send enquiries (leads) into a vendor's CRM programmatically — for webhooks, Zapier, and AI agents. This is **separate** from the read-only sync token above.

### Credentials

| | Sync token | Enquiry intake key |
|--|------------|--------------------|
| Purpose | Read data (MCP, CalDAV, CardDAV) | Create leads only (write-only) |
| Where | Settings → Calendar & Sync | Settings → Enquiry form → API & webhooks |
| Format | 32-char hex | `wc_intake_` + 48 hex |
| Tier | Pro (MCP) | Pro |

A leaked intake key cannot read any vendor data — it can only create a lead. Rotate or revoke it any time in Settings.

### JSON API

```
POST https://wedding.computer/api/v1/enquiries
Authorization: Bearer wc_intake_xxxxxxxx…
Content-Type: application/json

{
  "first_name": "Sam",
  "last_name": "Rivera",
  "email": "sam@example.com",
  "wedding_date": "2027-03-14",
  "wedding_location": "Byron Bay",
  "notes": "Looking for a celebrant for a beach elopement.",
  "fields": { "How did you hear about us?": "Instagram" }
}
```

Required: `first_name`, `last_name`, `email`. Optional: `phone`, `partner_first_name`, `partner_last_name`, `wedding_date`, `wedding_location`, `notes`, and a `fields` object of custom label/value pairs. Success returns `201 { "ok": true, "id": "…" }`.

- `GET /api/v1` — public API index (no auth).
- `GET /api/v1/form` — the fields configured on your enquiry form (auth).

### Via MCP agent

Agents connected to the MCP server (Bearer = sync token) can call the **`submit_enquiry`** tool with the same fields to create a lead conversationally.

### Plain HTML

Any website can post directly to `https://wedding.computer/enquire/{vendorId}` (the same endpoint the hosted form uses) — copy ready-made HTML from Settings → Enquiry form → HTML form code. This channel is free and uses a Cloudflare Turnstile captcha instead of a key.

## Discovery Endpoints

| Endpoint | Description |
|----------|-------------|
| [/.well-known/mcp/server-card.json](https://wedding.computer/.well-known/mcp/server-card.json) | MCP Server Card (SEP-1649) |
| [/.well-known/agent](https://wedding.computer/.well-known/agent) | Agent discovery |
| [/.well-known/agent-skills/index.json](https://wedding.computer/.well-known/agent-skills/index.json) | Agent skills index |
| [/.well-known/api-catalog](https://wedding.computer/.well-known/api-catalog) | API catalog (RFC 9727) |
| [/.well-known/oauth-authorization-server](https://wedding.computer/.well-known/oauth-authorization-server) | OAuth metadata with agent_auth |
| [/.well-known/oauth-protected-resource](https://wedding.computer/.well-known/oauth-protected-resource) | Protected resource metadata |

## Open Data

- File format: [Wedding CRM Markdown Standard](https://wedding.computer/standard) (CC0 public domain)
- Obsidian plugin: [wedding-computer-sync](https://github.com/joshwithers/wedding-computer-sync) (open source reference implementation)
