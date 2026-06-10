import type { Bindings } from '../types'
import { parseRawEmail } from '../lib/mime'
import { createEmail, findVendorByEmailHandle, findContactByEmail, getEmailByMessageId } from '../db/emails'
import { consumeRateLimit } from '../middleware/rate-limit'

const MAX_INBOUND_BYTES = 2_000_000 // 2MB — bound memory + D1 storage per message

export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Bindings
): Promise<void> {
  const toAddr = message.to.toLowerCase()
  const handle = toAddr.split('@')[0]

  if (!handle || !toAddr.endsWith('@wedding.computer')) {
    message.setReject('Unknown recipient')
    return
  }

  const vendor = await findVendorByEmailHandle(env.DB, handle)
  if (!vendor) {
    console.log('[EMAIL] no vendor for handle', handle)
    message.setReject('Unknown recipient')
    return
  }

  // Bound how much unauthenticated mail one handle can store.
  if (!(await consumeRateLimit(env.KV, `inbound:${vendor.id}`, 120, 3600))) {
    console.warn('[EMAIL] inbound rate limit hit for vendor', vendor.id)
    message.setReject('Rate limited')
    return
  }

  // Reject oversized mail before buffering it into memory.
  if (typeof message.rawSize === 'number' && message.rawSize > MAX_INBOUND_BYTES) {
    console.warn('[EMAIL] inbound too large', message.rawSize, 'for vendor', vendor.id)
    message.setReject('Message too large')
    return
  }

  let rawText: string
  try {
    const reader = message.raw.getReader()
    const chunks: Uint8Array[] = []
    let done = false
    while (!done) {
      const result = await reader.read()
      if (result.value) chunks.push(result.value)
      done = result.done
    }
    const combined = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0))
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }
    rawText = new TextDecoder().decode(combined)
  } catch (e: any) {
    console.error('[EMAIL] failed to read raw email', e.message)
    message.setReject('Failed to process email')
    return
  }

  const parsed = parseRawEmail(rawText, message.headers)

  let threadId: string | null = null
  if (parsed.inReplyTo) {
    const parent = await getEmailByMessageId(env.DB, parsed.inReplyTo)
    if (parent) {
      threadId = parent.thread_id ?? parent.message_id
    }
  }

  // Only attribute mail to a known contact when the sender domain actually
  // authenticates (DMARC pass) — otherwise a spoofed From could impersonate
  // the vendor's real client. Unverified mail is still stored, just unlinked.
  const authResults = message.headers.get('authentication-results') ?? ''
  const dmarcPass = /dmarc=pass/i.test(authResults)
  const contact = dmarcPass ? await findContactByEmail(env.DB, vendor.id, parsed.from) : null

  await createEmail(env.DB, {
    vendor_id: vendor.id,
    contact_id: contact?.id ?? null,
    direction: 'inbound',
    from_email: parsed.from,
    from_name: parsed.fromName,
    to_email: toAddr,
    to_name: vendor.business_name,
    subject: parsed.subject,
    body_text: parsed.textBody,
    body_html: parsed.htmlBody,
    message_id: parsed.messageId,
    in_reply_to: parsed.inReplyTo,
    thread_id: threadId,
    status: 'received',
    is_system: 0,
  })

  console.log('[EMAIL] inbound stored for vendor', vendor.id, 'from', parsed.from)
}
