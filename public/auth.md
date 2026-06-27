# auth.md - Wedding Computer

Wedding Computer supports AI agents through OAuth 2.1 for the MCP server, plus a manual sync-token fallback for clients that cannot run an OAuth flow yet.

## Human Authentication

Wedding Computer uses magic links and passkeys. There are no passwords.

1. Visit [wedding.computer/login](https://wedding.computer/login).
2. Enter your email address.
3. Open the magic link sent to your inbox, or use a registered passkey.
4. Complete vendor onboarding if this is a new account.

The MCP server is a Pro feature for vendor accounts.

## Agent Registration

Preferred agent registration uses OAuth 2.1 Authorization Code + PKCE with Dynamic Client Registration. Agents should discover the metadata instead of hardcoding endpoints.

### 1. Discover the Protected Resource

Fetch:

```http
GET https://wedding.computer/.well-known/oauth-protected-resource
```

The protected resource is:

```txt
https://wedding.computer/mcp
```

Send MCP credentials with:

```http
Authorization: Bearer {access_token}
```

### 2. Discover the Authorization Server

Fetch:

```http
GET https://wedding.computer/.well-known/oauth-authorization-server
```

The metadata includes an `agent_auth` block with:

| Field | Value |
|-------|-------|
| `skill` | `https://wedding.computer/auth.md` |
| `register_uri` | `https://wedding.computer/oauth/register` |
| `claim_uri` | `https://wedding.computer/oauth/authorize` |
| `revocation_uri` | `https://wedding.computer/oauth/revoke` |
| `identity_types_supported` | `anonymous`, `user` |
| `credential_types_supported` | `oauth2_bearer_access_token`, `oauth2_refresh_token` |

`anonymous` means an agent can register an OAuth client before Wedding Computer knows which user will authorize it. No vendor data or credentials are issued until a signed-in vendor authorizes the client at `claim_uri`.

### 3. Register an OAuth Client

Dynamic Client Registration:

```http
POST https://wedding.computer/oauth/register
Content-Type: application/json

{
  "client_name": "Your Agent",
  "redirect_uris": ["https://agent.example.com/oauth/callback"],
  "token_endpoint_auth_method": "none"
}
```

Public PKCE clients use `token_endpoint_auth_method: "none"`. Confidential clients may use `client_secret_post`.

Wedding Computer also supports Client ID Metadata Documents: an agent may use an HTTPS URL as `client_id` when that URL serves valid client metadata with matching `client_id` and `redirect_uris`.

### 4. Claim Authorization From the User

Open the authorization URL in the user's browser:

```http
GET https://wedding.computer/oauth/authorize?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}&scope=mcp&code_challenge={S256_challenge}&code_challenge_method=S256&state={state}
```

The user signs in, confirms access, and Wedding Computer redirects to the registered `redirect_uri` with an authorization code.

### 5. Exchange the Code

```http
POST https://wedding.computer/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code={code}&
client_id={client_id}&
redirect_uri={redirect_uri}&
code_verifier={pkce_verifier}
```

The response is a standard bearer-token response with an access token, refresh token, expiry, and `mcp` scope.

### 6. Use the MCP Server

```http
POST https://wedding.computer/mcp
Authorization: Bearer {access_token}
Content-Type: application/json
MCP-Protocol-Version: 2025-06-18
```

The MCP server can read and update Wedding Computer data according to the signed-in vendor's permissions, including contacts, weddings, run sheets, checklists, notes, calendar data, vendor credits, weather helpers, and agent-submitted enquiries.

### 7. Revoke Credentials

```http
POST https://wedding.computer/oauth/revoke
Content-Type: application/x-www-form-urlencoded

token={access_token_or_refresh_token}
```

Revoking a refresh token tears down the connected-app grant. Users can also revoke connected agents from Wedding Computer settings.

## Manual Sync-Token Fallback

Some MCP clients only support a static bearer token. A signed-in Pro vendor can create or rotate a sync token in **Settings > Calendar & Sync**.

```json
{
  "mcpServers": {
    "wedding-computer": {
      "url": "https://wedding.computer/mcp",
      "headers": {
        "Authorization": "Bearer {sync-token}"
      }
    }
  }
}
```

### Sync-Token Details

| Type | Value |
|------|-------|
| Identity | Signed-in vendor account |
| Credential | `api_key` sync token |
| Format | 32-character lowercase hex string |
| Scope | Vendor-scoped MCP, CardDAV, CalDAV, and vault sync access |
| Lifetime | Does not expire automatically |
| Revocation | Rotate/regenerate the token in Settings > Calendar & Sync |

## Available Protocols

| Protocol | Endpoint | Auth | Description |
|----------|----------|------|-------------|
| MCP | `https://wedding.computer/mcp` | OAuth bearer token or sync token | Agent access to contacts, weddings, run sheets, checklists, notes, calendar data, and lead intake |
| CardDAV | `https://wedding.computer/.well-known/carddav` | Basic auth with sync token | Contact sync |
| CalDAV | `https://wedding.computer/.well-known/caldav` | Basic auth with sync token | Calendar sync |
| iCal feed | `https://wedding.computer/feed/{token}.ics` | Token in URL | Read-only calendar feed |

## Enquiry Intake Key

Wedding Computer also has a separate enquiry intake key for lead capture. It is not an MCP credential.

| | Sync token / OAuth MCP token | Enquiry intake key |
|--|------------------------------|--------------------|
| Purpose | Agent access to vendor data and permitted MCP actions | Create leads only |
| Where | Settings > Calendar & Sync or OAuth flow | Settings > Enquiry form > API & webhooks |
| Format | OAuth token or 32-character sync token | `wc_intake_` plus 48 hex characters |
| Tier | Pro for MCP | Pro |

Example:

```http
POST https://wedding.computer/api/v1/enquiries
Authorization: Bearer wc_intake_xxxxxxxx...
Content-Type: application/json

{
  "first_name": "Sam",
  "last_name": "Rivera",
  "email": "sam@example.com",
  "wedding_date": "2027-03-14",
  "wedding_location": "Byron Bay",
  "notes": "Looking for a celebrant for a beach elopement."
}
```

## Discovery Endpoints

| Endpoint | Description |
|----------|-------------|
| [/.well-known/oauth-protected-resource](https://wedding.computer/.well-known/oauth-protected-resource) | OAuth Protected Resource Metadata |
| [/.well-known/oauth-authorization-server](https://wedding.computer/.well-known/oauth-authorization-server) | OAuth Authorization Server Metadata with `agent_auth` |
| [/.well-known/mcp/server-card.json](https://wedding.computer/.well-known/mcp/server-card.json) | MCP Server Card |
| [/.well-known/agent](https://wedding.computer/.well-known/agent) | Agent discovery |
| [/.well-known/agent-skills/index.json](https://wedding.computer/.well-known/agent-skills/index.json) | Agent skills index |
| [/.well-known/api-catalog](https://wedding.computer/.well-known/api-catalog) | API catalog |

## Open Data

- File format: [Wedding CRM Markdown Standard](https://wedding.computer/standard), a CC0 public-domain specification.
- Obsidian plugin: [wedding-computer-sync](https://github.com/joshwithers/wedding-computer-sync), the open source reference implementation for vault sync.
