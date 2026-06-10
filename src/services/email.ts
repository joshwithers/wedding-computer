import { createEmail, updateEmailStatus } from '../db/emails'
import { sanitize } from '../lib/validation'

// HTML-escape a value for safe interpolation into raw email HTML strings.
// (sanitize performs HTML-entity encoding.) Form/contact data is now stored
// raw, so it must be escaped here at the output boundary.
const esc = (v: string | null | undefined): string => (v ? sanitize(v) : '')

type SendEmailParams = {
  db: D1Database
  resendApiKey: string
  vendorId: string | null
  contactId?: string | null
  to: string
  toName?: string
  subject: string
  html: string
  text?: string
  from?: string
  fromName?: string
  replyTo?: string
  isSystem?: boolean
  threadId?: string | null
  inReplyTo?: string | null
  /**
   * For preference-gated notifications: adds a "manage / unsubscribe" footer
   * to the email body and RFC 8058 List-Unsubscribe headers so mail clients
   * can offer native one-click unsubscribe.
   */
  unsubscribe?: { manageUrl: string; unsubscribeUrl: string }
}

// Appended to notification emails so every preference-gated email carries its
// own opt-out. Injected just before </body> — works for any wrapper-built html.
function unsubscribeFooter(manageUrl: string, unsubscribeUrl: string): string {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:0 16px 32px;">
      <p style="margin:0;font-size:12px;color:#999;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;">
        You choose which emails you get from Wedding Computer —
        <a href="${manageUrl}" style="color:#999;text-decoration:underline;">manage email preferences</a>
        or <a href="${unsubscribeUrl}" style="color:#999;text-decoration:underline;">unsubscribe from emails like this</a>.
      </p>
    </td></tr>
  </table>`
}

export async function sendEmailMessage(params: SendEmailParams): Promise<string> {
  const fromAddr = params.from ?? 'hello@wedding.computer'
  const fromName = params.fromName ?? 'Wedding Computer'

  if (params.unsubscribe) {
    const footer = unsubscribeFooter(params.unsubscribe.manageUrl, params.unsubscribe.unsubscribeUrl)
    params = {
      ...params,
      html: params.html.includes('</body>')
        ? params.html.replace('</body>', `${footer}</body>`)
        : params.html + footer,
    }
  }

  const messageId = `<${crypto.randomUUID()}@wedding.computer>`

  const record = await createEmail(params.db, {
    vendor_id: params.vendorId,
    contact_id: params.contactId ?? null,
    direction: 'outbound',
    from_email: fromAddr,
    from_name: fromName,
    to_email: params.to,
    to_name: params.toName ?? null,
    reply_to: params.replyTo ?? null,
    subject: params.subject,
    body_text: params.text ?? null,
    body_html: params.html,
    message_id: messageId,
    in_reply_to: params.inReplyTo ?? null,
    thread_id: params.threadId ?? null,
    status: 'queued',
    is_system: params.isSystem ? 1 : 0,
  })

  try {
    const headers: Record<string, string> = {}
    if (params.inReplyTo) {
      headers['In-Reply-To'] = params.inReplyTo
      headers['References'] = params.inReplyTo
    }
    if (params.unsubscribe) {
      // RFC 8058 one-click unsubscribe — mail clients show a native button.
      headers['List-Unsubscribe'] = `<${params.unsubscribe.unsubscribeUrl}>`
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${params.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${fromName} <${fromAddr}>`,
        to: params.toName ? `${params.toName} <${params.to}>` : params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
        reply_to: params.replyTo,
        headers,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Resend API error ${res.status}: ${body}`)
    }

    await updateEmailStatus(params.db, record.id, 'sent')
  } catch (e: any) {
    await updateEmailStatus(params.db, record.id, 'failed', e.message)
    throw e
  }

  return record.id
}

function emailWrapper(content: string, options?: { preheader?: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  ${options?.preheader ? `<span style="display:none;max-height:0;overflow:hidden;mso-hide:all">${options.preheader}</span>` : ''}
</head>
<body style="margin:0;padding:0;background:#faf5ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf5ef;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <!-- Logo -->
        <tr><td style="padding-bottom:24px;text-align:center;">
          <a href="https://wedding.computer" style="text-decoration:none;color:#be2f2f;font-size:16px;font-weight:700;letter-spacing:-0.3px;">Wedding Computer</a>
        </td></tr>
        <!-- Card -->
        <tr><td style="background:#ffffff;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
          ${content}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding-top:24px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#999;line-height:1.5;">
            <a href="https://wedding.computer" style="color:#999;text-decoration:none;">wedding.computer</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
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
    `<strong>Name:</strong> ${esc(data.contactName)}`,
    `<strong>Email:</strong> ${esc(data.contactEmail)}`,
    data.contactPhone ? `<strong>Phone:</strong> ${esc(data.contactPhone)}` : null,
    data.partnerName ? `<strong>Partner:</strong> ${esc(data.partnerName)}` : null,
    data.weddingDate ? `<strong>Wedding date:</strong> ${esc(data.weddingDate)}` : null,
    data.weddingLocation ? `<strong>Location:</strong> ${esc(data.weddingLocation)}` : null,
  ]
    .filter(Boolean)
    .join('<br>')

  return emailWrapper(`
    <h1 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#1a1a1a;">New enquiry from ${esc(data.contactName)}</h1>
    <div style="background:#faf5ef;border-radius:12px;padding:16px;margin-bottom:20px;line-height:1.8;font-size:14px;color:#333;">
      ${details}
    </div>
    ${data.message ? `<div style="margin-bottom:20px;padding:14px;border-left:3px solid #be2f2f;font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap;">${esc(data.message)}</div>` : ''}
    <a href="${data.appUrl}/app/contacts/${data.contactId}" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View contact</a>
    <p style="margin:20px 0 0;font-size:13px;color:#999;">Submitted via your enquiry form.</p>
  `, { preheader: `New enquiry from ${esc(data.contactName)}` })
}

export function referralRewardEmail(data: { appUrl: string }): string {
  return emailWrapper(`
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1a1a1a;">You earned a free month 🎉</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333;">
      Someone you referred just subscribed to Wedding Computer Pro — so you've earned a
      <strong>free month</strong>. It's applied automatically as a credit to your next Pro invoice.
    </p>
    <a href="${data.appUrl}/app/refer" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View your referrals</a>
    <p style="margin:20px 0 0;font-size:13px;color:#999;">Keep sharing your link to keep earning — up to 9 months at a time.</p>
  `, { preheader: 'A referral subscribed — you earned a free month' })
}

export function coupleInviteEmail(data: {
  coupleName: string
  vendorName: string
  weddingTitle: string
  weddingDate: string | null
  loginUrl: string
}): string {
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">You're booked with ${data.vendorName}</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 24px;">
      Hi ${data.coupleName}, ${data.vendorName} has set up your wedding${data.weddingDate ? ` on ${data.weddingDate}` : ''} on Wedding Computer.
      You can view your wedding details, invoices, and stay in touch — all in one place.
    </p>
    <a href="${data.loginUrl}" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View your wedding</a>
    <p style="margin:24px 0 0;font-size:13px;color:#999;line-height:1.5;">
      This link will sign you in automatically. If you didn't expect this email, you can safely ignore it.
    </p>
  `, { preheader: `${data.vendorName} has added you to Wedding Computer` })
}

