import { runWithI18n, t } from '../i18n'
import {
  sendEmailMessage,
  EmailSendError,
  invoiceSentEmail,
  vendorAddedEmail,
  vendorJoinedWeddingEmail,
  coupleJoinedEmail,
  bookingConfirmedEmail,
  weddingCancelledEmail,
  weddingPostponedEmail,
  weddingDateSetEmail,
  paymentReceivedEmail,
  paymentReceiptEmail,
  paymentDueSoonEmail,
  paymentOverdueEmail,
  clientPaymentOverdueEmail,
  vendorRemovedAdminEmail,
  vendorBookedEmail,
  weddingDetailsUpdatedEmail,
  adminSignupEmail,
  dailyDigestEmail,
  timelineChangeRequestedEmail,
  timelineChangeDecidedEmail,
  weddingFormResponseEmail,
  documentAwaitingCelebrantEmail,
  documentSignedEmail,
} from './email'
import { getWedding, getWeddingMembers, SQL_WEDDING_ACTIVE, SQL_CALENDAR_EVENT_NOT_CANCELLED } from '../db/weddings'
import { getVendorWithEmail } from '../db/vendors'
import { getSigningSessionById } from '../db/signing'
import { formSubmissionFields } from '../db/forms'
import { formatDate } from '../lib/date'
import {
  isNotificationEnabled,
  makeUnsubscribeToken,
  unsubscribeUrl,
  MANAGE_PREFS_PATH,
  type NotificationKey,
} from './notification-prefs'

export type NotifyEnv = {
  db: D1Database
  resendApiKey: string
  appUrl: string
  sessionSecret: string
}

// ─── Delivery core ───
//
// Every notification to a platform user goes through deliver(): it checks the
// recipient's notification_prefs (opt-out model — missing key = enabled),
// attaches a signed one-click unsubscribe link for exactly this notification
// type, and never throws. Emails to people WITHOUT an account (e.g. invoice
// contacts) are transactional and sent ungated via sendEmailMessage directly.

export type Recipient = {
  id: string
  email: string
  name: string
  notification_prefs: string | null
  locale?: string | null
  timezone?: string | null
}

async function recipientById(db: D1Database, userId: string): Promise<Recipient | null> {
  return db
    .prepare('SELECT id, email, name, notification_prefs, locale, timezone FROM users WHERE id = ?')
    .bind(userId)
    .first<Recipient>()
}

