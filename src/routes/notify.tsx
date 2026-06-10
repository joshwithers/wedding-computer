import { Hono } from 'hono'
import type { Env } from '../types'
import { MarketingLayout } from '../views/layouts/marketing'
import { isValidEmail } from '../lib/validation'
import { rateLimit } from '../middleware/rate-limit'
import { addToWaitlist, getWaitlistByToken, unsubscribeWaitlist } from '../db/waitlist'
import { sendEmailMessage, waitlistWelcomeEmail } from '../services/email'

const notify = new Hono<Env>()

function NotifyForm({ error }: { error?: string }) {
  return (
    <div class="max-w-md mx-auto px-4 sm:px-6 py-12 sm:py-20">
      <div class="text-center mb-8">
        <div class="inline-block bg-horizon-50 text-horizon-700 font-semibold text-sm px-4 py-1.5 rounded-full mb-4">
          Coming soon
        </div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight mb-3">Be notified when it's live</h1>
        <p class="text-gray-600 leading-relaxed">
          Wedding Computer is opening up gradually. Pop your email in and we'll let you know
          the moment you can sign up.
        </p>
      </div>
      <div class="bg-white rounded-2xl shadow-lg shadow-horizon/5 p-5 sm:p-8">
        {error && <p class="text-sm text-grapefruit-700 font-medium mb-4">{error}</p>}
        <form method="post" action="/notify">
          {/* Honeypot — bots fill this; humans never see it */}
          <input
            type="text"
            name="company"
            tabindex={-1}
            autocomplete="off"
            class="hidden"
            aria-hidden="true"
          />
          <label class="block text-sm font-bold text-gray-700 mb-1.5" for="email">Email address</label>
          <input
            type="email"
            id="email"
            name="email"
            required
            autofocus
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            placeholder="you@example.com"
          />
          <label class="block text-sm font-bold text-gray-700 mb-1.5 mt-4" for="name">Name <span class="font-normal text-gray-400">(optional)</span></label>
          <input
            type="text"
            id="name"
            name="name"
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            placeholder="Your name"
          />
          <label class="block text-sm font-bold text-gray-700 mb-1.5 mt-4" for="country">Country <span class="font-normal text-gray-400">(optional)</span></label>
          <input
            type="text"
            id="country"
            name="country"
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            placeholder="e.g. Australia"
          />
          <button
            type="submit"
            class="mt-5 w-full bg-horizon-600 text-white py-3 px-4 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            Notify me
          </button>
        </form>
        <p class="text-xs text-gray-400 mt-4 text-center">
          No spam — just one email when we launch. Already have an invite? <a href="/login" class="text-horizon-700 font-medium hover:underline">Sign in</a>.
        </p>
      </div>
    </div>
  )
}

notify.get('/notify', (c) => {
  if (c.req.query('joined')) {
    return c.html(
      <MarketingLayout title="You're on the list">
        <div class="max-w-md mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
          <div class="text-5xl mb-4">🎉</div>
          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight mb-3">You're on the list</h1>
          <p class="text-gray-600 leading-relaxed mb-8">
            Thanks for your interest in Wedding Computer. We'll email you the moment it's live.
          </p>
          <a href="/about" class="inline-block bg-horizon-600 text-white px-6 py-3 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
            Learn what we're building
          </a>
        </div>
      </MarketingLayout>
    )
  }
  const error = c.req.query('error') ? "Please enter a valid email address." : undefined
  return c.html(
    <MarketingLayout title="Be notified when it's live">
      <NotifyForm error={error} />
    </MarketingLayout>
  )
})

notify.post('/notify', rateLimit(10, 60), async (c) => {
  const body = await c.req.parseBody()
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const country = typeof body.country === 'string' ? body.country.trim() : ''
  const honeypot = typeof body.company === 'string' ? body.company.trim() : ''

  // Honeypot tripped — silently pretend success so bots don't learn anything.
  if (honeypot) return c.redirect('/notify?joined=1')

  if (!isValidEmail(email)) {
    return c.redirect('/notify?error=1')
  }

  try {
    const entry = await addToWaitlist(c.env.DB, {
      email,
      name: name || null,
      country: country || null,
      source: 'notify_page',
    })

    // Best-effort welcome email — never block signup on a send failure.
    try {
      await sendEmailMessage({
        db: c.env.DB,
        resendApiKey: c.env.RESEND_API_KEY,
        vendorId: null,
        to: entry.email,
        toName: entry.name ?? undefined,
        subject: "You're on the Wedding Computer waitlist",
        html: waitlistWelcomeEmail({
          name: entry.name,
          unsubscribeUrl: `${c.env.APP_URL}/notify/unsubscribe?token=${entry.unsubscribe_token}`,
        }),
        isSystem: true,
        listUnsubscribeUrl: `${c.env.APP_URL}/notify/unsubscribe?token=${entry.unsubscribe_token}`,
      })
    } catch (e) {
      console.error('[NOTIFY] welcome email failed', e)
    }
  } catch (e) {
    console.error('[NOTIFY] waitlist signup failed', e)
    return c.redirect('/notify?error=1')
  }

  return c.redirect('/notify?joined=1')
})

notify.get('/notify/unsubscribe', async (c) => {
  const token = c.req.query('token') ?? ''
  let message = 'This unsubscribe link is invalid or has already been used.'
  if (token) {
    const entry = await getWaitlistByToken(c.env.DB, token)
    if (entry) {
      await unsubscribeWaitlist(c.env.DB, token)
      message = "You've been unsubscribed. You won't receive any more emails from the waitlist."
    }
  }
  return c.html(
    <MarketingLayout title="Unsubscribed">
      <div class="max-w-md mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight mb-3">Unsubscribe</h1>
        <p class="text-gray-600 leading-relaxed mb-8">{message}</p>
        <a href="/" class="inline-block bg-horizon-600 text-white px-6 py-3 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
          Back to home
        </a>
      </div>
    </MarketingLayout>
  )
})

export default notify
