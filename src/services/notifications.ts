import { sendEmailMessage, invoiceSentEmail, vendorAddedEmail, coupleJoinedEmail, visibilityChangedEmail, bookingConfirmedEmail, paymentReceivedEmail, vendorRemovedAdminEmail, vendorBookedEmail, weddingDetailsUpdatedEmail, dailyDigestEmail } from './email'
import { getWedding, getWeddingMembers } from '../db/weddings'
import { getVendorWithEmail } from '../db/vendors'
import { formatDate } from '../lib/date'

type NotifyEnv = {
  db: D1Database
  resendApiKey: string
  appUrl: string
}

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

  const amount = (data.amountCents / 100).toLocaleString('en-AU', {
    style: 'currency', currency: data.currency.toUpperCase(),
  })

  const html = invoiceSentEmail({
    coupleName: data.coupleName,
    vendorName: vendor.business_name,
    invoiceTitle: data.invoiceTitle,
    amountFormatted: amount,
    dueDate: data.dueDate ? formatDate(data.dueDate) : null,
    loginUrl: `${env.appUrl}/login`,
  })

  await sendEmailMessage({
    db: env.db,
    resendApiKey: env.resendApiKey,
    vendorId: data.vendorId,
    to: data.coupleEmail,
    toName: data.coupleName,
    subject: `Invoice from ${vendor.business_name}: ${data.invoiceTitle}`,
    html,
    isSystem: true,
  }).catch((e) => console.error('[NOTIFY] invoice sent failed', e.message))
}

export async function notifyVendorAdded(env: NotifyEnv, data: {
  weddingId: string
  vendorUserId: string
  addedByName: string
}): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return

  const vendorUser = await env.db
    .prepare('SELECT email, name FROM users WHERE id = ?')
    .bind(data.vendorUserId)
    .first<{ email: string; name: string }>()
  if (!vendorUser) return

  const html = vendorAddedEmail({
    vendorName: vendorUser.name,
    addedByName: data.addedByName,
    weddingTitle: wedding.title,
    ceremonyType: wedding.ceremony_type ?? 'wedding',
    weddingDate: wedding.date ? formatDate(wedding.date) : null,
    loginUrl: `${env.appUrl}/login`,
  })

  await sendEmailMessage({
    db: env.db,
    resendApiKey: env.resendApiKey,
    vendorId: null,
    to: vendorUser.email,
    toName: vendorUser.name,
    subject: `You've been added to ${wedding.title}`,
    html,
    isSystem: true,
  }).catch((e) => console.error('[NOTIFY] vendor added failed', e.message))
}

export async function notifyCoupleJoined(env: NotifyEnv, data: {
  weddingId: string
  coupleName: string
}): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return

  const members = await getWeddingMembers(env.db, data.weddingId)
  const vendors = members.filter((m) => m.role === 'vendor')

  for (const vendor of vendors) {
    if (!vendor.vendor_profile_id) continue
    const vendorWithEmail = await getVendorWithEmail(env.db, vendor.vendor_profile_id)
    if (!vendorWithEmail) continue

    const html = coupleJoinedEmail({
      vendorName: vendorWithEmail.business_name,
      coupleName: data.coupleName,
      weddingTitle: wedding.title,
      appUrl: env.appUrl,
      weddingId: data.weddingId,
    })

    await sendEmailMessage({
      db: env.db,
      resendApiKey: env.resendApiKey,
      vendorId: vendor.vendor_profile_id,
      to: vendorWithEmail.user_email,
      toName: vendorWithEmail.user_name,
      subject: `${data.coupleName} joined ${wedding.title}`,
      html,
      isSystem: true,
    }).catch((e) => console.error('[NOTIFY] couple joined failed', e.message))
  }
}

