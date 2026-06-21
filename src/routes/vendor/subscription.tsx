import { Hono } from 'hono'
import type { Env } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { getSubscription, createSubscription, updateSubscription, isProVendor } from '../../db/subscriptions'

const subscription = new Hono<Env>()

subscription.use('/app/subscription*', requireAuth, csrf, requireVendor)

// ─── Subscription management page ───

subscription.get('/app/subscription', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const csrfToken = c.get('csrfToken')

  const sub = await getSubscription(c.env.DB, vendor.id)
  const isPro = sub?.plan === 'pro' && (sub.status === 'active' || sub.status === 'trialing')
  const isCancelled = isPro && sub.cancel_at_period_end === 1
  const success = c.req.query('success')
  const checkoutError = c.req.query('error') === 'checkout'

  const periodEnd = sub?.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null

  return c.html(
    <AppLayout title="Subscription" user={user} vendor={vendor} csrfToken={csrfToken}>
      <div class="max-w-xl">
        {success && (
          <div class="bg-horizon-50 border border-horizon-600/20 text-horizon-700 text-sm font-bold rounded-xl p-3 mb-6">
            Welcome to Pro! Your subscription is now active.
          </div>
        )}

        {checkoutError && (
          <div class="bg-papaya-100 border border-papaya-300/50 text-gray-700 text-sm rounded-xl p-3 mb-6">
            We couldn’t start checkout just now. Please try again in a moment.
          </div>
        )}

        {vendor.free_months > 0 && (
          <div class="bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl p-3 mb-6 flex items-center justify-between gap-3">
            <span>
              <strong>{vendor.free_months} free month{vendor.free_months === 1 ? '' : 's'}</strong> banked
              — applied automatically to your {isPro ? 'next' : 'first'} Pro invoice{vendor.free_months === 1 ? '' : 's'}.
            </span>
            <a href="/app/refer" class="font-bold underline whitespace-nowrap">Earn more</a>
          </div>
        )}

        {isPro ? (
          <div class="bg-white rounded-2xl p-5 sm:p-8">
            <div class="flex items-center gap-2 mb-4">
              <span class="bg-horizon-50 text-horizon-700 text-xs font-bold px-3 py-1 rounded-full">Pro</span>
              <h2 class="text-lg font-bold text-gray-900">You're on the Pro plan</h2>
            </div>

            {isCancelled ? (
              <div>
                <p class="text-sm text-gray-600 mb-1">
                  Your subscription has been cancelled. You'll keep Pro access until:
                </p>
                <p class="text-sm font-bold text-gray-900 mb-6">{periodEnd}</p>

                <form method="post" action="/app/subscription/reactivate">
                  <input type="hidden" name="_csrf" value={csrfToken} />
                  <button
                    type="submit"
                    class="bg-horizon-600 text-white rounded-xl px-6 py-3 text-sm font-bold hover:bg-horizon-700 transition-colors"
                  >
                    Reactivate subscription
                  </button>
                </form>
              </div>
            ) : (
              <div>
                <div class="space-y-2 mb-6">
                  <div class="flex items-center justify-between text-sm">
                    <span class="text-gray-500">Plan</span>
                    <span class="font-bold text-gray-900">Pro &mdash; $28 AUD / month</span>
                  </div>
                  {periodEnd && (
                    <div class="flex items-center justify-between text-sm">
                      <span class="text-gray-500">Next billing date</span>
                      <span class="font-bold text-gray-900">{periodEnd}</span>
                    </div>
                  )}
                </div>

                <form
                  method="post"
                  action="/app/subscription/cancel"
                  onsubmit="return confirm('Are you sure you want to cancel? You\\'ll keep Pro access until the end of your current billing period.')"
                >
                  <input type="hidden" name="_csrf" value={csrfToken} />
                  <button
                    type="submit"
                    class="text-sm text-gray-400 hover:text-grapefruit-600 transition-colors"
                  >
                    Cancel subscription
                  </button>
                </form>
              </div>
            )}
          </div>
        ) : (
          <div class="bg-white rounded-2xl p-5 sm:p-8">
            <h2 class="text-lg font-bold text-gray-900 mb-1">You're on the Free plan</h2>
            <p class="text-sm text-gray-500 mb-6">Upgrade to Pro to unlock powerful tools for your business.</p>

            <ul class="space-y-3 mb-8">
              <ProFeature text="Business analytics and reporting" />
              <ProFeature text="Industry benchmarks" />
              <ProFeature text="Goal tracking" />
              <ProFeature text="AI-powered insights" />
              <ProFeature text="Email drafting AI" />
            </ul>

            <div class="mb-6">
              <span class="text-2xl font-bold text-gray-900">$28</span>
              <span class="text-sm text-gray-500 ml-1">AUD / month</span>
            </div>

            <form method="post" action="/app/subscription/checkout">
              <input type="hidden" name="_csrf" value={csrfToken} />
              <button
                type="submit"
                class="bg-horizon-600 text-white rounded-xl px-6 py-3 text-sm font-bold hover:bg-horizon-700 transition-colors"
              >
                Upgrade to Pro
              </button>
            </form>
          </div>
        )}
      </div>
    </AppLayout>
  )
})

