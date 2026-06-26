export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
}

export function sanitize(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function trimOrNull(val: unknown): string | null {
  if (typeof val !== 'string') return null
  const trimmed = val.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function requireString(val: unknown, name: string): string {
  if (typeof val !== 'string' || val.trim().length === 0) {
    throw new Error(`${name} is required`)
  }
  return val.trim()
}

const SAFE_TAGS = new Set([
  'p', 'br', 'div', 'span', 'a', 'strong', 'b', 'em', 'i', 'u',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code', 'table', 'tr', 'td', 'th',
  'thead', 'tbody', 'hr', 'img', 'sup', 'sub', 'small',
])

const SAFE_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
}

// True only for href/src values that resolve to a safe scheme. We must mirror
// how a browser normalises a URL before picking the scheme: it ignores ASCII
// whitespace and C0 control characters anywhere in the value (so "java\tscript:"
// becomes "javascript:"), and HTML entities in the attribute are decoded first.
// A blocklist of "javascript:"/"vbscript:"/"data:" is therefore bypassable —
// we strip-then-allowlist instead. Relative URLs, anchors and query-only refs
// (no scheme) are allowed; any explicit scheme must be on the allowlist.
const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])
function isSafeUrlAttr(value: string): boolean {
  const decoded = value
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&(tab|newline);/gi, ' ')
  // Strip everything the URL parser ignores: all ASCII whitespace + C0 controls.
  const stripped = decoded.replace(/[\u0000-\u0020]+/g, '').toLowerCase()
  if (stripped === '' || stripped.startsWith('/') || stripped.startsWith('#') || stripped.startsWith('?')) {
    return true
  }
  const scheme = stripped.match(/^([a-z][a-z0-9+.-]*):/)
  if (!scheme) return true // no scheme → relative reference, safe
  return SAFE_URL_SCHEMES.has(scheme[1])
}

export function sanitizeHtml(html: string): string {
  let result = html
    .replace(/<script[\s>][\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s>][\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s>][\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s>][\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s>][\s\S]*?<\/embed>/gi, '')
    .replace(/<form[\s>][\s\S]*?<\/form>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|link|meta|base|svg)\s*\/?>/gi, '')

  result = result.replace(/<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi, (match, tag: string, attrs: string) => {
    const t = tag.toLowerCase()
    if (!SAFE_TAGS.has(t)) return ''
    const allowed = SAFE_ATTRS[t]
    if (!allowed) return `<${match.startsWith('</') ? '/' : ''}${t}>`
    const cleanAttrs: string[] = []
    const attrRegex = /([a-z][a-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/gi
    let m: RegExpExecArray | null
    while ((m = attrRegex.exec(attrs)) !== null) {
      const name = m[1].toLowerCase()
      const value = m[2] ?? m[3] ?? m[4] ?? ''
      if (!allowed.has(name)) continue
      if ((name === 'href' || name === 'src') && !isSafeUrlAttr(value)) continue
      cleanAttrs.push(`${name}="${sanitize(value)}"`)
    }
    const isClosing = match.startsWith('</')
    return isClosing ? `</${t}>` : `<${t}${cleanAttrs.length ? ' ' + cleanAttrs.join(' ') : ''}>`
  })

  return result
}