export function magicLinkEmail(url: string): string {
  return emailWrapper(`
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1a1a1a;">Sign in to Wedding Computer</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#333;">Click the button below to sign in. This link expires in 15 minutes.</p>
    <a href="${url}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">Sign in</a>
    <p style="margin:24px 0 0;font-size:13px;color:#999;line-height:1.5;">If you didn't request this, you can safely ignore this email.</p>
  `, { preheader: 'Your sign-in link for Wedding Computer' })
}

// ─── Notification email templates ───

export function invoiceSentEmail(data: {
  coupleName: string
  vendorName: string
  invoiceTitle: string
  amountFormatted: string
  dueDate: string | null
  loginUrl: string
}): string {
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">New invoice from ${data.vendorName}</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">
      Hi ${data.coupleName}, ${data.vendorName} has sent you an invoice.
    </p>
    <div style="background:#faf5ef;border-radius:12px;padding:16px;margin-bottom:20px;">
      <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#1a1a1a;">${data.invoiceTitle}</p>
      <p style="margin:0;font-size:24px;font-weight:700;color:#1a1a1a;">${data.amountFormatted}</p>
      ${data.dueDate ? `<p style="margin:8px 0 0;font-size:13px;color:#666;">Due ${data.dueDate}</p>` : ''}
    </div>
    <a href="${data.loginUrl}" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View invoice</a>
  `, { preheader: `Invoice for ${data.amountFormatted} from ${data.vendorName}` })
}

export function vendorAddedEmail(data: {
  vendorName: string
  addedByName: string
  weddingTitle: string
  ceremonyType: string
  weddingDate: string | null
  loginUrl: string
}): string {
  const typeLabel = data.ceremonyType.charAt(0).toUpperCase() + data.ceremonyType.slice(1)
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">You've been added to a ${data.ceremonyType}</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">
      Hi ${data.vendorName}, ${data.addedByName} has added you to <strong>${data.weddingTitle}</strong>${data.weddingDate ? ` on ${data.weddingDate}` : ''}.
    </p>
    <a href="${data.loginUrl}" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View ${data.ceremonyType}</a>
  `, { preheader: `${data.addedByName} added you to ${data.weddingTitle}` })
}

