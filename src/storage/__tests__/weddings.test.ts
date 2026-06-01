import { describe, it, expect, beforeEach } from 'vitest'
import {
  weddingToMarkdown,
  markdownToWedding,
  weddingCachedData,
  writeWeddingFile,
  readWeddingFile,
  deleteWeddingFile,
} from '../weddings'
import { serializeMarkdown, parseMarkdown } from '../markdown'
import { MockStorageBackend } from './mock-storage'
import { MockD1Database } from './mock-d1'
import type { Wedding } from '../../types'

const VENDOR_ID = 'vendor-abc123'

function makeWedding(overrides: Partial<Wedding> = {}): Wedding {
  return {
    id: 'wedding-001',
    title: 'Sarah & James',
    date: '2026-12-15',
    time: '15:00',
    location: 'The Grand Ballroom, Sydney',
    location_lat: -33.8688,
    location_lng: 151.2093,
    status: 'planning',
    ceremony_type: 'civil',
    vendor_visibility: 'private',
    reception_location: 'The Garden Terrace',
    reception_time: '18:00',
    getting_ready_location: 'Hilton Hotel',
    getting_ready_time: '09:00',
    dress_code: 'Black tie',
    guest_count: 150,
    timeline_notes: null,
    notes: 'Big outdoor ceremony, weather contingency needed.',
    created_by_user_id: 'user-001',
    created_at: '2025-06-01T00:00:00.000Z',
    updated_at: '2025-06-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('weddingToMarkdown', () => {
  it('converts all fields to frontmatter', () => {
    const wedding = makeWedding()
    const doc = weddingToMarkdown(wedding)

    expect(doc.frontmatter.id).toBe('wedding-001')
    expect(doc.frontmatter.title).toBe('Sarah & James')
    expect(doc.frontmatter.date).toBe('2026-12-15')
    expect(doc.frontmatter.time).toBe('15:00')
    expect(doc.frontmatter.location).toBe('The Grand Ballroom, Sydney')
    expect(doc.frontmatter.status).toBe('planning')
    expect(doc.frontmatter.guest_count).toBe(150)
    expect(doc.frontmatter.reception_location).toBe('The Garden Terrace')
  })

  it('puts notes in the body', () => {
    const wedding = makeWedding({ notes: 'Ceremony notes.\n\nDetails.' })
    const doc = weddingToMarkdown(wedding)
    expect(doc.body).toBe('Ceremony notes.\n\nDetails.')
  })

  it('handles null notes as empty body', () => {
    const wedding = makeWedding({ notes: null })
    const doc = weddingToMarkdown(wedding)
    expect(doc.body).toBe('')
  })
})

describe('markdownToWedding', () => {
  it('converts frontmatter back to Wedding', () => {
    const wedding = makeWedding()
    const doc = weddingToMarkdown(wedding)
    const restored = markdownToWedding(doc)

    expect(restored.id).toBe('wedding-001')
    expect(restored.title).toBe('Sarah & James')
    expect(restored.date).toBe('2026-12-15')
    expect(restored.status).toBe('planning')
    expect(restored.guest_count).toBe(150)
    expect(restored.location_lat).toBe(-33.8688)
  })

  it('throws when id is missing', () => {
    const doc = {
      frontmatter: { title: 'Test Wedding', status: 'planning' },
      body: '',
    }
    expect(() => markdownToWedding(doc)).toThrow('missing a required "id" field')
  })

  it('throws when id is not a string', () => {
    const doc = {
      frontmatter: { id: 42, title: 'Test', status: 'planning' },
      body: '',
    }
    expect(() => markdownToWedding(doc)).toThrow('missing a required "id" field')
  })

  it('null-coalesces missing optional fields', () => {
    const doc = {
      frontmatter: {
        id: 'wedding-001',
        title: 'Minimal Wedding',
        status: 'planning',
        created_by_user_id: 'user-001',
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
      },
      body: '',
    }
    const wedding = markdownToWedding(doc)
    expect(wedding.date).toBeNull()
    expect(wedding.time).toBeNull()
    expect(wedding.location).toBeNull()
    expect(wedding.guest_count).toBeNull()
    expect(wedding.reception_location).toBeNull()
    expect(wedding.dress_code).toBeNull()
  })

  it('restores notes from body', () => {
    const doc = {
      frontmatter: {
        id: 'wedding-001',
        title: 'Test',
        status: 'planning',
        created_by_user_id: 'u1',
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
      },
      body: 'Some ceremony notes.',
    }
    const wedding = markdownToWedding(doc)
    expect(wedding.notes).toBe('Some ceremony notes.')
  })
})

describe('roundtrip: Wedding → Markdown → Wedding', () => {
  it('preserves all fields through a full roundtrip', () => {
    const original = makeWedding()
    const doc = weddingToMarkdown(original)
    const markdown = serializeMarkdown(doc)
    const parsed = parseMarkdown(markdown)
    const restored = markdownToWedding(parsed)

    expect(restored.id).toBe(original.id)
    expect(restored.title).toBe(original.title)
    expect(restored.date).toBe(original.date)
    expect(restored.time).toBe(original.time)
    expect(restored.location).toBe(original.location)
    expect(restored.location_lat).toBe(original.location_lat)
    expect(restored.location_lng).toBe(original.location_lng)
    expect(restored.status).toBe(original.status)
    expect(restored.ceremony_type).toBe(original.ceremony_type)
    expect(restored.guest_count).toBe(original.guest_count)
    expect(restored.reception_location).toBe(original.reception_location)
    expect(restored.dress_code).toBe(original.dress_code)
    expect(restored.notes).toBe(original.notes)
    expect(restored.created_by_user_id).toBe(original.created_by_user_id)
  })
})

