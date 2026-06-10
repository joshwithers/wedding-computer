// Central registry of email notification types and per-user preference helpers.
//
// Preferences live in users.notification_prefs as a JSON object of
// { [key]: boolean }. A missing key means ENABLED (opt-out model), so new
// notification types are automatically on for everyone, and '{}' = all on.
//
// Transactional email (magic links, email-change verification, couple/guest
// invites, invoices to people without accounts) is never preference-gated —
// it is the mechanism of using the platform, not a notification about it.

import { hmacSign, hmacVerify } from '../lib/crypto'

export type NotificationKey =
  | 'enquiries'
  | 'wedding_invites'
  | 'wedding_updates'
  | 'vendor_collaboration'
  | 'invoices'
  | 'payments_received'
  | 'payment_reminders'
  | 'daily_digest'
  | 'referrals'
  | 'announcements'
  | 'admin_signups'
  | 'admin_safety'

export type NotificationAudience = 'vendor' | 'couple' | 'all' | 'admin'

export type NotificationType = {
  key: NotificationKey
  label: string
  description: string
  /** Which preference groups show this toggle. 'all' = vendors and couples. */
  audience: NotificationAudience
}

export const NOTIFICATION_TYPES: NotificationType[] = [
  // ─── Vendor: running your business ───
  {
    key: 'enquiries',
    label: 'New enquiries',
    description: 'Someone submits your enquiry form or one of your custom forms.',
    audience: 'vendor',
  },
  {
    key: 'payments_received',
    label: 'Payments received',
    description: 'A payment lands on one of your invoices.',
    audience: 'vendor',
  },
  {
    key: 'vendor_collaboration',
    label: 'Vendor collaboration',
    description: 'A couple books another vendor, or changes whether vendors can see each other.',
    audience: 'vendor',
  },
  {
    key: 'daily_digest',
    label: 'Daily summary',
    description: 'A morning round-up of upcoming weddings, new contacts, and payments due.',
    audience: 'vendor',
  },
  {
    key: 'referrals',
    label: 'Referral rewards',
    description: 'Someone you referred subscribes and you earn a free month.',
    audience: 'vendor',
  },

  // ─── Everyone: weddings you're part of ───
  {
    key: 'wedding_invites',
    label: 'Added to a wedding',
    description: "You're added to a wedding by a vendor or couple.",
    audience: 'all',
  },
  {
    key: 'wedding_updates',
    label: 'Wedding updates',
    description: 'Details change, a booking is confirmed, or someone joins a wedding you’re part of.',
    audience: 'all',
  },
  {
    key: 'payment_reminders',
    label: 'Payment reminders',
    description: 'A payment is due in the next few days or has become overdue.',
    audience: 'all',
  },

  // ─── Couple: your wedding's money ───
  {
    key: 'invoices',
    label: 'Invoices & receipts',
    description: 'A vendor sends you an invoice, or a payment you made is recorded.',
    audience: 'couple',
  },

  // ─── Everyone: from Wedding Computer ───
  {
    key: 'announcements',
    label: 'News & announcements',
    description: 'Occasional product news and updates from Wedding Computer.',
    audience: 'all',
  },

  // ─── Admins ───
  {
    key: 'admin_signups',
    label: 'New signups',
    description: 'A new vendor or couple joins the platform.',
    audience: 'admin',
  },
  {
    key: 'admin_safety',
    label: 'Safety alerts',
    description: 'A couple removes a vendor from their wedding, or other events that may need review.',
    audience: 'admin',
  },
]

export const NOTIFICATION_KEYS = new Set<string>(NOTIFICATION_TYPES.map((t) => t.key))

/** Parse a raw notification_prefs column value. Unknown/invalid input = {} (all enabled). */
export function parseNotificationPrefs(raw: string | null | undefined): Record<string, boolean> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(parsed)) out[k] = Boolean(v)
      return out
    }
  } catch {
    // fall through — treat unparseable prefs as defaults
  }
  return {}
}

/** Is this notification enabled for a user? Missing key = enabled. */
export function isNotificationEnabled(
  prefsRaw: string | null | undefined,
  key: NotificationKey
): boolean {
  const prefs = parseNotificationPrefs(prefsRaw)
  return prefs[key] !== false
}

// ─── Signed unsubscribe tokens ───
//
// Format: <userId>.<key>.<hmac> — lets a one-click link in an email footer
// disable exactly one notification type for one user, without a session.

export async function makeUnsubscribeToken(
  secret: string,
  userId: string,
  key: NotificationKey
): Promise<string> {
  const sig = await hmacSign(secret, `unsub:${userId}:${key}`)
  return `${userId}.${key}.${sig}`
}

export async function verifyUnsubscribeToken(
  secret: string,
  token: string
): Promise<{ userId: string; key: NotificationKey } | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [userId, key, sig] = parts
  if (!userId || !NOTIFICATION_KEYS.has(key) || !sig) return null
  const valid = await hmacVerify(secret, `unsub:${userId}:${key}`, sig)
  return valid ? { userId, key: key as NotificationKey } : null
}

export function unsubscribeUrl(appUrl: string, token: string): string {
  return `${appUrl}/email/unsubscribe?token=${encodeURIComponent(token)}`
}

export const MANAGE_PREFS_PATH = '/account/notifications'
