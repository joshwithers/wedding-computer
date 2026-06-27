const OAUTH_SCOPES = ['mcp'] as const
const BEARER_METHODS = ['header'] as const
const IDENTITY_TYPES = ['anonymous', 'user'] as const
const CREDENTIAL_TYPES = ['oauth2_bearer_access_token', 'oauth2_refresh_token'] as const

function baseUrl(appUrl: string): string {
  return appUrl.replace(/\/+$/, '')
}

export function oauthProtectedResourceMetadata(appUrl: string) {
  const base = baseUrl(appUrl)
  return {
    resource: `${base}/mcp`,
    resource_name: 'Wedding Computer MCP',
    authorization_servers: [base],
    bearer_methods_supported: BEARER_METHODS,
    scopes_supported: OAUTH_SCOPES,
    resource_documentation: `${base}/auth.md`,
  }
}

export function agentAuthMetadata(appUrl: string) {
  const base = baseUrl(appUrl)
  const registerUri = `${base}/oauth/register`
  const authorizationUri = `${base}/oauth/authorize`
  const tokenUri = `${base}/oauth/token`
  const revocationUri = `${base}/oauth/revoke`

  return {
    skill: `${base}/auth.md`,
    register_uri: registerUri,
    claim_uri: authorizationUri,
    revocation_uri: revocationUri,
    identity_types_supported: IDENTITY_TYPES,
    credential_types_supported: CREDENTIAL_TYPES,
    anonymous: {
      register_uri: registerUri,
      claim_uri: authorizationUri,
      revocation_uri: revocationUri,
      credential_types_supported: CREDENTIAL_TYPES,
      description: 'An agent can dynamically register as an OAuth client without a prior Wedding Computer identity. No vendor data is issued until a signed-in user authorizes the client.',
    },
    registration_methods_supported: [
      {
        type: 'oauth2_dynamic_client_registration',
        register_uri: registerUri,
        claim_uri: authorizationUri,
        token_uri: tokenUri,
        revocation_uri: revocationUri,
        identity_types_supported: IDENTITY_TYPES,
        credential_types_supported: CREDENTIAL_TYPES,
        grant_types_supported: ['authorization_code', 'refresh_token'] as const,
        code_challenge_methods_supported: ['S256'] as const,
      },
      {
        type: 'client_id_metadata_document',
        claim_uri: authorizationUri,
        token_uri: tokenUri,
        revocation_uri: revocationUri,
        identity_types_supported: IDENTITY_TYPES,
        credential_types_supported: CREDENTIAL_TYPES,
        grant_types_supported: ['authorization_code', 'refresh_token'] as const,
        code_challenge_methods_supported: ['S256'] as const,
      },
    ],
    oauth2: {
      registration_endpoint: registerUri,
      authorization_endpoint: authorizationUri,
      token_endpoint: tokenUri,
      revocation_endpoint: revocationUri,
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'] as const,
    },
  }
}

export function oauthAuthorizationServerMetadata(appUrl: string) {
  const base = baseUrl(appUrl)
  return {
    ...oauthProtectedResourceMetadata(base),
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: OAUTH_SCOPES,
    response_types_supported: ['code'] as const,
    grant_types_supported: ['authorization_code', 'refresh_token'] as const,
    code_challenge_methods_supported: ['S256'] as const,
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'] as const,
    client_id_metadata_document_supported: true,
    service_documentation: `${base}/auth.md`,
    agent_auth: agentAuthMetadata(base),
  }
}
