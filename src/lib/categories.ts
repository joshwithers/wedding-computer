// Vendor category helpers. A vendor has one primary `category` (kept for the
// public directory API shape, analytics benchmarks, and AI context) plus a
// `categories` JSON array holding every type they work as.

import { CELEBRANT_SLUG, celebrantTermLabel } from './celebrant-term'

/** Vendor types that administer weddings and control the timeline. */
export const MANAGER_CATEGORIES = ['planner', 'venue'] as const

type CategorisedVendor = { category: string | null; categories?: string | null; celebrant_term?: string | null }

/** All categories for a vendor, parsed; falls back to the primary. */
export function vendorCategories(vendor: CategorisedVendor): string[] {
  if (vendor.categories) {
    try {
      const parsed = JSON.parse(vendor.categories)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(String)
    } catch {
      // fall through to primary
    }
  }
  return vendor.category ? [vendor.category] : []
}

export function hasCategory(vendor: CategorisedVendor, category: string): boolean {
  return vendorCategories(vendor).includes(category)
}

/** Planner or venue — administers weddings they're on. */
export function isManagerVendor(vendor: CategorisedVendor): boolean {
  const cats = vendorCategories(vendor)
  return MANAGER_CATEGORIES.some((c) => cats.includes(c))
}

/** Display label: "Photographer", or "Photographer · Videographer". The
 *  'celebrant' slug honours the vendor's chosen term (Celebrant / Officiant). */
export function categoriesLabel(vendor: CategorisedVendor): string {
  return vendorCategories(vendor)
    .map((c) => (c === CELEBRANT_SLUG ? celebrantTermLabel(vendor) : c.charAt(0).toUpperCase() + c.slice(1)))
    .join(' · ')
}