export function coupleJoinedEmail(data: {
  vendorName: string
  coupleName: string
  weddingTitle: string
  appUrl: string
  weddingId: string
}): string {
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">${data.coupleName} has joined</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">
      Hi ${data.vendorName}, ${data.coupleName} has accepted the invitation and joined <strong>${data.weddingTitle}</strong> on Wedding Computer.
    </p>
    <a href="${data.appUrl}/app/weddings/${data.weddingId}" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View wedding</a>
  `, { preheader: `${data.coupleName} joined ${data.weddingTitle}` })
}

export function visibilityChangedEmail(data: {
  vendorName: string
  weddingTitle: string
  isNowVisible: boolean
  loginUrl: string
}): string {
  const message = data.isNowVisible
    ? `The couple on <strong>${data.weddingTitle}</strong> has enabled vendor collaboration. You can now see other vendors working on this wedding.`
    : `The couple on <strong>${data.weddingTitle}</strong> has turned off vendor collaboration. Other vendors are no longer visible.`
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">Vendor visibility updated</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">
      Hi ${data.vendorName}, ${message}
    </p>
    <a href="${data.loginUrl}" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View wedding</a>
  `, { preheader: `Vendor visibility changed for ${data.weddingTitle}` })
}

export function bookingConfirmedEmail(data: {
  recipientName: string
  weddingTitle: string
  ceremonyType: string
  weddingDate: string | null
  weddingLocation: string | null
  loginUrl: string
}): string {
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">${data.ceremonyType.charAt(0).toUpperCase() + data.ceremonyType.slice(1)} confirmed</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">
      Great news! <strong>${data.weddingTitle}</strong> has been confirmed.
    </p>
    <div style="background:#faf5ef;border-radius:12px;padding:16px;margin-bottom:20px;font-size:14px;line-height:1.8;color:#333;">
      ${data.weddingDate ? `<strong>Date:</strong> ${data.weddingDate}<br>` : ''}
      ${data.weddingLocation ? `<strong>Location:</strong> ${data.weddingLocation}` : ''}
    </div>
    <a href="${data.loginUrl}" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View details</a>
  `, { preheader: `${data.weddingTitle} is confirmed!` })
}

export function vendorRemovedAdminEmail(data: {
  coupleName: string
  coupleEmail: string
  vendorName: string
  vendorCategory: string
  weddingTitle: string
  weddingDate: string | null
  weddingId: string
}): string {
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#be2f2f;">Vendor removed from wedding</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">
      A couple has removed a vendor from their wedding. This may indicate a safety concern.
    </p>
    <div style="background:#faf5ef;border-radius:12px;padding:16px;margin-bottom:20px;font-size:14px;line-height:1.8;color:#333;">
      <strong>Couple:</strong> ${data.coupleName} (${data.coupleEmail})<br>
      <strong>Vendor removed:</strong> ${data.vendorName} (${data.vendorCategory})<br>
      <strong>Wedding:</strong> ${data.weddingTitle}<br>
      ${data.weddingDate ? `<strong>Date:</strong> ${data.weddingDate}<br>` : ''}
      <strong>Wedding ID:</strong> ${data.weddingId}
    </div>
    <p style="font-size:13px;color:#999;line-height:1.5;">
      The vendor has not been notified. The couple's contact record with this vendor has been marked as lost.
      Please review if follow-up is needed.
    </p>
  `, { preheader: `${data.coupleName} removed ${data.vendorName} from ${data.weddingTitle}` })
}

