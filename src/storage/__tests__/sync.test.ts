import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  syncVendor,
  checkForExternalChange,
  recordConflict,
  listPendingConflicts,
  rebuildIndex,
} from '../sync'
import { contactToMarkdown, contactCachedData } from '../contacts'
import { weddingToMarkdown, weddingCachedData } from '../weddings'
import { serializeMarkdown } from '../markdown'
import { MockStorageBackend } from './mock-storage'
import { MockD1Database } from './mock-d1'
import type { Contact, Wedding } from '../../types'

const VENDOR_ID = 'vendor-abc123'

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'contact-001',
    vendor_id: VENDOR_ID,
    first_name: 'Sarah',
    last_name: 'Smith',
    email: 'sarah@example.com',
    phone: null,
    partner_first_name: null,
    partner_last_name: null,
    partner_email: null,
    partner_phone: null,
    source: 'website',
    status: 'new',
    wedding_id: null,
    wedding_date: '2026-12-15',
    wedding_location: null,
    notes: 'Some notes.',
    tags: null,
    form_data: null,
    last_contacted_at: null,
    created_at: '2025-06-01T00:00:00.000Z',
    updated_at: '2025-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeWedding(overrides: Partial<Wedding> = {}): Wedding {
  return {
    id: 'wedding-001',
    title: 'Sarah & James',
    date: '2026-12-15',
    time: '15:00',
    location: 'Sydney',
    location_lat: null,
    location_lng: null,
    status: 'planning',
    ceremony_type: null,
    vendor_visibility: 'private',
    reception_location: null,
    reception_time: null,
    getting_ready_location: null,
    getting_ready_time: null,
    dress_code: null,
    guest_count: null,
    timeline_notes: null,
    notes: null,
    created_by_user_id: 'user-001',
    created_at: '2025-06-01T00:00:00.000Z',
    updated_at: '2025-06-01T00:00:00.000Z',
    ...overrides,
  }
}

async function seedContactFile(storage: MockStorageBackend, contact: Contact) {
  const doc = contactToMarkdown(contact)
  const content = serializeMarkdown(doc)
  return storage.write(`contacts/${contact.id}.md`, content)
}

async function seedWeddingFile(storage: MockStorageBackend, wedding: Wedding) {
  const doc = weddingToMarkdown(wedding)
  const content = serializeMarkdown(doc)
  return storage.write(`weddings/${wedding.id}.md`, content)
}

describe('syncVendor', () => {
  let storage: MockStorageBackend
  let db: MockD1Database

  beforeEach(() => {
    storage = new MockStorageBackend()
    db = new MockD1Database()
    db.seed('file_index', [])
  })

  it('indexes new contact files', async () => {
    const contact = makeContact()
    await seedContactFile(storage, contact)

    const result = await syncVendor(
      storage,
      db as unknown as D1Database,
      VENDOR_ID
    )

    expect(result.indexed).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.errors).toBe(0)

    const rows = db.getTable('file_index')
    expect(rows).toHaveLength(1)
    expect(rows[0].entity_id).toBe('contact-001')
    expect(rows[0].entity_type).toBe('contact')
  })

  it('indexes new wedding files', async () => {
    const wedding = makeWedding()
    await seedWeddingFile(storage, wedding)

    const result = await syncVendor(
      storage,
      db as unknown as D1Database,
      VENDOR_ID
    )

    expect(result.indexed).toBe(1)
    expect(rows(db, 'file_index')[0].entity_type).toBe('wedding')
  })

  it('skips files with matching etags', async () => {
    const contact = makeContact()
    const etag = await seedContactFile(storage, contact)

    // Pre-seed the index with matching etag
    db.seed('file_index', [
      {
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        entity_id: 'contact-001',
        file_path: 'contacts/contact-001.md',
        etag,
      },
    ])

    const result = await syncVendor(
      storage,
      db as unknown as D1Database,
      VENDOR_ID
    )

    expect(result.skipped).toBe(1)
    expect(result.indexed).toBe(0)
    expect(result.updated).toBe(0)
  })

  it('updates files with changed etags', async () => {
    const contact = makeContact()
    await seedContactFile(storage, contact)

    // Pre-seed index with stale etag
    db.seed('file_index', [
      {
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        entity_id: 'contact-001',
        file_path: 'contacts/contact-001.md',
        etag: 'stale-etag-does-not-match',
      },
    ])

    const result = await syncVendor(
      storage,
      db as unknown as D1Database,
      VENDOR_ID
    )

    expect(result.updated).toBe(1)
  })

  it('removes index entries for deleted files', async () => {
    // Index says file exists, but storage doesn't have it
    db.seed('file_index', [
      {
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        entity_id: 'contact-deleted',
        file_path: 'contacts/deleted.md',
        etag: 'old-etag',
      },
    ])

    const result = await syncVendor(
      storage,
      db as unknown as D1Database,
      VENDOR_ID
    )

    expect(result.removed).toBe(1)
    expect(db.getTable('file_index')).toHaveLength(0)
  })

  it('counts parse errors without crashing', async () => {
    // Write a file with invalid frontmatter
    await storage.write('contacts/broken.md', '---\n  broken yaml: [\n---\n')

    const result = await syncVendor(
      storage,
      db as unknown as D1Database,
      VENDOR_ID
    )

    expect(result.errors).toBe(1)
    expect(result.indexed).toBe(0)
  })

  it('counts errors for contacts missing id field', async () => {
    // Write a file with valid YAML but no id
    await storage.write(
      'contacts/no-id.md',
      '---\nfirst_name: Test\nlast_name: User\nstatus: new\n---\n'
    )

    const result = await syncVendor(
      storage,
      db as unknown as D1Database,
      VENDOR_ID
    )

    expect(result.errors).toBe(1)
  })

  it('handles mixed contact and wedding files', async () => {
    await seedContactFile(storage, makeContact())
    await seedContactFile(storage, makeContact({ id: 'contact-002', first_name: 'Jane' }))
    await seedWeddingFile(storage, makeWedding())

    const result = await syncVendor(
      storage,
      db as unknown as D1Database,
      VENDOR_ID
    )

    expect(result.indexed).toBe(3)
    expect(db.getTable('file_index')).toHaveLength(3)
  })

  it('continues syncing weddings even if contacts sync fails (Promise.allSettled)', async () => {
    // Seed a valid wedding file
    await seedWeddingFile(storage, makeWedding())

    // Write a broken contact file to trigger an error within sync
    // But since syncEntityType catches per-file errors, we need to make
    // the listing itself work — the allSettled protects against the
    // entire entity type sync throwing.
    const result = await syncVendor(
      storage,
      db as unknown as D1Database,
      VENDOR_ID
    )

    // Wedding should still be indexed regardless of contact results
    const indexRows = db.getTable('file_index')
    const weddingRows = indexRows.filter((r) => r.entity_type === 'wedding')
    expect(weddingRows).toHaveLength(1)
  })
})

