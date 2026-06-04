/**
 * Storage abstraction for markdown-backed entities.
 *
 * The storage backend is pluggable — R2 by default, Git for power users.
 * Every vendor's data lives as a folder of markdown files that can be
 * opened in any text editor, even Obsidian.
 */

/** Metadata returned alongside file content */
export type FileMeta = {
  path: string
  etag: string          // content hash for conflict detection
  size: number
  lastModified: Date
}

/** A file read from storage */
export type StorageFile = {
  content: string
  meta: FileMeta
}

/** Result of listing files in a directory */
export type ListResult = {
  files: FileMeta[]
  cursor?: string       // for pagination in large directories
}

/** Conflict between local (web app) and remote (external edit) versions */
export type ConflictInfo = {
  entityType: 'contact' | 'wedding'
  entityId: string
  filePath: string
  localContent: string
  remoteContent: string
  localEtag: string
  remoteEtag: string
  detectedAt: string
}

/** Resolution choice for a conflict */
export type ConflictResolution = 'keep_remote' | 'keep_local' | 'merge'

/**
 * Abstract storage backend. R2 and Git implement this interface.
 *
 * All paths are relative to the vendor's root:
 *   contacts/john-doe.md
 *   weddings/2026-07-12-smith-jones/wedding.md
 *   weddings/2026-07-12-smith-jones/todo.md
 *   weddings/2026-07-12-smith-jones/log.md
 *   weddings/2026-07-12-smith-jones/files/photo.jpg
 */
export interface StorageBackend {
  /** Read a file. Returns null if not found. */
  read(path: string): Promise<StorageFile | null>

  /** Write a file. Returns the new etag. */
  write(path: string, content: string): Promise<string>

  /** Write a binary file (images, PDFs, etc.). Returns the new etag. */
  writeBinary(path: string, data: ArrayBuffer, contentType: string): Promise<string>

  /** Delete a file. No-op if not found. */
  delete(path: string): Promise<void>

  /** List files in a directory (non-recursive). */
  list(prefix: string, cursor?: string): Promise<ListResult>

  /** Check if a file exists and return its metadata. */
  head(path: string): Promise<FileMeta | null>

  /** Rename/move a file (for when a contact name changes). */
  move(oldPath: string, newPath: string): Promise<void>
}

/** Storage configuration stored on the vendor profile */
export type StorageConfig = {
  type: 'r2' | 'git'
  // Git-specific
  git_provider?: 'github' | 'gitlab'
  git_repo?: string         // "owner/repo"
  git_branch?: string       // defaults to "main"
  git_path?: string         // subdirectory in repo, defaults to ""
  git_access_token_ref?: string // KV reference
  git_access_token?: string     // legacy raw token; do not write new configs with this
}

/**
 * Parsed frontmatter document — the universal format for
 * contacts and weddings stored as markdown.
 */
export type MarkdownDocument<T extends Record<string, unknown> = Record<string, unknown>> = {
  frontmatter: T
  body: string  // everything after the closing ---
}

/**
 * Index row stored in D1 for fast queries.
 * The index is a cache — it can be rebuilt from the markdown files.
 */
export type FileIndexRow = {
  id: string
  vendor_id: string
  entity_type: 'contact' | 'wedding'
  entity_id: string
  file_path: string
  etag: string
  /** Cached frontmatter fields as JSON for fast filtering */
  cached_data: string
  last_synced_at: string
  created_at: string
}

/**
 * Conflict row stored in D1 when sync detects divergent edits.
 */
export type FileConflictRow = {
  id: string
  vendor_id: string
  entity_type: 'contact' | 'wedding'
  entity_id: string
  file_path: string
  local_content: string
  remote_content: string
  local_etag: string
  remote_etag: string
  status: 'pending' | 'resolved'
  resolved_at: string | null
  resolution: ConflictResolution | null
  created_at: string
}
