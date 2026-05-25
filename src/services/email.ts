type SendEmailParams = {
  to: string
  toName?: string
  subject: string
  html: string
  apiKey: string
  from?: string
  replyTo?: string
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  const payload: Record<string, string> = {
    from: params.from ?? 'Wedding Computer <hello@wedding.computer>',
    to: params.toName ? `${params.toName} <${params.to}>` : params.to,
    subject: params.subject,
    html: params.html,
  }
  if (params.replyTo) payload.reply_to = params.replyTo

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend error ${res.status}: ${body}`)
  }
}

export function newLeadEmail(data: {
  contactName: string
  contactEmail: string
  contactPhone: string | null
  partnerName: string | null
  weddingDate: string | null
  weddingLocation: string | null
  message: string | null
  appUrl: string
  contactId: string
}): string {
  const details = [
    `<strong>Name:</strong> ${data.contactName}`,
    `<strong>Email:</strong> ${data.contactEmail}`,
    data.contactPhone ? `<strong>Phone:</strong> ${data.contactPhone}` : null,
    data.partnerName ? `<strong>Partner:</strong> ${data.partnerName}` : null,
    data.weddingDate ? `<strong>Wedding date:</strong> ${data.weddingDate}` : null,
    data.weddingLocation ? `<strong>Location:</strong> ${data.weddingLocation}` : null,
  ]
    .filter(Boolean)
    .join('<br>')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
  <h1 style="font-size: 20px; font-weight: 600; margin-bottom: 24px;">New enquiry from ${data.contactName}</h1>
  <div style="background: #f9f5f0; border-radius: 8px; padding: 20px; margin-bottom: 24px; line-height: 1.8; font-size: 14px;">
    ${details}
  </div>
  ${data.message ? `<div style="margin-bottom: 24px; padding: 16px; border-left: 3px solid #C53030; font-size: 14px; line-height: 1.6; color: #333;">${data.message}</div>` : ''}
  <a href="${data.appUrl}/app/contacts/${data.contactId}" style="display: inline-block; background: #C53030; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">View in Wedding Computer</a>
  <p style="margin-top: 32px; font-size: 13px; color: #666;">This lead was submitted via your enquiry form.</p>
</body>
</html>`
}

export function magicLinkEmail(url: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
  <h1 style="font-size: 20px; font-weight: 600; margin-bottom: 24px;">Sign in to Wedding Computer</h1>
  <p style="margin-bottom: 24px; line-height: 1.5;">Click the button below to sign in. This link expires in 15 minutes.</p>
  <a href="${url}" style="display: inline-block; background: #1a1a1a; color: #fff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500;">Sign in</a>
  <p style="margin-top: 32px; font-size: 13px; color: #666; line-height: 1.5;">If you didn't request this, you can safely ignore this email.</p>
</body>
</html>`
}