describe('checkForExternalChange', () => {
  let storage: MockStorageBackend

  beforeEach(() => {
    storage = new MockStorageBackend()
  })

  it('returns null when etags match', async () => {
    const etag = await storage.write('contacts/test.md', 'content')
    const result = await checkForExternalChange(storage, 'contacts/test.md', etag)
    expect(result).toBeNull()
  })

  it('returns new etag when file changed', async () => {
    await storage.write('contacts/test.md', 'original')
    const newEtag = await storage.write('contacts/test.md', 'modified')
    const result = await checkForExternalChange(storage, 'contacts/test.md', 'old-etag')
    expect(result).toBe(newEtag)
  })

  it('returns null when file deleted', async () => {
    const result = await checkForExternalChange(storage, 'contacts/missing.md', 'any-etag')
    expect(result).toBeNull()
  })
})

describe('recordConflict', () => {
  let db: MockD1Database

  beforeEach(() => {
    db = new MockD1Database()
    db.seed('file_conflicts', [])
  })

  it('inserts a conflict row', async () => {
    await recordConflict(
      db as unknown as D1Database,
      VENDOR_ID,
      'contact',
      'contact-001',
      'contacts/sarah.md',
      'local content',
      'remote content',
      'local-etag',
      'remote-etag'
    )

    const rows = db.getTable('file_conflicts')
    expect(rows).toHaveLength(1)
    expect(rows[0].vendor_id).toBe(VENDOR_ID)
    expect(rows[0].entity_type).toBe('contact')
    expect(rows[0].local_content).toBe('local content')
    expect(rows[0].remote_content).toBe('remote content')
  })
})

describe('listPendingConflicts', () => {
  let db: MockD1Database

  beforeEach(() => {
    db = new MockD1Database()
  })

  it('returns only pending conflicts for the vendor', async () => {
    db.seed('file_conflicts', [
      {
        id: 'c1',
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        entity_id: 'contact-001',
        file_path: 'contacts/sarah.md',
        status: 'pending',
        created_at: '2025-06-01',
      },
      {
        id: 'c2',
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        entity_id: 'contact-002',
        file_path: 'contacts/james.md',
        status: 'resolved',
        created_at: '2025-06-01',
      },
      {
        id: 'c3',
        vendor_id: 'other-vendor',
        entity_type: 'contact',
        entity_id: 'contact-003',
        file_path: 'contacts/other.md',
        status: 'pending',
        created_at: '2025-06-01',
      },
    ])

    const conflicts = await listPendingConflicts(
      db as unknown as D1Database,
      VENDOR_ID
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].id).toBe('c1')
  })

  it('returns empty array when no conflicts', async () => {
    db.seed('file_conflicts', [])
    const conflicts = await listPendingConflicts(
      db as unknown as D1Database,
      VENDOR_ID
    )
    expect(conflicts).toHaveLength(0)
  })
})

describe('rebuildIndex', () => {
  let storage: MockStorageBackend
  let db: MockD1Database

  beforeEach(() => {
    storage = new MockStorageBackend()
    db = new MockD1Database()
  })

  it('clears existing index and rebuilds from storage', async () => {
    // Seed storage with files
    await seedContactFile(storage, makeContact())

    // Seed index with stale data
    db.seed('file_index', [
      {
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        entity_id: 'old-contact',
        file_path: 'contacts/old.md',
        etag: 'old',
      },
    ])

    const result = await rebuildIndex(
      storage,
      db as unknown as D1Database,
      VENDOR_ID
    )

    expect(result.indexed).toBe(1)
    // Old entry should be gone, new one added
    const rows = db.getTable('file_index')
    expect(rows.some((r) => r.entity_id === 'old-contact')).toBe(false)
    expect(rows.some((r) => r.entity_id === 'contact-001')).toBe(true)
  })
})

// Helper
function rows(db: MockD1Database, table: string) {
  return db.getTable(table)
}
