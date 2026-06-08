import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import marketing from './marketing'

const PUBLIC_CACHE = 'public, max-age=300, s-maxage=3600'

// Mirrors the production mount order in index.tsx: the marketing router — which carries the
// edge-cache middleware as a use('*') — is mounted first at the root, and authenticated/tenant
// routers are mounted AFTER it. Because of that ordering, marketing's wildcard middleware wraps
// every later route too. The regression we guard against: it stamping a shared/CDN-cacheable
// `Cache-Control` header onto authenticated, tenant-specific responses (a cross-tenant data-leak
// risk, since an edge cache may then serve one user's page to another).
function buildApp() {
  const app = new Hono()
  app.route('/', marketing)

  // Stub authenticated/tenant routes, mounted after marketing like the real app. These span the
  // several top-level prefixes the real authenticated routers use.
  app.get('/app/settings', (c) => c.text('settings'))
  app.get('/app/contacts/abc', (c) => c.text('contact pii'))
  app.get('/wedding/xyz', (c) => c.text('couple workspace'))
  app.get('/account/profile', (c) => c.text('account'))

  // A route that declares its own cache policy (mirrors files.tsx serving private documents).
  app.get('/files/abc', (c) => {
    c.header('Cache-Control', 'private, max-age=3600')
    return c.body('private file')
  })

  return app
}

describe('marketing edge-cache middleware', () => {
  it('stores public marketing pages in shared caches', async () => {
    const app = buildApp()
    for (const path of ['/', '/about', '/pricing', '/standard', '/docs/plain-text']) {
      const res = await app.request(path)
      expect(res.status, path).toBe(200)
      expect(res.headers.get('Cache-Control'), path).toBe(PUBLIC_CACHE)
    }
  })

  it('serves markdown with a shared-cache header on content negotiation', async () => {
    const app = buildApp()
    const res = await app.request('/', { headers: { Accept: 'text/markdown' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/markdown')
    expect(res.headers.get('Cache-Control')).toBe(PUBLIC_CACHE)
  })

  it('never attaches a shared-cache header to authenticated/tenant pages', async () => {
    const app = buildApp()
    for (const path of ['/app/settings', '/app/contacts/abc', '/wedding/xyz', '/account/profile']) {
      const res = await app.request(path)
      expect(res.status, path).toBe(200)
      const cc = res.headers.get('Cache-Control') ?? ''
      // Must not be storable by, or shared from, an edge/proxy cache.
      expect(cc, path).not.toContain('public')
      expect(cc, path).not.toContain('s-maxage')
    }
  })

  it('does not override a Cache-Control a route set for itself', async () => {
    const app = buildApp()
    const res = await app.request('/files/abc')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600')
  })
})
