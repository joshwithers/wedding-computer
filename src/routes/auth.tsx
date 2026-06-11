import { Hono } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import type { Env } from '../types'
import { AuthLayout } from '../views/layouts/auth'
import { isValidEmail } from '../lib/validation'
import { sendMagicLink, verifyMagicLink, findOrCreateUser, createUserSession, destroySession, resolveSession } from '../services/auth'
import { getVendorByUserId } from '../db/vendors'
import { getFirstCoupleWedding, hasPendingVendorInvite } from '../db/weddings'
import { linkPendingInvites } from '../db/couple-vendors'
import { ensureCoupleContact } from '../services/couple-contact'
import { getUserById, getUserByEmail, restoreUser } from '../db/users'
import { hasPasskeys } from '../db/passkeys'
import { rateLimit } from '../middleware/rate-limit'
import { auditLog } from '../middleware/audit'
import {
  generateRegistrationOptions,
  verifyRegistration,
  generateAuthenticationOptions,
  verifyAuthentication,
} from '../services/webauthn'

const auth = new Hono<Env>()

auth.get('/login', (c) => {
  const error = c.req.query('error')
  const sent = c.req.query('sent')
  // Persist a referral code (?ref=) through the magic-link → onboarding flow
  const ref = c.req.query('ref')
  if (ref) {
    const code = ref.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    if (code) {
      setCookie(c, 'wc_ref', code, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        maxAge: 60 * 60 * 24 * 30,
      })
    }
  }
  return c.html(renderLoginPage({ error, sent: !!sent, gateOn: signupGateActive(c.env), deleted: c.req.query('deleted') === '1' }))
})

