type DraftContext = {
  vendorName: string
  vendorCategory: string
  contactName: string
  contactEmail: string | null
  weddingDate: string | null
  weddingLocation: string | null
  status: string
  notes: string | null
  purpose: string
}

function buildPrompt(context: DraftContext): string {
  return `You are a wedding ${context.vendorCategory} named ${context.vendorName}. Draft a professional, warm email to ${context.contactName}.

Context:
- Contact status: ${context.status}
- Wedding date: ${context.weddingDate ?? 'not set'}
- Wedding location: ${context.weddingLocation ?? 'not set'}
${context.notes ? `- Notes: ${context.notes}` : ''}

Purpose of this email: ${context.purpose}

Write just the email body (no subject line, no greeting prefix like "Dear", no sign-off). Keep it concise (2-3 short paragraphs), professional but friendly. Use Australian English spelling.`
}

export async function draftEmail(
  ai: Ai,
  context: DraftContext,
  anthropicKey?: string | null,
): Promise<string> {
  const prompt = buildPrompt(context)

  if (anthropicKey) {
    return draftWithAnthropic(anthropicKey, prompt)
  }
  return draftWithWorkersAI(ai, prompt)
}

async function draftWithWorkersAI(ai: Ai, prompt: string): Promise<string> {
  const result = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 512,
  }) as { response?: string }

  return result.response ?? ''
}

async function draftWithAnthropic(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`AI draft failed: ${err}`)
  }

  const data = (await res.json()) as {
    content: { type: string; text: string }[]
  }

  return data.content[0]?.text ?? ''
}

export async function generateWithAI(
  ai: Ai,
  anthropicKey: string | null | undefined,
  prompt: string,
  maxTokens = 1024,
): Promise<string> {
  if (anthropicKey) return draftWithAnthropic(anthropicKey, prompt)
  const result = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
  }) as { response?: string }
  return result.response ?? ''
}

type RunSheetContext = {
  weddingDate: string | null
  weddingTime: string | null
  location: string | null
  ceremonyLocation: string | null
  ceremonyType: string | null
  receptionLocation: string | null
  receptionTime: string | null
  gettingReadyLocation: string | null
  gettingReadyTime: string | null
  gettingReady2Location: string | null
  gettingReady2Time: string | null
  portraitLocation: string | null
  portraitTime: string | null
  durationHours: number | null
  vendorCategory: string
  vendorName: string
  notes: string | null
}

export async function generateRunSheet(
  ai: Ai,
  context: RunSheetContext,
  anthropicKey?: string | null,
): Promise<Array<{ time: string; end_time: string; title: string; description: string; location: string; category: string }>> {
  const prompt = `You are helping a wedding ${context.vendorCategory} (${context.vendorName}) create a day-of run sheet for a wedding.

Wedding details:
- Date: ${context.weddingDate ?? 'TBD'}
- Ceremony time: ${context.weddingTime ?? 'TBD'}
- Duration: ${context.durationHours ?? 8} hours
- Ceremony type: ${context.ceremonyType ?? 'wedding'}
- Ceremony location: ${context.ceremonyLocation ?? context.location ?? 'TBD'}
- Reception location: ${context.receptionLocation ?? 'same venue'}
- Reception time: ${context.receptionTime ?? 'after ceremony'}
- Getting ready location: ${context.gettingReadyLocation ?? 'TBD'}
- Getting ready time: ${context.gettingReadyTime ?? 'TBD'}
${context.gettingReady2Location ? `- Getting ready (party 2): ${context.gettingReady2Location} at ${context.gettingReady2Time ?? 'TBD'}` : ''}
- Portrait location: ${context.portraitLocation ?? 'on-site'}
- Portrait time: ${context.portraitTime ?? 'after ceremony'}
${context.notes ? `- Notes: ${context.notes}` : ''}

Generate a detailed run sheet as a JSON array. Each item is an object with exactly these keys: time (24h format "HH:MM"), end_time ("HH:MM"), title (short), description (1 sentence), location, category (one of: getting_ready, ceremony, portraits, reception, other).

Include typical events for a ${context.vendorCategory}: arrivals, prep, ceremony, photos, reception key moments, pack-down. Use realistic Australian wedding timing.

Respond with ONLY the raw JSON array — start your reply with [ and end with ]. No markdown, no code fences, no commentary.`

  const raw = await generateWithAI(ai, anthropicKey, prompt, 2048)
  return parseRunSheetItems(raw)
}

// Robustly extract a run-sheet array from an LLM response. Handles code fences,
// surrounding prose, and a wrapping { "items": [...] } object. Returns [] only
// when nothing usable can be parsed (the caller surfaces that to the user).
export function parseRunSheetItems(
  raw: string,
): Array<{ time: string; end_time: string; title: string; description: string; location: string; category: string }> {
  let txt = (raw || '').trim()
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) txt = fence[1].trim()

  const start = txt.indexOf('[')
  const end = txt.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return []

  try {
    const parsed = JSON.parse(txt.slice(start, end + 1))
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x) => x && typeof x === 'object' && (x.title || x.time))
      .map((x) => ({
        time: typeof x.time === 'string' ? x.time : '',
        end_time: typeof x.end_time === 'string' ? x.end_time : '',
        title: typeof x.title === 'string' ? x.title : '',
        description: typeof x.description === 'string' ? x.description : '',
        location: typeof x.location === 'string' ? x.location : '',
        category: typeof x.category === 'string' ? x.category : 'other',
      }))
  } catch {
    return []
  }
}

type EnquiryReplyContext = {
  vendorName: string
  vendorCategory: string
  contactName: string
  weddingDate: string | null
  weddingLocation: string | null
  isAvailable: boolean | null
  busynessScore: number | null
  notes: string | null
  // Pro: vendor's own guidance for the reply (tone, what to mention).
  instructions?: string | null
  // Ask the enquirer to reply so they confirm the email arrived (not in spam).
  inviteReply?: boolean
}

export async function draftEnquiryReply(
  ai: Ai,
  context: EnquiryReplyContext,
  anthropicKey?: string | null,
): Promise<string> {
  const availabilityInfo = context.isAvailable === null
    ? 'Availability is unknown for this date.'
    : context.isAvailable
      ? `You ARE available on ${context.weddingDate}.${context.busynessScore !== null ? ` This date has a busyness score of ${context.busynessScore.toFixed(1)} (${context.busynessScore > 2 ? 'very popular' : context.busynessScore > 1 ? 'moderately busy' : 'relatively quiet'}).` : ''}`
      : `You are NOT available on ${context.weddingDate}.`

  const instructionsBlock = context.instructions?.trim()
    ? `\nSpecific guidance from ${context.vendorName} for this reply (follow it): ${context.instructions.trim()}\n`
    : ''
  const replyNudge = context.inviteReply
    ? ' End by warmly inviting them to reply to this email so they know it arrived safely (in case it lands in their spam).'
    : ''

  const prompt = `You are a wedding ${context.vendorCategory} named ${context.vendorName}. A new enquiry just came in from ${context.contactName}.

${context.weddingDate ? `Requested date: ${context.weddingDate}` : 'No date specified'}
${context.weddingLocation ? `Location: ${context.weddingLocation}` : ''}
${context.notes ? `Their message: ${context.notes}` : ''}

${availabilityInfo}
${instructionsBlock}
Draft a warm, professional reply acknowledging their enquiry. If available, express enthusiasm. If not available, be gracious and suggest they check back or offer alternative dates. Keep it concise (2-3 paragraphs), friendly, Australian English.${replyNudge} Write just the body — no subject line, no sign-off.`

  return generateWithAI(ai, anthropicKey, prompt)
}
