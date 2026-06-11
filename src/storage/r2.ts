/**
 * R2 storage backend — the default for all vendors.
 *
 * Each vendor's files are stored under a prefix:
 *   vendors/{vendor_id}/contacts/john-doe.md
 *   vendors/{vendor_id}/weddings/2026-07-12-smith-jones/wedding.md
 *
 * R2 provides ETags on every object, which we use for
 * conflict detection. When a file is read, the etag is
 * recorded. On the next write, we compare etags to detect
 * if someone (or some other process) changed the file.
 */

import type { StorageBackend, StorageFile, ListResult, FileMeta } from './types'

export class R2StorageBackend implements StorageBackend {
  private bucket: R2Bucket
  private prefix: string

  /**
   * @param bucket - R2 bucket binding
   * @param vendorId - vendor's ID, used as the root prefix
   */
  constructor(bucket: R2Bucket, vendorId: string) {
    this.bucket = bucket
    this.prefix = `vendors/${vendorId}/`
  }

  private fullPath(path: string): string {
    return this.prefix + path
  }

  async read(path: string): Promise<StorageFile | null> {
    const obj = await this.bucket.get(this.fullPath(path))
    if (!obj) return null

    const content = await obj.text()
    return {
      content,
      meta: this.objectToMeta(path, obj),
    }
  }

  async write(path: string, content: string, _knownSha?: string): Promise<string> {
    const obj = await this.bucket.put(this.fullPath(path), content, {
      httpMetadata: {
        contentType: 'text/markdown; charset=utf-8',
      },
    })
    // R2 put returns the object with its etag (R2 has no concept of a prior sha)
    return obj.etag
  }

  async writeBinary(path: string, data: ArrayBuffer, contentType: string): Promise<string> {
    const obj = await this.bucket.put(this.fullPath(path), data, {
      httpMetadata: { contentType },
    })
    return obj.etag
  }

  async delete(path: string): Promise<void> {
    await this.bucket.delete(this.fullPath(path))
  }

  async list(prefix: string, cursor?: string): Promise<ListResult> {
    const fullPrefix = this.fullPath(prefix)
    const result = await this.bucket.list({
      prefix: fullPrefix,
      cursor,
      limit: 1000,
    })

    const files: FileMeta[] = result.objects
      .map((obj) => ({
        path: obj.key.slice(this.prefix.length),
        etag: obj.etag,
        size: obj.size,
        lastModified: obj.uploaded,
      }))

    return {
      files,
      cursor: result.truncated ? result.cursor : undefined,
    }
  }

  async head(path: string): Promise<FileMeta | null> {
    const obj = await this.bucket.head(this.fullPath(path))
    if (!obj) return null
    return this.objectToMeta(path, obj)
  }

  async move(oldPath: string, newPath: string): Promise<void> {
    const file = await this.read(oldPath)
    if (!file) return

    // Write new file first. If this fails, old file is untouched.
    await this.write(newPath, file.content)

    // New file exists — safe to delete old one.
    // If delete fails, we have a duplicate but no data loss.
    try {
      await this.delete(oldPath)
    } catch (err) {
      console.error(`[r2] move: failed to delete old file ${oldPath} after writing ${newPath}:`, err)
    }
  }

  private objectToMeta(
    path: string,
    obj: R2Object | R2ObjectBody
  ): FileMeta {
    return {
      path,
      etag: obj.etag,
      size: obj.size,
      lastModified: obj.uploaded,
    }
  }
}