export async function notifyVisibilityChanged(env: NotifyEnv, data: {
  weddingId: string
  isNowVisible: boolean
}): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return

  const members = await getWeddingMembers(env.db, data.weddingId)
  const vendors = members.filter((m) => m.role === 'vendor')

  for (const vendor of vendors) {
    if (!vendor.vendor_profile_id) continue
    const vendorWithEmail = await getVendorWithEmail(env.db, vendor.vendor_profile_id)
    if (!vendorWithEmail) continue

    const html = visibilityChangedEmail({
      vendorName: vendorWithEmail.business_name,
      weddingTitle: wedding.title,
      isNowVisible: data.isNowVisible,
      loginUrl: `${env.appUrl}/login`,
    })

    await sendEmailMessage({
      db: env.db,
      resendApiKey: env.resendApiKey,
      vendorId: vendor.vendor_profile_id,
      to: vendorWithEmail.user_email,
      toName: vendorWithEmail.user_name,
      subject: `Vendor visibility ${data.isNowVisible ? 'enabled' : 'disabled'} on ${wedding.title}`,
      html,
      isSystem: true,
    }).catch((e) => console.error('[NOTIFY] visibility changed failed', e.message))
  }
}

export async function notifyBookingConfirmed(env: NotifyEnv, data: {
  weddingId: string
}): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return

  const members = await getWeddingMembers(env.db, data.weddingId)

  for (const member of members) {
    const user = await env.db
      .prepare('SELECT email, name FROM users WHERE id = ?')
      .bind(member.user_id)
      .first<{ email: string; name: string }>()
    if (!user) continue

    const loginUrl = member.role === 'couple'
      ? `${env.appUrl}/wedding/${data.weddingId}`
      : `${env.appUrl}/app/weddings/${data.weddingId}`

    const html = bookingConfirmedEmail({
      recipientName: user.name,
      weddingTitle: wedding.title,
      ceremonyType: wedding.ceremony_type ?? 'wedding',
      weddingDate: wedding.date ? formatDate(wedding.date) : null,
      weddingLocation: wedding.location,
      loginUrl,
    })

    await sendEmailMessage({
      db: env.db,
      resendApiKey: env.resendApiKey,
      vendorId: null,
      to: user.email,
      toName: user.name,
      subject: `${wedding.title} is confirmed!`,
      html,
      isSystem: true,
    }).catch((e) => console.error('[NOTIFY] booking confirmed failed', e.message))
  }
}

export async function notifyVendorRemoved(env: NotifyEnv, data: {
  weddingId: string
  vendorProfileId: string
  coupleUserId: string
}): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return

  const coupleUser = await env.db
    .prepare('SELECT email, name FROM users WHERE id = ?')
    .bind(data.coupleUserId)
    .first<{ email: string; name: string }>()
  if (!coupleUser) return

  const vendor = await getVendorWithEmail(env.db, data.vendorProfileId)
  if (!vendor) return

  const html = vendorRemovedAdminEmail({
    coupleName: coupleUser.name,
    coupleEmail: coupleUser.email,
    vendorName: vendor.business_name,
    vendorCategory: vendor.category,
    weddingTitle: wedding.title,
    weddingDate: wedding.date ? formatDate(wedding.date) : null,
    weddingId: data.weddingId,
  })

  await sendEmailMessage({
    db: env.db,
    resendApiKey: env.resendApiKey,
    vendorId: null,
    to: 'hello@wedding.computer',
    toName: 'Wedding Computer Admin',
    subject: `Safety alert: ${coupleUser.name} removed ${vendor.business_name} from ${wedding.title}`,
    html,
    isSystem: true,
  }).catch((e) => console.error('[NOTIFY] vendor removed admin alert failed', e.message))
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
  const vendors = members.filter((m) => (m.role === 'vendor') && m.vendor_profile_id !== data.bookedVendorId)

  for (const vendor of vendors) {
    if (!vendor.vendor_profile_id) continue
    const vendorWithEmail = await getVendorWithEmail(env.db, vendor.vendor_profile_id)
    if (!vendorWithEmail) continue

    const html = vendorBookedEmail({
      recipientVendorName: vendorWithEmail.business_name,
      coupleName: data.coupleName,
      bookedVendorName: bookedVendor.business_name,
      bookedVendorCategory: bookedVendor.category,
      weddingTitle: wedding.title,
      appUrl: env.appUrl,
      weddingId: data.weddingId,
    })

    await sendEmailMessage({
      db: env.db,
      resendApiKey: env.resendApiKey,
      vendorId: vendor.vendor_profile_id,
      to: vendorWithEmail.user_email,
      toName: vendorWithEmail.user_name,
      subject: `${data.coupleName} booked ${bookedVendor.business_name} for ${wedding.title}`,
      html,
      isSystem: true,
    }).catch((e) => console.error('[NOTIFY] vendor booked failed', e.message))
  }
}

