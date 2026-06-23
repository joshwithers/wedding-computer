import type { Bindings, VendorProfile, Contact } from '../types'
import { getWedding, getWeddingMembers } from '../db/weddings'
import { getStorageWithSecrets } from '../storage'
import { createContact, updateContact } from '../storage/contacts'

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

function blank(v: unknown): boolean {
  return v == null || String(v).trim() === ''
}

/** First non-blank value, trimmed; null if none. */
function firstNonBlank(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) if (!blank(v)) return String(v).trim()
  return null
}

/** One partner's directly-owned details, from their Wedding Computer account. */
export type CoupleAccount = { first: string; last: string; email: string | null; phone: string | null }

/** The couple details every team vendor should see. Names/emails/phones are
 *  couple-owned (their account); address/socials are captured by a vendor and
 *  shared across the wedding team. */
export type SharedCoupleFields = {
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  partner_first_name: string | null
  partner_last_name: string | null
  partner_email: string | null
  partner_phone: string | null
  address: string | null
  instagram: string | null
  facebook: string | null
  tiktok: string | null
  website: string | null
}

/** Contact columns we can use as a donor for fields the couple's bare account
 *  doesn't carry (surnames, address, socials, partner details). */
const DONOR_FIELDS = [
  'first_name', 'last_name', 'partner_first_name', 'partner_last_name',
  'email', 'partner_email', 'phone', 'partner_phone', 'address',
  'instagram', 'facebook', 'tiktok', 'website',
] as const
export type DonorContact = Pick<Contact, (typeof DONOR_FIELDS)[number]>

/**
 * Merge the couple's accounts (authoritative for names/email/phone) with a
 * richer donor contact already on the wedding (address/socials/surnames a vendor
 * captured) into the full couple details to share with a team vendor. Pure.
 *
 * A donor `first_name` that's actually an email is ignored for the name (it's a
 * placeholder), but its address/socials are still used.
 */
export function buildSharedCoupleFields(
  accounts: CoupleAccount[],
  donor?: DonorContact | null
): SharedCoupleFields {
  const a0 = accounts[0]
  const a1 = accounts[1]
  const d = donor ?? null
  const donorFirst = d && !String(d.first_name ?? '').includes('@') ? d.first_name : null
  const first =
    firstNonBlank(a0?.first, donorFirst) ?? (a0?.email ? a0.email.split('@')[0] : '')
  return {
    first_name: first,
    last_name: firstNonBlank(a0?.last, d?.last_name) ?? '',
    email: firstNonBlank(a0?.email, d?.email),
    phone: firstNonBlank(a0?.phone, d?.phone),
    partner_first_name: firstNonBlank(a1?.first, d?.partner_first_name),
    partner_last_name: firstNonBlank(a1?.last, d?.partner_last_name),
    partner_email: firstNonBlank(a1?.email, d?.partner_email),
    partner_phone: firstNonBlank(a1?.phone, d?.partner_phone),
    address: firstNonBlank(d?.address),
    instagram: firstNonBlank(d?.instagram),
    facebook: firstNonBlank(d?.facebook),
    tiktok: firstNonBlank(d?.tiktok),
    website: firstNonBlank(d?.website),
  }
}

/** Which fields to copy onto an existing contact: only those it's MISSING (so a
 *  vendor's own edits are never overwritten). Pure. */
export function fillableFromShared(
  existing: Partial<SharedCoupleFields>,
  shared: SharedCoupleFields
): Partial<SharedCoupleFields> {
  const out: Partial<SharedCoupleFields> = {}
  for (const k of Object.keys(shared) as (keyof SharedCoupleFields)[]) {
    if (blank(existing[k]) && !blank(shared[k])) (out as Record<string, unknown>)[k] = shared[k]
  }
  return out
}

/** Count of non-blank donor fields — used to pick the richest contact. */
function donorScore(c: DonorContact): number {
  return DONOR_FIELDS.reduce((n, f) => n + (blank(c[f]) ? 0 : 1), 0)
}

/**
 * The most complete couple contact already on the wedding (across ALL vendors):
 * the donor for surnames/address/socials a newly-added vendor can't get from the
 * couple's bare account. Scoped to the wedding; demo rows excluded.
 */
export async function getRichestWeddingContact(
  db: D1Database,
  weddingId: string
): Promise<DonorContact | null> {
  const rows = await db
    .prepare(
      `SELECT first_name, last_name, partner_first_name, partner_last_name,
              email, partner_email, phone, partner_phone, address,
              instagram, facebook, tiktok, website
       FROM contacts WHERE wedding_id = ? AND is_demo = 0`
    )
    .bind(weddingId)
    .all<DonorContact>()
    .then((r) => r.results)
  let best: DonorContact | null = null
  let bestScore = -1
  for (const r of rows) {
    const s = donorScore(r)
    if (s > bestScore) {
      bestScore = s
      best = r
    }
  }
  return best
}

