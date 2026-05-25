import type { Bindings } from '../types'
import { parseRawEmail } from '../lib/mime'
import { createEmail, findVendorByEmailHandle, findContactByEmail, getEmailByMessageId } from '../db/emails'

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

  const contact = await findContactByEmail(env.DB, vendor.id, parsed.from)

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
