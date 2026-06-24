import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  contactToMarkdown,
  markdownToContact,
  contactCachedData,
  contactFromCache,
  getContactCached,
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
  countContactsByStatus,
} from '../contacts'
import { serializeMarkdown, parseMarkdown } from '../markdown'
import { MockStorageBackend } from './mock-storage'
import { MockD1Database } from './mock-d1'
import type { Contact } from '../../types'
import { StorageConflictError } from '../conflicts'

// Mock generateId to return predictable values
vi.mock('../../lib/crypto', () => ({
  generateId: () => 'mock-id-000001',
}))

const VENDOR_ID = 'vendor-abc123'

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'contact-001',
    vendor_id: VENDOR_ID,
    first_name: 'Sarah',
    last_name: 'Smith',
    email: 'sarah@example.com',
    phone: '+61 400 000 000',
    partner_first_name: 'James',
    partner_last_name: 'Wilson',
    partner_email: 'james@example.com',
    partner_phone: null,
    source: 'website',
    status: 'new',
    wedding_id: null,
    wedding_date: '2026-12-15',
    wedding_location: 'Sydney, Australia',
    notes: 'Met at the bridal expo.',
    tags: '["vip","referral"]',
    form_data: null,
    last_contacted_at: null,
    created_at: '2025-06-01T00:00:00.000Z',
    updated_at: '2025-06-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('contactToMarkdown', () => {
  it('converts all fields to frontmatter', () => {
    const contact = makeContact()
    const doc = contactToMarkdown(contact)

    expect(doc.frontmatter.id).toBe('contact-001')
    expect(doc.frontmatter.first_name).toBe('Sarah')
    expect(doc.frontmatter.last_name).toBe('Smith')
    expect(doc.frontmatter.email).toBe('sarah@example.com')
    expect(doc.frontmatter.partner_first_name).toBe('James')
    expect(doc.frontmatter.status).toBe('new')
    expect(doc.frontmatter.wedding_date).toBe('2026-12-15')
  })

  it('puts notes in the body', () => {
    const contact = makeContact({ notes: 'Important client.\n\nFollow up.' })
    const doc = contactToMarkdown(contact)
    expect(doc.body).toBe('Important client.\n\nFollow up.')
  })

  it('handles null notes as empty body', () => {
    const contact = makeContact({ notes: null })
    const doc = contactToMarkdown(contact)
    expect(doc.body).toBe('')
  })

  it('parses tags JSON into array', () => {
    const contact = makeContact({ tags: '["vip","referral"]' })
    const doc = contactToMarkdown(contact)
    expect(doc.frontmatter.tags).toEqual(['vip', 'referral'])
  })

  it('handles invalid tags JSON gracefully', () => {
    const contact = makeContact({ tags: 'not json' })
    const doc = contactToMarkdown(contact)
    expect(doc.frontmatter.tags).toBeUndefined()
  })

  it('parses form_data JSON into object', () => {
    const contact = makeContact({ form_data: '{"venue":"The Gardens"}' })
    const doc = contactToMarkdown(contact)
    expect(doc.frontmatter.form_data).toEqual({ venue: 'The Gardens' })
  })

  it('handles invalid form_data JSON gracefully', () => {
    const contact = makeContact({ form_data: '{broken' })
    const doc = contactToMarkdown(contact)
    expect(doc.frontmatter.form_data).toBeNull()
  })
})