async function recipientByEmail(db: D1Database, email: string): Promise<Recipient | null> {
  return db
    .prepare('SELECT id, email, name, notification_prefs FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first<Recipient>()
}

/**
 * Send a preference-gated notification to a platform user.
 * Returns true if sent, false if skipped (opted out) or failed. Never throws.
 */
export async function deliver(
  env: NotifyEnv,
  params: {
    key: NotificationKey
    recipient: Recipient
    subject: string
    html: string
    vendorId?: string | null
    contactId?: string | null
  }
): Promise<boolean> {
  const { key, recipient } = params
  if (!isNotificationEnabled(recipient.notification_prefs, key)) return false

  try {
    const token = await makeUnsubscribeToken(env.sessionSecret, recipient.id, key)
    await sendEmailMessage({
      db: env.db,
      resendApiKey: env.resendApiKey,
      vendorId: params.vendorId ?? null,
      contactId: params.contactId ?? null,
      to: recipient.email,
      toName: recipient.name,
      subject: params.subject,
      html: params.html,
      isSystem: true,
      unsubscribe: {
        manageUrl: `${env.appUrl}${MANAGE_PREFS_PATH}`,
        unsubscribeUrl: unsubscribeUrl(env.appUrl, token),
      },
    })
    return true
  } catch (e: any) {
    console.error(`[NOTIFY] ${key} to user ${recipient.id} failed:`, e.message)
    // Transient failures bubble up so the queue consumer retries the message;
    // permanent failures and opt-outs are swallowed (return false).
    if (e instanceof EmailSendError && e.retryable) throw e
    return false
  }
}

/** Ungated transactional send to an email with no account. Never throws. */
async function sendTransactional(
  env: NotifyEnv,
  params: { to: string; toName?: string; subject: string; html: string; vendorId?: string | null; contactId?: string | null }
): Promise<void> {
  await sendEmailMessage({
    db: env.db,
    resendApiKey: env.resendApiKey,
    vendorId: params.vendorId ?? null,
    contactId: params.contactId ?? null,
    to: params.to,
    toName: params.toName,
    subject: params.subject,
    html: params.html,
    isSystem: true,
  }).catch((e) => console.error('[NOTIFY] transactional send failed:', e.message))
}

function formatAmount(cents: number, currency: string): string {
  return (cents / 100).toLocaleString('en-AU', {
    style: 'currency',
    currency: currency.toUpperCase(),
  })
}

// ─── Invoices & payments ───

export async function notifyInvoiceSent(env: NotifyEnv, data: {
  weddingId: string
  vendorId: string
  invoiceTitle: string
  amountCents: number
  currency: string
  dueDate: string | null
  coupleEmail: string
  coupleName: string
}): Promise<void> {
  const vendor = await getVendorWithEmail(env.db, data.vendorId)
  if (!vendor) return

  const html = invoiceSentEmail({
    coupleName: data.coupleName,
    vendorName: vendor.business_name,
    invoiceTitle: data.invoiceTitle,
    amountFormatted: formatAmount(data.amountCents, data.currency),
    dueDate: data.dueDate ? formatDate(data.dueDate) : null,
    loginUrl: `${env.appUrl}/login`,
  })
  const subject = `Invoice from ${vendor.business_name}: ${data.invoiceTitle}`

  const user = await recipientByEmail(env.db, data.coupleEmail)
  if (user) {
    await deliver(env, { key: 'invoices', recipient: user, subject, html, vendorId: data.vendorId })
  } else {
    // No account — a bill addressed to them is transactional, not a preference.
    await sendTransactional(env, { to: data.coupleEmail, toName: data.coupleName, subject, html, vendorId: data.vendorId })
  }
}

/**
 * A payment landed on an invoice (Stripe webhook or manual record).
 * - source 'stripe': vendor gets a "payment received" (payments_received),
 *   payer gets a receipt. Manual records skip the vendor (they did it themselves).
 */
export async function notifyPaymentReceived(env: NotifyEnv, data: {
  vendorId: string
  paymentId: string
  source: 'stripe' | 'manual'
}): Promise<void> {
  const payment = await env.db
    .prepare(
      `SELECT ip.label, ip.amount_cents, i.id AS invoice_id, i.title AS invoice_title,
              i.currency, i.wedding_id, i.contact_id, i.public_token
       FROM invoice_payments ip
       JOIN invoices i ON i.id = ip.invoice_id
       WHERE ip.id = ? AND ip.vendor_id = ?`
    )
    .bind(data.paymentId, data.vendorId)
    .first<{
      label: string
      amount_cents: number
      invoice_id: string
      invoice_title: string
      currency: string
      wedding_id: string | null
      contact_id: string | null
      public_token: string | null
    }>()
  if (!payment) return

  const vendor = await getVendorWithEmail(env.db, data.vendorId)
  if (!vendor) return

  const amount = formatAmount(payment.amount_cents, payment.currency)
  const wedding = payment.wedding_id ? await getWedding(env.db, payment.wedding_id) : null

  // Vendor: money arrived (skip for manual — the vendor recorded it themselves).
  if (data.source === 'stripe') {
    await deliver(env, {
      key: 'payments_received',
      recipient: {
        id: vendor.user_id,
        email: vendor.user_email,
        name: vendor.user_name,
        notification_prefs: vendor.user_notification_prefs,
      },
      subject: `Payment received: ${amount} — ${payment.label}`,
      html: paymentReceivedEmail({
        vendorName: vendor.business_name,
        weddingTitle: wedding?.title ?? payment.invoice_title,
        amountFormatted: amount,
        paymentLabel: payment.label,
        viewUrl: `${env.appUrl}/app/invoices/${payment.invoice_id}`,
      }),
      vendorId: data.vendorId,
      contactId: payment.contact_id,
    })
  }

  // Payer side: receipt to couple members (gated) and invoice contacts (transactional).
  const sentTo = new Set<string>([vendor.user_email.toLowerCase()])
  const receiptHtml = (name: string) =>
    paymentReceiptEmail({
      recipientName: name,
      vendorName: vendor.business_name,
      invoiceTitle: payment.invoice_title,
      amountFormatted: amount,
      loginUrl: payment.public_token ? `${env.appUrl}/book/${payment.public_token}` : `${env.appUrl}/login`,
    })
  const receiptSubject = `Payment recorded: ${amount} to ${vendor.business_name}`

  if (payment.wedding_id) {
    const members = await getWeddingMembers(env.db, payment.wedding_id)
    for (const m of members.filter((m) => m.role === 'couple')) {
      const email = m.user_email.toLowerCase()
      if (sentTo.has(email)) continue
      sentTo.add(email)
      await deliver(env, {
        key: 'invoices',
        recipient: { id: m.user_id, email: m.user_email, name: m.user_name, notification_prefs: m.user_notification_prefs },
        subject: receiptSubject,
        html: receiptHtml(m.user_name),
        vendorId: data.vendorId,
        contactId: payment.contact_id,
      })
    }
  }

  if (payment.contact_id) {
    const contact = await env.db
      .prepare('SELECT first_name, email, partner_first_name, partner_email FROM contacts WHERE id = ?')
      .bind(payment.contact_id)
      .first<{ first_name: string; email: string | null; partner_first_name: string | null; partner_email: string | null }>()
    for (const { email, name } of [
      { email: contact?.email, name: contact?.first_name },
      { email: contact?.partner_email, name: contact?.partner_first_name },
    ]) {
      if (!email || sentTo.has(email.toLowerCase())) continue
      sentTo.add(email.toLowerCase())
      const user = await recipientByEmail(env.db, email)
      if (user) {
        await deliver(env, { key: 'invoices', recipient: user, subject: receiptSubject, html: receiptHtml(user.name), vendorId: data.vendorId, contactId: payment.contact_id })
      } else {
        await sendTransactional(env, { to: email, toName: name ?? undefined, subject: receiptSubject, html: receiptHtml(name ?? 'there'), vendorId: data.vendorId, contactId: payment.contact_id })
      }
    }
  }
}

/**
 * Cron: payment reminders. Exact-date matching means each payment is reminded
 * about exactly once per stage with no extra bookkeeping:
 * - due-soon: pending payments due in exactly 3 days
 * - overdue: unpaid payments that became overdue exactly 1 day ago
 * Payers (couple members + invoice contacts) get the reminder; the vendor gets
 * an overdue alert so they can chase it up. All user sends gated by payment_reminders.
 */
export async function sendPaymentReminders(env: NotifyEnv, vendorId?: string): Promise<void> {
  const stmt = env.db
    .prepare(
      `SELECT ip.id AS payment_id, ip.label, ip.amount_cents, ip.due_date,
              i.id AS invoice_id, i.title AS invoice_title, i.currency, i.vendor_id,
              i.wedding_id, i.contact_id, i.public_token,
              CASE WHEN ip.due_date = date('now', '+3 days') THEN 'due_soon' ELSE 'overdue' END AS stage
       FROM invoice_payments ip
       JOIN invoices i ON i.id = ip.invoice_id
       WHERE ip.status IN ('pending', 'overdue')
         AND i.status NOT IN ('draft', 'paid', 'cancelled', 'refunded')
         AND NOT EXISTS (SELECT 1 FROM weddings w WHERE w.id = i.wedding_id AND w.status = 'cancelled')
         AND (ip.due_date = date('now', '+3 days') OR ip.due_date = date('now', '-1 day'))
         ${vendorId ? 'AND i.vendor_id = ?' : ''}`
    )
  const duePayments = await (vendorId ? stmt.bind(vendorId) : stmt)
    .all<{
      payment_id: string
      label: string
      amount_cents: number
      due_date: string
      invoice_id: string
      invoice_title: string
      currency: string
      vendor_id: string
      wedding_id: string | null
      contact_id: string | null
      public_token: string | null
      stage: 'due_soon' | 'overdue'
    }>()
    .then((r) => r.results)

  let sent = 0
  for (const p of duePayments) {
    const vendor = await getVendorWithEmail(env.db, p.vendor_id)
    if (!vendor) continue

    const amount = formatAmount(p.amount_cents, p.currency)
    const dueDate = formatDate(p.due_date)
    const payUrl = p.public_token ? `${env.appUrl}/book/${p.public_token}` : `${env.appUrl}/login`
    const buildHtml = (name: string) =>
      p.stage === 'due_soon'
        ? paymentDueSoonEmail({ recipientName: name, vendorName: vendor.business_name, invoiceTitle: `${p.invoice_title} — ${p.label}`, amountFormatted: amount, dueDate, loginUrl: payUrl })
        : paymentOverdueEmail({ recipientName: name, vendorName: vendor.business_name, invoiceTitle: `${p.invoice_title} — ${p.label}`, amountFormatted: amount, dueDate, loginUrl: payUrl })
    const subject =
      p.stage === 'due_soon'
        ? `Reminder: ${amount} due ${dueDate} to ${vendor.business_name}`
        : `Overdue: ${amount} to ${vendor.business_name}`

    const sentTo = new Set<string>([vendor.user_email.toLowerCase()])
    let clientName: string | null = null

    // Couple members on the wedding
    if (p.wedding_id) {
      const members = await getWeddingMembers(env.db, p.wedding_id)
      for (const m of members.filter((m) => m.role === 'couple')) {
        const email = m.user_email.toLowerCase()
        if (sentTo.has(email)) continue
        sentTo.add(email)
        clientName = clientName ?? m.user_name
        const ok = await deliver(env, {
          key: 'payment_reminders',
          recipient: { id: m.user_id, email: m.user_email, name: m.user_name, notification_prefs: m.user_notification_prefs },
          subject,
          html: buildHtml(m.user_name),
          vendorId: p.vendor_id,
          contactId: p.contact_id,
        })
        if (ok) sent++
      }
    }

    // Invoice contact emails (may not be platform users)
    if (p.contact_id) {
      const contact = await env.db
        .prepare('SELECT first_name, last_name, email, partner_first_name, partner_email FROM contacts WHERE id = ?')
        .bind(p.contact_id)
        .first<{ first_name: string; last_name: string; email: string | null; partner_first_name: string | null; partner_email: string | null }>()
      clientName = clientName ?? (contact ? `${contact.first_name} ${contact.last_name}`.trim() : null)
      for (const { email, name } of [
        { email: contact?.email, name: contact?.first_name },
        { email: contact?.partner_email, name: contact?.partner_first_name },
      ]) {
        if (!email || sentTo.has(email.toLowerCase())) continue
        sentTo.add(email.toLowerCase())
        const user = await recipientByEmail(env.db, email)
        if (user) {
          const ok = await deliver(env, { key: 'payment_reminders', recipient: user, subject, html: buildHtml(user.name), vendorId: p.vendor_id, contactId: p.contact_id })
          if (ok) sent++
        } else {
          await sendTransactional(env, { to: email, toName: name ?? undefined, subject, html: buildHtml(name ?? 'there'), vendorId: p.vendor_id, contactId: p.contact_id })
          sent++
        }
      }
    }

    // Vendor: overdue alert so they can chase it up
    if (p.stage === 'overdue') {
      const ok = await deliver(env, {
        key: 'payment_reminders',
        recipient: { id: vendor.user_id, email: vendor.user_email, name: vendor.user_name, notification_prefs: vendor.user_notification_prefs },
        subject: `Client payment overdue: ${amount} — ${p.label}`,
        html: clientPaymentOverdueEmail({
          vendorName: vendor.business_name,
          clientName: clientName ?? 'your client',
          invoiceTitle: p.invoice_title,
          paymentLabel: p.label,
          amountFormatted: amount,
          dueDate,
          viewUrl: `${env.appUrl}/app/invoices/${p.invoice_id}`,
        }),
        vendorId: p.vendor_id,
        contactId: p.contact_id,
      })
      if (ok) sent++
    }
  }

  console.log('[REMINDERS] processed', duePayments.length, 'payments, sent', sent, 'emails')
}

// ─── Wedding membership & updates ───

/**
 * A vendor was added to a wedding. Notifies the added vendor (wedding_invites)
 * and the couple on the wedding (wedding_updates).
 * Payload matches the producer in routes/vendor/weddings.tsx (add-vendor).
 */
export async function notifyVendorAdded(env: NotifyEnv, data: {
  weddingId: string
  vendorEmail: string
  vendorName: string
  addedBy: string
}): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return

  const ceremonyType = wedding.ceremony_type ?? 'wedding'
  const weddingDate = wedding.date ? formatDate(wedding.date) : null

  // The added vendor
  const vendorUser = await recipientByEmail(env.db, data.vendorEmail)
  if (vendorUser) {
    await deliver(env, {
      key: 'wedding_invites',
      recipient: vendorUser,
      subject: `You've been added to ${wedding.title}`,
      html: vendorAddedEmail({
        vendorName: vendorUser.name || data.vendorName,
        addedByName: data.addedBy,
        weddingTitle: wedding.title,
        ceremonyType,
        weddingDate,
        loginUrl: `${env.appUrl}/login`,
      }),
    })
  }

  // The couple: someone new is working on their wedding
  const members = await getWeddingMembers(env.db, data.weddingId)
  for (const m of members.filter((m) => m.role === 'couple')) {
    if (m.user_email.toLowerCase() === data.vendorEmail.toLowerCase()) continue
    await deliver(env, {
      key: 'wedding_updates',
      recipient: { id: m.user_id, email: m.user_email, name: m.user_name, notification_prefs: m.user_notification_prefs },
      subject: `${data.vendorName} joined ${wedding.title}`,
      html: vendorJoinedWeddingEmail({
        recipientName: m.user_name,
        vendorBusinessName: data.vendorName,
        vendorCategory: null,
        weddingTitle: wedding.title,
        addedByName: data.addedBy,
        loginUrl: `${env.appUrl}/wedding/${data.weddingId}`,
      }),
    })
  }
}

