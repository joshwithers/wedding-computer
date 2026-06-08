/**
 * GitHub storage backend — syncs vendor markdown files to a GitHub repo.
 *
 * Uses the GitHub Contents API to read/write files. Each vendor's data
 * lives in the repo root (or a configured subdirectory):
 *   contacts/john-doe.md
 *   weddings/2026-07-12-smith-jones/wedding.md
 *
 * This is a push-on-write backend: every create/update/delete in the
 * web app is immediately pushed to GitHub. External edits (made in
 * GitHub, Obsidian, etc.) are detected on the next read via SHA comparison.
 *
 * GitHub API docs: https://docs.github.com/en/rest/repos/contents
 */

import type { StorageBackend, StorageFile, ListResult, FileMeta } from './types'

type GitHubConfig = {
  token: string       // Personal Access Token or OAuth token
  repo: string        // "owner/repo"
  branch: string      // defaults to "main"
  path: string        // subdirectory prefix, defaults to ""
}

// GitHub API file response
type GitHubFileResponse = {
  name: string
  path: string
  sha: string
  size: number
  content?: string     // base64 encoded
  encoding?: string
  type: 'file' | 'dir' | 'symlink' | 'submodule'
}

// Files to ignore when listing/syncing — created by Obsidian, GitHub, or editors.
// Matched against the filename (not the full path).
const IGNORED_FILES = new Set([
  'Welcome.md',       // Obsidian default vault note
  'README.md',        // GitHub auto-init
  '.gitignore',
  '.gitkeep',
])

// Directory prefixes to ignore entirely
const IGNORED_DIRS = [
  '.obsidian/',       // Obsidian config/plugins
  '.trash/',          // Obsidian trash
  '.git/',
]

export function isIgnoredPath(path: string): boolean {
  const filename = path.split('/').pop() ?? ''
  if (IGNORED_FILES.has(filename)) return true
  if (filename.startsWith('.')) return true  // dotfiles
  for (const dir of IGNORED_DIRS) {
    if (path.includes(dir)) return true
  }
  return false
}

export class GitHubStorageBackend implements StorageBackend {
  private config: GitHubConfig
  private baseUrl: string

  constructor(config: GitHubConfig) {
    this.config = {
      ...config,
      branch: config.branch || 'main',
      path: config.path ? config.path.replace(/\/$/, '') : '',
    }
    this.baseUrl = `https://api.github.com/repos/${this.config.repo}/contents`
  }

  private fullPath(path: string): string {
    return this.config.path ? `${this.config.path}/${path}` : path
  }

