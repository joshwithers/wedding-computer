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
  const result = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
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
