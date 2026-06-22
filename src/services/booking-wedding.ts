// Booking / enquiry → collaboration. When a couple books (or enquires with) a
// vendor "in the wild" — i.e. the vendor wasn't explicitly Added to a wedding —
// this runs the SAME outcome as being added: the vendor becomes a member of the
// couple's wedding. Because a wedding is a single SHARED entity, we match the
// couple's existing wedding by email first; only if none exists (and the caller
// allows it) do we create one from the contact. The couple is linked via their
// EXISTING contact (no duplicate profile). Idempotent; safe to run in waitUntil.

import type { Bindings, VendorProfile, Contact } from '../types'
import { createWedding, addWeddingMember, getAnyMembership } from '../db/weddings'
import { findOrCreateUser, sendCoupleInvite } from './auth'
import { getUserByEmail } from '../db/users'
import { resyncWeddingCalendars } from './wedding-calendar'
import { createEvent } from '../db/calendar'
import { getStorageWithSecrets } from '../storage'
import { updateContact } from '../storage/contacts'
import { isManagerVendor } from '../lib/categories'
import { formatDate } from '../lib/date'

// The couple's existing active wedding, matched by any of their emails (the
// couple is the same user across vendors). Prefers the soonest upcoming.
async function findCoupleWedding(db: D1Database, emails: string[]): Promise<string | null> {
  const clean = emails.map((e) => e.toLowerCase()).filter(Boolean)
  if (clean.length === 0) return null
  const ph = clean.map(() => '?').join(',')
  const row = await db
    .prepare(
      `SELECT wm.wedding_id FROM wedding_members wm
       JOIN users u ON u.id = wm.user_id
       JOIN weddings w ON w.id = wm.wedding_id
       WHERE wm.role = 'couple' AND wm.status = 'active' AND LOWER(u.email) IN (${ph})
         AND (w.status IS NULL OR w.status NOT IN ('completed', 'cancelled'))
       ORDER BY (w.date IS NULL), w.date ASC
       LIMIT 1`,
    )
    .bind(...clean)
    .first<{ wedding_id: string }>()
  return row?.wedding_id ?? null
}

async function inviteCouple(
  env: Bindings,
  weddingId: string,
  email: string,
  fullName: string,
  firstName: string,
  inviteData: { vendorName: string; weddingTitle: string; weddingDate: string | null },
): Promise<void> {
  const isNewUser = !(await getUserByEmail(env.DB, email))
  const u = await findOrCreateUser(env.DB, email, fullName)
  await addWeddingMember(env.DB, { wedding_id: weddingId, user_id: u.id, role: 'couple' })
  sendCoupleInvite(env.DB, env.KV, env.RESEND_API_KEY, env.APP_URL, {
    email,
    coupleName: firstName || fullName,
    ...inviteData,
  }).catch((e: any) => console.error('[booking-wedding] couple invite failed', e?.message))
  if (isNewUser) {
    await env.EMAIL_QUEUE.send({
      type: 'notify_admin_signup',
      payload: JSON.stringify({ kind: 'couple', name: fullName, email }),
    }).catch(() => {})
  }
}

export async function attachVendorToCoupleWedding(
  env: Bindings,
  vendor: VendorProfile,
  contact: Contact,
  opts: { createIfMissing: boolean },
): Promise<string | null> {
  const db = env.DB
  const emails = [contact.email, contact.partner_email].filter(Boolean) as string[]

  // 1. Already linked, or match the couple's existing shared wedding by email.
  let weddingId = contact.wedding_id ?? (await findCoupleWedding(db, emails))

  if (!weddingId) {
    if (!opts.createIfMissing) return null // enquiries don't conjure a wedding

    // 2. No wedding yet → create one from the contact and invite the couple.
    const title = contact.partner_first_name
      ? `${contact.first_name} & ${contact.partner_first_name}`
      : `${contact.first_name} ${contact.last_name}`.trim() || 'Wedding'
    const wedding = await createWedding(db, {
      title,
      date: contact.wedding_date ?? null,
      location: contact.wedding_location ?? null,
      ceremony_type: 'wedding',
      created_by_user_id: vendor.user_id,
    })
    weddingId = wedding.id
    await addWeddingMember(db, {
      wedding_id: weddingId,
      user_id: vendor.user_id,
      role: 'vendor',
      vendor_profile_id: vendor.id,
      vendor_role: vendor.category,
      can_manage: isManagerVendor(vendor),
    })
    if (contact.wedding_date) {
      await createEvent(db, vendor.id, {
        title,
        date: contact.wedding_date,
        type: 'booking',
        wedding_id: weddingId,
        all_day: true, // no ceremony time yet; the resync upgrades it once the timeline has one
      }).catch(() => {})
    }
    const inviteData = { vendorName: vendor.business_name, weddingTitle: title, weddingDate: contact.wedding_date ? formatDate(contact.wedding_date) : null }
    if (contact.email) {
      await inviteCouple(env, weddingId, contact.email, `${contact.first_name} ${contact.last_name}`.trim(), contact.first_name, inviteData)
    }
    if (contact.partner_email) {
      const pName = [contact.partner_first_name, contact.partner_last_name].filter(Boolean).join(' ') || contact.partner_email.split('@')[0]
      await inviteCouple(env, weddingId, contact.partner_email, pName, contact.partner_first_name ?? pName, inviteData)
    }
  } else {
    // 3. Matched / already-linked wedding → ensure the vendor is a member. Only
    // add when NO membership row exists (so a vendor the couple previously
    // REMOVED is never silently resurrected). Auto-joining someone else's wedding
    // never grants management rights — the wedding's lead can promote if wanted.
    if (!(await getAnyMembership(db, weddingId, vendor.user_id))) {
      await addWeddingMember(db, {
        wedding_id: weddingId,
        user_id: vendor.user_id,
        role: 'vendor',
        vendor_profile_id: vendor.id,
        vendor_role: vendor.category,
        can_manage: false,
      })
    }
  }

  // Link the couple's EXISTING contact to the wedding (storage + D1) + mark booked.
  if (contact.wedding_id !== weddingId || contact.status !== 'booked') {
    try {
      const storage = await getStorageWithSecrets(env, vendor)
      await updateContact(storage, db, vendor.id, contact.id, { wedding_id: weddingId, status: 'booked' })
    } catch (e: any) {
      console.error('[booking-wedding] contact link failed', e?.message)
    }
  }

  // Fan out calendar events so the wedding shows in everyone's iCal/CalDAV feed.
  await resyncWeddingCalendars(db, weddingId).catch(() => {})
  return weddingId
}