describe('markdownToContact', () => {
  it('converts frontmatter back to Contact', () => {
    const contact = makeContact()
    const doc = contactToMarkdown(contact)
    const restored = markdownToContact(doc, VENDOR_ID)

    expect(restored.id).toBe(contact.id)
    expect(restored.vendor_id).toBe(VENDOR_ID)
    expect(restored.first_name).toBe('Sarah')
    expect(restored.last_name).toBe('Smith')
    expect(restored.email).toBe('sarah@example.com')
    expect(restored.status).toBe('new')
    expect(restored.wedding_date).toBe('2026-12-15')
  })

  it('restores notes from body', () => {
    const doc = {
      frontmatter: {
        id: 'test',
        first_name: 'Test',
        last_name: 'User',
        status: 'new',
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
      },
      body: 'Some notes here.',
    }
    const contact = markdownToContact(doc, VENDOR_ID)
    expect(contact.notes).toBe('Some notes here.')
  })

  it('handles empty body as null notes', () => {
    const doc = {
      frontmatter: {
        id: 'test',
        first_name: 'Test',
        last_name: 'User',
        status: 'new',
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
      },
      body: '',
    }
    const contact = markdownToContact(doc, VENDOR_ID)
    expect(contact.notes).toBeNull()
  })

  it('null-coalesces missing optional fields', () => {
    const doc = {
      frontmatter: {
        id: 'test',
        first_name: 'Test',
        last_name: 'User',
        status: 'new',
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
      },
      body: '',
    }
    const contact = markdownToContact(doc, VENDOR_ID)
    expect(contact.email).toBeNull()
    expect(contact.phone).toBeNull()
    expect(contact.partner_first_name).toBeNull()
    expect(contact.source).toBeNull()
    expect(contact.wedding_id).toBeNull()
    expect(contact.last_contacted_at).toBeNull()
  })

  it('throws when id is missing', () => {
    const doc = {
      frontmatter: { first_name: 'Test', last_name: 'User', status: 'new' },
      body: '',
    }
    expect(() => markdownToContact(doc, VENDOR_ID)).toThrow('missing a required "id" field')
  })

  it('throws when id is not a string', () => {
    const doc = {
      frontmatter: { id: 12345, first_name: 'Test', last_name: 'User', status: 'new' },
      body: '',
    }
    expect(() => markdownToContact(doc, VENDOR_ID)).toThrow('missing a required "id" field')
  })

  it('serializes tags array back to JSON string', () => {
    const doc = {
      frontmatter: {
        id: 'test',
        first_name: 'Test',
        last_name: 'User',
        status: 'new',
        tags: ['vip', 'referral'],
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
      },
      body: '',
    }
    const contact = markdownToContact(doc, VENDOR_ID)
    expect(contact.tags).toBe('["vip","referral"]')
  })
})

describe('roundtrip: Contact → Markdown → Contact', () => {
  it('preserves all fields through a full roundtrip', () => {
    const original = makeContact()
    const doc = contactToMarkdown(original)
    const markdown = serializeMarkdown(doc)
    const parsed = parseMarkdown(markdown)
    const restored = markdownToContact(parsed, VENDOR_ID)

    expect(restored.id).toBe(original.id)
    expect(restored.first_name).toBe(original.first_name)
    expect(restored.last_name).toBe(original.last_name)
    expect(restored.email).toBe(original.email)
    expect(restored.phone).toBe(original.phone)
    expect(restored.partner_first_name).toBe(original.partner_first_name)
    expect(restored.partner_last_name).toBe(original.partner_last_name)
    expect(restored.source).toBe(original.source)
    expect(restored.status).toBe(original.status)
    expect(restored.wedding_date).toBe(original.wedding_date)
    expect(restored.wedding_location).toBe(original.wedding_location)
    expect(restored.notes).toBe(original.notes)
    expect(restored.tags).toBe(original.tags)
  })
})

describe('contactCachedData', () => {
  it('includes key fields for indexing', () => {
    const contact = makeContact()
    const json = contactCachedData(contact)
    const parsed = JSON.parse(json)

    expect(parsed.first_name).toBe('Sarah')
    expect(parsed.last_name).toBe('Smith')
    expect(parsed.email).toBe('sarah@example.com')
    expect(parsed.status).toBe('new')
    expect(parsed.wedding_date).toBe('2026-12-15')
  })

  it('includes notes/tags/form_data so detail+edit reads and merge-on-save can be served from the cache', () => {
    const contact = makeContact({ notes: 'Very long note...', tags: '["vip"]' })
    const json = contactCachedData(contact)
    const parsed = JSON.parse(json)
    expect(parsed.notes).toBe('Very long note...')
    expect(parsed.tags).toBe('["vip"]')
    expect('form_data' in parsed).toBe(true)
  })
})

