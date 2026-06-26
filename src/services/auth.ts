import { generateToken } from '../lib/crypto'
import type { User, Session } from '../types'
import { getUserByEmail, createUser } from '../db/users'
import { createSession } from '../db/sessions'
import { sendEmailMessage, magicLinkEmail, coupleInviteEmail, vendorWelcomeInviteEmail } from './email'
import { recordPendingInvite } from './invite-followups'
import { trackEvent } from '../db/analytics'

const MAGIC_LINK_TTL = 60 * 15 // 15 minutes
const INVITE_LINK_TTL = 60 * 60 * 24 * 7 // 7 days — invites go to cold recipients who open them later
const SESSION_TTL = 60 * 60 * 24 * 30 // 30 days

// Per-email cooldown: at most one magic link sent per address per 2 minutes.
// Prevents inbox flooding from attackers rotating IPs to bypass the per-IP
// rate limit on POST /login. The key is keyed by email hash, not plaintext.
const MAGIC_LINK_EMAIL_COOLDOWN = 120

export async function sendMagicLink(
  db: D1Database,
  kv: KVNamespace,
  resendApiKey: string,
  appUrl: string,
  email: string
): Promise<void> {
  const throttleKey = `magic:throttle:${await hashSession(email.toLowerCase())}`
  const recentlySent = await kv.get(throttleKey)
  if (recentlySent) {
    // Silently succeed — caller shows "Check your email" regardless, so the
    // attacker learns nothing and the recipient's inbox isn't flooded.
    return
  }

  const token = await generateToken(32)
  await kv.put(
    await magicKey(token),
    JSON.stringify({ email: email.toLowerCase() }),
    { expirationTtl: MAGIC_LINK_TTL }
  )
  // Set the cooldown after the token is stored, so a KV write failure on the
  // throttle key doesn't prevent delivery.
  await kv.put(throttleKey, '1', { expirationTtl: MAGIC_LINK_EMAIL_COOLDOWN })

  const url = `${appUrl}/login/verify?token=${token}`
  await sendEmailMessage({
    db,
    resendApiKey,
    vendorId: null,
    to: email,
    subject: 'Sign in to Wedding Computer',
    html: magicLinkEmail(url),
    isSystem: true,
    // Auth must always attempt delivery — never suppress the login path.
    bypassSuppression: true,
  })
}

export async function verifyMagicLink(
  kv: KVNamespace,
  token: string
): Promise<string | null> {
  const hashedKey = await magicKey(token)
  // Legacy fallback for links issued before hashing (consumed within their TTL).
  let key = hashedKey
  let data = await kv.get(hashedKey)
  if (!data) {
    key = `magic:${token}`
    data = await kv.get(key)
  }
  if (!data) return null
  await kv.delete(key)
  const { email } = JSON.parse(data) as { email: string }
  return email
}

