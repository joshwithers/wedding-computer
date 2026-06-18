import type { Bindings } from '../types'
import { generateToken } from '../lib/crypto'
import { sendEmailMessage, vendorInviteReminderEmail } from './email'
import { getUserByEmail } from '../db/users'
import { getVendorByUserId } from '../db/vendors'
import { trackEvent } from '../db/analytics'

// First-touch vendor invites go to cold recipients who rarely act on the first
// email. We stash a lightweight record in KV when the welcome invite is sent,
// then a daily cron nudges anyone who hasn't signed in — at day 3, and a final
// at day 7. Activation (the invitee becoming a vendor, or signing in) clears the
// record. KV TTL is the backstop cleanup; no schema/table needed.

const PREFIX = 'vinvite:'
const RECORD_TTL = 60 * 60 * 24 * 14 // 14 days — covers both reminders + buffer
const MAGIC_TTL = 60 * 60 * 24 * 7 // fresh sign-in link in each reminder
const MAX_PER_RUN = 200 // bound cron work

export type PendingInvite = {
  weddingId: string
  weddingTitle: string
  weddingDate: string | null
  inviterName: string
  inviterVendorId: string | null
  vendorRole: string | null
  invitedAt: string // ISO
  remindersSent: number
}

function keyFor(email: string): string {
  return `${PREFIX}${email.toLowerCase()}`
}

/** Stash a pending-invite record so the cron can follow up. Best-effort. */
export async function recordPendingInvite(
  kv: KVNamespace,
  email: string,
  data: Omit<PendingInvite, 'invitedAt' | 'remindersSent'>
): Promise<void> {
  const record: PendingInvite = { ...data, invitedAt: new Date().toISOString(), remindersSent: 0 }
  await kv.put(keyFor(email), JSON.stringify(record), { expirationTtl: RECORD_TTL })
}

export async function getPendingInvite(kv: KVNamespace, email: string): Promise<PendingInvite | null> {
  const raw = await kv.get(keyFor(email))
  if (!raw) return null
  try {
    return JSON.parse(raw) as PendingInvite
  } catch {
    return null
  }
}

export async function clearPendingInvite(kv: KVNamespace, email: string): Promise<void> {
  await kv.delete(keyFor(email))
}

/**
 * Mark an invited vendor as activated (they signed in). Records the conversion
 * against the inviter for measurement, then stops further reminders. Safe to
 * call on every login — a no-op when there's no pending invite.
 */
export async function activateInvite(env: Bindings, email: string): Promise<void> {
  const invite = await getPendingInvite(env.KV, email)
  if (!invite) return
  if (invite.inviterVendorId) {
    await trackEvent(env.DB, {
      vendor_id: invite.inviterVendorId,
      event_type: 'vendor_invite_activated',
      wedding_id: invite.weddingId,
      metadata: { email, source: 'login' },
    }).catch(() => {})
  }
  await clearPendingInvite(env.KV, email)
}

/**
 * Daily sweep: nudge invited vendors who haven't signed in (day 3, then a final
 * at day 7), and retire records for anyone who has since become a vendor.
 * Returns the number of reminder emails sent.
 */
export async function sendPendingVendorInviteReminders(env: Bindings): Promise<number> {
  const list = await env.KV.list({ prefix: PREFIX, limit: 1000 })
  let sent = 0

  for (const entry of list.keys) {
    if (sent >= MAX_PER_RUN) break
    const raw = await env.KV.get(entry.name)
    if (!raw) continue
    let rec: PendingInvite
    try {
      rec = JSON.parse(raw)
    } catch {
      await env.KV.delete(entry.name)
      continue
    }
    const email = entry.name.slice(PREFIX.length)

    // Activated? If they now have a vendor profile, record + retire.
    const user = await getUserByEmail(env.DB, email)
    if (user) {
      const vp = await getVendorByUserId(env.DB, user.id)
      if (vp) {
        if (rec.inviterVendorId) {
          await trackEvent(env.DB, {
            vendor_id: rec.inviterVendorId,
            event_type: 'vendor_invite_activated',
            wedding_id: rec.weddingId,
            metadata: { email, source: 'profile' },
          }).catch(() => {})
        }
        await env.KV.delete(entry.name)
        continue
      }
    }

    const ageDays = (Date.now() - Date.parse(rec.invitedAt)) / 86400000
    let due = false
    let final = false
    if (rec.remindersSent === 0 && ageDays >= 3) {
      due = true
    } else if (rec.remindersSent === 1 && ageDays >= 7) {
      due = true
      final = true
    } else if (rec.remindersSent >= 2) {
      await env.KV.delete(entry.name)
      continue
    }
    if (!due) continue

    const token = await generateToken(32)
    await env.KV.put(`magic:${token}`, JSON.stringify({ email }), { expirationTtl: MAGIC_TTL })
    const loginUrl = `${env.APP_URL}/login/verify?token=${token}`

    await sendEmailMessage({
      db: env.DB,
      resendApiKey: env.RESEND_API_KEY,
      vendorId: null,
      to: email,
      subject: `${rec.weddingTitle} is waiting for you on Wedding Computer`,
      html: vendorInviteReminderEmail({
        inviterName: rec.inviterName,
        weddingTitle: rec.weddingTitle,
        weddingDate: rec.weddingDate,
        loginUrl,
        finalReminder: final,
      }),
      isSystem: true,
    }).catch((e: any) => console.error('[invite-followup] send failed', e?.message))

    rec.remindersSent += 1
    const remainingTtl = Math.max(60, Math.floor(RECORD_TTL - ageDays * 86400))
    await env.KV.put(entry.name, JSON.stringify(rec), { expirationTtl: remainingTtl })
    sent++
  }

  return sent
}
