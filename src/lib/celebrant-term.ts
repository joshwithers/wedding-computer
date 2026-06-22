// In some countries a celebrant is called an "officiant". The vendor type stays
// the single canonical slug 'celebrant' everywhere (directory, matching, credits,
// analytics); a per-vendor preference (vendor_profiles.celebrant_term) only
// changes how THAT vendor's celebrant role is LABELLED. NULL = "Celebrant",
// 'officiant' = "Officiant".

import { t } from '../i18n'

export const CELEBRANT_SLUG = 'celebrant'
export const OFFICIANT_TERM = 'officiant'

/**
 * Whether the viewer's language actually distinguishes "celebrant" from
 * "officiant" (English does; many languages share one word). Guards the
 * dual-term picker label + the settings toggle so they don't show two
 * identical options where there's no distinction.
 */
export function celebrantTermsDiffer(): boolean {
  return t('onboarding.category.celebrant') !== t('onboarding.category.officiant')
}

type HasTerm = { celebrant_term?: string | null } | null | undefined

/** The vendor's chosen term: 'celebrant' (default) or 'officiant'. */
export function celebrantTermOf(vendor: HasTerm): 'celebrant' | 'officiant' {
  return vendor?.celebrant_term === OFFICIANT_TERM ? OFFICIANT_TERM : 'celebrant'
}

/** The display word for a vendor's celebrant role — "Celebrant" or "Officiant". */
export function celebrantTermLabel(vendor: HasTerm): string {
  return celebrantTermOf(vendor) === OFFICIANT_TERM ? 'Officiant' : 'Celebrant'
}

/** Normalise a submitted term value to the stored form (null = celebrant). */
export function normalizeCelebrantTerm(input: unknown): string | null {
  return String(input ?? '').trim().toLowerCase() === OFFICIANT_TERM ? OFFICIANT_TERM : null
}

/**
 * For DISPLAY only: swap the 'celebrant' slug for an 'officiant' pseudo-slug when
 * the vendor prefers that term, so role/credit formatters render "Officiant".
 * The stored slug is never changed.
 */
export function displayRoles(roles: string[], celebrantTerm: string | null | undefined): string[] {
  if (celebrantTerm !== OFFICIANT_TERM) return roles
  return roles.map((r) => (r === CELEBRANT_SLUG ? OFFICIANT_TERM : r))
}
