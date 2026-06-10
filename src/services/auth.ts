import { generateToken } from '../lib/crypto'
import type { User, Session } from '../types'
import { getUserByEmail, createUser } from '../db/users'
import { createSession } from '../db/sessions'
import { sendEmailMessage, magicLinkEmail, coupleInviteEmail } from './email'

const MAGIC_LINK_TTL = 60 * 15 // 15 minutes
const SESSION_TTL = 60 * 60 * 24 * 30 // 30 days

export async function sendMagicLink(
  db: D1Database,
  kv: KVNamespace,
  resendApiKey: string,
  appUrl: string,
  email: string
): Promise<void> {
  const token = await generateToken(32)
  await kv.put(
    `magic:${token}`,
    JSON.stringify({ email: email.toLowerCase() }),
    { expirationTtl: MAGIC_LINK_TTL }
  )
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
  const data = await kv.get(`magic:${token}`)
  if (!data) return null
  await kv.delete(`magic:${token}`)
  const { email } = JSON.parse(data) as { email: string }
  return email
}

export async function createUserSession(
  db: D1Database,
  kv: KVNamespace,
  user: User,
  ip: string | null,
  ua: string | null
): Promise<string> {
  const sessionId = await generateToken(32)
  const expiresAt = new Date(Date.now() + SESSION_TTL * 1000).toISOString()

  await kv.put(
    `session:${sessionId}`,
    JSON.stringify({ userId: user.id, expiresAt }),
    { expirationTtl: SESSION_TTL }
  )

  const session: Session = {
    id: sessionId,
    user_id: user.id,
    expires_at: expiresAt,
    ip_address: ip,
    user_agent: ua,
    created_at: new Date().toISOString(),
  }
  await createSession(db, session)

  return sessionId
}

export async function resolveSession(
  kv: KVNamespace,
  sessionId: string
): Promise<{ userId: string } | null> {
  const data = await kv.get(`session:${sessionId}`)
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
  sessionId: string
): Promise<void> {
  await kv.delete(`session:${sessionId}`)
  const { deleteSession } = await import('../db/sessions')
  await deleteSession(db, sessionId)
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
    `magic:${token}`,
    JSON.stringify({ email: data.email.toLowerCase() }),
    { expirationTtl: MAGIC_LINK_TTL }
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
