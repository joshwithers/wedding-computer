import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { classifyWeddingPath, validatePulledFile, applyPulledFile, safeToPruneIndex } from './sync'
import { serializeMarkdown } from './markdown'
import { gitBlobSha } from './etag'
import { GitHubStorageBackend, isIgnoredPath } from './github'
import { verifyGitHubSignature } from '../routes/webhooks'
import { MockD1Database } from './__tests__/mock-d1'

describe('classifyWeddingPath', () => {
  it('identifies wedding.md inside a wedding folder', () => {
    expect(classifyWeddingPath('weddings/2026-06-07-sarah-james/wedding.md')).toBe('wedding')
  })

  it('identifies todo.md and log.md companions', () => {
    expect(classifyWeddingPath('weddings/2026-06-07-sarah-james/todo.md')).toBe('todo')
    expect(classifyWeddingPath('weddings/2026-06-07-sarah-james/log.md')).toBe('log')
  })

  it('flags flat files under weddings/ as legacy (never parsed as weddings)', () => {
    expect(classifyWeddingPath('weddings/sarah-james.md')).toBe('legacy')
  })

  it('ignores uploads and unknown nesting', () => {
    expect(classifyWeddingPath('weddings/2026-06-07-sarah-james/files/contract.pdf')).toBe('other')
    expect(classifyWeddingPath('weddings/2026-06-07-sarah-james/files/notes.md')).toBe('other')
    expect(classifyWeddingPath('weddings/2026-06-07-sarah-james/random.md')).toBe('other')
    expect(classifyWeddingPath('contacts/john-doe.md')).toBe('other')
  })
})

describe('gitBlobSha', () => {
  // Expected values generated with `git hash-object --stdin`
  it('matches git hash-object for empty content', async () => {
    expect(await gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
  })

  it('matches git hash-object for ascii content', async () => {
    expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
  })

  it('matches git hash-object for multi-byte UTF-8 content', async () => {
    const content = '---\nwedding: Sarah & James\n---\n\n- [x] Book célébrant 🎉\n'
    expect(await gitBlobSha(content)).toBe('e773b7de322f0aae1e7fec8693b2d17f826d32b2')
  })
})

describe('GitHubStorageBackend.list (recursive via trees API)', () => {
  let realFetch: typeof globalThis.fetch

  const tree = [
    { path: '.obsidian/app.json', type: 'blob', sha: 'a1', size: 10 },
    { path: 'contacts/john-doe.md', type: 'blob', sha: 'a2', size: 20 },
    { path: 'weddings', type: 'tree', sha: 'a3' },
    { path: 'weddings/sarah-james.md', type: 'blob', sha: 'a4', size: 30 },
    { path: 'weddings/2026-06-07-sarah-james', type: 'tree', sha: 'a5' },
    { path: 'weddings/2026-06-07-sarah-james/wedding.md', type: 'blob', sha: 'a6', size: 40 },
    { path: 'weddings/2026-06-07-sarah-james/todo.md', type: 'blob', sha: 'a7', size: 50 },
    { path: 'weddings/2026-06-07-sarah-james/files/contract.pdf', type: 'blob', sha: 'a8', size: 60 },
  ]

  beforeEach(() => {
    realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('/git/trees/')) {
        return new Response(JSON.stringify({ tree, truncated: false }), { status: 200 })
      }
      return new Response('', { status: 404 })
    }) as any
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('returns nested files under the prefix, skipping ignored dirs', async () => {
    const backend = new GitHubStorageBackend({ token: 't', repo: 'o/r', branch: 'main', path: '' })
    const result = await backend.list('weddings/')
    const paths = result.files.map((f) => f.path)

    expect(paths).toContain('weddings/2026-06-07-sarah-james/wedding.md')
    expect(paths).toContain('weddings/2026-06-07-sarah-james/todo.md')
    expect(paths).toContain('weddings/sarah-james.md')
    expect(paths).toContain('weddings/2026-06-07-sarah-james/files/contract.pdf')
    expect(paths).not.toContain('contacts/john-doe.md')
    expect(paths).not.toContain('.obsidian/app.json')
  })

  it('etag is the git blob sha', async () => {
    const backend = new GitHubStorageBackend({ token: 't', repo: 'o/r', branch: 'main', path: '' })
    const result = await backend.list('weddings/')
    const wedding = result.files.find((f) => f.path.endsWith('/wedding.md'))
    expect(wedding?.etag).toBe('a6')
  })
})

