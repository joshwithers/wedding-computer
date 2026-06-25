import { Hono } from 'hono'
import { setSessionCookie } from '../lib/session-cookie'
import type { Env } from '../types'
import { generateToken } from '../lib/crypto'
import { getVendorByIcalToken } from '../db/vendors'
import { getUserById } from '../db/users'
import { isProVendor } from '../db/subscriptions'
import { createUserSession } from '../services/auth'
import { auditLog } from '../middleware/audit'
import {
  clientIp,
  consumeRateLimit,
  isAuthThrottled,
  recordAuthFailure,
} from '../middleware/rate-limit'

const native = new Hono<Env>()

const HANDOFF_TTL_SECONDS = 60

type NativeHandoff = {
  userId: string
  vendorId: string
  redirect: string
}

export function safeNativeRedirect(raw: unknown, requestUrl: string): string {
  if (typeof raw !== 'string') return '/app'

  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('//') || /[\r\n]/.test(trimmed)) return '/app'

  const origin = new URL(requestUrl).origin
  let url: URL
  try {
    url = trimmed.startsWith('/')
      ? new URL(trimmed, origin)
      : new URL(trimmed)
  } catch {
    return '/app'
  }

  if (url.origin !== origin) return '/app'
  if (url.pathname !== '/app' && !url.pathname.startsWith('/app/')) return '/app'
  return `${url.pathname}${url.search}${url.hash}`
}

function bearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7).trim()
  return token.length >= 32 ? token : null
}

function handoffUrl(requestUrl: string, token: string): string {
  const url = new URL('/native/web-session/consume', requestUrl)
  url.searchParams.set('token', token)
  return url.toString()
}

native.post('/native/web-session', async (c) => {
  c.header('Cache-Control', 'no-store')

  const ip = clientIp(c)
  if (await isAuthThrottled(c.env.KV, ip)) {
    return c.json({ error: 'Too many failed attempts. Try again later.' }, 429)
  }

  const token = bearerToken(c.req.header('Authorization'))
  const vendor = token ? await getVendorByIcalToken(c.env.DB, token) : null
  if (!vendor) {
    if (c.req.header('Authorization')) await recordAuthFailure(c.env.KV, ip)
    return c.json({ error: 'Unauthorized' }, 401)
  }

  if (!(await isProVendor(c.env.DB, vendor.id))) {
    return c.json({ error: 'Native web session requires active Pro sync access.' }, 403)
  }

  if (!(await consumeRateLimit(c.env.KV, `native-web-session:${vendor.id}`, 20, 60))) {
    return c.json({ error: 'Too many requests' }, 429)
  }

  const body = await c.req.json().catch(() => ({}))
  const redirect = safeNativeRedirect((body as { redirect?: unknown }).redirect, c.req.url)
  const handoffToken = await generateToken(32)
  const payload: NativeHandoff = {
    userId: vendor.user_id,
    vendorId: vendor.id,
    redirect,
  }

  await c.env.KV.put(
    `native_handoff:${handoffToken}`,
    JSON.stringify(payload),
    { expirationTtl: HANDOFF_TTL_SECONDS }
  )

  return c.json({ url: handoffUrl(c.req.url, handoffToken), expires_in: HANDOFF_TTL_SECONDS })
})

native.get('/native/web-session/consume', async (c) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')

  const token = c.req.query('token')
  if (!token) return c.redirect('/login?error=Invalid+or+expired+native+session')

  const key = `native_handoff:${token}`
  const data = await c.env.KV.get(key)
  if (!data) return c.redirect('/login?error=Invalid+or+expired+native+session')

  await c.env.KV.delete(key)

  let handoff: NativeHandoff
  try {
    handoff = JSON.parse(data) as NativeHandoff
  } catch {
    return c.redirect('/login?error=Invalid+or+expired+native+session')
  }

  const user = await getUserById(c.env.DB, handoff.userId)
  if (!user || user.deleted_at) {
    return c.redirect('/login?error=Invalid+or+expired+native+session')
  }

  const ip = c.req.header('cf-connecting-ip') ?? null
  const ua = c.req.header('user-agent') ?? null
  const sessionId = await createUserSession(c.env.DB, c.env.KV, user, ip, ua)

  setSessionCookie(c, sessionId)

  c.set('user', user)
  await auditLog(c, 'login', 'user', user.id, {
    method: 'native_handoff',
    vendor_id: handoff.vendorId,
  }).catch(() => {})

  return c.redirect(handoff.redirect)
})

export default native
