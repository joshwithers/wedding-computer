import { isProVendor } from '../db/subscriptions'
import { countActiveOwnWeddings } from '../db/weddings'
import { todayString } from '../lib/date'
import type { VendorProfile } from '../types'

// Free plan covers this many *active* (upcoming/undated) wedding workspaces at
// once. Past weddings free up a slot, so it's a rolling cap, not a lifetime or
// annual count. Pro is uncapped. Tweak here to retune the free tier.
export const FREE_ACTIVE_WEDDING_LIMIT = 4

export type WeddingCapStatus = {
  isPro: boolean
  count: number
  limit: number
  remaining: number
  atCap: boolean
}

/**
 * Soft cap for free vendors: returns where they stand against the active-
 * wedding limit. Pro vendors are always uncapped (limit Infinity, atCap false).
 * `userId` is the acting user — the cap counts the weddings they originated.
 */
export async function weddingCapStatus(
  db: D1Database,
  vendor: VendorProfile,
  userId: string
): Promise<WeddingCapStatus> {
  const isPro = await isProVendor(db, vendor.id)
  if (isPro) {
    return { isPro: true, count: 0, limit: Infinity, remaining: Infinity, atCap: false }
  }
  const count = await countActiveOwnWeddings(db, userId, todayString())
  const limit = FREE_ACTIVE_WEDDING_LIMIT
  return { isPro: false, count, limit, remaining: Math.max(0, limit - count), atCap: count >= limit }
}
