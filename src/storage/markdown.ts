/**
 * Markdown frontmatter parser and serializer.
 *
 * Parses YAML frontmatter from markdown files and serializes
 * structured data back to clean, human-readable markdown.
 *
 * Uses the `yaml` package for robust parsing — these files will
 * be edited by humans in Obsidian, VS Code, vim, etc.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { MarkdownDocument } from './types'

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

/**
 * Parse a markdown file with YAML frontmatter.
 *
 * Tolerant of:
 * - Windows line endings (\r\n)
 * - Missing body (frontmatter only)
 * - Extra whitespace
 * - Missing trailing newline after closing ---
 *
 * Throws ParseError with a human-readable message if the
 * frontmatter is malformed (so the UI can show it).
 */
export function parseMarkdown<T extends Record<string, unknown> = Record<string, unknown>>(
  raw: string
): MarkdownDocument<T> {
  const trimmed = raw.trim()

  // Handle files with no frontmatter (just body text)
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {} as T, body: trimmed }
  }

  const match = trimmed.match(FRONTMATTER_REGEX)
  if (!match) {
    throw new ParseError(
      'Could not parse frontmatter. Make sure the file starts and ends with --- on their own lines.',
      raw
    )
  }

  const [, yamlStr, body] = match

  let frontmatter: T
  try {
    const parsed = parseYaml(yamlStr)
    // parseYaml can return null for empty frontmatter
    frontmatter = (parsed ?? {}) as T
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown YAML error'
    throw new ParseError(
      `Invalid YAML in frontmatter: ${msg}`,
      raw
    )
  }

  // Ensure frontmatter is an object (not a string, number, etc.)
  if (typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new ParseError(
      'Frontmatter must be a YAML mapping (key: value pairs), not a scalar or list.',
      raw
    )
  }

  return {
    frontmatter,
    body: body.trim(),
  }
}

/**
 * Serialize a frontmatter document back to markdown.
 *
 * Produces clean, human-readable YAML that looks good in any editor.
 */
export function serializeMarkdown<T extends Record<string, unknown>>(
  doc: MarkdownDocument<T>
): string {
  // Clean out undefined values
  const cleaned: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(doc.frontmatter)) {
    if (val !== undefined) {
      cleaned[key] = val
    }
  }

  const yaml = stringifyYaml(cleaned, {
    indent: 2,
    lineWidth: 0,         // don't wrap long strings
    singleQuote: false,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
    nullStr: '',
  }).trim()

  const parts = ['---', yaml, '---']

  if (doc.body.trim()) {
    parts.push('', doc.body.trim())
  }

  return parts.join('\n') + '\n'
}

/**
 * Error thrown when a markdown file can't be parsed.
 * Includes the raw content so the conflict UI can show it.
 */
export class ParseError extends Error {
  public readonly rawContent: string

  constructor(message: string, rawContent: string) {
    super(message)
    this.name = 'ParseError'
    this.rawContent = rawContent
  }
}
