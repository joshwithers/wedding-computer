import type { CoupleVendor } from '../types'
import { sanitizeInstagramHandle } from '../lib/instagram'

type CreditEntry = {
  role: string
  name: string
  instagram: string | null
  website: string | null
}

type MemberWithVendor = {
  vendor_role: string | null
  business_name: string | null
  vendor_instagram: string | null
  vendor_website: string | null
  user_name: string
  role: string
}

/**
 * Build a unified credits list from platform vendors (wedding_members)
 * and couple-added vendors (couple_vendors).
 */
export function buildCredits(
  members: MemberWithVendor[],
  coupleVendors: CoupleVendor[]
): CreditEntry[] {
  const credits: CreditEntry[] = []

  // Platform vendors from wedding_members
  for (const m of members) {
    if (m.role !== 'vendor') continue
    const name = m.business_name ?? m.user_name
    const role = m.vendor_role
      ? m.vendor_role.charAt(0).toUpperCase() + m.vendor_role.slice(1)
      : 'Vendor'
    credits.push({
      role,
      name,
      instagram: sanitizeInstagramHandle(m.vendor_instagram),
      website: m.vendor_website,
    })
  }

  // Couple-added vendors (only booked ones)
  for (const cv of coupleVendors) {
    if (cv.status !== 'booked') continue
    const role = cv.category
      ? cv.category.charAt(0).toUpperCase() + cv.category.slice(1)
      : 'Vendor'
    credits.push({
      role,
      name: cv.name,
      instagram: sanitizeInstagramHandle(cv.instagram),
      website: cv.website,
    })
  }

  return credits
}

/** Format credits for Instagram caption (with @handles). */
export function formatInstagramCredits(credits: CreditEntry[]): string {
  return credits
    .map((c) => {
      const ig = sanitizeInstagramHandle(c.instagram)
      const handle = ig ? `@${ig}` : c.name
      return `${c.role}: ${c.name} ${handle !== c.name ? handle : ''}`
    })
    .map((l) => l.trim())
    .join('\n')
}

/** Format credits for blog/website (markdown with links). */
export function formatWebCredits(credits: CreditEntry[]): string {
  return credits
    .map((c) => {
      if (c.website) {
        const url = c.website.startsWith('http') ? c.website : `https://${c.website}`
        return `- **${c.role}:** [${c.name}](${url})`
      }
      return `- **${c.role}:** ${c.name}`
    })
    .join('\n')
}

/** Format credits as HTML for blog/website embedding. */
export function formatHtmlCredits(credits: CreditEntry[]): string {
  const items = credits
    .map((c) => {
      if (c.website) {
        const url = c.website.startsWith('http') ? c.website : `https://${c.website}`
        return `<li><strong>${escHtml(c.role)}:</strong> <a href="${escHtml(url)}" target="_blank" rel="noopener">${escHtml(c.name)}</a></li>`
      }
      return `<li><strong>${escHtml(c.role)}:</strong> ${escHtml(c.name)}</li>`
    })
    .join('\n  ')
  return `<ul>\n  ${items}\n</ul>`
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
