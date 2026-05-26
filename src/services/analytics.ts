import { trackEvent } from '../db/analytics'

/**
 * Fire-and-forget analytics tracking.
 * Wraps db trackEvent so callers don't need to await or handle errors.
 * Analytics should never break the main flow.
 */
export function track(
  db: D1Database,
  vendorId: string,
  eventType: string,
  opts?: {
    contactId?: string | null
    weddingId?: string | null
    invoiceId?: string | null
    metadata?: Record<string, unknown> | null
  }
): void {
  trackEvent(db, {
    vendor_id: vendorId,
    event_type: eventType,
    contact_id: opts?.contactId,
    wedding_id: opts?.weddingId,
    invoice_id: opts?.invoiceId,
    metadata: opts?.metadata,
  }).catch((err) => {
    console.error('[ANALYTICS] tracking failed:', eventType, err)
  })
}