export function paymentReceivedEmail(data: {
  vendorName: string
  weddingTitle: string
  amountFormatted: string
  paymentLabel: string
  viewUrl: string
}): string {
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">Payment received</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">
      ${esc(data.vendorName)}, a payment of <strong>${data.amountFormatted}</strong> has been recorded for <strong>${esc(data.paymentLabel)}</strong> on ${esc(data.weddingTitle)}.
    </p>
    <a href="${data.viewUrl}" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View details</a>
  `, { preheader: `${data.amountFormatted} payment received for ${esc(data.weddingTitle)}` })
}

export function clientPaymentOverdueEmail(data: {
  vendorName: string
  clientName: string
  invoiceTitle: string
  paymentLabel: string
  amountFormatted: string
  dueDate: string
  viewUrl: string
}): string {
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">A client payment is overdue</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">
      Hi ${esc(data.vendorName)}, a payment from <strong>${esc(data.clientName)}</strong> was due ${esc(data.dueDate)} and hasn't been recorded yet. We've sent them a reminder too.
    </p>
    <div style="background:#faf5ef;border-radius:12px;padding:16px;margin-bottom:20px;">
      <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#1a1a1a;">${esc(data.invoiceTitle)} — ${esc(data.paymentLabel)}</p>
      <p style="margin:0;font-size:24px;font-weight:700;color:#1a1a1a;">${data.amountFormatted}</p>
      <p style="margin:8px 0 0;font-size:13px;color:#be2f2f;font-weight:600;">Was due ${esc(data.dueDate)}</p>
    </div>
    <a href="${data.viewUrl}" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View invoice</a>
    <p style="margin:20px 0 0;font-size:13px;color:#999;line-height:1.5;">Received this payment outside Wedding Computer? Record it on the invoice to stop reminders.</p>
  `, { preheader: `Overdue: ${data.amountFormatted} from ${esc(data.clientName)}` })
}

export function vendorBookedEmail(data: {
  recipientVendorName: string
  coupleName: string
  bookedVendorName: string
  bookedVendorCategory: string
  weddingTitle: string
  appUrl: string
  weddingId: string
}): string {
  const cat = data.bookedVendorCategory.charAt(0).toUpperCase() + data.bookedVendorCategory.slice(1)
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">New vendor booked</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">
      Hi ${data.recipientVendorName}, ${data.coupleName} has just booked <strong>${data.bookedVendorName}</strong> as their ${cat} for <strong>${data.weddingTitle}</strong>.
    </p>
    <a href="${data.appUrl}/app/weddings/${data.weddingId}" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View wedding</a>
  `, { preheader: `${data.coupleName} booked ${data.bookedVendorName} for ${data.weddingTitle}` })
}

export function weddingDetailsUpdatedEmail(data: {
  vendorName: string
  coupleName: string
  weddingTitle: string
  appUrl: string
  weddingId: string
}): string {
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">Wedding details updated</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">
      Hi ${data.vendorName}, ${data.coupleName} has updated the details for <strong>${data.weddingTitle}</strong>.
      Log in to see what changed.
    </p>
    <a href="${data.appUrl}/app/weddings/${data.weddingId}" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View details</a>
  `, { preheader: `${data.coupleName} updated details for ${data.weddingTitle}` })
}

