import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GitHubStorageBackend } from '../github'

// Mocks the GitHub Contents API with an in-memory base64 store so we can
// exercise the real write→read encode/decode path without network calls.
// Regression test for UTF-8 corruption: read() used to atob() into a Latin-1
// "binary string" without decoding UTF-8, mangling accents/em-dashes/emoji.
describe('GitHubStorageBackend UTF-8 round-trip', () => {
  const store = new Map<string, string>() // path -> base64 content
  let realFetch: typeof globalThis.fetch

  beforeEach(() => {
    store.clear()
    realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
      const u = String(url)
      const path = decodeURIComponent(u.replace(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\//, '').replace(/\?.*$/, ''))
      const method = (init.method || 'GET').toUpperCase()
      if (method === 'PUT') {
        const body = JSON.parse(init.body)
        store.set(path, body.content)
        return new Response(JSON.stringify({ content: { sha: 'sha-' + path } }), { status: 200 })
      }
      // GET
      if (!store.has(path)) return new Response('', { status: 404 })
      return new Response(JSON.stringify({
        type: 'file',
        name: path.split('/').pop(),
        path,
        sha: 'sha-' + path,
        size: store.get(path)!.length,
        content: store.get(path)!,
        encoding: 'base64',
      }), { status: 200 })
    }) as any
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('preserves accents, em-dashes, smart quotes and emoji', async () => {
    const backend = new GitHubStorageBackend({ token: 't', repo: 'o/r', branch: 'main', path: '' })
    const original = 'José & Zoë — "sunset" ceremony … keen! 🎉 Siân O’Brien'

    await backend.write('contacts/test.md', original)
    const file = await backend.read('contacts/test.md')

    expect(file).not.toBeNull()
    expect(file!.content).toBe(original)
  })

  it('round-trips a multi-line markdown document with frontmatter', async () => {
    const backend = new GitHubStorageBackend({ token: 't', repo: 'o/r', branch: 'main', path: '' })
    const doc = '---\nname: "François"\n---\n\nNotes: café déjà vu — €50 budget 😀'

    await backend.write('weddings/x.md', doc)
    const file = await backend.read('weddings/x.md')

    expect(file!.content).toBe(doc)
  })

  it('leaves plain ASCII unchanged', async () => {
    const backend = new GitHubStorageBackend({ token: 't', repo: 'o/r', branch: 'main', path: '' })
    const ascii = 'Plain ASCII content, no surprises.'

    await backend.write('a.md', ascii)
    const file = await backend.read('a.md')

    expect(file!.content).toBe(ascii)
  })
})
