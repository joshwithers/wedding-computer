// Fetch a web link's display metadata (title / site name / image) from its
// OpenGraph tags, with an SSRF guard. Best-effort: any failure falls back to
// the hostname so adding a link never blocks on a flaky page.
//
// Parsing is a pure function (parseLinkMetadataHtml) so it can be unit-tested
// without the network.

export type LinkMetadata = {
  url: string
  title: string
  siteName: string | null
  imageUrl: string | null
}

const FETCH_TIMEOUT_MS = 4000
const MAX_HTML_BYTES = 200_000

/** Parse a raw user string into a normalised http(s) URL, or null. */
export function normalizeUrl(raw: string): URL | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null
    return u
  } catch {
    return null
  }
}

/** Block private / loopback / link-local hosts to avoid SSRF. */
export function isFetchableHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return false

  // IPv4 literal
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 10 || a === 127 || a === 0) return false
    if (a === 169 && b === 254) return false // link-local (incl. cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
    return true
  }

  // IPv6 literal — block loopback, ULA (fc00::/7), link-local (fe80::/10)
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return false
    if (/^\[?(fc|fd|fe8|fe9|fea|feb)/.test(h)) return false
    return true
  }

  return true
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s">]+))', 'i')
  const m = tag.match(re)
  if (!m) return null
  return m[2] ?? m[3] ?? m[4] ?? null
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
}

function safeCodePoint(cp: number): string {
  try {
    return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : ''
  } catch {
    return ''
  }
}

/** Pure: pull title / site name / image from page HTML. */
export function parseLinkMetadataHtml(html: string): {
  title?: string
  siteName?: string
  imageUrl?: string
} {
  let ogTitle: string | undefined
  let twTitle: string | undefined
  let siteName: string | undefined
  let ogImage: string | undefined

  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase()
    const content = attr(tag, 'content')
    if (!content) continue
    if (key === 'og:title' && !ogTitle) ogTitle = content
    else if (key === 'twitter:title' && !twTitle) twTitle = content
    else if (key === 'og:site_name' && !siteName) siteName = content
    else if ((key === 'og:image' || key === 'og:image:url' || key === 'og:image:secure_url') && !ogImage) ogImage = content
  }

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const rawTitle = (ogTitle ?? twTitle ?? (titleTag ? titleTag[1] : '') ?? '').replace(/\s+/g, ' ').trim()
  const title = rawTitle ? decodeEntities(rawTitle) : undefined

  return {
    title,
    siteName: siteName ? decodeEntities(siteName.trim()) : undefined,
    imageUrl: ogImage ? ogImage.trim() : undefined,
  }
}

function fallbackTitle(u: URL): string {
  return u.hostname.replace(/^www\./, '')
}

function absoluteImage(img: string | undefined, base: URL): string | null {
  if (!img) return null
  try {
    const abs = new URL(img, base)
    return abs.protocol === 'http:' || abs.protocol === 'https:' ? abs.toString() : null
  } catch {
    return null
  }
}

async function readCapped(res: Response, cap: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, cap)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < cap) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.byteLength
    }
  }
  try {
    await reader.cancel()
  } catch {
    /* ignore */
  }
  const merged = new Uint8Array(Math.min(total, cap))
  let off = 0
  for (const c of chunks) {
    if (off >= merged.length) break
    const take = Math.min(c.byteLength, merged.length - off)
    merged.set(c.subarray(0, take), off)
    off += take
  }
  return new TextDecoder('utf-8').decode(merged)
}

/**
 * Resolve display metadata for a link. Returns null if the input isn't a valid
 * http(s) URL; otherwise always returns metadata (falling back to the hostname
 * when the page can't be fetched or parsed).
 */
export async function fetchLinkMetadata(raw: string): Promise<LinkMetadata | null> {
  const u = normalizeUrl(raw)
  if (!u) return null

  const fallback: LinkMetadata = {
    url: u.toString(),
    title: fallbackTitle(u),
    siteName: u.hostname.replace(/^www\./, ''),
    imageUrl: null,
  }
  if (!isFetchableHost(u.hostname)) return fallback

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(u.toString(), {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'WeddingComputerBot/1.0 (+https://wedding.computer)',
          Accept: 'text/html,application/xhtml+xml',
        },
      })
    } finally {
      clearTimeout(timer)
    }

    const ct = res.headers.get('content-type') ?? ''
    if (!res.ok || !/text\/html|application\/xhtml/i.test(ct)) {
      try {
        await res.body?.cancel()
      } catch {
        /* ignore */
      }
      return fallback
    }

    const html = await readCapped(res, MAX_HTML_BYTES)
    const meta = parseLinkMetadataHtml(html)
    return {
      url: u.toString(),
      title: meta.title || fallback.title,
      siteName: meta.siteName || fallback.siteName,
      imageUrl: absoluteImage(meta.imageUrl, u),
    }
  } catch {
    return fallback
  }
}
