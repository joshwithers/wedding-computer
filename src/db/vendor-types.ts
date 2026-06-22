// Admin-managed vendor types — the approved "type of vendor" list shown when a
// vendor is added to a wedding. Seeded from VENDOR_CATEGORIES (migration 062);
// admins add/remove more. The role is stored as a free string on the membership,
// so changing this list never breaks existing weddings.

import { t } from '../i18n'
import type { MessageKey } from '../i18n'
import { VENDOR_CATEGORIES } from '../types'

export type VendorType = {
  slug: string
  label: string
  sort_order: number
  active: number
  is_system: number
  created_at: string
}

const TRANSLATED_SLUGS = new Set<string>(VENDOR_CATEGORIES)

// Display label: seeded/known slugs use the already-translated
// onboarding.category.<slug> string; custom admin-added types use their label.
export function vendorTypeLabel(type: { slug: string; label: string }): string {
  return TRANSLATED_SLUGS.has(type.slug) ? t(`onboarding.category.${type.slug}` as MessageKey) : type.label
}

// Slug from a human label: lowercase, collapse to single spaces, drop odd chars
// (matches existing slugs like "photo booth").
export function slugifyVendorType(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export async function listVendorTypes(
  db: D1Database,
  opts: { includeInactive?: boolean } = {}
): Promise<VendorType[]> {
  const where = opts.includeInactive ? '' : 'WHERE active = 1'
  const rows = (
    await db
      .prepare(`SELECT slug, label, sort_order, active, is_system, created_at FROM vendor_types ${where} ORDER BY sort_order ASC, label ASC`)
      .all<VendorType>()
  ).results
  if (rows.length > 0) return rows
  // Defensive fallback: table never seeded (schema applied without the seed).
  return VENDOR_CATEGORIES.map((slug, i) => ({
    slug,
    label: slug.charAt(0).toUpperCase() + slug.slice(1),
    sort_order: i,
    active: 1,
    is_system: 1,
    created_at: '',
  }))
}

export async function addVendorType(db: D1Database, label: string): Promise<{ ok: boolean; slug?: string; error?: string }> {
  const clean = label.trim()
  if (!clean) return { ok: false, error: 'A label is required.' }
  if (clean.length > 60) return { ok: false, error: 'That label is too long.' }
  const slug = slugifyVendorType(clean)
  if (!slug) return { ok: false, error: 'That label has no usable letters or numbers.' }

  // Re-activate (and refresh the label) if the slug already exists, incl. a
  // previously-removed one; otherwise append at the end of the list.
  const existing = await db.prepare('SELECT active FROM vendor_types WHERE slug = ?').bind(slug).first<{ active: number }>()
  if (existing) {
    if (existing.active === 1) return { ok: false, error: 'That type already exists.' }
    await db.prepare('UPDATE vendor_types SET active = 1, label = ? WHERE slug = ?').bind(clean, slug).run()
    return { ok: true, slug }
  }
  const max = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM vendor_types').first<{ m: number }>()
  await db
    .prepare('INSERT INTO vendor_types (slug, label, sort_order, active, is_system) VALUES (?, ?, ?, 1, 0)')
    .bind(slug, clean, (max?.m ?? -1) + 1)
    .run()
  return { ok: true, slug }
}

export async function setVendorTypeActive(db: D1Database, slug: string, active: boolean): Promise<void> {
  await db.prepare('UPDATE vendor_types SET active = ? WHERE slug = ?').bind(active ? 1 : 0, slug).run()
}
