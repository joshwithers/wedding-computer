import { describe, expect, it } from 'vitest'
import {
  agentAuthMetadata,
  oauthAuthorizationServerMetadata,
  oauthProtectedResourceMetadata,
} from './agent-auth'

describe('agent auth discovery metadata', () => {
  const appUrl = 'https://wedding.computer/'

  it('publishes protected resource metadata for the MCP endpoint', () => {
    const metadata = oauthProtectedResourceMetadata(appUrl)

    expect(metadata.resource).toBe('https://wedding.computer/mcp')
    expect(metadata.authorization_servers).toEqual(['https://wedding.computer'])
    expect(metadata.bearer_methods_supported).toContain('header')
    expect(metadata.scopes_supported).toContain('mcp')
    expect(metadata.resource_documentation).toBe('https://wedding.computer/auth.md')
  })

  it('publishes agent_auth with registration, claim, credential, and revocation hints', () => {
    const agentAuth = agentAuthMetadata(appUrl)

    expect(agentAuth.skill).toBe('https://wedding.computer/auth.md')
    expect(agentAuth.register_uri).toBe('https://wedding.computer/oauth/register')
    expect(agentAuth.claim_uri).toBe('https://wedding.computer/oauth/authorize')
    expect(agentAuth.revocation_uri).toBe('https://wedding.computer/oauth/revoke')
    expect(agentAuth.identity_types_supported).toEqual(['anonymous', 'user'])
    expect(agentAuth.credential_types_supported).toEqual([
      'oauth2_bearer_access_token',
      'oauth2_refresh_token',
    ])
    expect(agentAuth.anonymous.claim_uri).toBe('https://wedding.computer/oauth/authorize')
    expect(agentAuth.anonymous.credential_types_supported).toEqual([
      'oauth2_bearer_access_token',
      'oauth2_refresh_token',
    ])
    expect(agentAuth.registration_methods_supported.map((m) => m.type)).toEqual([
      'oauth2_dynamic_client_registration',
      'client_id_metadata_document',
    ])
  })

  it('includes agent_auth inside OAuth Authorization Server metadata', () => {
    const metadata = oauthAuthorizationServerMetadata(appUrl)

    expect(metadata.issuer).toBe('https://wedding.computer')
    expect(metadata.registration_endpoint).toBe('https://wedding.computer/oauth/register')
    expect(metadata.revocation_endpoint).toBe('https://wedding.computer/oauth/revoke')
    expect(metadata.agent_auth.register_uri).toBe(metadata.registration_endpoint)
    expect(metadata.agent_auth.oauth2.client_id_metadata_document_supported).toBe(true)
  })
})