describe('weddingCachedData', () => {
  it('includes key fields for indexing', () => {
    const wedding = makeWedding()
    const json = weddingCachedData(wedding)
    const parsed = JSON.parse(json)

    expect(parsed.title).toBe('Sarah & James')
    expect(parsed.date).toBe('2026-12-15')
    expect(parsed.status).toBe('planning')
    expect(parsed.guest_count).toBe(150)
  })

  it('does NOT include notes (too large)', () => {
    const wedding = makeWedding({ notes: 'Very long...' })
    const json = weddingCachedData(wedding)
    const parsed = JSON.parse(json)
    expect(parsed.notes).toBeUndefined()
  })
})

// ─── File operation tests ───

describe('writeWeddingFile', () => {
  let storage: MockStorageBackend
  let db: MockD1Database

  beforeEach(() => {
    storage = new MockStorageBackend()
    db = new MockD1Database()
    db.seed('file_index', [])
  })

  it('writes a markdown file to storage', async () => {
    const wedding = makeWedding()
    await writeWeddingFile(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      wedding
    )

    const files = Array.from(storage.files.keys())
    expect(files).toHaveLength(1)
    expect(files[0]).toContain('weddings/')
    expect(files[0]).toContain('sarah-james')
  })

  it('creates index entry', async () => {
    const wedding = makeWedding()
    await writeWeddingFile(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      wedding
    )

    const rows = db.getTable('file_index')
    expect(rows).toHaveLength(1)
    expect(rows[0].entity_type).toBe('wedding')
    expect(rows[0].entity_id).toBe('wedding-001')
  })

  it('cleans up R2 file when D1 index fails for new file', async () => {
    db.throwOnQuery = (sql: string) => {
      if (sql.includes('file_index')) return new Error('D1 is down')
      return null
    }

    await expect(
      writeWeddingFile(
        storage,
        db as unknown as D1Database,
        VENDOR_ID,
        makeWedding()
      )
    ).rejects.toThrow('D1 is down')

    // File should have been cleaned up
    expect(storage.files.size).toBe(0)
  })
})

describe('readWeddingFile', () => {
  let storage: MockStorageBackend
  let db: MockD1Database

  beforeEach(async () => {
    storage = new MockStorageBackend()
    db = new MockD1Database()

    const wedding = makeWedding()
    const doc = weddingToMarkdown(wedding)
    const content = serializeMarkdown(doc)
    const etag = await storage.write('weddings/sarah-james-2026-12-15.md', content)

    db.seed('file_index', [
      {
        vendor_id: VENDOR_ID,
        entity_type: 'wedding',
        entity_id: 'wedding-001',
        file_path: 'weddings/sarah-james-2026-12-15.md',
        etag,
      },
    ])
  })

  it('reads and parses wedding from file', async () => {
    const result = await readWeddingFile(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      'wedding-001'
    )

    expect(result).not.toBeNull()
    expect(result!.wedding.title).toBe('Sarah & James')
    expect(result!.wedding.guest_count).toBe(150)
  })

  it('returns null when not in index', async () => {
    const result = await readWeddingFile(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      'nonexistent'
    )
    expect(result).toBeNull()
  })

  it('cleans up stale index when file missing from storage', async () => {
    // Delete the file but leave the index
    storage.files.clear()

    const result = await readWeddingFile(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      'wedding-001'
    )

    expect(result).toBeNull()
    expect(db.getTable('file_index')).toHaveLength(0)
  })
})

describe('deleteWeddingFile', () => {
  let storage: MockStorageBackend
  let db: MockD1Database

  beforeEach(async () => {
    storage = new MockStorageBackend()
    db = new MockD1Database()

    await storage.write('weddings/sarah-james.md', 'content')
    db.seed('file_index', [
      {
        vendor_id: VENDOR_ID,
        entity_type: 'wedding',
        entity_id: 'wedding-001',
        file_path: 'weddings/sarah-james.md',
        etag: 'etag-123',
      },
    ])
  })

  it('removes index entry and storage file', async () => {
    await deleteWeddingFile(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      'wedding-001'
    )

    expect(db.getTable('file_index')).toHaveLength(0)
    expect(storage.files.size).toBe(0)
  })

  it('survives storage delete failure', async () => {
    storage.throwOn = { delete: new Error('R2 down') }

    await deleteWeddingFile(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      'wedding-001'
    )

    // Index should be cleaned up even though file delete failed
    expect(db.getTable('file_index')).toHaveLength(0)
    // File orphaned but acceptable
    expect(storage.files.size).toBe(1)
  })

  it('handles deleting nonexistent wedding', async () => {
    await deleteWeddingFile(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      'nonexistent'
    )
    // No error, original data untouched
    expect(db.getTable('file_index')).toHaveLength(1)
    expect(storage.files.size).toBe(1)
  })
})
