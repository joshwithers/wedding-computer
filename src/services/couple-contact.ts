import type { Bindings, VendorProfile } from '../types'
import { getWedding, getWeddingMembers } from '../db/weddings'
import { getStorageWithSecrets } from '../storage'
import { createContact } from '../storage/contacts'

export function splitName(name?: string | null): [string, string] {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return [parts[0] ?? '', parts.slice(1).join(' ')]
}

export type CouplePartner = { first: string; last: string }

/** Parse a combined wedding title ("Sarah Smith & James Lee") into partners. */
export function partnersFromTitle(title?: string | null): CouplePartner[] {
  const raw = (title ?? '').trim()
  if (!raw) return []
  return raw
    .split(/\s*&\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => {
      const [first, last] = splitName(part)
      return { first: first || part, last }
    })
}

/**
 * Derive the couple's two partners as separate first + last names for display,
 * richest source first:
 *   1. the vendor's CRM contact linked to this wedding (explicit partner
 *      first/last — most likely to carry both surnames),
 *   2. active couple members (users.name, split on whitespace),
 *   3. the wedding title parsed on "&"/"and".
 * Returns 1–2 partners; `last` may be '' when no surname is available.
 */
export async function getCouplePartners(
  db: D1Database,
  weddingId: string,
  opts: { vendorId?: string; title?: string | null } = {}
): Promise<CouplePartner[]> {
  if (opts.vendorId) {
    const c = await db
      .prepare(
        'SELECT first_name, last_name, partner_first_name, partner_last_name FROM contacts WHERE vendor_id = ? AND wedding_id = ? LIMIT 1'
      )
      .bind(opts.vendorId, weddingId)
      .first<{ first_name: string; last_name: string; partner_first_name: string | null; partner_last_name: string | null }>()
    // first_name can be an email when the couple had no parseable name — skip then.
    if (c && c.first_name && !c.first_name.includes('@')) {
      const partners: CouplePartner[] = [{ first: c.first_name, last: c.last_name || '' }]
      if (c.partner_first_name) partners.push({ first: c.partner_first_name, last: c.partner_last_name || '' })
      return partners
    }
  }

  try {
    const members = await getWeddingMembers(db, weddingId)
    const couples = members.filter((m) => m.role === 'couple' && (m.user_name || m.user_email))
    if (couples.length) {
      return couples.slice(0, 2).map((m) => {
        const [first, last] = splitName(m.user_name)
        return { first: first || (m.user_email?.split('@')[0] ?? ''), last }
      })
    }
  } catch {
    // fall through to the title
  }

  return partnersFromTitle(opts.title)
}

/**
 * Ensure the couple on a wedding exists as a CRM contact in the vendor's
 * contacts — status 'booked', linked to the wedding — so a vendor a couple
 * adds shows up in their contact list, not just their wedding list.
 *
 * Idempotent: skips if a contact already exists for this wedding or the
 * couple's email. Best-effort — never throws; callers shouldn't block on it.
 */
export async function ensureCoupleContact(
  env: Bindings,
  vendor: VendorProfile,
  weddingId: string
): Promise<void> {
  try {
    const byWedding = await env.DB
      .prepare('SELECT id FROM contacts WHERE vendor_id = ? AND wedding_id = ? LIMIT 1')
      .bind(vendor.id, weddingId)
      .first()
    if (byWedding) return

    const wedding = await getWedding(env.DB, weddingId)
    if (!wedding) return

    const members = await getWeddingMembers(env.DB, weddingId)
    const couples = members.filter((m) => m.role === 'couple' && m.user_email)
    if (couples.length === 0) return

    const primary = couples[0]
    const partner = couples[1]

    // Don't duplicate an existing lead/contact for the same email.
    const byEmail = await env.DB
      .prepare('SELECT id FROM contacts WHERE vendor_id = ? AND lower(email) = lower(?) LIMIT 1')
      .bind(vendor.id, primary.user_email)
      .first()
    if (byEmail) return

    const [firstName, lastName] = splitName(primary.user_name)
    const [partnerFirst, partnerLast] = splitName(partner?.user_name)

    const storage = await getStorageWithSecrets(env, vendor)
    await createContact(storage, env.DB, vendor.id, {
      first_name: firstName || primary.user_email,
      last_name: lastName,
      email: primary.user_email,
      partner_first_name: partner ? partnerFirst || null : null,
      partner_last_name: partner ? partnerLast || null : null,
      partner_email: partner?.user_email ?? null,
      wedding_id: weddingId,
      wedding_date: wedding.date,
      wedding_location: wedding.location,
      source: 'couple',
      status: 'booked',
      notes: 'Added to this wedding by the couple on Wedding Computer.',
    })
  } catch (e: any) {
    console.error('[couple-contact] failed for vendor', vendor.id, weddingId, e?.message)
  }
}