// ─── Create Stripe Checkout Session ───

subscription.post('/app/subscription/checkout', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!

  // Redeem banked free months (gifted or earned) as a free trial so the first
  // N months aren't charged. They're consumed in the checkout.session.completed
  // webhook once the subscription is created.
  const freeMonths = Math.max(0, Math.min(9, vendor.free_months ?? 0))

  const params: Record<string, string> = {
    'mode': 'subscription',
    // Let customers enter a marketing promotion code at checkout. Stripe
    // validates the code + enforces its expiry/usage limits atomically.
    'allow_promotion_codes': 'true',
    'line_items[0][price_data][currency]': 'aud',
    'line_items[0][price_data][product_data][name]': 'Wedding Computer Pro',
    'line_items[0][price_data][product_data][description]': 'Analytics, insights, AI features, and business goals',
    'line_items[0][price_data][unit_amount]': '2800',
    'line_items[0][price_data][recurring][interval]': 'month',
    'line_items[0][quantity]': '1',
    'success_url': `${c.env.APP_URL}/app/subscription?success=1`,
    'cancel_url': `${c.env.APP_URL}/app/subscription`,
    'customer_email': user.email,
    'client_reference_id': vendor.id,
    'metadata[vendor_id]': vendor.id,
    'metadata[user_id]': user.id,
    // Also stamp the SUBSCRIPTION (not just the checkout session) so subscription.*
    // webhooks can self-heal a missing local row from the event alone.
    'subscription_data[metadata][vendor_id]': vendor.id,
  }
  if (freeMonths > 0) {
    params['subscription_data[trial_period_days]'] = String(freeMonths * 30)
    params['metadata[free_months_applied]'] = String(freeMonths)
  }

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  })

  const session = (await response.json().catch(() => ({}))) as { id?: string; url?: string }
  if (!response.ok || !session.url) {
    console.error('[stripe] checkout session creation failed', response.status, JSON.stringify(session))
    return c.redirect('/app/subscription?error=checkout')
  }
  return c.redirect(session.url)
})

// ─── Cancel subscription at period end ───

subscription.post('/app/subscription/cancel', async (c) => {
  const vendor = c.get('vendor')!

  const sub = await getSubscription(c.env.DB, vendor.id)
  if (!sub?.stripe_subscription_id) {
    return c.redirect('/app/subscription')
  }

  await fetch(`https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'cancel_at_period_end=true',
  })

  await updateSubscription(c.env.DB, vendor.id, { cancel_at_period_end: 1 })

  return c.redirect('/app/subscription')
})

// ─── Reactivate a cancelled subscription ───

subscription.post('/app/subscription/reactivate', async (c) => {
  const vendor = c.get('vendor')!

  const sub = await getSubscription(c.env.DB, vendor.id)
  if (!sub?.stripe_subscription_id) {
    return c.redirect('/app/subscription')
  }

  await fetch(`https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'cancel_at_period_end=false',
  })

  await updateSubscription(c.env.DB, vendor.id, { cancel_at_period_end: 0 })

  return c.redirect('/app/subscription')
})

export default subscription

// ─── Components ───

function ProFeature({ text }: { text: string }) {
  return (
    <li class="flex items-start gap-3">
      <span class="text-horizon-600 font-bold mt-0.5" aria-hidden="true">&#10003;</span>
      <span class="text-sm text-gray-700">{text}</span>
    </li>
  )
}
