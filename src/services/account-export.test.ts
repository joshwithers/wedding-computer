import { describe, it, expect } from 'vitest'
import type { Contact, Wedding } from '../types'
import { contactCachedData } from '../storage/contacts'
import { MockD1Database } from '../storage/__tests__/mock-d1'
import {
  addMissingContactMarkdown,
  addMissingWeddingMarkdown,
  listExportContacts,
} from './account-export'
import type { ZipEntry } from '../lib/zip'

const VENDOR_ID = 'vendor-abc123'

function contact(overrides: Partial<Contact> = {}): Contact {
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
    address: null,
    instagram: null,
    facebook: null,
    tiktok: null,
    website: null,
    source: 'import',
    status: 'new',
    wedding_id: null,
    wedding_date: null,
    wedding_location: null,
    notes: null,
    tags: null,
    form_data: null,
    last_contacted_at: null,
    created_at: '2025-06-01T00:00:00.000Z',
    updated_at: '2025-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function wedding(overrides: Partial<Wedding> = {}): Wedding {
  return {
    id: 'wedding-001',
    title: 'Sarah & James',
    date: '2024-10-12',
    time: null,
    duration_hours: null,
    location: 'Sydney',
    location_lat: null,
    location_lng: null,
    location_city: null,
    location_state: null,
    location_country: null,
    status: 'completed',
    ceremony_type: 'wedding',
    vendor_visibility: 'private',
    ceremony_location: null,
    reception_location: null,
    reception_time: null,
    getting_ready_location: null,
    getting_ready_time: null,
    getting_ready_1_label: null,
    getting_ready_2_location: null,
    getting_ready_2_label: null,
    getting_ready_2_time: null,
    portrait_location: null,
    portrait_time: null,
    emoji: null,
    reception_duration_hours: null,
    timeline_notes: null,
    dress_code: null,
    guest_count: null,
    notes: 'Imported wedding notes.',
    created_by_user_id: 'user-001',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('listExportContacts', () => {
  it('exports the union of markdown-indexed and legacy D1 contacts', async () => {
    const db = new MockD1Database()
    const indexed = contact({
      id: 'indexed-001',
      first_name: 'Indexed',
      last_name: 'Contact',
      notes: 'Notes from cached markdown.',
      tags: '["vip"]',
      form_data: '{"lead":"form"}',
      created_at: '2025-07-01T00:00:00.000Z',
    })

    db.seed('file_index', [
      {
        vendor_id: VENDOR_ID,
        entity_type: 'contact',
        entity_id: indexed.id,
        file_path: 'contacts/indexed-contact.md',
        etag: 'etag',
        cached_data: contactCachedData(indexed),
        created_at: indexed.created_at,
      },
    ])
    db.seed('contacts', [
      contact({
        id: 'legacy-001',
        first_name: 'Legacy',
        last_name: 'Import',
        notes: 'D1-only imported note.',
        created_at: '2025-06-01T00:00:00.000Z',
      }),
    ])

    const contacts = await listExportContacts(db as unknown as D1Database, VENDOR_ID)

    expect(contacts.map((c) => c.id)).toEqual(['indexed-001', 'legacy-001'])
    expect(contacts[0].notes).toBe('Notes from cached markdown.')
    expect(contacts[0].tags).toBe('["vip"]')
    expect(contacts[0].form_data).toBe('{"lead":"form"}')
    expect(contacts[1].notes).toBe('D1-only imported note.')
  })
})

describe('missing markdown export entries', () => {
  it('adds a generated markdown file for a D1-only contact', () => {
    const entries: ZipEntry[] = []
    const existing = new Set<string>()

    addMissingContactMarkdown(
      entries,
      existing,
      [contact({ id: 'legacy-001', first_name: 'Legacy', last_name: 'Import', notes: 'Imported note.' })],
      new Map()
    )

    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('markdown/contacts/legacy-import.md')
    expect(String(entries[0].data)).toContain('id: legacy-001')
    expect(String(entries[0].data)).toContain('Imported note.')
  })

  it('does not duplicate a contact markdown file that is already in storage', () => {
    const entries: ZipEntry[] = []
    const existing = new Set<string>(['contacts/legacy-import.md'])

    addMissingContactMarkdown(
      entries,
      existing,
      [contact({ id: 'legacy-001', first_name: 'Legacy', last_name: 'Import' })],
      new Map([['legacy-001', 'contacts/legacy-import.md']])
    )

    expect(entries).toHaveLength(0)
  })

  it('adds a generated markdown file for an accessible wedding without storage', () => {
    const entries: ZipEntry[] = []
    const existing = new Set<string>()

    addMissingWeddingMarkdown(entries, existing, [wedding()], new Map())

    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('markdown/weddings/2024-10-12-sarah-james/wedding.md')
    expect(String(entries[0].data)).toContain('id: wedding-001')
    expect(String(entries[0].data)).toContain('Imported wedding notes.')
  })
})