// The cookie holds a raw 32-byte token; at rest (KV key suffix + D1
// sessions.id) we store only its SHA-256, so a leak of KV or D1 yields
// hashes, not usable session tokens.
async function hashSession(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Magic-link / invite tokens grant a full sign-in, so — like sessions — we key
// the KV entry by the token's SHA-256, never the raw token. The raw value only
// ever lives in the emailed URL; a KV leak then yields hashes, not login links.
async function magicKey(token: string): Promise<string> {
  return `magic:${await hashSession(token)}`
}

export async function createUserSession(
  db: D1Database,
  kv: KVNamespace,
  user: User,
  ip: string | null,
  ua: string | null
): Promise<string> {
  const token = await generateToken(32)
  const keyId = await hashSession(token)
  const expiresAt = new Date(Date.now() + SESSION_TTL * 1000).toISOString()

  await kv.put(
    `session:${keyId}`,
    JSON.stringify({ userId: user.id, expiresAt }),
    { expirationTtl: SESSION_TTL }
  )

  const session: Session = {
    id: keyId,
    user_id: user.id,
    expires_at: expiresAt,
    ip_address: ip,
    user_agent: ua,
    created_at: new Date().toISOString(),
  }
  await createSession(db, session)

  return token
}

export async function resolveSession(
  kv: KVNamespace,
  token: string
): Promise<{ userId: string } | null> {
  const keyId = await hashSession(token)
  // Legacy fallback: sessions issued before hashing was keyed by the raw
  // token. Those expire within the 30-day TTL, after which this can go.
  const data = (await kv.get(`session:${keyId}`)) ?? (await kv.get(`session:${token}`))
  if (!data) return null
  const { userId, expiresAt } = JSON.parse(data) as {
    userId: string
    expiresAt: string
  }
  if (new Date(expiresAt) < new Date()) return null
  return { userId }
}

export async function destroySession(
  db: D1Database,
  kv: KVNamespace,
  token: string
): Promise<void> {
  const keyId = await hashSession(token)
  const { deleteSession } = await import('../db/sessions')
  // Clear both the hashed and any legacy raw-keyed entries.
  await kv.delete(`session:${keyId}`)
  await kv.delete(`session:${token}`)
  await deleteSession(db, keyId)
  await deleteSession(db, token)
}

/**
 * Invite a vendor (by email) to sign up, create a profile, and join a wedding.
 * Mints the same 15-min magic-link token sendCoupleInvite uses, so the invitee
 * is auto-signed-in and bypasses the SIGNUP_INVITE_CODE gate. The wedding
 * membership is created separately (waiting on vendor_profile_id); this is
 * just the email.
 */
/**
 * First-touch invite for a vendor with no Wedding Computer profile yet —
 * introduces the platform before the wedding context, since they've almost
 * certainly never heard of us. Token lives 7 days (cold recipients don't
 * open email within 15 minutes), with a plain-login fallback after that.
 * Records a pending-invite for the follow-up drip, and (when the inviter is a
 * vendor) tracks the send so the invite→signup loop is measurable.
 */
export async function sendVendorWelcomeInvite(
  db: D1Database,
  kv: KVNamespace,
  resendApiKey: string,
  appUrl: string,
  data: {
    email: string
    inviterName: string
    inviterRole?: string | null
    inviterVendorId?: string | null
    weddingId: string
    weddingTitle: string
    weddingDate: string | null
    vendorRole: string | null
  }
): Promise<void> {
  const token = await generateToken(32)
  await kv.put(
    await magicKey(token),
    JSON.stringify({ email: data.email.toLowerCase() }),
    { expirationTtl: 60 * 60 * 24 * 7 }
  )
  const loginUrl = `${appUrl}/login/verify?token=${token}`
  try {
    await sendEmailMessage({
      db,
      resendApiKey,
      vendorId: null,
      to: data.email,
      subject: `${data.inviterName} added you to ${data.weddingTitle} — here's what that means`,
      html: vendorWelcomeInviteEmail({
        inviterName: data.inviterName,
        inviterRole: data.inviterRole ?? null,
        weddingTitle: data.weddingTitle,
        weddingDate: data.weddingDate,
        vendorRole: data.vendorRole,
        loginUrl,
      }),
      isSystem: true,
    })
  } finally {
    // Always record the invite + track the send, even if this first email
    // throws on a transient error — the follow-up drip then re-sends, and the
    // invite→signup loop stays measurable.
    await recordPendingInvite(kv, data.email, {
      weddingId: data.weddingId,
      weddingTitle: data.weddingTitle,
      weddingDate: data.weddingDate,
      inviterName: data.inviterName,
      inviterVendorId: data.inviterVendorId ?? null,
      vendorRole: data.vendorRole,
    }).catch(() => {})
    if (data.inviterVendorId) {
      await trackEvent(db, {
        vendor_id: data.inviterVendorId,
        event_type: 'vendor_invite_sent',
        wedding_id: data.weddingId,
        metadata: { email: data.email.toLowerCase() },
      }).catch(() => {})
    }
  }
}

export async function sendCoupleInvite(
  db: D1Database,
  kv: KVNamespace,
  resendApiKey: string,
  appUrl: string,
  data: {
    email: string
    coupleName: string
    vendorName: string
    weddingTitle: string
    weddingDate: string | null
  }
): Promise<void> {
  const token = await generateToken(32)
  await kv.put(
    await magicKey(token),
    JSON.stringify({ email: data.email.toLowerCase() }),
    { expirationTtl: INVITE_LINK_TTL }
  )
  const loginUrl = `${appUrl}/login/verify?token=${token}`
  await sendEmailMessage({
    db,
    resendApiKey,
    vendorId: null,
    to: data.email,
    toName: data.coupleName,
    subject: `Your wedding with ${data.vendorName}`,
    html: coupleInviteEmail({
      coupleName: data.coupleName,
      vendorName: data.vendorName,
      weddingTitle: data.weddingTitle,
      weddingDate: data.weddingDate,
      loginUrl,
    }),
    isSystem: true,
    // This carries the couple's only sign-in link — never suppress it on a
    // prior bounce/complaint, or they can't access their wedding.
    bypassSuppression: true,
  })
}

export async function findOrCreateUser(
  db: D1Database,
  email: string,
  name?: string
): Promise<User> {
  const existing = await getUserByEmail(db, email)
  if (existing) return existing
  return createUser(db, email, name ?? email.split('@')[0])
}