describe('validatePulledFile (vault API write gate)', () => {
  it('accepts a contact with an id', () => {
    const md = '---\nid: abc123\nfirst_name: Sarah\nlast_name: Smith\nstatus: new\n---\n'
    expect(validatePulledFile('contacts/sarah-smith.md', md)).toEqual({ ok: true })
  })

  it('rejects a contact without an id', () => {
    const md = '---\nfirst_name: Sarah\n---\n'
    const result = validatePulledFile('contacts/sarah-smith.md', md)
    expect(result.ok).toBe(false)
  })

  it('accepts todo.md with any parseable markdown', () => {
    expect(validatePulledFile('weddings/2026-06-07-x/todo.md', '- [ ] a thing\n')).toEqual({ ok: true })
  })

  it('rejects log.md as read-only', () => {
    const result = validatePulledFile('weddings/2026-06-07-x/log.md', '# log\n')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('read-only')
  })

  it('rejects unsyncable paths', () => {
    expect(validatePulledFile('weddings/flat-legacy.md', '---\nid: x\n---\n').ok).toBe(false)
    expect(validatePulledFile('weddings/2026-06-07-x/random.md', 'hi').ok).toBe(false)
  })
})

describe('isIgnoredPath conflict copies', () => {
  it('ignores plugin conflict files', () => {
    expect(isIgnoredPath('contacts/sarah-smith.conflict.md')).toBe(true)
    expect(isIgnoredPath('weddings/2026-06-07-x/todo.conflict.md')).toBe(true)
    expect(isIgnoredPath('contacts/sarah-smith.md')).toBe(false)
  })
})

describe('verifyGitHubSignature', () => {
  const body = '{"ref":"refs/heads/main","repository":{"full_name":"josh/repo"}}'
  const goodSig = 'sha256=29598d7ffcadfad72eece1369dab0a7aac8c44bafc05728008e77fc9f143ddf1'

  it('accepts a valid signature', async () => {
    expect(await verifyGitHubSignature(body, goodSig, 'test-secret')).toBe(true)
  })

  it('rejects a tampered body', async () => {
    expect(await verifyGitHubSignature(body + ' ', goodSig, 'test-secret')).toBe(false)
  })

  it('rejects the wrong secret', async () => {
    expect(await verifyGitHubSignature(body, goodSig, 'other-secret')).toBe(false)
  })

  it('rejects malformed signatures', async () => {
    expect(await verifyGitHubSignature(body, 'sha256=zzz', 'test-secret')).toBe(false)
  })
})

