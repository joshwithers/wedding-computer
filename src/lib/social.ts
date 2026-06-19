// Helpers for rendering couple/contact social handles.

export type SocialNetwork = 'instagram' | 'facebook' | 'tiktok' | 'website'

// Resolve a stored social handle/URL into a full https link. Accepts either a
// bare "@handle" / "handle" or an existing URL.
export function socialUrl(
  network: SocialNetwork,
  raw: string | null | undefined,
): string | undefined {
  if (!raw) return undefined
  const v = raw.trim()
  if (!v) return undefined
  if (/^https?:\/\//i.test(v)) return v
  if (network === 'website') return `https://${v}`
  const handle = v.replace(/^@/, '').replace(/\/+$/, '')
  if (!handle) return undefined
  switch (network) {
    case 'instagram':
      return `https://instagram.com/${handle}`
    case 'facebook':
      return `https://facebook.com/${handle}`
    case 'tiktok':
      return `https://tiktok.com/@${handle}`
  }
}

// Show a tidy handle for social fields (strip protocol/domain noise).
export function socialDisplay(raw: string): string {
  const v = raw.trim()
  const m = v.match(/^https?:\/\/(?:www\.)?[^/]+\/@?([^/?#]+)/i)
  if (m && m[1]) return `@${m[1]}`
  if (/^https?:\/\//i.test(v)) return v
  return v.startsWith('@') ? v : `@${v}`
}