/**
 * Collaborative PDF signing turn notifications. Signing is witnessed live (the celebrant
 * releases each turn), so these are backups/records, not the primary nudge. `event`:
 *  - awaiting_celebrant: the owning celebrant (vendor_collaboration) — link to /app/weddings/:id/sign/:sid
 *  - completed:          each couple member  (wedding_updates)       — NO CTA link, by design
 * 'completed' deliberately sends no link: the couple does not receive a copy; the signed PDF
 * is the celebrant-private final document. Loads the session unscoped (getSigningSessionById)
 * because the queue consumer has already established trust.
 */
export async function notifyDocumentReady(
  env: NotifyEnv,
  data: { sessionId: string; event: 'awaiting_celebrant' | 'completed' }
): Promise<void> {
  const session = await getSigningSessionById(env.db, data.sessionId)
  if (!session) return
  const wedding = await getWedding(env.db, session.wedding_id)
  if (!wedding) return
  const vendor = await getVendorWithEmail(env.db, session.vendor_id)
  if (!vendor) return

  if (data.event === 'awaiting_celebrant') {
    await deliver(env, {
      key: 'vendor_collaboration',
      recipient: {
        id: vendor.user_id,
        email: vendor.user_email,
        name: vendor.user_name,
        notification_prefs: vendor.user_notification_prefs,
      },
      subject: `The couple signed ${session.title}`,
      html: documentAwaitingCelebrantEmail({
        vendorName: vendor.user_name || vendor.business_name,
        documentTitle: session.title,
        signUrl: `${env.appUrl}/app/weddings/${session.wedding_id}/sign/${session.id}`,
      }),
      vendorId: session.vendor_id,
    })
    return
  }

  // completed → couple confirmation (no link; they don't receive a copy)
  const members = await getWeddingMembers(env.db, session.wedding_id)
  for (const m of members.filter((m) => m.role === 'couple')) {
    await deliver(env, {
      key: 'wedding_updates',
      recipient: { id: m.user_id, email: m.user_email, name: m.user_name, notification_prefs: m.user_notification_prefs },
      subject: `${session.title} is signed`,
      html: documentSignedEmail({
        coupleName: m.user_name,
        vendorName: vendor.business_name,
        documentTitle: session.title,
      }),
      vendorId: session.vendor_id,
    })
  }
}

