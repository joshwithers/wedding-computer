import type { Bindings, VendorProfile } from '../types'
import { getWedding, getWeddingMembers } from '../db/weddings'
import { getStorageWithSecrets } from '../storage'
import { createContact } from '../storage/contacts'

function splitName(name?: string | null): [string, string] {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return [parts[0] ?? '', parts.slice(1).join(' ')]
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