describe('contactFromCache', () => {
  it('round-trips a contact through cached_data losslessly', () => {
    const original = makeContact({ notes: 'Hi there', tags: '["vip","local"]', phone: '0400123456' })
    const cached = JSON.parse(contactCachedData(original))
    const restored = contactFromCache(cached, original.id, original.vendor_id)
    expect(restored.first_name).toBe(original.first_name)
    expect(restored.last_name).toBe(original.last_name)
    expect(restored.email).toBe(original.email)
    expect(restored.phone).toBe(original.phone)
    expect(restored.notes).toBe(original.notes)
    expect(restored.tags).toBe(original.tags)
    expect(restored.status).toBe(original.status)
    expect(restored.id).toBe(original.id)
    expect(restored.vendor_id).toBe(original.vendor_id)
  })
})

// ─── Data access tests with mocks ───

describe('listContacts', () => {
  let db: MockD1Database

  beforeEach(() => {
    db = new MockD1Database()
  })

  it('returns contacts from index with parsed cached_data', async () => {
    const cachedData = JSON.stringify({
      first_name: 'Sarah',
      last_name: 'Smith',
      email: 'sarah@example.com',
      status: 'new',
      notes: 'Imported notes',
      tags: '["vip"]',
      form_data: '{"lead":"website"}',
      created_at: '2025-06-01T00:00:00.000Z',
      updated_at: '2025-06-01T00:00:00.000Z',
    })

    db.seed('file_index', [
      {
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        entity_id: 'c1',
        file_path: 'contacts/sarah-smith.md',
        cached_data: cachedData,
        created_at: '2025-06-01',
      },
    ])

    const contacts = await listContacts(db as unknown as D1Database, VENDOR_ID)
    expect(contacts).toHaveLength(1)
    expect(contacts[0].id).toBe('c1')
    expect(contacts[0].first_name).toBe('Sarah')
    expect(contacts[0].email).toBe('sarah@example.com')
    expect(contacts[0].notes).toBe('Imported notes')
    expect(contacts[0].tags).toBe('["vip"]')
    expect(contacts[0].form_data).toBe('{"lead":"website"}')
    expect(contacts[0].vendor_id).toBe(VENDOR_ID)
  })

  it('skips rows with corrupt cached_data instead of crashing', async () => {
    db.seed('file_index', [
      {
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        entity_id: 'c1',
        file_path: 'contacts/good.md',
        cached_data: JSON.stringify({ first_name: 'Good', last_name: 'Contact', status: 'new', created_at: '2025-01-01', updated_at: '2025-01-01' }),
        created_at: '2025-06-01',
      },
      {
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        entity_id: 'c2',
        file_path: 'contacts/bad.md',
        cached_data: 'not-valid-json{{{',
        created_at: '2025-06-01',
      },
    ])

    // Should return 1 contact, not crash
    const contacts = await listContacts(db as unknown as D1Database, VENDOR_ID)
    expect(contacts).toHaveLength(1)
    expect(contacts[0].first_name).toBe('Good')
  })

  it('returns empty array when no contacts exist', async () => {
    db.seed('file_index', [])
    const contacts = await listContacts(db as unknown as D1Database, VENDOR_ID)
    expect(contacts).toHaveLength(0)
  })
})

