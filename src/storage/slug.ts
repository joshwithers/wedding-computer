/**
 * Generate human-readable, filesystem-safe filenames from entity data.
 *
 * These filenames show up in Obsidian's sidebar, file explorers,
 * and git logs — they should be readable and meaningful.
 */

/**
 * Create a slug from a string. Produces clean kebab-case.
 *
 *   "John O'Brien" → "john-obrien"
 *   "Sarah & James Smith-Jones" → "sarah-james-smith-jones"
 *   "Ñoño" → "nono"
 */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')                     // decompose accented chars
    .replace(/[̀-ͯ]/g, '')       // strip combining marks
    .toLowerCase()
    .replace(/[''"]/g, '')                 // strip apostrophes/quotes
    .replace(/&/g, '-')                    // & → hyphen
    .replace(/[^a-z0-9]+/g, '-')           // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, '')               // trim leading/trailing hyphens
    .replace(/-{2,}/g, '-')               // collapse multiple hyphens
    || 'untitled'
}

/**
 * Generate a contact filename.
 *
 *   "John", "Doe" → "john-doe.md"
 *   "Sarah", "Smith", "James", "Jones" → "sarah-james-smith-jones.md"
 */
export function contactFilename(
  firstName: string,
  lastName: string,
  partnerFirstName?: string | null,
  partnerLastName?: string | null
): string {
  const parts = [firstName, lastName]
  if (partnerFirstName) {
    // If same last name, just add first name: "john-jane-doe"
    if (partnerLastName === lastName) {
      parts.splice(1, 0, partnerFirstName)
    } else {
      parts.push(partnerFirstName)
      if (partnerLastName) parts.push(partnerLastName)
    }
  }
  return `${slugify(parts.join(' '))}.md`
}

/**
 * Generate a wedding filename.
 *
 *   "Sarah & James", "2026-12-15" → "sarah-james-2026-12-15.md"
 *   "Smith-Jones Wedding", null → "smith-jones-wedding.md"
 */
export function weddingFilename(
  title: string,
  date?: string | null
): string {
  const parts = [title]
  if (date) parts.push(date)
  return `${slugify(parts.join(' '))}.md`
}

/**
 * Given an existing set of filenames, ensure uniqueness by
 * appending -2, -3, etc. if needed.
 *
 *   "john-doe.md" with existing ["john-doe.md"] → "john-doe-2.md"
 */
export function deduplicateFilename(
  filename: string,
  existing: Set<string>
): string {
  if (!existing.has(filename)) return filename

  const base = filename.replace(/\.md$/, '')
  let n = 2
  while (existing.has(`${base}-${n}.md`)) n++
  return `${base}-${n}.md`
}