export async function notifyWeddingDetailsUpdated(env: NotifyEnv, data: {
  weddingId: string
  coupleName: string
}): Promise<void> {
  const wedding = await getWedding(env.db, data.weddingId)
  if (!wedding) return

  const members = await getWeddingMembers(env.db, data.weddingId)
  const vendors = members.filter((m) => m.role === 'vendor')

  for (const vendor of vendors) {
    if (!vendor.vendor_profile_id) continue
    const vendorWithEmail = await getVendorWithEmail(env.db, vendor.vendor_profile_id)
    if (!vendorWithEmail) continue

    const html = weddingDetailsUpdatedEmail({
      vendorName: vendorWithEmail.business_name,
      coupleName: data.coupleName,
      weddingTitle: wedding.title,
      appUrl: env.appUrl,
      weddingId: data.weddingId,
    })

    await sendEmailMessage({
      db: env.db,
      resendApiKey: env.resendApiKey,
      vendorId: vendor.vendor_profile_id,
      to: vendorWithEmail.user_email,
      toName: vendorWithEmail.user_name,
      subject: `${data.coupleName} updated details for ${wedding.title}`,
      html,
      isSystem: true,
    }).catch((e) => console.error('[NOTIFY] wedding details updated failed', e.message))
  }
}

export async function dailyDigest(env: NotifyEnv): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]

  // Get all active vendors
  const vendors = await env.db
    .prepare(
      `SELECT vp.id, vp.business_name, u.email, u.name
       FROM vendor_profiles vp
       JOIN users u ON u.id = vp.user_id`
    )
    .all<{ id: string; business_name: string; email: string; name: string }>()
    .then((r) => r.results)

  for (const vendor of vendors) {
    // Upcoming weddings in next 7 days
    const upcomingWeddings = await env.db
      .prepare(
        `SELECT w.title, w.date
         FROM weddings w
         JOIN wedding_members wm ON wm.wedding_id = w.id
         WHERE wm.vendor_profile_id = ? AND wm.status = 'active'
           AND w.date >= ? AND w.date <= ?
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
         ORDER BY date ASC, start_time ASC`
      )
      .bind(vendor.id, today, weekFromNow)
      .all<{ title: string; date: string; start_time: string | null }>()
      .then((r) => r.results)

    // Skip if nothing to report
    if (upcomingWeddings.length === 0 && newContacts.length === 0 && duePayments.length === 0 && upcomingEvents.length === 0) {
      continue
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
        amount: (p.amount_cents / 100).toLocaleString('en-AU', { style: 'currency', currency: p.currency.toUpperCase() }),
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

    await sendEmailMessage({
      db: env.db,
      resendApiKey: env.resendApiKey,
      vendorId: vendor.id,
      to: vendor.email,
      toName: vendor.name,
      subject: `Your daily summary — ${formatDate(today)}`,
      html,
      isSystem: true,
    }).catch((e) => console.error('[DIGEST] failed for vendor', vendor.id, e.message))
  }

  console.log('[DIGEST] completed for', vendors.length, 'vendors')
}
