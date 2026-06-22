import type { CoupleVendor } from '../types'
import { sanitizeInstagramHandle } from '../lib/instagram'
import { displayRoles } from '../lib/celebrant-term'

export type CreditEntry = {
  /** One or more vendor-type slugs this party is credited as on the wedding. */
  roles: string[]
  name: string
  instagram: string | null
  website: string | null
}

type MemberWithVendor = {
  vendor_profile_id: string | null
  vendor_role: string | null
  vendor_roles: string | null // JSON array of slugs for this wedding
  invited_instagram: string | null // handle captured before they had a profile
  business_name: string | null
  vendor_instagram: string | null
  vendor_website: string | null
  celebrant_term: string | null
  user_name: string
  role: string
}

/** Turn a slug ("content-creator") into a display label ("Content Creator"). */
export function formatRoleSlug(slug: string): string {
  return slug
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** The per-wedding roles for a member: the JSON array if set, else the single
 *  vendor_role, else empty. */
export function parseMemberRoles(vendorRoles: string | null, vendorRole: string | null): string[] {
  if (vendorRoles) {
    try {
      const arr = JSON.parse(vendorRoles)
      if (Array.isArray(arr)) {
        const clean = arr.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        if (clean.length) return clean
      }
    } catch {
      /* fall through to the singular role */
    }
  }
  return vendorRole ? [vendorRole] : []
}

/** Combined human label for a credit's roles, e.g. "Celebrant · Content Creator". */
export function rolesLabel(roles: string[]): string {
  const label = roles.map(formatRoleSlug).filter(Boolean).join(' · ')
  return label || 'Vendor'
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
  // Platform vendors are members; syncPlatformVendors also mirrors them into
  // couple_vendors (for the couple's view). Track member profile ids so we don't
  // credit the same vendor twice once that mirror row exists.
  const memberProfileIds = new Set<string>()

  // Platform vendors from wedding_members
  for (const m of members) {
    if (m.role !== 'vendor') continue
    if (m.vendor_profile_id) memberProfileIds.add(m.vendor_profile_id)
    const name = m.business_name ?? m.user_name
    credits.push({
      roles: displayRoles(parseMemberRoles(m.vendor_roles, m.vendor_role), m.celebrant_term),
      name,
      // An email-invited vendor has no profile yet — fall back to the handle
      // captured on the invite so their credit still links.
      instagram: sanitizeInstagramHandle(m.vendor_instagram ?? m.invited_instagram),
      website: m.vendor_website,
    })
  }

  // Couple-added vendors (only booked ones), skipping platform vendors already
  // credited above via their membership.
  for (const cv of coupleVendors) {
    if (cv.status !== 'booked') continue
    if (cv.vendor_profile_id && memberProfileIds.has(cv.vendor_profile_id)) continue
    credits.push({
      roles: cv.category ? [cv.category] : [],
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
      return `${rolesLabel(c.roles)}: ${c.name} ${handle !== c.name ? handle : ''}`
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
        return `- **${rolesLabel(c.roles)}:** [${c.name}](${url})`
      }
      return `- **${rolesLabel(c.roles)}:** ${c.name}`
    })
    .join('\n')
}

/** Format credits as HTML for blog/website embedding. */
export function formatHtmlCredits(credits: CreditEntry[]): string {
  const items = credits
    .map((c) => {
      if (c.website) {
        const url = c.website.startsWith('http') ? c.website : `https://${c.website}`
        return `<li><strong>${escHtml(rolesLabel(c.roles))}:</strong> <a href="${escHtml(url)}" target="_blank" rel="noopener">${escHtml(c.name)}</a></li>`
      }
      return `<li><strong>${escHtml(rolesLabel(c.roles))}:</strong> ${escHtml(c.name)}</li>`
    })
    .join('\n  ')
  return `<ul>\n  ${items}\n</ul>`
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
