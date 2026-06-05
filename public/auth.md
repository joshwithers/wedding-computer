# Auth.md — Wedding Computer

## Human Authentication

Wedding Computer uses **magic links** for authentication — no passwords.

1. Visit [wedding.computer/login](https://wedding.computer/login)
2. Enter your email address
3. Click the link sent to your inbox
4. You're signed in (session lasts 30 days)

Google and Apple OAuth are also supported as secondary login methods.

## Agent Authentication

AI agents access Wedding Computer via the **MCP server** using a Bearer token.

### Getting a Token

1. Sign in to [wedding.computer](https://wedding.computer/login)
2. Go to **Settings → Calendar & Sync**
3. Copy your **sync token** (a 32-character hex string)

### Using the Token

Include the token as a Bearer token in the Authorization header:

```
Authorization: Bearer {your-token}
```

### MCP Server Configuration

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

### Available Protocols

| Protocol | Endpoint | Auth |
|----------|----------|------|
| MCP | `https://wedding.computer/mcp` | Bearer token |
| CardDAV | `https://wedding.computer/.well-known/carddav` | Basic (token:token) |
| CalDAV | `https://wedding.computer/.well-known/caldav` | Basic (token:token) |
| iCal feed | `https://wedding.computer/feed/{token}.ics` | Token in URL |

### Token Scope

A single token grants read access to all data belonging to the authenticated vendor:
contacts, weddings, checklists, calendar events, and activity logs.

Tokens do not expire but can be regenerated in Settings, which invalidates the previous token.

### Revocation

Regenerate your token in **Settings → Calendar & Sync** to revoke the old one.

## Links

- MCP Server Card: [/.well-known/mcp/server-card.json](https://wedding.computer/.well-known/mcp/server-card.json)
- Agent Discovery: [/.well-known/agent](https://wedding.computer/.well-known/agent)
- Agent Skills: [/.well-known/agent-skills/index.json](https://wedding.computer/.well-known/agent-skills/index.json)
- Source Code: [github.com/joshwithers/wedding-computer](https://github.com/joshwithers/wedding-computer)
