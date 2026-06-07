type ExtractedContact = {
  first_name: string
  last_name: string
  email?: string
  phone?: string
  partner_first_name?: string
  partner_last_name?: string
  partner_email?: string
  partner_phone?: string
  wedding_date?: string
  wedding_location?: string
  source?: string
  notes?: string
}

export type ExtractionResult = {
  contacts: ExtractedContact[]
  confidence: 'high' | 'medium' | 'low'
  notes: string
}

const EXTRACTION_PROMPT = `You are a data extraction assistant for a wedding vendor CRM. Extract contact records from the provided text.

Return a JSON object with:
- "contacts": an array of contact objects
- "confidence": "high", "medium", or "low" based on data quality
- "notes": a brief note about the extraction (e.g. "Found 5 contacts from an enquiry list")

Each contact object should have these fields (omit any that aren't present):
- first_name (required)
- last_name (required — use "" if truly unknown)
- email
- phone
- partner_first_name
- partner_last_name
- partner_email
- partner_phone
- wedding_date (ISO format YYYY-MM-DD if possible, otherwise as written)
- wedding_location
- source
- notes

Normalise phone numbers. Parse dates into YYYY-MM-DD where possible. If two names appear together (e.g. "Sarah & Tom Smith"), treat them as a couple — first name + partner_first_name sharing the last name.

Respond ONLY with the JSON object. No markdown fences, no explanation.`

export async function extractContactsFromText(
  text: string,
  ai: Ai,
  anthropicKey?: string | null
): Promise<ExtractionResult> {
  const userMessage = `Extract contacts from this text:\n\n${text.slice(0, 15000)}`

  let response: string
  if (anthropicKey) {
    response = await callAnthropic(anthropicKey, userMessage)
  } else {
    response = await callWorkersAI(ai, userMessage)
  }

  const cleaned = response.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
  const parsed = JSON.parse(cleaned) as ExtractionResult

  if (!Array.isArray(parsed.contacts)) {
    throw new Error('AI response did not contain a contacts array')
  }

  const valid = parsed.contacts.filter(
    (c) => c.first_name && typeof c.first_name === 'string'
  )

  return {
    contacts: valid,
    confidence: parsed.confidence ?? 'low',
    notes: parsed.notes ?? `Extracted ${valid.length} contacts`,
  }
}

async function callAnthropic(apiKey: string, userMessage: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: EXTRACTION_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`AI extraction failed: ${err}`)
  }

  const data = (await res.json()) as {
    content: { type: string; text: string }[]
  }

  return data.content[0]?.text ?? ''
}

async function callWorkersAI(ai: Ai, userMessage: string): Promise<string> {
  const result = (await ai.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 4096,
  })) as { response?: string }

  return result.response ?? ''
}

export async function extractFromUrl(
  url: string,
  ai: Ai,
  anthropicKey?: string | null
): Promise<ExtractionResult> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are supported')
  }
  const hostname = parsed.hostname.toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname.startsWith('127.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('169.254.') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    throw new Error('Cannot fetch internal or private URLs')
  }

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'WeddingComputer/1.0 (Contact Import)',
      'Accept': 'text/html,text/plain,application/json',
    },
    redirect: 'follow',
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch URL: ${res.status} ${res.statusText}`)
  }

  const contentType = res.headers.get('content-type') ?? ''
  let text = await res.text()

  if (contentType.includes('text/html')) {
    text = stripHtml(text)
  }

  if (text.length < 10) {
    throw new Error('Page content too short to extract contacts from')
  }

  return extractContactsFromText(text, ai, anthropicKey)
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&rsquo;|&lsquo;/gi, "'")
    .replace(/&rdquo;|&ldquo;/gi, '"')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\s+/g, ' ')
    .trim()
}
