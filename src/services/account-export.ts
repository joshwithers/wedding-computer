import type { Contact, Wedding } from '../types'
import type { ZipEntry } from '../lib/zip'
import { safeZipPath } from '../lib/zip'
import { contactToMarkdown, listContacts as listStorageContacts } from '../storage/contacts'
import { weddingToMarkdown, weddingFolder } from '../storage/weddings'
import { serializeMarkdown } from '../storage/markdown'
import { contactFilename } from '../storage/slug'

type IndexedEntityType = 'contact' | 'wedding'

type IndexedEntityPathRow = {
  entity_id: string
  file_path: string
}

function sortNewestFirst<T extends { created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
}

async function listLegacyContacts(db: D1Database, vendorId: string): Promise<Contact[]> {
  const rows = await db
    .prepare('SELECT * FROM contacts WHERE vendor_id = ? ORDER BY created_at DESC LIMIT 500')
    .bind(vendorId)
    .all<Contact>()
  return rows.results
}

export async function listExportContacts(db: D1Database, vendorId: string): Promise<Contact[]> {
  const [storageContacts, legacyContacts] = await Promise.all([
    listStorageContacts(db, vendorId, {}),
    listLegacyContacts(db, vendorId),
  ])

  const byId = new Map<string, Contact>()
  for (const contact of legacyContacts) byId.set(contact.id, contact)

  for (const contact of storageContacts) {
    const legacy = byId.get(contact.id)
    byId.set(contact.id, {
      ...legacy,
      ...contact,
      notes: contact.notes ?? legacy?.notes ?? null,
      tags: contact.tags ?? legacy?.tags ?? null,
      form_data: contact.form_data ?? legacy?.form_data ?? null,
    })
  }

  return sortNewestFirst([...byId.values()])
}

export async function listIndexedEntityPaths(
  db: D1Database,
  vendorId: string,
  entityType: IndexedEntityType
): Promise<Map<string, string>> {
  const rows = await db
    .prepare('SELECT entity_id, file_path FROM file_index WHERE vendor_id = ? AND entity_type = ?')
    .bind(vendorId, entityType)
    .all<IndexedEntityPathRow>()

  return new Map(rows.results.map((row) => [row.entity_id, safeZipPath(row.file_path)]))
}

function contactPreferredPath(contact: Contact): string {
  return safeZipPath(
    `contacts/${contactFilename(
      contact.first_name,
      contact.last_name,
      contact.partner_first_name,
      contact.partner_last_name
    )}`
  )
}

function uniqueContactPath(contact: Contact, existingPaths: Set<string>): string {
  const preferred = contactPreferredPath(contact)
  if (!existingPaths.has(preferred)) return preferred

  const base = preferred.replace(/\.md$/, '')
  let candidate = `${base}-${contact.id}.md`
  let suffix = 2
  while (existingPaths.has(candidate)) {
    candidate = `${base}-${contact.id}-${suffix}.md`
    suffix += 1
  }
  return safeZipPath(candidate)
}

function weddingPreferredPath(wedding: Wedding): string {
  return safeZipPath(`${weddingFolder(wedding.title, wedding.date)}wedding.md`)
}

function uniqueWeddingPath(wedding: Wedding, existingPaths: Set<string>): string {
  const preferred = weddingPreferredPath(wedding)
  if (!existingPaths.has(preferred)) return preferred

  const folder = preferred.replace(/\/wedding\.md$/, '')
  let candidate = `${folder}-${wedding.id}/wedding.md`
  let suffix = 2
  while (existingPaths.has(candidate)) {
    candidate = `${folder}-${wedding.id}-${suffix}/wedding.md`
    suffix += 1
  }
  return safeZipPath(candidate)
}

function indexedOrMissingPath(indexedPath: string | undefined, existingPaths: Set<string>, fallbackPath: string): string | null {
  if (!indexedPath) return fallbackPath
  return existingPaths.has(indexedPath) ? null : indexedPath
}

export function addMissingContactMarkdown(
  entries: ZipEntry[],
  existingMarkdownPaths: Set<string>,
  contacts: Contact[],
  indexedPaths: Map<string, string>
): void {
  for (const contact of contacts) {
    const relativePath = indexedOrMissingPath(
      indexedPaths.get(contact.id),
      existingMarkdownPaths,
      uniqueContactPath(contact, existingMarkdownPaths)
    )
    if (!relativePath) continue

    entries.push({
      path: safeZipPath(`markdown/${relativePath}`),
      data: serializeMarkdown(contactToMarkdown(contact)),
    })
    existingMarkdownPaths.add(relativePath)
  }
}

export function addMissingWeddingMarkdown(
  entries: ZipEntry[],
  existingMarkdownPaths: Set<string>,
  weddings: Wedding[],
  indexedPaths: Map<string, string>
): void {
  for (const wedding of weddings) {
    const relativePath = indexedOrMissingPath(
      indexedPaths.get(wedding.id),
      existingMarkdownPaths,
      uniqueWeddingPath(wedding, existingMarkdownPaths)
    )
    if (!relativePath) continue

    entries.push({
      path: safeZipPath(`markdown/${relativePath}`),
      data: serializeMarkdown(weddingToMarkdown(wedding)),
    })
    existingMarkdownPaths.add(relativePath)
  }
}