/**
 * A couple was invited to / joined a wedding. Notifies the wedding's vendors,
 * excluding the vendor who did the inviting (they already know).
 */
export async function notifyCoupleJoined(env: NotifyEnv, data: {
  weddingId: string
  coupleName: string
  excludeVendorProfileId?: string | null
}): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return

  const members = await getWeddingMembers(env.db, data.weddingId)
  const vendors = members.filter((m) => m.role === 'vendor')

  for (const vendor of vendors) {
    if (!vendor.vendor_profile_id) continue
    if (data.excludeVendorProfileId && vendor.vendor_profile_id === data.excludeVendorProfileId) continue

    await deliver(env, {
      key: 'wedding_updates',
      recipient: { id: vendor.user_id, email: vendor.user_email, name: vendor.user_name, notification_prefs: vendor.user_notification_prefs },
      subject: `${data.coupleName} joined ${wedding.title}`,
      html: coupleJoinedEmail({
        vendorName: vendor.business_name ?? vendor.user_name,
        coupleName: data.coupleName,
        weddingTitle: wedding.title,
        appUrl: env.appUrl,
        weddingId: data.weddingId,
      }),
      vendorId: vendor.vendor_profile_id,
    })
  }
}

export async function notifyBookingConfirmed(env: NotifyEnv, data: {
  weddingId: string
}): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return

  const members = await getWeddingMembers(env.db, data.weddingId)
  for (const member of members) {
    const loginUrl = member.role === 'couple'
      ? `${env.appUrl}/wedding/${data.weddingId}`
      : `${env.appUrl}/app/weddings/${data.weddingId}`

    await deliver(env, {
      key: 'wedding_updates',
      recipient: { id: member.user_id, email: member.user_email, name: member.user_name, notification_prefs: member.user_notification_prefs },
      subject: `${wedding.title} is confirmed!`,
      html: bookingConfirmedEmail({
        recipientName: member.user_name,
        weddingTitle: wedding.title,
        ceremonyType: wedding.ceremony_type ?? 'wedding',
        weddingDate: wedding.date ? formatDate(wedding.date) : null,
        weddingLocation: wedding.location,
        loginUrl,
      }),
      vendorId: member.vendor_profile_id,
    })
  }
}