export function paymentDueSoonEmail(data: {
  recipientName: string
  vendorName: string
  invoiceTitle: string
  amountFormatted: string
  dueDate: string
  loginUrl: string
}): string {
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">Payment due soon</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">
      Hi ${esc(data.recipientName)}, a friendly reminder that a payment to <strong>${esc(data.vendorName)}</strong> is due soon.
    </p>
    <div style="background:#faf5ef;border-radius:12px;padding:16px;margin-bottom:20px;">
      <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#1a1a1a;">${esc(data.invoiceTitle)}</p>
      <p style="margin:0;font-size:24px;font-weight:700;color:#1a1a1a;">${data.amountFormatted}</p>
      <p style="margin:8px 0 0;font-size:13px;color:#666;">Due ${esc(data.dueDate)}</p>
    </div>
    <a href="${data.loginUrl}" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View invoice</a>
  `, { preheader: `${data.amountFormatted} due ${esc(data.dueDate)} to ${esc(data.vendorName)}` })
}

export function paymentOverdueEmail(data: {
  recipientName: string
  vendorName: string
  invoiceTitle: string
  amountFormatted: string
  dueDate: string
  loginUrl: string
}): string {
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#be2f2f;">Payment overdue</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">
      Hi ${esc(data.recipientName)}, a payment to <strong>${esc(data.vendorName)}</strong> was due ${esc(data.dueDate)} and is now overdue.
    </p>
    <div style="background:#faf5ef;border-radius:12px;padding:16px;margin-bottom:20px;">
      <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#1a1a1a;">${esc(data.invoiceTitle)}</p>
      <p style="margin:0;font-size:24px;font-weight:700;color:#1a1a1a;">${data.amountFormatted}</p>
      <p style="margin:8px 0 0;font-size:13px;color:#be2f2f;font-weight:600;">Was due ${esc(data.dueDate)}</p>
    </div>
    <a href="${data.loginUrl}" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View invoice</a>
    <p style="margin:20px 0 0;font-size:13px;color:#999;line-height:1.5;">Already paid? It may take a moment to be recorded — you can safely ignore this email.</p>
  `, { preheader: `Overdue: ${data.amountFormatted} to ${esc(data.vendorName)}` })
}

export function paymentReceiptEmail(data: {
  recipientName: string
  vendorName: string
  invoiceTitle: string
  amountFormatted: string
  loginUrl: string
}): string {
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">Payment recorded</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">
      Hi ${esc(data.recipientName)}, your payment of <strong>${data.amountFormatted}</strong> to <strong>${esc(data.vendorName)}</strong> has been recorded. Thank you!
    </p>
    <div style="background:#faf5ef;border-radius:12px;padding:16px;margin-bottom:20px;">
      <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#1a1a1a;">${esc(data.invoiceTitle)}</p>
      <p style="margin:0;font-size:24px;font-weight:700;color:#1a1a1a;">${data.amountFormatted}</p>
    </div>
    <a href="${data.loginUrl}" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View invoice</a>
  `, { preheader: `Payment of ${data.amountFormatted} to ${esc(data.vendorName)} recorded` })
}

export function vendorJoinedWeddingEmail(data: {
  recipientName: string
  vendorBusinessName: string
  vendorCategory: string | null
  weddingTitle: string
  addedByName: string
  loginUrl: string
}): string {
  const cat = data.vendorCategory
    ? ` as your ${esc(data.vendorCategory)}`
    : ''
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">A vendor joined your wedding</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">
      Hi ${esc(data.recipientName)}, ${esc(data.addedByName)} has added <strong>${esc(data.vendorBusinessName)}</strong>${cat} to <strong>${esc(data.weddingTitle)}</strong>.
    </p>
    <a href="${data.loginUrl}" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View your wedding</a>
  `, { preheader: `${esc(data.vendorBusinessName)} joined ${esc(data.weddingTitle)}` })
}