auth.post('/login', rateLimit(5, 60), async (c) => {
  const body = await c.req.parseBody()
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const inviteCode = typeof body.invite_code === 'string' ? body.invite_code.trim() : ''

  const requiredCode = c.env.SIGNUP_INVITE_CODE?.trim()
  const gateOn = !!requiredCode

  if (!isValidEmail(email)) {
    return c.html(
      renderLoginPage({ error: 'Please enter a valid email address.', gateOn, email }),
      400
    )
  }

  // Invite gate: only brand-new self-signups need a code. Existing users are
  // unaffected, and anyone arriving via an invite (couples/vendors receive a
  // pre-issued magic-link token that lands on /login/verify, never here) bypasses
  // this entirely. Unset/empty SIGNUP_INVITE_CODE = open signups.
  if (gateOn) {
    const existing = await getUserByEmail(c.env.DB, email)
    if (!existing) {
      const valid = inviteCode.toLowerCase() === requiredCode!.toLowerCase()
      if (!valid) {
        console.warn('[AUTH] signup blocked: invalid/missing invite code')
        const msg = inviteCode
          ? 'That invite code isn’t valid.'
          : 'Wedding Computer is invite-only right now — enter your invite code to create an account.'
        return c.html(renderLoginPage({ error: msg, gateOn, email }), 400)
      }
    }
  }

  try {
    await sendMagicLink(c.env.DB, c.env.KV, c.env.RESEND_API_KEY, c.env.APP_URL, email)
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
  // Signing back in within the grace period cancels a pending account deletion.
  if (user.deleted_at) {
    await restoreUser(c.env.DB, user.id).catch(() => {})
    await auditLog(c, 'account_delete_cancelled', 'user', user.id).catch(() => {})
  }
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

  const vendor = await getVendorByUserId(c.env.DB, user.id)
  if (vendor) {
    // Link any weddings they were invited to before they had a profile, and
    // add each couple to their CRM contacts.
    try {
      const linked = await linkPendingInvites(c.env.DB, user.id, vendor.id)
      for (const wid of linked) c.executionCtx.waitUntil(ensureCoupleContact(c.env, vendor, wid))
    } catch { /* best-effort */ }
    return c.redirect('/app')
  }
  const coupleWedding = await getFirstCoupleWedding(c.env.DB, user.id)
  if (coupleWedding) return c.redirect(`/wedding/${coupleWedding.wedding_id}`)
  // A brand-new user with a waiting vendor invite goes straight to vendor
  // setup rather than the generic "couple or vendor?" chooser.
  if (await hasPendingVendorInvite(c.env.DB, user.id)) return c.redirect('/onboarding/business')
  return c.redirect('/onboarding')
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

// Dev-only: bypass magic link for local testing. Gated on an explicit
// opt-in env var (set only in local .dev.vars), NOT on the absence of an
// infrastructure header — a header check would silently expose this
// full-account-takeover bypass on any non-Cloudflare or self-hosted deploy.
auth.get('/dev/login/:email', async (c) => {
  if (c.env.ENABLE_DEV_LOGIN !== 'true') {
    return c.notFound()
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
  const vendor = await getVendorByUserId(c.env.DB, user.id)
  if (vendor) return c.redirect('/app')
  const coupleWedding = await getFirstCoupleWedding(c.env.DB, user.id)
  if (coupleWedding) return c.redirect(`/wedding/${coupleWedding.wedding_id}`)
  return c.redirect('/onboarding')
})

// ─── Passkey API routes ───

// Registration: step 1 — get options (requires active session)
auth.post('/auth/passkey/register/options', async (c) => {
  const sessionId = getCookie(c, 'wc_session')
  if (!sessionId) return c.json({ error: 'Not authenticated' }, 401)
  const session = await resolveSession(c.env.KV, sessionId)
  if (!session) return c.json({ error: 'Session expired' }, 401)
  const user = await getUserById(c.env.DB, session.userId)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const options = await generateRegistrationOptions(
    c.env.KV, c.env.DB,
    { id: user.id, email: user.email, name: user.name },
    c.env.APP_URL
  )
  return c.json(options)
})

// Registration: step 2 — verify
auth.post('/auth/passkey/register/verify', async (c) => {
  const sessionId = getCookie(c, 'wc_session')
  if (!sessionId) return c.json({ error: 'Not authenticated' }, 401)
  const session = await resolveSession(c.env.KV, sessionId)
  if (!session) return c.json({ error: 'Session expired' }, 401)
  const userId = session.userId

  const body = await c.req.json()
  const result = await verifyRegistration(
    c.env.KV, c.env.DB, userId, body.credential, c.env.APP_URL, body.deviceName
  )

  if (!result.verified) {
    return c.json({ error: result.error ?? 'Verification failed' }, 400)
  }

  return c.json({ verified: true })
})

// Authentication: step 1 — get options (no session required)
auth.post('/auth/passkey/login/options', rateLimit(10, 60), async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined

  const options = await generateAuthenticationOptions(
    c.env.KV, c.env.DB, c.env.APP_URL, email
  )
  return c.json(options)
})

// Authentication: step 2 — verify and create session
auth.post('/auth/passkey/login/verify', rateLimit(10, 60), async (c) => {
  const body = await c.req.json()
  const result = await verifyAuthentication(
    c.env.KV, c.env.DB, body.credential, c.env.APP_URL
  )

  if (!result.verified || !result.userId) {
    return c.json({ error: result.error ?? 'Verification failed' }, 400)
  }

  const user = await getUserById(c.env.DB, result.userId)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const ip = c.req.header('cf-connecting-ip') ?? null
  const ua = c.req.header('user-agent') ?? null
  const sid = await createUserSession(c.env.DB, c.env.KV, user, ip, ua)

  setCookie(c, 'wc_session', sid, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 30,
  })

  await auditLog(c, 'login', 'user', user.id, { method: 'passkey' }).catch(() => {})

  const vendor = await getVendorByUserId(c.env.DB, user.id)
  if (vendor) return c.json({ redirect: '/app' })
  const coupleWedding = await getFirstCoupleWedding(c.env.DB, user.id)
  if (coupleWedding) return c.json({ redirect: `/wedding/${coupleWedding.wedding_id}` })
  return c.json({ redirect: '/onboarding' })
})

// ─── Login page rendering ───

// Signup gate is active only when SIGNUP_INVITE_CODE is set to a non-empty value.
function signupGateActive(env: Env['Bindings']): boolean {
  return !!env.SIGNUP_INVITE_CODE?.trim()
}

function renderLoginPage(opts: { error?: string; sent?: boolean; gateOn?: boolean; email?: string; deleted?: boolean }) {
  const { error, sent, gateOn, email, deleted } = opts
  return (
    <AuthLayout title="Sign in">
      <div class="bg-white rounded-2xl shadow-lg shadow-horizon/5 p-5 sm:p-8">
        <h2 class="text-2xl font-bold mb-1">Sign in</h2>
        <p class="text-sm text-gray-500 mb-6">Enter your email and we'll send you a magic link.</p>
        {deleted && (
          <div class="bg-papaya-50 text-grapefruit-700 text-sm font-medium rounded-xl p-4 mb-4">
            Your account is scheduled for deletion in 30 days. Changed your mind? Sign back in below to restore it.
          </div>
        )}
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
            value={email ?? ''}
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            placeholder="you@example.com"
          />
          {gateOn && (
            <div class="mt-4">
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="invite_code">
                Invite code
              </label>
              <input
                type="text"
                id="invite_code"
                name="invite_code"
                autocomplete="off"
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                placeholder="Enter your invite code"
              />
              <p class="text-xs text-gray-500 mt-1.5">
                Wedding Computer is invite-only right now. New here? Enter your invite code.
                Already have an account? Leave this blank.
              </p>
            </div>
          )}
          <button
            type="submit"
            class="mt-4 w-full bg-horizon-600 text-white py-3 px-4 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            Send magic link
          </button>
        </form>
        <div class="mt-4 text-center">
          <div class="relative mb-4">
            <div class="absolute inset-0 flex items-center"><div class="w-full border-t border-gray-200"></div></div>
            <div class="relative flex justify-center"><span class="bg-white px-3 text-xs text-gray-400">or</span></div>
          </div>
          <button
            id="passkey-login-btn"
            type="button"
            class="w-full border border-gray-200 py-3 px-4 rounded-xl text-sm font-bold text-gray-700 hover:bg-papaya-50 transition-colors flex items-center justify-center gap-2"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
            Sign in with passkey
          </button>
          <p id="passkey-error" class="text-sm text-grapefruit-700 font-medium mt-2 hidden"></p>
        </div>
        <p class="text-center text-xs text-gray-500 mt-5">
          Not signed up yet?{' '}
          <a href="/notify" class="text-horizon-700 font-bold hover:underline">Get notified when we launch →</a>
        </p>
        {PasskeyLoginScript()}
      </div>
    </AuthLayout>
  )
}

// ─── Passkey login script ───

function PasskeyLoginScript() {
  return (
    <script dangerouslySetInnerHTML={{ __html: `
(function() {
  var btn = document.getElementById('passkey-login-btn');
  var errEl = document.getElementById('passkey-error');
  if (!btn || !window.PublicKeyCredential) {
    if (btn) btn.style.display = 'none';
    return;
  }

  function b64urlToArr(b64) {
    var s = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function arrToB64url(arr) {
    var bin = '';
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }

  btn.addEventListener('click', async function() {
    errEl.classList.add('hidden');
    try {
      var optRes = await fetch('/auth/passkey/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (!optRes.ok) throw new Error('Failed to get options');
      var opts = await optRes.json();

      var publicKey = {
        challenge: b64urlToArr(opts.challenge),
        timeout: opts.timeout,
        rpId: opts.rpId,
        userVerification: opts.userVerification
      };
      if (opts.allowCredentials && opts.allowCredentials.length > 0) {
        publicKey.allowCredentials = opts.allowCredentials.map(function(c) {
          var o = { id: b64urlToArr(c.id), type: c.type };
          if (c.transports) o.transports = c.transports;
          return o;
        });
      }

      var cred = await navigator.credentials.get({ publicKey: publicKey });
      var verRes = await fetch('/auth/passkey/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: {
            id: cred.id,
            rawId: arrToB64url(new Uint8Array(cred.rawId)),
            type: cred.type,
            response: {
              clientDataJSON: arrToB64url(new Uint8Array(cred.response.clientDataJSON)),
              authenticatorData: arrToB64url(new Uint8Array(cred.response.authenticatorData)),
              signature: arrToB64url(new Uint8Array(cred.response.signature)),
              userHandle: cred.response.userHandle ? arrToB64url(new Uint8Array(cred.response.userHandle)) : undefined
            }
          }
        })
      });
      var result = await verRes.json();
      if (result.redirect) {
        window.location.href = result.redirect;
      } else if (result.error) {
        errEl.textContent = result.error;
        errEl.classList.remove('hidden');
      }
    } catch(e) {
      if (e.name !== 'NotAllowedError') {
        errEl.textContent = 'Passkey sign-in failed. Try magic link instead.';
        errEl.classList.remove('hidden');
      }
    }
  });
})();
`}} />
  )
}

export default auth