export async function notifyWeddingCancelled(env: NotifyEnv, data: { weddingId: string }): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return
  const members = await getWeddingMembers(env.db, data.weddingId)
  for (const member of members) {
    const loginUrl = member.role === 'couple'
      ? `${env.appUrl}/wedding/${data.weddingId}`
      : `${env.appUrl}/app/weddings/${data.weddingId}`
    await deliver(env, {
      key: 'wedding_updates',
      recipient: { id: member.user_id, email: member.user_email, name: member.user_name, notification_prefs: member.user_notification_prefs },
      subject: `${wedding.title} has been cancelled`,
      html: weddingCancelledEmail({
        weddingTitle: wedding.title,
        weddingDate: wedding.date ? formatDate(wedding.date) : null,
        reason: wedding.cancellation_note,
        loginUrl,
      }),
      vendorId: member.vendor_profile_id,
    })
  }
}

export async function notifyWeddingPostponed(env: NotifyEnv, data: { weddingId: string }): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return
  const members = await getWeddingMembers(env.db, data.weddingId)
  for (const member of members) {
    const loginUrl = member.role === 'couple'
      ? `${env.appUrl}/wedding/${data.weddingId}`
      : `${env.appUrl}/app/weddings/${data.weddingId}`
    await deliver(env, {
      key: 'wedding_updates',
      recipient: { id: member.user_id, email: member.user_email, name: member.user_name, notification_prefs: member.user_notification_prefs },
      subject: `${wedding.title} has been postponed`,
      html: weddingPostponedEmail({
        weddingTitle: wedding.title,
        newDate: wedding.date ? formatDate(wedding.date) : null,
        loginUrl,
      }),
      vendorId: member.vendor_profile_id,
    })
  }
}

// Sent when an existing wedding's date is first set, moved, or cleared — fans
// out to everyone else booked on it (couple + vendors), skipping the person who
// made the change. The booking accepts a wedding with no date; this is how the
// team finds out when the date lands later.
export async function notifyWeddingDateChanged(env: NotifyEnv, data: {
  weddingId: string
  oldDate: string | null
  newDate: string | null
  editorUserId: string
}): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return
  const oldFmt = data.oldDate ? formatDate(data.oldDate) : null
  const newFmt = data.newDate ? formatDate(data.newDate) : null
  const subject =
    data.newDate && !data.oldDate
      ? `${wedding.title} now has a date: ${newFmt}`
      : data.newDate
        ? `${wedding.title} has a new date: ${newFmt}`
        : `${wedding.title}: date to be confirmed`

  const members = await getWeddingMembers(env.db, data.weddingId)
  for (const member of members) {
    // The editor already knows — they just made the change.
    if (member.user_id === data.editorUserId) continue
    const loginUrl =
      member.role === 'couple'
        ? `${env.appUrl}/wedding/${data.weddingId}`
        : `${env.appUrl}/app/weddings/${data.weddingId}`
    await deliver(env, {
      key: 'wedding_updates',
      recipient: { id: member.user_id, email: member.user_email, name: member.user_name, notification_prefs: member.user_notification_prefs },
      subject,
      html: weddingDateSetEmail({
        weddingTitle: wedding.title,
        oldDate: oldFmt,
        newDate: newFmt,
        loginUrl,
      }),
      vendorId: member.vendor_profile_id,
    })
  }
}