export function adminSignupEmail(data: {
  kind: 'vendor' | 'couple'
  name: string
  email: string
  businessName?: string | null
  category?: string | null
  appUrl: string
}): string {
  const heading = data.kind === 'vendor' ? 'New vendor signup' : 'New couple signup'
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">${heading}</h1>
    <div style="background:#faf5ef;border-radius:12px;padding:16px;margin-bottom:20px;font-size:14px;line-height:1.8;color:#333;">
      <strong>Name:</strong> ${esc(data.name)}<br>
      <strong>Email:</strong> ${esc(data.email)}<br>
      ${data.businessName ? `<strong>Business:</strong> ${esc(data.businessName)}<br>` : ''}
      ${data.category ? `<strong>Category:</strong> ${esc(data.category)}<br>` : ''}
    </div>
    <a href="${data.appUrl}/admin" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">Open admin</a>
  `, { preheader: `${heading}: ${esc(data.businessName || data.name)}` })
}

export function dailyDigestEmail(data: {
  vendorName: string
  upcomingWeddings: { title: string; date: string; daysUntil: number }[]
  newContacts: { name: string; source: string | null }[]
  duePayments: { label: string; amount: string; weddingTitle: string; dueDate: string }[]
  upcomingEvents: { title: string; date: string; time: string | null }[]
  appUrl: string
}): string {
  let sections = ''

  if (data.upcomingWeddings.length > 0) {
    const items = data.upcomingWeddings.map((w) =>
      `<tr><td style="padding:8px 0;font-size:14px;color:#333;border-bottom:1px solid #f0f0f0;">
        <strong>${w.title}</strong><br>
        <span style="color:#666;font-size:13px;">${w.date} — ${w.daysUntil} day${w.daysUntil !== 1 ? 's' : ''} away</span>
      </td></tr>`
    ).join('')
    sections += `
      <h2 style="margin:24px 0 12px;font-size:16px;font-weight:700;color:#1a1a1a;">Upcoming weddings</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>`
  }

  if (data.newContacts.length > 0) {
    const items = data.newContacts.map((c) =>
      `<tr><td style="padding:8px 0;font-size:14px;color:#333;border-bottom:1px solid #f0f0f0;">
        <strong>${c.name}</strong>${c.source ? ` <span style="color:#999;font-size:12px;">via ${c.source}</span>` : ''}
      </td></tr>`
    ).join('')
    sections += `
      <h2 style="margin:24px 0 12px;font-size:16px;font-weight:700;color:#1a1a1a;">New contacts today</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>`
  }

  if (data.duePayments.length > 0) {
    const items = data.duePayments.map((p) =>
      `<tr><td style="padding:8px 0;font-size:14px;color:#333;border-bottom:1px solid #f0f0f0;">
        <strong>${p.label}</strong> — ${p.amount}<br>
        <span style="color:#666;font-size:13px;">${p.weddingTitle} · Due ${p.dueDate}</span>
      </td></tr>`
    ).join('')
    sections += `
      <h2 style="margin:24px 0 12px;font-size:16px;font-weight:700;color:#1a1a1a;">Payments due soon</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>`
  }

  if (data.upcomingEvents.length > 0) {
    const items = data.upcomingEvents.map((e) =>
      `<tr><td style="padding:8px 0;font-size:14px;color:#333;border-bottom:1px solid #f0f0f0;">
        <strong>${e.title}</strong><br>
        <span style="color:#666;font-size:13px;">${e.date}${e.time ? ` at ${e.time}` : ''}</span>
      </td></tr>`
    ).join('')
    sections += `
      <h2 style="margin:24px 0 12px;font-size:16px;font-weight:700;color:#1a1a1a;">Calendar this week</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>`
  }

  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">Your daily summary</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 16px;">
      Hi ${data.vendorName}, here's what's happening today.
    </p>
    ${sections}
    <div style="margin-top:24px;">
      <a href="${data.appUrl}/app" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">Open dashboard</a>
    </div>
  `, { preheader: `Your daily summary for ${data.vendorName}` })
}

export function emailChangeVerifyEmail(verifyUrl: string, name: string): string {
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">Verify your new email</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">
      Hi ${name}, click the link below to confirm this as your new email address on Wedding Computer.
    </p>
    <div style="margin:24px 0;">
      <a href="${verifyUrl}" style="display:inline-block;background:#0066E6;color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;">Verify email address</a>
    </div>
    <p style="font-size:13px;color:#999;margin:16px 0 0;">
      This link expires in 15 minutes. If you didn't request this change, you can ignore this email.
    </p>
  `, { preheader: 'Verify your new email address' })
}

export function emailChangeNotifyEmail(newEmail: string): string {
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">Email address changed</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 8px;">
      Your Wedding Computer email address has been changed to <strong>${esc(newEmail)}</strong>.
    </p>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0;">
      If you didn't make this change, please contact us immediately.
    </p>
  `, { preheader: 'Your email address was changed' })
}

// Render a label/value table from form submission fields (values are raw → escaped here).
function fieldsTable(fields: { label: string; value: string }[]): string {
  if (!fields.length) return ''
  const rows = fields
    .map(
      (f) => `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-weight:600;vertical-align:top;white-space:nowrap;font-size:13px;">${esc(f.label)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;color:#1f2937;white-space:pre-wrap;font-size:13px;">${esc(f.value)}</td>
      </tr>`
    )
    .join('')
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:20px;background:#faf5ef;border-radius:12px;overflow:hidden;">${rows}</table>`
}

