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
import type { MessageKey } from '../i18n'

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
  labelKey: MessageKey
  descriptionKey: MessageKey
  /** Which preference groups show this toggle. 'all' = vendors and couples. */
  audience: NotificationAudience
}

export const NOTIFICATION_TYPES: NotificationType[] = [
  // ─── Vendor: running your business ───
  {
    key: 'enquiries',
    labelKey: 'account.notifications.type.enquiries.label',
    descriptionKey: 'account.notifications.type.enquiries.desc',
    audience: 'vendor',
  },
  {
    key: 'payments_received',
    labelKey: 'account.notifications.type.paymentsReceived.label',
    descriptionKey: 'account.notifications.type.paymentsReceived.desc',
    audience: 'vendor',
  },
  {
    key: 'vendor_collaboration',
    labelKey: 'account.notifications.type.vendorCollaboration.label',
    descriptionKey: 'account.notifications.type.vendorCollaboration.desc',
    audience: 'vendor',
  },
  {
    key: 'daily_digest',
    labelKey: 'account.notifications.type.dailyDigest.label',
    descriptionKey: 'account.notifications.type.dailyDigest.desc',
    audience: 'vendor',
  },
  {
    key: 'referrals',
    labelKey: 'account.notifications.type.referrals.label',
    descriptionKey: 'account.notifications.type.referrals.desc',
    audience: 'vendor',
  },

  // ─── Everyone: weddings you're part of ───
  {
    key: 'wedding_invites',
    labelKey: 'account.notifications.type.weddingInvites.label',
    descriptionKey: 'account.notifications.type.weddingInvites.desc',
    audience: 'all',
  },
  {
    key: 'wedding_updates',
    labelKey: 'account.notifications.type.weddingUpdates.label',
    descriptionKey: 'account.notifications.type.weddingUpdates.desc',
    audience: 'all',
  },
  {
    key: 'payment_reminders',
    labelKey: 'account.notifications.type.paymentReminders.label',
    descriptionKey: 'account.notifications.type.paymentReminders.desc',
    audience: 'all',
  },

  // ─── Couple: your wedding's money ───
  {
    key: 'invoices',
    labelKey: 'account.notifications.type.invoices.label',
    descriptionKey: 'account.notifications.type.invoices.desc',
    audience: 'couple',
  },

  // ─── Everyone: from Wedding Computer ───
  {
    key: 'announcements',
    labelKey: 'account.notifications.type.announcements.label',
    descriptionKey: 'account.notifications.type.announcements.desc',
    audience: 'all',
  },

  // ─── Admins ───
  {
    key: 'admin_signups',
    labelKey: 'account.notifications.type.adminSignups.label',
    descriptionKey: 'account.notifications.type.adminSignups.desc',
    audience: 'admin',
  },
  {
    key: 'admin_safety',
    labelKey: 'account.notifications.type.adminSafety.label',
    descriptionKey: 'account.notifications.type.adminSafety.desc',
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