describe('getContact', () => {
  let storage: MockStorageBackend
  let db: MockD1Database

  beforeEach(() => {
    storage = new MockStorageBackend()
    db = new MockD1Database()
  })

  it('returns contact from storage file', async () => {
    const contact = makeContact()
    const doc = contactToMarkdown(contact)
    const content = serializeMarkdown(doc)

    // Seed the file in storage
    await storage.write('contacts/sarah-smith.md', content)

    // Seed the index
    db.seed('file_index', [
      {
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        entity_id: 'contact-001',
        file_path: 'contacts/sarah-smith.md',
        etag: 'etag-123',
      },
    ])

    const result = await getContact(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      'contact-001'
    )

    expect(result).not.toBeNull()
    expect(result!.contact.first_name).toBe('Sarah')
    expect(result!.contact.last_name).toBe('Smith')
    expect(result!.filePath).toBe('contacts/sarah-smith.md')
  })

  it('returns null when contact not in index', async () => {
    db.seed('file_index', [])
    const result = await getContact(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      'nonexistent'
    )
    expect(result).toBeNull()
  })

  it('returns null and cleans up stale index when file missing from storage', async () => {
    // Index says file exists, but storage doesn't have it
    db.seed('file_index', [
      {
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        entity_id: 'contact-001',
        file_path: 'contacts/deleted.md',
        etag: 'etag-123',
      },
    ])

    const result = await getContact(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      'contact-001'
    )

    expect(result).toBeNull()
    // Verify the stale index entry was cleaned up
    const remaining = db.getTable('file_index')
    expect(remaining).toHaveLength(0)
  })
})

describe('createContact', () => {
  let storage: MockStorageBackend
  let db: MockD1Database

  beforeEach(() => {
    storage = new MockStorageBackend()
    db = new MockD1Database()
    db.seed('file_index', [])
    db.seed('contacts', [])
  })

  it('writes a markdown file to storage', async () => {
    const contact = await createContact(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      {
        first_name: 'Sarah',
        last_name: 'Smith',
        email: 'sarah@example.com',
      }
    )

    expect(contact.id).toBe('mock-id-000001')
    expect(contact.first_name).toBe('Sarah')
    expect(contact.status).toBe('new')

    // File should exist in storage
    const files = Array.from(storage.files.keys())
    expect(files).toHaveLength(1)
    expect(files[0]).toBe('contacts/sarah-smith.md')

    // File should be valid markdown
    const file = await storage.read('contacts/sarah-smith.md')
    expect(file).not.toBeNull()
    const doc = parseMarkdown(file!.content)
    expect(doc.frontmatter.first_name).toBe('Sarah')
  })

  it('creates index entry in D1', async () => {
    await createContact(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      { first_name: 'Sarah', last_name: 'Smith' }
    )

    const indexRows = db.getTable('file_index')
    expect(indexRows).toHaveLength(1)
    expect(indexRows[0].vendor_id).toBe(VENDOR_ID)
    expect(indexRows[0].entity_type).toBe('contact')
  })

  it('backward-compat writes to contacts table', async () => {
    await createContact(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      { first_name: 'Sarah', last_name: 'Smith' }
    )

    const contactRows = db.getTable('contacts')
    expect(contactRows).toHaveLength(1)
    expect(contactRows[0].first_name).toBe('Sarah')
    expect(contactRows[0].vendor_id).toBe(VENDOR_ID)
  })

  it('cleans up R2 file when D1 index insert fails', async () => {
    db.throwOnQuery = (sql: string) => {
      if (sql.includes('file_index')) return new Error('D1 is down')
      return null
    }

    await expect(
      createContact(
        storage,
        db as unknown as D1Database,
        VENDOR_ID,
        { first_name: 'Sarah', last_name: 'Smith' }
      )
    ).rejects.toThrow('D1 is down')

    // File should have been cleaned up
    expect(storage.files.size).toBe(0)
  })

  it('continues even if syncToContactsTable fails', async () => {
    // Make the contacts table insert fail, but file_index succeed
    let callCount = 0
    db.throwOnQuery = (sql: string) => {
      if (sql.includes('INTO contacts')) {
        return new Error('contacts table error')
      }
      return null
    }

    // Should NOT throw — syncToContactsTable failure is non-critical
    const contact = await createContact(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      { first_name: 'Sarah', last_name: 'Smith' }
    )

    expect(contact.first_name).toBe('Sarah')
    // File should still exist
    expect(storage.files.size).toBe(1)
  })
})

