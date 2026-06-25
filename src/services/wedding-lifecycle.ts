// Wedding/contact lifecycle: status is the state of a relationship, not a label.
// A wedding's status change propagates to its linked CRM contact(s) so the sales
// funnel and the wedding can never disagree, and the terminal transitions capture
// a reason + timestamp for win/loss reporting. See migration 074.

import type { Wedding } from '../types'
import type { StorageBackend } from '../storage/types'
import { updateContactStatus } from '../storage/contacts'
import { createActivity } from '../db/activities'

// Structured reasons (slugs; labels rendered via i18n `lifecycle.reason.*`). The
// optional free-text note lives alongside. Editable taxonomy — add slugs here +
// the matching i18n keys.
export const CANCELLATION_REASONS = [
  'couple_cancelled',
  'changed_vendor',
  'budget',
  'event_called_off',
  'double_booked',
  'other',
] as const
export const LOST_REASONS = [
  'price',
  'availability',
  'chose_competitor',
  'no_response',
  'not_a_fit',
  'other',
] as const
export type CancellationReason = (typeof CANCELLATION_REASONS)[number]
export type LostReason = (typeof LOST_REASONS)[number]

export function isCancellationReason(v: string): v is CancellationReason {
  return (CANCELLATION_REASONS as readonly string[]).includes(v)
}
export function isLostReason(v: string): v is LostReason {
  return (LOST_REASONS as readonly string[]).includes(v)
}

/**
 * The lifecycle state a vendor selects + sees: the stored wedding statuses PLUS
 * the derived 'postponed'. Postponed isn't a stored status value (that needs a
 * CHECK change, which isn't FK-safe to migrate on D1) — it's `postponed_at` on
 * top of a still-active status. See migration 074.
 */
export type WeddingStatusChoice = Wedding['status'] | 'postponed'

/**
 * The state to display + act on: 'postponed' when the wedding has a postponed_at
 * and isn't cancelled/completed, otherwise its real status.
 */
export function effectiveWeddingStatus(
  w: Pick<Wedding, 'status' | 'postponed_at'>
): WeddingStatusChoice {
  if (w.postponed_at && w.status !== 'cancelled' && w.status !== 'completed') return 'postponed'
  return w.status
}

/**
 * The CRM contact status implied by a wedding lifecycle choice. `null` = leave
 * the contact alone (planning/postponed are still-active relationships). A
 * cancelled wedding moves the contact to 'lost' — the existing terminal status
 * — distinguished from a never-booked lost lead by its cancellation reason.
 */
export function contactStatusForWeddingStatus(
  s: WeddingStatusChoice
): 'booked' | 'completed' | 'lost' | null {
  switch (s) {
    case 'confirmed':
      return 'booked'
    case 'completed':
      return 'completed'
    case 'cancelled':
      return 'lost'
    case 'postponed':
      return 'booked' // still your client, just a moved/TBD date
    case 'planning':
      return null
  }
}

/**
 * Propagate a wedding status change onto the acting vendor's OWN linked contact,
 * so their sales funnel matches the wedding. Scoped to the vendor's own data:
 * each vendor owns their contact (its own markdown/storage), and the shared
 * wedding status + notifications inform the others. Goes through the storage
 * layer (not a raw table write) so markdown + cache + the contacts table stay
 * consistent — a direct UPDATE would be clobbered by the next syncToContactsTable.
 * Idempotent: a no-op if there's no linked contact or it's already in step.
 */
export async function syncVendorContactToWeddingStatus(
  storage: StorageBackend,
  db: D1Database,
  vendorId: string,
  weddingId: string,
  newStatus: WeddingStatusChoice
): Promise<void> {
  const target = contactStatusForWeddingStatus(newStatus)
  if (!target) return
  const contact = await db
    .prepare('SELECT id, status FROM contacts WHERE wedding_id = ? AND vendor_id = ? LIMIT 1')
    .bind(weddingId, vendorId)
    .first<{ id: string; status: string }>()
  if (!contact || contact.status === target) return
  await updateContactStatus(storage, db, vendorId, contact.id, target)
  await createActivity(db, contact.id, 'status_change', `Wedding ${newStatus} → ${target}`).catch(() => {})
}

/**
 * The lifecycle COLUMNS to write for a transition — never the `status` column
 * itself (the caller writes that, and 'postponed' is not a status value). Sets
 * the per-state timestamp + cancellation reason, flags/clears postponed_at, and
 * (first postponement only) retains the date moved from. `stampIso` is the
 * caller's "now" (Workers `new Date().toISOString()`).
 */
export function lifecycleColumnsForTransition(
  choice: WeddingStatusChoice,
  old: Pick<Wedding, 'date' | 'original_date'> | null,
  reason: string | null,
  note: string | null,
  stampIso: string
): Partial<Wedding> {
  const stamp = stampIso.replace('T', ' ').slice(0, 19)
  switch (choice) {
    case 'confirmed':
      return { confirmed_at: stamp, postponed_at: null }
    case 'completed':
      return { completed_at: stamp, postponed_at: null }
    case 'cancelled':
      return { cancelled_at: stamp, cancellation_reason: reason, cancellation_note: note, postponed_at: null }
    case 'postponed':
      return {
        postponed_at: stamp,
        // Retain the date we're moving FROM, the first time only.
        ...(old?.date && !old?.original_date ? { original_date: old.date } : {}),
      }
    case 'planning':
      return { postponed_at: null }
  }
}
