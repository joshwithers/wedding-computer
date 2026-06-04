import type { StorageBackend } from './types'

export class StorageConflictError extends Error {
  constructor(
    message = 'This file changed outside Wedding Computer. Review the recorded conflict before saving again.'
  ) {
    super(message)
    this.name = 'StorageConflictError'
  }
}

/**
 * Check if a file has been modified since we last indexed it.
 * Returns the new etag if changed, null if unchanged or missing.
 */
export async function checkForExternalChange(
  storage: StorageBackend,
  filePath: string,
  expectedEtag: string
): Promise<string | null> {
  const meta = await storage.head(filePath)
  if (!meta) return null
  return meta.etag !== expectedEtag ? meta.etag : null
}

/**
 * Record a conflict in D1 for the user to resolve.
 */
export async function recordConflict(
  db: D1Database,
  vendorId: string,
  entityType: 'contact' | 'wedding',
  entityId: string,
  filePath: string,
  localContent: string,
  remoteContent: string,
  localEtag: string,
  remoteEtag: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO file_conflicts
        (vendor_id, entity_type, entity_id, file_path, local_content, remote_content, local_etag, remote_etag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      vendorId,
      entityType,
      entityId,
      filePath,
      localContent,
      remoteContent,
      localEtag,
      remoteEtag
    )
    .run()
}

export async function recordWriteConflict(
  db: D1Database,
  vendorId: string,
  entityType: 'contact' | 'wedding',
  entityId: string,
  filePath: string,
  localContent: string,
  remoteContent: string,
  indexedEtag: string,
  remoteEtag: string
): Promise<never> {
  await recordConflict(
    db,
    vendorId,
    entityType,
    entityId,
    filePath,
    localContent,
    remoteContent,
    indexedEtag,
    remoteEtag
  )
  throw new StorageConflictError()
}