export async function notifyVendorBooked(env: NotifyEnv, data: {
  weddingId: string
  bookedVendorId: string
  coupleName: string
}): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return

  const bookedVendor = await getVendorWithEmail(env.db, data.bookedVendorId)
  if (!bookedVendor) return

  const members = await getWeddingMembers(env.db, data.weddingId)
  const vendors = members.filter((m) => m.role === 'vendor' && m.vendor_profile_id !== data.bookedVendorId)

  for (const vendor of vendors) {
    if (!vendor.vendor_profile_id) continue
    await deliver(env, {
      key: 'vendor_collaboration',
      recipient: { id: vendor.user_id, email: vendor.user_email, name: vendor.user_name, notification_prefs: vendor.user_notification_prefs },
      subject: `${data.coupleName} booked ${bookedVendor.business_name} for ${wedding.title}`,
      html: vendorBookedEmail({
        recipientVendorName: vendor.business_name ?? vendor.user_name,
        coupleName: data.coupleName,
        bookedVendorName: bookedVendor.business_name,
        bookedVendorCategory: bookedVendor.category,
        weddingTitle: wedding.title,
        appUrl: env.appUrl,
        weddingId: data.weddingId,
      }),
      vendorId: vendor.vendor_profile_id,
    })
  }
}

export async function notifyWeddingDetailsUpdated(env: NotifyEnv, data: {
  weddingId: string
  coupleName: string
}): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return

  const members = await getWeddingMembers(env.db, data.weddingId)
  for (const vendor of members.filter((m) => m.role === 'vendor')) {
    if (!vendor.vendor_profile_id) continue
    await deliver(env, {
      key: 'wedding_updates',
      recipient: { id: vendor.user_id, email: vendor.user_email, name: vendor.user_name, notification_prefs: vendor.user_notification_prefs },
      subject: `${data.coupleName} updated details for ${wedding.title}`,
      html: weddingDetailsUpdatedEmail({
        vendorName: vendor.business_name ?? vendor.user_name,
        coupleName: data.coupleName,
        weddingTitle: wedding.title,
        appUrl: env.appUrl,
        weddingId: data.weddingId,
      }),
      vendorId: vendor.vendor_profile_id,
    })
  }
}

export async function notifyTimelineChangeRequested(env: NotifyEnv, data: {
  weddingId: string
  requesterLabel: string
  summary: string | null
  controllerUserIds: string[]
}): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return

  for (const userId of data.controllerUserIds) {
    const recipient = await recipientById(env.db, userId)
    if (!recipient) continue
    // Render in the recipient's language.
    const { subject, html } = runWithI18n(
      { locale: recipient.locale ?? undefined, timezone: recipient.timezone ?? undefined },
      () => ({
        subject: t('email.timeline.requested.subject', { wedding: wedding.title }),
        html: timelineChangeRequestedEmail({
          managerName: recipient.name,
          requesterLabel: data.requesterLabel,
          weddingTitle: wedding.title,
          summary: data.summary,
          appUrl: env.appUrl,
          weddingId: data.weddingId,
        }),
      })
    )
    await deliver(env, { key: 'wedding_updates', recipient, subject, html })
  }
}

export async function notifyTimelineChangeDecided(env: NotifyEnv, data: {
  weddingId: string
  requesterUserId: string
  deciderLabel: string
  approved: boolean
  summary: string | null
}): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return

  const recipient = await recipientById(env.db, data.requesterUserId)
  if (!recipient) return
  const v = data.approved ? 'approved' : 'declined'
  const { subject, html } = runWithI18n(
    { locale: recipient.locale ?? undefined, timezone: recipient.timezone ?? undefined },
    () => ({
      subject: t(`email.timeline.decided.subject.${v}` as const, { wedding: wedding.title }),
      html: timelineChangeDecidedEmail({
        requesterName: recipient.name,
        deciderLabel: data.deciderLabel,
        weddingTitle: wedding.title,
        approved: data.approved,
        summary: data.summary,
        appUrl: env.appUrl,
        weddingId: data.weddingId,
      }),
    })
  )
  await deliver(env, { key: 'wedding_updates', recipient, subject, html })
}

// ─── Admin notifications ───

/**
 * Send to every admin user (gated by their prefs for the given key).
 * Falls back to hello@wedding.computer if no admin users exist yet.
 */
