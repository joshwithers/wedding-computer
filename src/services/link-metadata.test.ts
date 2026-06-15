import { describe, it, expect } from 'vitest'
import {
  normalizeUrl,
  isFetchableHost,
  parseLinkMetadataHtml,
  decodeEntities,
} from './link-metadata'

describe('normalizeUrl', () => {
  it('adds https:// to a bare domain', () => {
    expect(normalizeUrl('example.com/gallery')?.toString()).toBe('https://example.com/gallery')
  })

  it('keeps an explicit http/https scheme', () => {
    expect(normalizeUrl('http://foo.com')?.protocol).toBe('http:')
    expect(normalizeUrl('https://foo.com')?.protocol).toBe('https:')
  })

  it('rejects non-http(s) and junk', () => {
    expect(normalizeUrl('ftp://x.com')).toBeNull()
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('not a url')).toBeNull()
    expect(normalizeUrl('')).toBeNull()
    expect(normalizeUrl('bareword')).toBeNull() // no dot, not localhost
  })
})

describe('isFetchableHost (SSRF guard)', () => {
  it('blocks loopback, link-local and private ranges', () => {
    for (const h of ['localhost', 'app.local', '127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.0.1', '172.31.255.1', '169.254.169.254', '100.64.0.1', '::1', 'fe80::1', 'fd00::1']) {
      expect(isFetchableHost(h)).toBe(false)
    }
  })

  it('allows public hosts and public IPs', () => {
    for (const h of ['example.com', 'pinterest.com', '8.8.8.8', '172.32.0.1', '11.0.0.1']) {
      expect(isFetchableHost(h)).toBe(true)
    }
  })
})

describe('parseLinkMetadataHtml', () => {
  it('prefers og:title and decodes entities (property-first attribute order)', () => {
    const html = '<meta property="og:title" content="Gallery — Sam &amp; Jo">'
    expect(parseLinkMetadataHtml(html).title).toBe('Gallery — Sam & Jo')
  })

  it('reads attributes regardless of order', () => {
    const html = '<meta content="Unsplash" property="og:site_name">'
    expect(parseLinkMetadataHtml(html).siteName).toBe('Unsplash')
  })

  it('falls back twitter:title → <title>', () => {
    expect(parseLinkMetadataHtml('<meta name="twitter:title" content="Tw Title">').title).toBe('Tw Title')
    expect(parseLinkMetadataHtml('<title>Doc Title</title>').title).toBe('Doc Title')
  })

  it('extracts og:image', () => {
    const html = '<meta property="og:image" content="https://img.example/x.jpg">'
    expect(parseLinkMetadataHtml(html).imageUrl).toBe('https://img.example/x.jpg')
  })

  it('returns nothing useful for metadata-free html', () => {
    expect(parseLinkMetadataHtml('<p>hi</p>').title).toBeUndefined()
  })
})

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('Tom &amp; Jerry')).toBe('Tom & Jerry')
    expect(decodeEntities('it&#39;s &#x2764; here')).toBe("it's ❤ here")
    expect(decodeEntities('&lt;tag&gt; &quot;x&quot;')).toBe('<tag> "x"')
  })
})
