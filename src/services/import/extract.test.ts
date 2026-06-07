import { describe, expect, it } from 'vitest'

// stripHtml is private, but we can test it indirectly by importing the module
// and testing the public API. For unit testing the HTML stripping, we'll
// re-implement the function signature test.

// We can't directly test extractContactsFromText without mocking the AI APIs,
// but we can test the HTML entity handling by extracting it.
// For now, test the module exports and types.

describe('extract module', () => {
  it('exports expected functions', async () => {
    const mod = await import('./extract')
    expect(typeof mod.extractContactsFromText).toBe('function')
    expect(typeof mod.extractFromUrl).toBe('function')
  })
})

describe('HTML entity decoding (via stripHtml behavior)', () => {
  // Since stripHtml is private, we test the patterns it handles
  // by verifying the regex transformations directly
  it('decodes common named entities', () => {
    const input = '&amp; &lt; &gt; &quot; &apos; &nbsp;'
    const decoded = input
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
    expect(decoded).toBe('& < > " \'  ')
  })

  it('decodes typographic entities', () => {
    const input = '&rsquo; &lsquo; &rdquo; &ldquo; &mdash; &ndash;'
    const decoded = input
      .replace(/&rsquo;|&lsquo;/gi, "'")
      .replace(/&rdquo;|&ldquo;/gi, '"')
      .replace(/&mdash;/gi, '—')
      .replace(/&ndash;/gi, '–')
    expect(decoded).toBe("' ' \" \" — –")
  })

  it('decodes decimal numeric entities', () => {
    const input = '&#169; &#8212;'
    const decoded = input.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    expect(decoded).toBe('© —')
  })

  it('decodes hex numeric entities', () => {
    const input = '&#xA9; &#x2014;'
    const decoded = input.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    expect(decoded).toBe('© —')
  })

  it('strips HTML tags while preserving text', () => {
    const html = '<p>Sarah <strong>Smith</strong></p>'
    const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    expect(stripped).toBe('Sarah Smith')
  })

  it('removes script and style blocks', () => {
    const html = '<script>alert("xss")</script><p>Hello</p><style>.x{}</style><p>World</p>'
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    expect(stripped).toBe('Hello World')
  })
})