export async function notifyAdmins(env: NotifyEnv, data: {
  key: NotificationKey
  subject: string
  html: string
}): Promise<void> {
  const admins = await env.db
    .prepare('SELECT id, email, name, notification_prefs FROM users WHERE is_admin = 1')
    .all<Recipient>()
    .then((r) => r.results)

  if (admins.length === 0) {
    await sendTransactional(env, {
      to: 'hello@wedding.computer',
      toName: 'Wedding Computer Admin',
      subject: data.subject,
      html: data.html,
    })
    return
  }

  for (const admin of admins) {
    await deliver(env, { key: data.key, recipient: admin, subject: data.subject, html: data.html })
  }
}

export async function notifyVendorRemoved(env: NotifyEnv, data: {
  weddingId: string
  vendorProfileId: string
  coupleUserId: string
}): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return

  const coupleUser = await recipientById(env.db, data.coupleUserId)
  if (!coupleUser) return

  const vendor = await getVendorWithEmail(env.db, data.vendorProfileId)
  if (!vendor) return

  await notifyAdmins(env, {
    key: 'admin_safety',
    subject: `Safety alert: ${coupleUser.name} removed ${vendor.business_name} from ${wedding.title}`,
    html: vendorRemovedAdminEmail({
      coupleName: coupleUser.name,
      coupleEmail: coupleUser.email,
      vendorName: vendor.business_name,
      vendorCategory: vendor.category,
      weddingTitle: wedding.title,
      weddingDate: wedding.date ? formatDate(wedding.date) : null,
      weddingId: data.weddingId,
    }),
  })
}

/** A new vendor or couple joined the platform. */
export async function notifyAdminSignup(env: NotifyEnv, data: {
  kind: 'vendor' | 'couple'
  name: string
  email: string
  businessName?: string | null
  category?: string | null
}): Promise<void> {
  await notifyAdmins(env, {
    key: 'admin_signups',
    subject: data.kind === 'vendor'
      ? `New vendor signup: ${data.businessName || data.name}`
      : `New couple signup: ${data.name}`,
    html: adminSignupEmail({
      kind: data.kind,
      name: data.name,
      email: data.email,
      businessName: data.businessName,
      category: data.category,
      appUrl: env.appUrl,
    }),
  })
}

// ─── Daily digest ───

type DigestVendorRow = {
  id: string
  business_name: string
  user_id: string
  email: string
  name: string
  notification_prefs: string
}

const DIGEST_VENDOR_SELECT =
  `SELECT vp.id, vp.business_name, u.id AS user_id, u.email, u.name, u.notification_prefs
   FROM vendor_profiles vp
   JOIN users u ON u.id = vp.user_id`

export async function dailyDigest(env: NotifyEnv): Promise<void> {
  // Get all active vendors (with prefs so opted-out vendors skip the heavy queries)
  const vendors = await env.db
    .prepare(`${DIGEST_VENDOR_SELECT} WHERE u.deleted_at IS NULL`)
    .all<DigestVendorRow>()
    .then((r) => r.results)

  let sentCount = 0
  for (const vendor of vendors) {
    if (await digestForVendor(env, vendor)) sentCount++
  }

  console.log('[DIGEST] sent', sentCount, 'of', vendors.length, 'vendors')
}

/**
 * Per-vendor daily work, run from the queue (one message per vendor) so a
 * single cron invocation never iterates every vendor and blows the
 * subrequest/CPU budget. Handles the digest email and that vendor's payment
 * reminders. Never throws — failures are logged so the message still acks
 * (the next day's cron retries; we don't want a retry to duplicate sends).
 */
export async function runVendorDailyJobs(env: NotifyEnv, vendorId: string): Promise<void> {
  try {
    const vendor = await env.db
      .prepare(`${DIGEST_VENDOR_SELECT} WHERE vp.id = ? AND u.deleted_at IS NULL`)
      .bind(vendorId)
      .first<DigestVendorRow>()
    if (vendor) await digestForVendor(env, vendor)
  } catch (e: any) {
    console.error('[DIGEST] vendor', vendorId, 'failed', e.message)
  }

  try {
    await sendPaymentReminders(env, vendorId)
  } catch (e: any) {
    console.error('[REMINDERS] vendor', vendorId, 'failed', e.message)
  }
}

/**
 * Build and send one vendor's daily digest. Returns true if an email was
 * sent (false if opted out or nothing to report).
 */
