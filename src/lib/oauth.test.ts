import { describe, it, expect } from 'vitest'
import {
  s256,
  verifyPkce,
  isOAuthAccessToken,
  redirectUriAllowed,
  isValidRedirectUri,
  newAccessToken,
  newRefreshToken,
  AT_PREFIX,
  RT_PREFIX,
} from './oauth'

describe('PKCE S256', () => {
  it('matches the RFC 7636 Appendix B test vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(await s256(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
  it('verifies a correct verifier against its challenge', async () => {
    const verifier = 'a'.repeat(64)
    const challenge = await s256(verifier)
    expect(await verifyPkce(verifier, challenge)).toBe(true)
  })
  it('rejects a wrong verifier', async () => {
    const challenge = await s256('a'.repeat(64))
    expect(await verifyPkce('b'.repeat(64), challenge)).toBe(false)
  })
  it('rejects verifiers outside the 43–128 length bound', async () => {
    const challenge = await s256('a'.repeat(64))
    expect(await verifyPkce('tooshort', challenge)).toBe(false)
    expect(await verifyPkce('a'.repeat(200), challenge)).toBe(false)
    expect(await verifyPkce(undefined, challenge)).toBe(false)
  })
})

describe('token classification', () => {
  it('tags OAuth access tokens distinctly from sync tokens', async () => {
    const at = await newAccessToken()
    const rt = await newRefreshToken()
    expect(at.startsWith(AT_PREFIX)).toBe(true)
    expect(rt.startsWith(RT_PREFIX)).toBe(true)
    expect(isOAuthAccessToken(at)).toBe(true)
    // A legacy sync token is raw hex — never matched as an OAuth token.
    expect(isOAuthAccessToken('deadbeef'.repeat(8))).toBe(false)
    expect(isOAuthAccessToken(rt)).toBe(false)
  })
})

describe('redirect URI handling', () => {
  it('allows only exact matches', () => {
    const reg = ['https://claude.ai/api/mcp/auth_callback']
    expect(redirectUriAllowed('https://claude.ai/api/mcp/auth_callback', reg)).toBe(true)
    expect(redirectUriAllowed('https://claude.ai/api/mcp/auth_callback/', reg)).toBe(false)
    expect(redirectUriAllowed('https://claude.ai/api/mcp/auth_callback?x=1', reg)).toBe(false)
    expect(redirectUriAllowed('https://evil.example/cb', reg)).toBe(false)
  })
  it('validates registration URIs (https or loopback http, no fragment)', () => {
    expect(isValidRedirectUri('https://claude.ai/cb')).toBe(true)
    expect(isValidRedirectUri('http://localhost:8080/cb')).toBe(true)
    expect(isValidRedirectUri('http://127.0.0.1/cb')).toBe(true)
    expect(isValidRedirectUri('http://evil.example/cb')).toBe(false)
    expect(isValidRedirectUri('https://x.example/cb#frag')).toBe(false)
    expect(isValidRedirectUri('not a url')).toBe(false)
  })
})
