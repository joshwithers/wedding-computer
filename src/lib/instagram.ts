// Normalise whatever someone pastes into an Instagram field down to a bare
// handle (no @, no URL, no query string), so @mentions and profile links work.
// Handles: "foo", "@foo", "instagram.com/foo", "https://www.instagram.com/foo/",
// "https://instagram.com/foo?igshid=x", "  @foo ".
export function sanitizeInstagramHandle(input: string | null | undefined): string | null {
  if (!input) return null
  const s = String(input).trim()
  if (!s) return null
  // If it's a URL (any subdomain of instagram.com), take the first path segment.
  const url = s.match(/instagram\.com\/+([^/?#\s]+)/i)
  const handle = (url ? url[1] : s).replace(/^@+/, '').split(/[/?#\s]/)[0].trim()
  return handle || null
}
