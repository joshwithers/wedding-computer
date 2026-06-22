import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveClient } from './oauth-client'

// Fake env: DB always misses (so we exercise the CIMD path), KV is an in-memory Map.
function makeEnv() {
  const kv = new Map<string, string>()
  return {
    DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
    KV: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v) },
  } as any
}

function mockFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }))
}

describe('resolveClient — CIMD (Client ID Metadata Documents)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('resolves a valid document and treats it as a public client', async () => {
    const url = 'https://claude.ai/oauth/client-metadata'
    const f = mockFetch({ client_id: url, client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] })
    vi.stubGlobal('fetch', f)
    const client = await resolveClient(makeEnv(), url)
    expect(client?.client_id).toBe(url)
    expect(client?.redirect_uris).toContain('https://claude.ai/api/mcp/auth_callback')
    expect(client?.client_secret_hash).toBe(null)
    expect(client?.client_name).toBe('Claude')
  })

  it('rejects when the document client_id does not equal the fetched URL', async () => {
    const url = 'https://claude.ai/oauth/client-metadata'
    vi.stubGlobal('fetch', mockFetch({ client_id: 'https://evil.example/x', redirect_uris: ['https://claude.ai/cb'] }))
    expect(await resolveClient(makeEnv(), url)).toBe(null)
  })

  it('rejects a document with no redirect_uris', async () => {
    const url = 'https://claude.ai/oauth/client-metadata'
    vi.stubGlobal('fetch', mockFetch({ client_id: url }))
    expect(await resolveClient(makeEnv(), url)).toBe(null)
  })

  it('never fetches a non-https or non-URL client_id', async () => {
    const f = mockFetch({})
    vi.stubGlobal('fetch', f)
    expect(await resolveClient(makeEnv(), 'http://claude.ai/x')).toBe(null)
    expect(await resolveClient(makeEnv(), 'wc_client_abc123')).toBe(null)
    expect(f).not.toHaveBeenCalled()
  })

  it('blocks SSRF to private / loopback / link-local hosts without fetching', async () => {
    const f = mockFetch({})
    vi.stubGlobal('fetch', f)
    for (const u of ['https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.1/x', 'https://169.254.169.254/x', 'https://192.168.1.1/x']) {
      expect(await resolveClient(makeEnv(), u)).toBe(null)
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('caches the document — one fetch across two resolves', async () => {
    const url = 'https://claude.ai/oauth/client-metadata'
    const f = mockFetch({ client_id: url, redirect_uris: ['https://claude.ai/cb'] })
    vi.stubGlobal('fetch', f)
    const env = makeEnv()
    await resolveClient(env, url)
    await resolveClient(env, url)
    expect(f).toHaveBeenCalledOnce()
  })
})
