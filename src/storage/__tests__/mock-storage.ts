/**
 * In-memory StorageBackend for testing.
 * Simulates R2 behavior: ETags, listing, head, move.
 */

import type { StorageBackend, StorageFile, ListResult, FileMeta } from '../types'
import { StorageConflictError } from '../conflicts'
import { createHash } from 'crypto'

function etag(content: string): string {
  return createHash('md5').update(content).digest('hex')
}

export class MockStorageBackend implements StorageBackend {
  /** Expose the internal store for assertions */
  files = new Map<string, { content: string; etag: string; size: number; lastModified: Date }>()

  /** Track calls for assertion */
  calls: { method: string; args: unknown[] }[] = []

  /** Optional: make specific methods throw */
  throwOn: Partial<Record<string, Error>> = {}

  async read(path: string): Promise<StorageFile | null> {
    this.calls.push({ method: 'read', args: [path] })
    if (this.throwOn.read) throw this.throwOn.read
    const f = this.files.get(path)
    if (!f) return null
    return {
      content: f.content,
      meta: { path, etag: f.etag, size: f.size, lastModified: f.lastModified },
    }
  }

  async write(path: string, content: string, knownSha?: string): Promise<string> {
    this.calls.push({ method: 'write', args: [path, content, knownSha] })
    if (this.throwOn.write) throw this.throwOn.write
    // Conditional write (like R2 onlyIf / GitHub SHA): only overwrite if the
    // current object still matches the asserted etag, else it's a conflict.
    if (knownSha !== undefined) {
      const existing = this.files.get(path)
      if (existing ? existing.etag !== knownSha : true) throw new StorageConflictError()
    }
    const e = etag(content)
    this.files.set(path, {
      content,
      etag: e,
      size: content.length,
      lastModified: new Date(),
    })
    return e
  }

  async delete(path: string): Promise<void> {
    this.calls.push({ method: 'delete', args: [path] })
    if (this.throwOn.delete) throw this.throwOn.delete
    this.files.delete(path)
  }

  async list(prefix: string, cursor?: string): Promise<ListResult> {
    this.calls.push({ method: 'list', args: [prefix, cursor] })
    if (this.throwOn.list) throw this.throwOn.list
    const files: FileMeta[] = []
    for (const [path, f] of this.files) {
      if (path.startsWith(prefix) && path.endsWith('.md')) {
        files.push({ path, etag: f.etag, size: f.size, lastModified: f.lastModified })
      }
    }
    return { files }
  }

  async head(path: string): Promise<FileMeta | null> {
    this.calls.push({ method: 'head', args: [path] })
    if (this.throwOn.head) throw this.throwOn.head
    const f = this.files.get(path)
    if (!f) return null
    return { path, etag: f.etag, size: f.size, lastModified: f.lastModified }
  }

  async move(oldPath: string, newPath: string): Promise<void> {
    this.calls.push({ method: 'move', args: [oldPath, newPath] })
    if (this.throwOn.move) throw this.throwOn.move
    const f = this.files.get(oldPath)
    if (!f) return
    this.files.set(newPath, { ...f, lastModified: new Date() })
    this.files.delete(oldPath)
  }

  reset(): void {
    this.files.clear()
    this.calls = []
    this.throwOn = {}
  }
}
