/**
 * timeline.md — the run sheet as a portable markdown table.
 *
 * Layout per wedding folder:
 *
 *   ## Run sheet                  ← THIS vendor's items; two-way editable
 *   ## Other vendors              ← other members' items; generated, read-only
 *   ## Pending timeline approvals ← change requests awaiting a decision
 *
 * Only the `## Run sheet` table is parsed on ingest; the rest is
 * regenerated on every push. Rows are matched to run_sheet_items by the
 * trailing `id` column — rows without an id are created (the app assigns
 * the id and re-pushes the canonical file), rows that disappear are
 * deleted, and row order becomes sort_order.
 */

import type { RunSheetItem, TimelineChangeRequest, Wedding } from '../types'
import { RUN_SHEET_CATEGORIES } from '../types'
import { parseMarkdown, serializeMarkdown, ParseError } from './markdown'

export const RUN_SHEET_SECTION = '## Run sheet'
export const OTHER_VENDORS_SECTION = '## Other vendors'
export const PENDING_SECTION = '## Pending timeline approvals'

const CATEGORY_LABELS: Record<RunSheetItem['category'], string> = {
  getting_ready: 'Getting ready',
  ceremony: 'Ceremony',
  portraits: 'Portraits',
  reception: 'Reception',
  other: 'Other',
}

export type ParsedRunSheetRow = {
  id: string | null
  time: string | null
  end_time: string | null
  title: string
  description: string | null
  location: string | null
  assigned_to: string | null
  category: RunSheetItem['category']
}

// ────────────────────────────────────────────
// Serialization
// ────────────────────────────────────────────

function escapeCell(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

function unescapeCell(value: string): string {
  return value.replace(/\\\|/g, '|').trim()
}

function renderTable(items: RunSheetItem[], withIds: boolean): string[] {
  const header = withIds
    ? '| Start | End | What | Details | Location | Who | Category | id |'
    : '| Start | End | What | Details | Location | Who | Category |'
  const sep = withIds
    ? '| --- | --- | --- | --- | --- | --- | --- | --- |'
    : '| --- | --- | --- | --- | --- | --- | --- |'
  const lines = [header, sep]
  for (const item of items) {
    const cells = [
      escapeCell(item.time),
      escapeCell(item.end_time),
      escapeCell(item.title),
      escapeCell(item.description),
      escapeCell(item.location),
      escapeCell(item.assigned_to),
      CATEGORY_LABELS[item.category] ?? 'Other',
    ]
    if (withIds) cells.push(item.id)
    lines.push(`| ${cells.join(' | ')} |`)
  }
  return lines
}

/**
 * Render the full timeline.md for one vendor's vault.
 */
export function timelineToMarkdown(data: {
  wedding: Pick<Wedding, 'id' | 'title'>
  ownItems: RunSheetItem[]
  otherVendors: { label: string; items: RunSheetItem[] }[]
  pendingRequests: TimelineChangeRequest[]
  updatedAt?: string | null
}): string {
  const body: string[] = [
    `# ${data.wedding.title} — Timeline`,
    '',
    RUN_SHEET_SECTION,
    '',
    'Rows in this table are yours — edits sync back to Wedding Computer.',
    'Leave the `id` cell empty for new rows; the app fills it in.',
    '',
    ...renderTable(data.ownItems, true),
  ]

  if (data.otherVendors.length > 0) {
    body.push('', OTHER_VENDORS_SECTION, '')
    body.push('_Read-only — these items belong to other vendors on this wedding._')
    for (const other of data.otherVendors) {
      body.push('', `### ${other.label}`, '', ...renderTable(other.items, false))
    }
  }

  if (data.pendingRequests.length > 0) {
    body.push('', PENDING_SECTION, '')
    body.push('_Read-only — changes awaiting a decision from the timeline manager._', '')
    for (const req of data.pendingRequests) {
      const ts = req.created_at.replace('T', ' ').slice(0, 16)
      const who = req.requested_by_label ?? 'Someone'
      body.push(`- **${ts}** ${who}: ${req.summary ?? 'timeline change'}`)
    }
  }

  body.push('')
  return serializeMarkdown({
    frontmatter: {
      wedding: data.wedding.title,
      wedding_id: data.wedding.id,
      ...(data.updatedAt ? { updated_at: data.updatedAt } : {}),
    },
    body: body.join('\n'),
  })
}

// ────────────────────────────────────────────
// Parsing
// ────────────────────────────────────────────

/** Map a header cell to a ParsedRunSheetRow key (null = ignore column). */
function headerKey(cell: string): keyof ParsedRunSheetRow | null {
  const c = cell.toLowerCase().trim()
  if (c === 'start' || c === 'time' || c === 'start time') return 'time'
  if (c === 'end' || c === 'end time') return 'end_time'
  if (c === 'what' || c === 'title' || c === 'item') return 'title'
  if (c === 'details' || c === 'description') return 'description'
  if (c === 'location' || c === 'where') return 'location'
  if (c === 'who' || c === 'assigned to' || c === 'assigned') return 'assigned_to'
  if (c === 'category') return 'category'
  if (c === 'id') return 'id'
  return null
}

function parseCategory(value: string): RunSheetItem['category'] {
  const c = value.toLowerCase().trim().replace(/[\s-]+/g, '_')
  return (RUN_SHEET_CATEGORIES as readonly string[]).includes(c)
    ? (c as RunSheetItem['category'])
    : 'other'
}

/** Split a markdown table line into cells, honouring `\|` escapes. */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '\\' && trimmed[i + 1] === '|') {
      current += '\\|'
      i++
    } else if (ch === '|') {
      cells.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current)
  return cells.map(unescapeCell)
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()) || c.trim() === '')
}

