/**
 * Markdown task-list parser and manipulator.
 *
 * Parses standard GitHub-flavoured markdown checklists:
 *   - [ ] unchecked
 *   - [x] checked
 *   ## Section headings group items
 *
 * All mutations return the updated markdown string.
 * Line numbers are 0-indexed for internal use.
 */

export type ParsedTodoItem = {
  text: string
  checked: boolean
  line: number   // 0-based line index in the raw content
  indent: number // nesting depth (0 = top-level)
}

export type ParsedTodoSection = {
  heading: string | null
  headingLine: number | null
  items: ParsedTodoItem[]
}

const TASK_RE = /^(\s*)- \[([ xX])\] (.+)$/
const HEADING_RE = /^(#{1,6})\s+(.+)$/

/** Normalise CRLF (from HTML form submission) to LF. */
function norm(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** Parse markdown content into sections of todo items. */
export function parseTodoMarkdown(content: string): ParsedTodoSection[] {
  const lines = norm(content).split('\n')
  const sections: ParsedTodoSection[] = []
  let current: ParsedTodoSection = { heading: null, headingLine: null, items: [] }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const headingMatch = line.match(HEADING_RE)
    if (headingMatch) {
      // Push previous section if it has items (or is the first unnamed section)
      if (current.items.length > 0 || current.heading !== null) {
        sections.push(current)
      }
      current = { heading: headingMatch[2].trim(), headingLine: i, items: [] }
      continue
    }

    const taskMatch = line.match(TASK_RE)
    if (taskMatch) {
      const [, spaces, check, text] = taskMatch
      current.items.push({
        text: text.trim(),
        checked: check !== ' ',
        line: i,
        indent: Math.floor(spaces.length / 2),
      })
    }
  }

  // Push the last section
  if (current.items.length > 0 || current.heading !== null) {
    sections.push(current)
  }

  return sections
}

/** Toggle a specific item's checked state at the given line number. */
export function toggleTodoItem(content: string, lineNumber: number): string {
  const lines = norm(content).split('\n')
  if (lineNumber < 0 || lineNumber >= lines.length) return content

  const line = lines[lineNumber]
  if (line.includes('- [ ] ')) {
    lines[lineNumber] = line.replace('- [ ] ', '- [x] ')
  } else if (line.match(/- \[[xX]\] /)) {
    lines[lineNumber] = line.replace(/- \[[xX]\] /, '- [ ] ')
  }

  return lines.join('\n')
}

/** Add a new unchecked item. If sectionHeading is provided, adds at the end of that section. */
export function addTodoItem(content: string, text: string, sectionHeading?: string | null): string {
  const trimmedText = text.trim()
  if (!trimmedText) return content

  const newLine = `- [ ] ${trimmedText}`
  const lines = norm(content).split('\n')

  if (!sectionHeading) {
    // Add to the very end
    // Trim trailing blank lines, add item, add blank line
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop()
    }
    lines.push(newLine)
    lines.push('')
    return lines.join('\n')
  }

  // Find the section and add at the end of its items
  let insertAt = -1
  let inSection = false

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(HEADING_RE)
    if (headingMatch) {
      if (inSection) {
        // We've hit the next heading — insert before it
        insertAt = i
        break
      }
      if (headingMatch[2].trim() === sectionHeading) {
        inSection = true
      }
      continue
    }

    if (inSection && lines[i].match(TASK_RE)) {
      // Track the last task item in this section
      insertAt = i + 1
    }
  }

  if (insertAt === -1 && inSection) {
    // Section found but no items yet — insert after the heading
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(HEADING_RE)
      if (m && m[2].trim() === sectionHeading) {
        insertAt = i + 1
        break
      }
    }
  }

  if (insertAt === -1) {
    // Section not found — add at the end
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop()
    }
    lines.push(newLine)
    lines.push('')
  } else {
    lines.splice(insertAt, 0, newLine)
  }

  return lines.join('\n')
}

/** Remove a specific item at the given line number. */
export function removeTodoItem(content: string, lineNumber: number): string {
  const lines = norm(content).split('\n')
  if (lineNumber < 0 || lineNumber >= lines.length) return content
  if (!lines[lineNumber].match(TASK_RE)) return content

  lines.splice(lineNumber, 1)
  return lines.join('\n')
}

/** Count total and checked items. */
export function todoStats(content: string): { total: number; checked: number } {
  if (!content) return { total: 0, checked: 0 }
  let total = 0
  let checked = 0
  for (const line of norm(content).split('\n')) {
    const match = line.match(TASK_RE)
    if (match) {
      total++
      if (match[2] !== ' ') checked++
    }
  }
  return { total, checked }
}

/** Count items per section. */
export function sectionStats(section: ParsedTodoSection): { total: number; checked: number } {
  const total = section.items.length
  const checked = section.items.filter(i => i.checked).length
  return { total, checked }
}
