import { Hono } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import type { Env } from '../types'
import { AuthLayout } from '../views/layouts/auth'
import { isValidEmail } from '../lib/validation'
import { sendMagicLink, verifyMagicLink, findOrCreateUser, createUserSession, destroySession } from '../services/auth'
import { rateLimit } from '../middleware/rate-limit'
import { auditLog } from '../middleware/audit'

const auth = new Hono<Env>()

auth.get('/login', (c) => {
  const error = c.req.query('error')
  const sent = c.req.query('sent')
  return c.html(
    <AuthLayout title="Sign in">
      <div class="bg-white rounded-2xl shadow-lg shadow-horizon/5 p-5 sm:p-8">
        <h2 class="text-2xl font-bold mb-1">Welcome back</h2>
        <p class="text-sm text-gray-500 mb-6">We'll email you a magic link to sign in.</p>
        {error && <p class="text-sm text-grapefruit-700 font-medium mb-4">{error}</p>}
        {sent && (
          <div class="bg-horizon-50 text-horizon-700 text-sm font-medium rounded-xl p-4 mb-4">
            Check your email for the sign-in link.
          </div>
        )}
        <form method="post" action="/login">
          <label class="block text-sm font-bold text-gray-700 mb-1.5" for="email">
            Email address
          </label>
          <input
            type="email"
            id="email"
            name="email"
            required
            autofocus
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            placeholder="you@example.com"
          />
          <button
            type="submit"
            class="mt-4 w-full bg-horizon-600 text-white py-3 px-4 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            Send magic link
          </button>
        </form>
      </div>
    </AuthLayout>
  )
})

auth.post('/login', rateLimit(5, 60), async (c) => {
  const body = await c.req.parseBody()
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

  if (!isValidEmail(email)) {
    return c.redirect('/login?error=Please+enter+a+valid+email+address')
  }

  try {
    await sendMagicLink(c.env.KV, c.env.RESEND_API_KEY, c.env.APP_URL, email)
  } catch (e) {
    console.error('[AUTH] magic link send failed', e)
  }

  return c.redirect('/login?sent=1')
})

auth.get('/login/verify', async (c) => {
  const token = c.req.query('token')
  if (!token) {
    return c.redirect('/login?error=Invalid+or+expired+link')
  }

  const email = await verifyMagicLink(c.env.KV, token)
  if (!email) {
    return c.redirect('/login?error=Invalid+or+expired+link')
  }

  const user = await findOrCreateUser(c.env.DB, email)
  const ip = c.req.header('cf-connecting-ip') ?? null
  const ua = c.req.header('user-agent') ?? null
  const sessionId = await createUserSession(c.env.DB, c.env.KV, user, ip, ua)

  setCookie(c, 'wc_session', sessionId, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 30,
  })

  await auditLog(c, 'login', 'user', user.id, { method: 'magic_link' }).catch(() => {})
  return c.redirect('/app')
})

auth.post('/logout', async (c) => {
  const sessionId = getCookie(c, 'wc_session')
  if (sessionId) {
    await auditLog(c, 'logout').catch(() => {})
    await destroySession(c.env.DB, c.env.KV, sessionId)
  }
  deleteCookie(c, 'wc_session', { path: '/' })
  return c.redirect('/')
})

// Dev-only: bypass magic link for local testing
auth.get('/dev/login/:email', async (c) => {
  const host = new URL(c.req.url).hostname
  if (host !== 'localhost' && host !== '127.0.0.1') {
    return c.text('Not available in production', 404)
  }
  const email = c.req.param('email')
  const user = await findOrCreateUser(c.env.DB, email)
  const sessionId = await createUserSession(c.env.DB, c.env.KV, user, null, null)
  setCookie(c, 'wc_session', sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 30,
  })
  return c.redirect('/app')
})

export default auth