  private async api(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const url = endpoint.startsWith('https://') ? endpoint : `${this.baseUrl}/${endpoint}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'WeddingComputer/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (options.body) {
      headers['Content-Type'] = 'application/json'
    }
    return fetch(url, { ...options, headers: { ...headers, ...(options.headers as Record<string, string> || {}) } })
  }

  async read(path: string): Promise<StorageFile | null> {
    const fullPath = this.fullPath(path)
    const res = await this.api(`${fullPath}?ref=${this.config.branch}`)

    if (res.status === 404) return null
    if (!res.ok) {
      const body = await res.text()
      console.error(`[github] read ${fullPath}: ${res.status} ${body}`)
      throw new Error(`GitHub API error: ${res.status}`)
    }

    const data = (await res.json()) as GitHubFileResponse
    if (data.type !== 'file' || !data.content) return null

    // Decode base64 → bytes → UTF-8. atob() alone yields a Latin-1 "binary
    // string", which corrupts multi-byte characters (accents, em-dashes,
    // emoji). This mirrors the write encoding (encodeURIComponent/unescape).
    const binary = atob(data.content.replace(/\n/g, ''))
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    const content = new TextDecoder().decode(bytes)

    return {
      content,
      meta: {
        path,
        etag: data.sha,
        size: data.size,
        lastModified: new Date(),
      },
    }
  }

  async write(path: string, content: string): Promise<string> {
    const fullPath = this.fullPath(path)

    // Check if file exists to get its SHA (required for updates)
    let sha: string | undefined
    const existing = await this.api(`${fullPath}?ref=${this.config.branch}`)
    if (existing.ok) {
      const data = (await existing.json()) as GitHubFileResponse
      sha = data.sha
    }

    const body: Record<string, unknown> = {
      message: sha ? `Update ${path}` : `Add ${path}`,
      content: btoa(unescape(encodeURIComponent(content))),
      branch: this.config.branch,
    }
    if (sha) {
      body.sha = sha
    }

    const res = await this.api(fullPath, {
      method: 'PUT',
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error(`[github] write ${fullPath}: ${res.status} ${errBody}`)
      throw new Error(`GitHub API error on write: ${res.status}`)
    }

    const result = (await res.json()) as { content: GitHubFileResponse }
    return result.content.sha
  }

  async writeBinary(path: string, data: ArrayBuffer, _contentType: string): Promise<string> {
    const fullPath = this.fullPath(path)

    // Check if file exists to get its SHA (required for updates)
    let sha: string | undefined
    const existing = await this.api(`${fullPath}?ref=${this.config.branch}`)
    if (existing.ok) {
      const existingData = (await existing.json()) as GitHubFileResponse
      sha = existingData.sha
    }

    // Convert ArrayBuffer to base64
    const bytes = new Uint8Array(data)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    const base64Content = btoa(binary)

    const body: Record<string, unknown> = {
      message: sha ? `Update ${path}` : `Add ${path}`,
      content: base64Content,
      branch: this.config.branch,
    }
    if (sha) {
      body.sha = sha
    }

    const res = await this.api(fullPath, {
      method: 'PUT',
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error(`[github] writeBinary ${fullPath}: ${res.status} ${errBody}`)
      throw new Error(`GitHub API error on writeBinary: ${res.status}`)
    }

    const result = (await res.json()) as { content: GitHubFileResponse }
    return result.content.sha
  }

  async delete(path: string): Promise<void> {
    const fullPath = this.fullPath(path)

    // Need SHA to delete
    const existing = await this.api(`${fullPath}?ref=${this.config.branch}`)
    if (!existing.ok) return // file doesn't exist, nothing to delete

    const data = (await existing.json()) as GitHubFileResponse

    const res = await this.api(fullPath, {
      method: 'DELETE',
      body: JSON.stringify({
        message: `Delete ${path}`,
        sha: data.sha,
        branch: this.config.branch,
      }),
    })

    if (!res.ok && res.status !== 404) {
      const errBody = await res.text()
      console.error(`[github] delete ${fullPath}: ${res.status} ${errBody}`)
      throw new Error(`GitHub API error on delete: ${res.status}`)
    }
  }

  async list(prefix: string, _cursor?: string): Promise<ListResult> {
    const fullPrefix = this.fullPath(prefix.replace(/\/$/, ''))
    const res = await this.api(`${fullPrefix}?ref=${this.config.branch}`)

    if (res.status === 404) return { files: [] }
    if (!res.ok) {
      const body = await res.text()
      console.error(`[github] list ${fullPrefix}: ${res.status} ${body}`)
      throw new Error(`GitHub API error on list: ${res.status}`)
    }

    const items = (await res.json()) as GitHubFileResponse[]
    if (!Array.isArray(items)) return { files: [] }

    const files: FileMeta[] = items
      .filter((item) => item.type === 'file' && item.name.endsWith('.md') && !isIgnoredPath(item.path))
      .map((item) => ({
        path: this.config.path
          ? item.path.slice(this.config.path.length + 1)
          : item.path,
        etag: item.sha,
        size: item.size,
        lastModified: new Date(),
      }))

    return { files }
  }

  async head(path: string): Promise<FileMeta | null> {
    const fullPath = this.fullPath(path)
    const res = await this.api(`${fullPath}?ref=${this.config.branch}`)

    if (res.status === 404) return null
    if (!res.ok) return null

    const data = (await res.json()) as GitHubFileResponse
    return {
      path,
      etag: data.sha,
      size: data.size,
      lastModified: new Date(),
    }
  }

  async move(oldPath: string, newPath: string): Promise<void> {
    const file = await this.read(oldPath)
    if (!file) return
    await this.write(newPath, file.content)
    await this.delete(oldPath)
  }
}

// ─── Helper: verify token and get repo info ───

export async function verifyGitHubToken(
  token: string
): Promise<{ login: string; name: string } | null> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'WeddingComputer/1.0',
      },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { login: string; name: string }
    return { login: data.login, name: data.name }
  } catch {
    return null
  }
}

export async function createGitHubRepo(
  token: string,
  name: string,
  description: string
): Promise<{ full_name: string; html_url: string } | null> {
  try {
    const res = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'WeddingComputer/1.0',
      },
      body: JSON.stringify({
        name,
        description,
        private: true,
        auto_init: true, // create with README so the default branch exists
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`[github] createRepo: ${res.status} ${body}`)
      return null
    }
    const data = (await res.json()) as { full_name: string; html_url: string }
    return { full_name: data.full_name, html_url: data.html_url }
  } catch (err) {
    console.error('[github] createRepo error:', err)
    return null
  }
}

export async function listUserRepos(
  token: string
): Promise<{ full_name: string; private: boolean }[]> {
  try {
    const res = await fetch(
      'https://api.github.com/user/repos?sort=updated&per_page=50&affiliation=owner',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'WeddingComputer/1.0',
        },
      }
    )
    if (!res.ok) return []
    const data = (await res.json()) as { full_name: string; private: boolean }[]
    return data.map((r) => ({ full_name: r.full_name, private: r.private }))
  } catch {
    return []
  }
}