export async function digestForVendor(env: NotifyEnv, vendor: DigestVendorRow): Promise<boolean> {
  if (!isNotificationEnabled(vendor.notification_prefs, 'daily_digest')) return false

  const today = new Date().toISOString().split('T')[0]
  const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]

  {
    // Upcoming weddings in next 7 days
    const upcomingWeddings = await env.db
      .prepare(
        `SELECT w.title, w.date
         FROM weddings w
         JOIN wedding_members wm ON wm.wedding_id = w.id
         WHERE wm.vendor_profile_id = ? AND wm.status = 'active'
           AND w.date >= ? AND w.date <= ?
           AND ${SQL_WEDDING_ACTIVE('w')}
         ORDER BY w.date ASC`
      )
      .bind(vendor.id, today, weekFromNow)
      .all<{ title: string; date: string }>()
      .then((r) => r.results)

    // New contacts received today
    const newContacts = await env.db
      .prepare(
        `SELECT first_name, last_name, source
         FROM contacts
         WHERE vendor_id = ? AND DATE(created_at) = ?
         ORDER BY created_at DESC`
      )
      .bind(vendor.id, today)
      .all<{ first_name: string; last_name: string; source: string | null }>()
      .then((r) => r.results)

    // Payments due in next 7 days
    const duePayments = await env.db
      .prepare(
        `SELECT ip.label, ip.amount_cents, ip.due_date, i.currency, w.title AS wedding_title
         FROM invoice_payments ip
         JOIN invoices i ON i.id = ip.invoice_id
         LEFT JOIN weddings w ON w.id = i.wedding_id
         WHERE ip.vendor_id = ? AND ip.status = 'pending'
           AND ip.due_date >= ? AND ip.due_date <= ?
         ORDER BY ip.due_date ASC`
      )
      .bind(vendor.id, today, weekFromNow)
      .all<{ label: string; amount_cents: number; due_date: string; currency: string; wedding_title: string | null }>()
      .then((r) => r.results)

    // Calendar events in next 7 days
    const upcomingEvents = await env.db
      .prepare(
        `SELECT title, date, start_time
         FROM calendar_events
         WHERE vendor_id = ? AND date >= ? AND date <= ?
           AND ${SQL_CALENDAR_EVENT_NOT_CANCELLED('calendar_events')}
         ORDER BY date ASC, start_time ASC`
      )
      .bind(vendor.id, today, weekFromNow)
      .all<{ title: string; date: string; start_time: string | null }>()
      .then((r) => r.results)

    // Skip if nothing to report
    if (upcomingWeddings.length === 0 && newContacts.length === 0 && duePayments.length === 0 && upcomingEvents.length === 0) {
      return false
    }

    const html = dailyDigestEmail({
      vendorName: vendor.business_name,
      upcomingWeddings: upcomingWeddings.map((w) => ({
        title: w.title,
        date: formatDate(w.date),
        daysUntil: Math.ceil((new Date(w.date).getTime() - Date.now()) / 86400000),
      })),
      newContacts: newContacts.map((c) => ({
        name: `${c.first_name} ${c.last_name}`,
        source: c.source,
      })),
      duePayments: duePayments.map((p) => ({
        label: p.label,
        amount: formatAmount(p.amount_cents, p.currency),
        weddingTitle: p.wedding_title ?? 'Unknown',
        dueDate: formatDate(p.due_date),
      })),
      upcomingEvents: upcomingEvents.map((e) => ({
        title: e.title,
        date: formatDate(e.date),
        time: e.start_time,
      })),
      appUrl: env.appUrl,
    })

    const ok = await deliver(env, {
      key: 'daily_digest',
      recipient: { id: vendor.user_id, email: vendor.email, name: vendor.name, notification_prefs: vendor.notification_prefs },
      subject: `Your daily summary — ${formatDate(today)}`,
      html,
      vendorId: vendor.id,
    })
    return ok
  }
}

// A custom form sent to a couple was answered. Notify the couple and the
// owning vendor; include the wider vendor team only once the submission has
// been shared with them. Each delivery respects the recipient's preferences.
export async function notifyWeddingFormSubmission(
  env: NotifyEnv,
  data: { submissionId: string }
): Promise<void> {
  const sub = await env.db
    .prepare(
      `SELECT s.id, s.vendor_id AS owner_vendor_id, s.data, s.wedding_id, s.shared_with_team,
              f.title AS form_title, f.config AS form_config, vp.business_name AS vendor_name
       FROM form_submissions s
       JOIN forms f ON f.id = s.form_id
       JOIN vendor_profiles vp ON vp.id = s.vendor_id
       WHERE s.id = ?`
    )
    .bind(data.submissionId)
    .first<Record<string, any>>()
  if (!sub || !sub.wedding_id) return

  const wedding = await getWedding(env.db, sub.wedding_id)
  if (!wedding) return
  const weddingTitle = wedding.title || 'your wedding'

  const members = await getWeddingMembers(env.db, sub.wedding_id)
  const fields = formSubmissionFields(sub.form_config, sub.data)

  for (const m of members) {
    if (m.role === 'guest') continue
    const isOwner = m.role === 'vendor' && m.vendor_profile_id === sub.owner_vendor_id
    const isOtherVendor = m.role === 'vendor' && !isOwner
    // Other vendors only hear about it once it's been shared with the team.
    if (isOtherVendor && !sub.shared_with_team) continue

    const viewUrl = m.role === 'couple'
      ? `${env.appUrl}/wedding/${sub.wedding_id}`
      : `${env.appUrl}/app/weddings/${sub.wedding_id}`

    await deliver(env, {
      key: 'wedding_updates',
      recipient: {
        id: m.user_id,
        email: m.user_email,
        name: m.user_name,
        notification_prefs: m.user_notification_prefs,
      },
      subject: `New form response — ${sub.form_title}`,
      html: weddingFormResponseEmail({
        formTitle: sub.form_title,
        weddingTitle,
        vendorName: sub.vendor_name,
        fields,
        viewUrl,
      }),
      vendorId: m.vendor_profile_id ?? null,
    })
  }
}