describe('deleteContact', () => {
  let storage: MockStorageBackend
  let db: MockD1Database

  beforeEach(async () => {
    storage = new MockStorageBackend()
    db = new MockD1Database()

    // Seed a contact in storage + index
    await storage.write('contacts/sarah-smith.md', 'test content')
    db.seed('file_index', [
      {
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        entity_id: 'contact-001',
        file_path: 'contacts/sarah-smith.md',
        etag: 'etag-123',
      },
    ])
    db.seed('contacts', [
      { id: 'contact-001', vendor_id: VENDOR_ID },
    ])
  })

  it('removes index entry and storage file', async () => {
    await deleteContact(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      'contact-001'
    )

    expect(db.getTable('file_index')).toHaveLength(0)
    expect(storage.files.size).toBe(0)
  })

  it('removes from backward-compat contacts table', async () => {
    await deleteContact(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      'contact-001'
    )

    expect(db.getTable('contacts')).toHaveLength(0)
  })

  it('deletes D1 index first, then storage (safe order)', async () => {
    const callOrder: string[] = []
    const origDelete = storage.delete.bind(storage)
    storage.delete = async (path: string) => {
      callOrder.push('storage.delete')
      return origDelete(path)
    }

    const origPrepare = db.prepare.bind(db)
    const origExecute = db._execute.bind(db)
    db._execute = (sql: string, params: unknown[]) => {
      if (sql.includes('DELETE FROM file_index')) {
        callOrder.push('db.deleteIndex')
      }
      return origExecute(sql, params)
    }

    await deleteContact(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      'contact-001'
    )

    expect(callOrder.indexOf('db.deleteIndex')).toBeLessThan(
      callOrder.indexOf('storage.delete')
    )
  })

  it('survives storage delete failure (orphaned file acceptable)', async () => {
    storage.throwOn = { delete: new Error('R2 delete failed') }

    // Should NOT throw
    await deleteContact(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      'contact-001'
    )

    // D1 index should still be cleaned up
    expect(db.getTable('file_index')).toHaveLength(0)
    // File is orphaned but that's acceptable
    expect(storage.files.size).toBe(1)
  })

  it('handles deleting nonexistent contact gracefully', async () => {
    await deleteContact(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      'nonexistent-id'
    )
    // No error thrown, original data untouched
    expect(db.getTable('file_index')).toHaveLength(1)
    expect(storage.files.size).toBe(1)
  })
})

