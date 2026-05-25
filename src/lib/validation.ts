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
      if (name === 'href' || name === 'src') {
        const v = value.trim().toLowerCase()
        if (v.startsWith('javascript:') || v.startsWith('vbscript:') || v.startsWith('data:')) continue
      }
      cleanAttrs.push(`${name}="${sanitize(value)}"`)
    }
    const isClosing = match.startsWith('</')
    return isClosing ? `</${t}>` : `<${t}${cleanAttrs.length ? ' ' + cleanAttrs.join(' ') : ''}>`
  })

  return result
}
