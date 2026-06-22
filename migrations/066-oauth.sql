-- OAuth 2.1 Authorization Server for the MCP endpoint (Authorization Code + PKCE + DCR).
-- Lets interactive clients (claude.ai, Claude Desktop connectors) connect with a
-- sign-in + consent flow. The legacy bearer sync token keeps working alongside this.

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret_hash TEXT,             -- NULL = public client (PKCE only)
  redirect_uris TEXT NOT NULL,         -- JSON array of exact-match redirect URIs
  client_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (vendor, client) authorization = a "connected app". Holds the
-- (hashed) refresh token; access tokens live in KV with a short TTL.
CREATE TABLE IF NOT EXISTS oauth_grants (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  client_name TEXT,
  scope TEXT NOT NULL DEFAULT 'mcp',
  refresh_token_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT,
  UNIQUE(vendor_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_grants_vendor ON oauth_grants(vendor_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_grants_refresh
  ON oauth_grants(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL;