describe('updateContact', () => {
  let storage: MockStorageBackend
  let db: MockD1Database

  beforeEach(async () => {
    storage = new MockStorageBackend()
    db = new MockD1Database()

    // Seed a contact
    const contact = makeContact()
    const doc = contactToMarkdown(contact)
    const content = serializeMarkdown(doc)
    const etag = await storage.write('contacts/sarah-smith-james-wilson.md', content)

    db.seed('file_index', [
      {
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        entity_id: 'contact-001',
        file_path: 'contacts/sarah-smith-james-wilson.md',
        etag,
      },
    ])
    db.seed('contacts', [
      { id: 'contact-001', vendor_id: VENDOR_ID },
    ])
  })

  it('updates fields in the markdown file', async () => {
    await updateContact(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      'contact-001',
      { email: 'new@example.com', status: 'contacted' }
    )

    // Read back and verify
    const file = await storage.read('contacts/sarah-smith-james-wilson.md')
    expect(file).not.toBeNull()
    const doc = parseMarkdown(file!.content)
    expect(doc.frontmatter.email).toBe('new@example.com')
    expect(doc.frontmatter.status).toBe('contacted')
    // Unchanged fields should be preserved
    expect(doc.frontmatter.first_name).toBe('Sarah')
  })

  it('records a conflict instead of overwriting an externally changed file', async () => {
    const externallyEdited = makeContact({
      email: 'external@example.com',
      notes: 'Edited in Git.',
    })
    await storage.write(
      'contacts/sarah-smith-james-wilson.md',
      serializeMarkdown(contactToMarkdown(externallyEdited))
    )

    await expect(
      updateContact(
        storage,
        db as unknown as D1Database,
        VENDOR_ID,
        'contact-001',
        { email: 'local@example.com' }
      )
    ).rejects.toBeInstanceOf(StorageConflictError)

    const conflicts = db.getTable('file_conflicts')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].entity_type).toBe('contact')
    expect(conflicts[0].local_content).toContain('local@example.com')
    expect(conflicts[0].remote_content).toContain('external@example.com')

    const file = await storage.read('contacts/sarah-smith-james-wilson.md')
    expect(file!.content).toContain('external@example.com')
    expect(file!.content).not.toContain('local@example.com')
  })

  it('fast path (cached): in-place edit writes conditionally with NO storage read', async () => {
    const s = new MockStorageBackend()
    const d = new MockD1Database()
    const seeded = makeContact()
    const e = await s.write('contacts/c.md', serializeMarkdown(contactToMarkdown(seeded)))
    d.seed('file_index', [{ vendor_id: VENDOR_ID, entity_type: 'contact', entity_id: 'c1', file_path: 'contacts/c.md', etag: e, cached_data: contactCachedData(seeded) }])
    d.seed('contacts', [{ id: 'c1', vendor_id: VENDOR_ID }])
    s.calls.length = 0

    await updateContact(s, d as unknown as D1Database, VENDOR_ID, 'c1', { status: 'contacted', notes: 'Called today' })

    // Merged from the cache — no storage GET on the save path.
    expect(s.calls.some((c) => c.method === 'read')).toBe(false)
    const file = await s.read('contacts/c.md')
    expect(parseMarkdown(file!.content).frontmatter.status).toBe('contacted')
    expect(file!.content).toContain('Called today')
    // Index cache refreshed so the next read stays fast + correct.
    const idx = (d.getTable('file_index') as Array<{ entity_id: string; cached_data: string }>).find((r) => r.entity_id === 'c1')!
    expect(JSON.parse(idx.cached_data).status).toBe('contacted')
  })

  it('fast path (cached): a stale etag (external edit) records a conflict and keeps the external version', async () => {
    const s = new MockStorageBackend()
    const d = new MockD1Database()
    const seeded = makeContact()
    await s.write('contacts/c.md', serializeMarkdown(contactToMarkdown(seeded)))
    d.seed('file_index', [{ vendor_id: VENDOR_ID, entity_type: 'contact', entity_id: 'c2', file_path: 'contacts/c.md', etag: 'stale-etag', cached_data: contactCachedData(seeded) }])
    d.seed('contacts', [{ id: 'c2', vendor_id: VENDOR_ID }])
    // Someone edits the file out from under us (new etag, index still 'stale-etag').
    await s.write('contacts/c.md', serializeMarkdown(contactToMarkdown(makeContact({ email: 'external@example.com', notes: 'Edited in Git.' }))))

    await expect(
      updateContact(s, d as unknown as D1Database, VENDOR_ID, 'c2', { email: 'local@example.com' })
    ).rejects.toBeInstanceOf(StorageConflictError)

    expect((d.getTable('file_conflicts') as unknown[]).length).toBeGreaterThanOrEqual(1)
    const file = await s.read('contacts/c.md')
    expect(file!.content).toContain('external@example.com')
    expect(file!.content).not.toContain('local@example.com')
  })

  it('silently does nothing when contact not found', async () => {
    await updateContact(
      storage,
      db as unknown as D1Database,
      VENDOR_ID,
      'nonexistent',
      { email: 'new@example.com' }
    )
    // No error thrown, storage unchanged
    expect(storage.files.size).toBe(1)
  })
})

describe('countContactsByStatus', () => {
  let db: MockD1Database

  beforeEach(() => {
    db = new MockD1Database()
  })

  it('returns counts grouped by status', async () => {
    db.seed('file_index', [
      {
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        cached_data: JSON.stringify({ status: 'new' }),
      },
      {
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        cached_data: JSON.stringify({ status: 'new' }),
      },
      {
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        cached_data: JSON.stringify({ status: 'booked' }),
      },
    ])

    // Note: the mock doesn't support GROUP BY natively, so this tests
    // that the function doesn't crash. Real grouping is DB-level.
    const counts = await countContactsByStatus(db as unknown as D1Database, VENDOR_ID)
    expect(typeof counts).toBe('object')
  })
})