// Vendor notification: "someone submitted your form"
export function formSubmissionEmail(data: {
  formTitle: string
  fields: { label: string; value: string }[]
  appUrl: string
  formId: string
  submissionId: string
}): string {
  return emailWrapper(`
    <h1 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#1a1a1a;">New submission: ${esc(data.formTitle)}</h1>
    ${fieldsTable(data.fields)}
    <a href="${data.appUrl}/app/forms/${data.formId}/submissions/${data.submissionId}" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">View submission</a>
    <p style="margin:20px 0 0;font-size:13px;color:#999;">Submitted via your "${esc(data.formTitle)}" form.</p>
  `, { preheader: `New submission to ${esc(data.formTitle)}` })
}

// Notification to a specific recipient configured on the form
export function formNotificationEmail(data: {
  formTitle: string
  vendorName: string
  fields: { label: string; value: string }[]
}): string {
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">New submission: ${esc(data.formTitle)}</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">A new response was submitted via ${esc(data.vendorName)}.</p>
    ${fieldsTable(data.fields)}
  `, { preheader: `New submission to ${esc(data.formTitle)}` })
}

// Confirmation back to the person who submitted the form
// Confirmation sent to the enquirer when a vendor enables "Send confirmation
// email to enquirer" on their enquiry form. bodyText is AI-written (Pro) or a
// template/default; rendered as paragraphs in the branded shell.
export function enquiryConfirmationEmail(data: {
  vendorName: string
  contactName: string
  bodyText: string
}): string {
  const paras = data.bodyText
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.6;">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')

  return emailWrapper(`
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1a1a1a;">Hi ${esc(data.contactName)},</h1>
    ${paras}
    <p style="margin:24px 0 0;font-size:15px;color:#333;line-height:1.6;">— ${esc(data.vendorName)}</p>
  `, { preheader: `Thanks for your enquiry with ${esc(data.vendorName)}` })
}

export function formConfirmationEmail(data: {
  formTitle: string
  vendorName: string
  fields: { label: string; value: string }[]
}): string {
  return emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">Thanks — we've received your submission</h1>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px;">
      ${esc(data.vendorName)} has received your "${esc(data.formTitle)}" submission and will be in touch. Here's a copy for your records:
    </p>
    ${fieldsTable(data.fields)}
  `, { preheader: `Your submission to ${esc(data.vendorName)}` })
}

// ─── Waitlist + broadcast ───

// Confirmation sent when someone joins the "notify me when it's live" waitlist.
export function waitlistWelcomeEmail(data: { name?: string | null; unsubscribeUrl?: string | null }): string {
  const greeting = data.name ? `Hi ${esc(data.name)},` : 'Hi there,'
  const unsub = data.unsubscribeUrl
    ? `<p style="margin:24px 0 0;font-size:12px;color:#999;line-height:1.5;">You're receiving this because you asked to be notified when Wedding Computer launches. <a href="${data.unsubscribeUrl}" style="color:#999;text-decoration:underline;">Unsubscribe</a>.</p>`
    : ''
  return emailWrapper(`
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1a1a1a;">You're on the list 🎉</h1>
    <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.6;">${greeting} thanks for your interest in Wedding Computer. We'll email you the moment it's live.</p>
    <p style="margin:0 0 24px;font-size:15px;color:#333;line-height:1.6;">In the meantime, you can read more about what we're building.</p>
    <a href="https://wedding.computer/about" style="display:inline-block;background:#be2f2f;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">Learn more</a>
    ${unsub}
  `, { preheader: "You're on the Wedding Computer waitlist — we'll let you know when it's live." })
}

// An admin broadcast / announcement. bodyText is admin-authored plain text:
// blank lines become paragraphs, single newlines become <br>, and everything is
// HTML-escaped at this output boundary.
export function broadcastEmail(data: { bodyText: string; unsubscribeUrl?: string | null }): string {
  const paras = data.bodyText
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.6;">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
  const unsub = data.unsubscribeUrl
    ? `<p style="margin:24px 0 0;font-size:12px;color:#999;line-height:1.5;">You're receiving this because you signed up for updates from Wedding Computer. <a href="${data.unsubscribeUrl}" style="color:#999;text-decoration:underline;">Unsubscribe</a>.</p>`
    : ''
  const preheader = data.bodyText.replace(/\s+/g, ' ').trim().slice(0, 110)
  return emailWrapper(`${paras}${unsub}`, { preheader: esc(preheader) })
}