/** The couple's partner accounts on a wedding (name/email/phone), oldest first. */
async function getCoupleAccounts(db: D1Database, weddingId: string): Promise<CoupleAccount[]> {
  const rows = await db
    .prepare(
      `SELECT u.name AS name, u.email AS email, u.phone AS phone
       FROM wedding_members wm JOIN users u ON u.id = wm.user_id
       WHERE wm.wedding_id = ? AND wm.role = 'couple' AND wm.status = 'active'
       ORDER BY wm.created_at`
    )
    .bind(weddingId)
    .all<{ name: string | null; email: string | null; phone: string | null }>()
    .then((r) => r.results)
  return rows.map((a) => {
    const [first, last] = splitName(a.name)
    return { first, last, email: a.email, phone: a.phone }
  })
}

/** The vendor's existing CRM contact for this couple — by wedding, else by the
 *  couple's email (so we enrich a pre-existing lead rather than duplicate it). */
async function findVendorCoupleContact(
  db: D1Database,
  vendorId: string,
  weddingId: string,
  coupleEmail: string | null
): Promise<Contact | null> {
  const byWedding = await db
    .prepare('SELECT * FROM contacts WHERE vendor_id = ? AND wedding_id = ? LIMIT 1')
    .bind(vendorId, weddingId)
    .first<Contact>()
  if (byWedding) return byWedding
  if (coupleEmail) {
    const byEmail = await db
      .prepare('SELECT * FROM contacts WHERE vendor_id = ? AND lower(email) = lower(?) LIMIT 1')
      .bind(vendorId, coupleEmail)
      .first<Contact>()
    if (byEmail) return byEmail
  }
  return null
}

/**
 * Give a vendor on a wedding access to the couple's full contact details as a
 * CRM contact — names (both partners), emails, phones, address and socials —
 * status 'booked', linked to the wedding. So any vendor a couple, planner or
 * booking adds can see and reach the couple, not just a bare wedding row.
 *
 * Couple-owned fields (names/email/phone) come from the couple's accounts; the
 * rest is backfilled from the richest contact already on the wedding (the
 * details the booking/creating vendor captured), shared across the team.
 *
 * Idempotent + non-destructive: if the vendor already has a contact for this
 * couple it only fills MISSING fields (never overwrites their edits); otherwise
 * it creates one. Best-effort — never throws; callers shouldn't block on it.
 */
export async function ensureCoupleContact(
  env: Bindings,
  vendor: VendorProfile,
  weddingId: string
): Promise<void> {
  try {
    const wedding = await getWedding(env.DB, weddingId)
    if (!wedding) return

    const accounts = await getCoupleAccounts(env.DB, weddingId)
    const donor = await getRichestWeddingContact(env.DB, weddingId)
    // Nothing to share if there's neither a couple account nor a donor contact.
    if (accounts.length === 0 && !donor) return

    const shared = buildSharedCoupleFields(accounts, donor)
    // Need at least a name or an email to make a usable contact.
    if (blank(shared.first_name) && blank(shared.email)) return

    const existing = await findVendorCoupleContact(env.DB, vendor.id, weddingId, shared.email)
    const storage = await getStorageWithSecrets(env, vendor)

    if (existing) {
      const patch: Record<string, unknown> = { ...fillableFromShared(existing, shared) }
      // Link a so-far-unlinked contact (e.g. a pre-existing lead) to this wedding.
      if (blank(existing.wedding_id)) {
        patch.wedding_id = weddingId
        if (blank(existing.wedding_date)) patch.wedding_date = wedding.date
        if (blank(existing.wedding_location)) patch.wedding_location = wedding.location
      }
      if (Object.keys(patch).length > 0) {
        await updateContact(storage, env.DB, vendor.id, existing.id, patch)
      }
      return
    }

    await createContact(storage, env.DB, vendor.id, {
      ...shared,
      wedding_id: weddingId,
      wedding_date: wedding.date,
      wedding_location: wedding.location,
      source: 'couple',
      status: 'booked',
      notes: 'Added to this wedding on Wedding Computer — couple details shared with the team.',
    })
  } catch (e: any) {
    console.error('[couple-contact] failed for vendor', vendor.id, weddingId, e?.message)
  }
}
