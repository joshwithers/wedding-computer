/**
 * frame-ancestors value for an embeddable public page (booking/quote/form with
 * ?embed=1): 'self' plus the vendor's own site origin, so the page can be framed
 * on their website but not by an arbitrary attacker origin. Returns null when the
 * vendor has no usable site — the caller then leaves the page framable (current
 * behaviour) rather than breaking the embed for vendors without a website.
 *
 * Embed handlers stash the result via c.set('embedFrameAncestors', …); the global
 * CSP middleware in index.tsx reads it when building the policy for embed pages.
 */
export function embedFrameAncestors(website: string | null | undefined): string | null {
  if (!website) return null
  try {
    const u = new URL(website.includes('://') ? website : `https://${website}`)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return `'self' ${u.protocol}//${u.host}`
  } catch {
    return null
  }
}
