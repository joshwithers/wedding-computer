export type ParsedEmail = {
  from: string
  fromName: string | null
  to: string
  subject: string
  messageId: string | null
  inReplyTo: string | null
  references: string | null
  textBody: string | null
  htmlBody: string | null
}

export function parseRawEmail(raw: string, headers: Headers): ParsedEmail {
  const from = headers.get('From') ?? ''
  const fromParsed = parseAddress(from)

  return {
    from: fromParsed.email,
    fromName: fromParsed.name,
    to: headers.get('To') ?? '',
    subject: headers.get('Subject') ?? '(no subject)',
    messageId: headers.get('Message-ID') ?? null,
    inReplyTo: headers.get('In-Reply-To') ?? null,
    references: headers.get('References') ?? null,
    textBody: extractTextBody(raw, headers),
    htmlBody: extractHtmlBody(raw, headers),
  }
}

function parseAddress(addr: string): { email: string; name: string | null } {
  const match = addr.match(/^(.+?)\s*<([^>]+)>$/)
  if (match) {
    return { name: match[1].replace(/^"|"$/g, '').trim(), email: match[2].trim().toLowerCase() }
  }
  return { name: null, email: addr.trim().toLowerCase() }
}

function extractTextBody(raw: string, headers: Headers): string | null {
  const contentType = headers.get('Content-Type') ?? 'text/plain'

  if (contentType.includes('multipart/')) {
    return extractMimePart(raw, 'text/plain')
  }

  if (contentType.includes('text/plain')) {
    return extractBodyAfterHeaders(raw)
  }

  return null
}

function extractHtmlBody(raw: string, headers: Headers): string | null {
  const contentType = headers.get('Content-Type') ?? 'text/plain'

  if (contentType.includes('multipart/')) {
    return extractMimePart(raw, 'text/html')
  }

  if (contentType.includes('text/html')) {
    return extractBodyAfterHeaders(raw)
  }

  return null
}

function extractBodyAfterHeaders(raw: string): string {
  const idx = raw.indexOf('\r\n\r\n')
  if (idx !== -1) return decodeBody(raw.slice(idx + 4))
  const idx2 = raw.indexOf('\n\n')
  if (idx2 !== -1) return decodeBody(raw.slice(idx2 + 2))
  return raw
}

function extractMimePart(raw: string, mimeType: string): string | null {
  const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i)
  if (!boundaryMatch) return null

  const boundary = boundaryMatch[1]
  const parts = raw.split(`--${boundary}`)

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n') !== -1
      ? part.indexOf('\r\n\r\n')
      : part.indexOf('\n\n')
    if (headerEnd === -1) continue

    const partHeaders = part.slice(0, headerEnd).toLowerCase()
    if (!partHeaders.includes(mimeType)) continue

    let body = part.slice(headerEnd + (part.indexOf('\r\n\r\n') !== -1 ? 4 : 2))
    const endBoundary = body.indexOf(`--${boundary}`)
    if (endBoundary !== -1) body = body.slice(0, endBoundary)

    if (partHeaders.includes('quoted-printable')) {
      body = decodeQuotedPrintable(body)
    } else if (partHeaders.includes('base64')) {
      try { body = atob(body.replace(/\s/g, '')) } catch {}
    }

    return body.trim()
  }

  return null
}

function decodeBody(body: string): string {
  return body.trim()
}

function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}