/**
 * Parse the editable `## Run sheet` table out of a timeline.md.
 *
 * Throws ParseError when the section or a usable header row is missing —
 * the file was mangled beyond safe interpretation, and silently treating
 * that as "delete everything" would destroy the run sheet.
 */
export function parseTimelineMarkdown(content: string): ParsedRunSheetRow[] {
  const doc = parseMarkdown(content)
  const lines = doc.body.split('\n')

  const start = lines.findIndex((l) => /^##\s+run sheet\s*$/i.test(l.trim()))
  if (start === -1) {
    throw new ParseError(`timeline.md is missing its "${RUN_SHEET_SECTION}" section`, content)
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i
      break
    }
  }

  const tableLines = lines
    .slice(start + 1, end)
    .filter((l) => l.trim().startsWith('|'))

  if (tableLines.length === 0) {
    throw new ParseError('timeline.md run sheet table is missing — keep the header row even when empty', content)
  }

  const headerCells = splitRow(tableLines[0])
  const columns = headerCells.map(headerKey)
  if (!columns.includes('title')) {
    throw new ParseError('timeline.md run sheet table needs a "What" column', content)
  }

  const rows: ParsedRunSheetRow[] = []
  for (const line of tableLines.slice(1)) {
    const cells = splitRow(line)
    if (isSeparatorRow(cells)) continue

    const row: ParsedRunSheetRow = {
      id: null,
      time: null,
      end_time: null,
      title: '',
      description: null,
      location: null,
      assigned_to: null,
      category: 'other',
    }
    columns.forEach((key, i) => {
      if (!key) return
      const value = (cells[i] ?? '').trim()
      if (key === 'category') {
        row.category = value ? parseCategory(value) : 'other'
      } else if (key === 'id') {
        row.id = value || null
      } else if (key === 'title') {
        row.title = value
      } else {
        row[key] = value || null
      }
    })
    // A row without a title is formatting noise, not an item
    if (row.title) rows.push(row)
  }

  return rows
}

// ────────────────────────────────────────────
// Diff
// ────────────────────────────────────────────

export type RunSheetDiff = {
  creates: (ParsedRunSheetRow & { sort_order: number })[]
  updates: {
    id: string
    changes: Partial<
      Pick<
        RunSheetItem,
        'time' | 'end_time' | 'title' | 'description' | 'location' | 'assigned_to' | 'category' | 'sort_order'
      >
    >
  }[]
  deletes: string[]
}

const COMPARABLE = ['time', 'end_time', 'title', 'description', 'location', 'assigned_to', 'category'] as const

/**
 * Diff parsed rows against the vendor's current items. Rows with an
 * unknown id are treated as creates (a fresh id is assigned), so a
 * copy-pasted or mistyped id can never touch someone else's row.
 */
export function diffRunSheetRows(
  existing: RunSheetItem[],
  rows: ParsedRunSheetRow[]
): RunSheetDiff {
  const byId = new Map(existing.map((i) => [i.id, i]))
  const seen = new Set<string>()
  const diff: RunSheetDiff = { creates: [], updates: [], deletes: [] }

  rows.forEach((row, index) => {
    const match = row.id ? byId.get(row.id) : undefined
    if (!match || seen.has(match.id)) {
      diff.creates.push({ ...row, sort_order: index })
      return
    }
    seen.add(match.id)
    const changes: RunSheetDiff['updates'][number]['changes'] = {}
    for (const f of COMPARABLE) {
      const oldVal = match[f] ?? null
      const newVal = row[f] ?? null
      if (String(oldVal ?? '') !== String(newVal ?? '')) {
        ;(changes as Record<string, unknown>)[f] = newVal
      }
    }
    if (match.sort_order !== index) changes.sort_order = index
    if (Object.keys(changes).length > 0) {
      diff.updates.push({ id: match.id, changes })
    }
  })

  for (const item of existing) {
    if (!seen.has(item.id)) diff.deletes.push(item.id)
  }

  return diff
}