describe('applyPulledFile — cross-tenant wedding guard (C1)', () => {
  const VICTIM_WEDDING = 'aaaaaaaaaaaaaaaaaaaaaaaa'
  const weddingMd = (id: string, title: string) =>
    serializeMarkdown({ frontmatter: { id, title }, body: '' })

  function seedVictimWedding(db: MockD1Database) {
    db.seed('weddings', [{ id: VICTIM_WEDDING, title: 'Real Wedding', updated_at: '2026-01-01 00:00:00' }])
    db.seed('wedding_members', [
      { id: 'm-a', wedding_id: VICTIM_WEDDING, user_id: 'user-a', status: 'active' },
    ])
  }

  it('rejects a foreign wedding id — no overwrite, no membership granted', async () => {
    const db = new MockD1Database()
    seedVictimWedding(db)
    db.seed('vendor_profiles', [{ id: 'vendor-b', user_id: 'user-b', category: 'photographer' }])

    const outcome = await applyPulledFile(
      db as any,
      'vendor-b',
      'weddings/2026-01-01-x/wedding.md',
      weddingMd(VICTIM_WEDDING, 'Hacked Title'),
      'etag-1'
    )

    expect(outcome).toEqual({ applied: 'ignored', reason: 'wedding belongs to another account' })
    expect(db.getTable('weddings')[0].title).toBe('Real Wedding')
    expect(db.getTable('wedding_members').some((m) => m.user_id === 'user-b')).toBe(false)
    expect(db.getTable('file_index').length).toBe(0)
  })

  it('lets an existing member update their wedding without a duplicate membership', async () => {
    const db = new MockD1Database()
    seedVictimWedding(db)
    db.seed('vendor_profiles', [{ id: 'vendor-a', user_id: 'user-a', category: 'celebrant' }])

    const outcome = await applyPulledFile(
      db as any,
      'vendor-a',
      'weddings/2026-01-01-x/wedding.md',
      weddingMd(VICTIM_WEDDING, 'Updated Title'),
      'etag-2'
    )

    expect(outcome.applied).toBe('wedding')
    expect(db.getTable('weddings')[0].title).toBe('Updated Title')
    expect(
      db.getTable('wedding_members').filter((m) => m.wedding_id === VICTIM_WEDDING).length
    ).toBe(1)
  })

  it('creates a brand-new wedding from a vendor file and grants that vendor membership', async () => {
    const db = new MockD1Database()
    db.seed('weddings', [])
    db.seed('wedding_members', [])
    db.seed('vendor_profiles', [{ id: 'vendor-c', user_id: 'user-c', category: 'florist' }])

    const outcome = await applyPulledFile(
      db as any,
      'vendor-c',
      'weddings/2026-02-02-y/wedding.md',
      weddingMd('bbbbbbbbbbbbbbbbbbbbbbbb', 'My New Wedding'),
      'etag-3'
    )

    expect(outcome.applied).toBe('wedding')
    expect(db.getTable('weddings').some((w) => w.id === 'bbbbbbbbbbbbbbbbbbbbbbbb')).toBe(true)
    const mem = db.getTable('wedding_members').find((m) => m.user_id === 'user-c')
    expect(mem?.role).toBe('vendor')
  })
})

describe('safeToPruneIndex (H8 mass-delete guard)', () => {
  it('allows when there is nothing to remove', () => {
    expect(safeToPruneIndex(0, 0, 5)).toBe(true)
  })
  it('refuses to delete when the listing is empty but the index is sizable', () => {
    expect(safeToPruneIndex(0, 50, 50)).toBe(false)
  })
  it('allows a small index to legitimately empty out (re-indexes on next sync)', () => {
    expect(safeToPruneIndex(0, 1, 1)).toBe(true)
  })
  it('allows a small, bounded deletion', () => {
    expect(safeToPruneIndex(100, 3, 103)).toBe(true)
  })
  it('refuses an implausibly large fraction in one pass', () => {
    expect(safeToPruneIndex(40, 60, 100)).toBe(false)
  })
  it('allows large deletions that are still a small fraction of the index', () => {
    expect(safeToPruneIndex(900, 100, 1000)).toBe(true)
  })
})

describe('GitHubStorageBackend.list — truncation guard (H8)', () => {
  let realFetch: typeof globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('throws instead of returning a partial tree', async () => {
    realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes('/git/trees/')) {
        return new Response(
          JSON.stringify({
            tree: [{ path: 'contacts/a.md', type: 'blob', sha: 'x', size: 1 }],
            truncated: true,
          }),
          { status: 200 }
        )
      }
      return new Response('', { status: 404 })
    }) as any

    const backend = new GitHubStorageBackend({ token: 't', repo: 'o/r', branch: 'main', path: '' })
    await expect(backend.list('contacts/')).rejects.toThrow(/truncated/i)
  })
})
