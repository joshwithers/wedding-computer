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

## Discovery Endpoints

| Endpoint | Description |
|----------|-------------|
| [/.well-known/mcp/server-card.json](https://wedding.computer/.well-known/mcp/server-card.json) | MCP Server Card (SEP-1649) |
| [/.well-known/agent](https://wedding.computer/.well-known/agent) | Agent discovery |
| [/.well-known/agent-skills/index.json](https://wedding.computer/.well-known/agent-skills/index.json) | Agent skills index |
| [/.well-known/api-catalog](https://wedding.computer/.well-known/api-catalog) | API catalog (RFC 9727) |
| [/.well-known/oauth-authorization-server](https://wedding.computer/.well-known/oauth-authorization-server) | OAuth metadata with agent_auth |
| [/.well-known/oauth-protected-resource](https://wedding.computer/.well-known/oauth-protected-resource) | Protected resource metadata |

## Source

- License: AGPL-3.0
- Source Code: [github.com/joshwithers/wedding-computer](https://github.com/joshwithers/wedding-computer)
