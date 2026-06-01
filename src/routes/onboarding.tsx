import { Hono } from 'hono'
import type { Env } from '../types'
import { AuthLayout } from '../views/layouts/auth'
import { requireAuth } from '../middleware/auth'
import { getVendorByUserId, createVendor } from '../db/vendors'
import { getFirstCoupleWedding, createWedding, addWeddingMember } from '../db/weddings'
import { requireString } from '../lib/validation'
import { VENDOR_CATEGORIES } from '../types'

const onboarding = new Hono<Env>()

onboarding.use('/onboarding', requireAuth)
onboarding.use('/onboarding/*', requireAuth)

// ─── Step 1: Choose your path ───

onboarding.get('/onboarding', async (c) => {
  const user = c.get('user')
  const hasVendor = await getVendorByUserId(c.env.DB, user.id)
  const hasWedding = await getFirstCoupleWedding(c.env.DB, user.id)

  // If they already have both, send them to the right place
  if (hasVendor && hasWedding) return c.redirect('/app')
  // If they only have a vendor, they're set
  if (hasVendor) return c.redirect('/app')
  // If they only have a wedding, they're set
  if (hasWedding) return c.redirect(`/wedding/${hasWedding.wedding_id}`)

  // Fresh user — ask what they want to do
  const needsName = !user.name || user.name === user.email.split('@')[0]

  return c.html(
    <AuthLayout title="Get started">
      <div class="bg-white rounded-2xl shadow-lg shadow-horizon/5 p-5 sm:p-8">
        <h2 class="text-2xl font-bold mb-1">Welcome!</h2>
        <p class="text-sm text-gray-500 mb-6">What brings you to Wedding Computer?</p>

        {needsName && (
          <div class="mb-6 pb-6 border-b border-gray-100">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">First, what's your name?</p>
            <form method="post" action="/onboarding/name" class="flex gap-2">
              <input
                type="text"
                name="name"
                required
                placeholder="Your name"
                class="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
              <button
                type="submit"
                class="bg-horizon-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors shrink-0"
              >
                Save
              </button>
            </form>
          </div>
        )}

        <div class="space-y-3">
          <a
            href="/onboarding/business"
            class="block p-4 rounded-xl border-2 border-gray-200 hover:border-horizon-600 hover:bg-horizon-50 transition-all group"
          >
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-full bg-horizon-100 text-horizon-600 flex items-center justify-center shrink-0 mt-0.5">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <div class="font-bold text-gray-900 group-hover:text-horizon-700">I'm a wedding professional</div>
                <p class="text-sm text-gray-500 mt-0.5">Set up your business — manage contacts, calendar, invoices and more.</p>
              </div>
            </div>
          </a>

          <a
            href="/onboarding/wedding"
            class="block p-4 rounded-xl border-2 border-gray-200 hover:border-grapefruit-600 hover:bg-grapefruit-50 transition-all group"
          >
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-full bg-grapefruit-100 text-grapefruit-600 flex items-center justify-center shrink-0 mt-0.5">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </div>
              <div>
                <div class="font-bold text-gray-900 group-hover:text-grapefruit-700">I'm planning a wedding</div>
                <p class="text-sm text-gray-500 mt-0.5">Create your wedding — track vendors, budget, and details all in one place.</p>
              </div>
            </div>
          </a>
        </div>
      </div>
    </AuthLayout>
  )
})

// ─── Save name (inline from chooser page) ───

onboarding.post('/onboarding/name', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name) {
    const { updateUser } = await import('../db/users')
    await updateUser(c.env.DB, user.id, { name })
  }
  return c.redirect('/onboarding')
})

// ─── Business setup ───

onboarding.get('/onboarding/business', async (c) => {
  const user = c.get('user')
  const existing = await getVendorByUserId(c.env.DB, user.id)
  if (existing) return c.redirect('/app')

  const error = c.req.query('error')
  const needsName = !user.name || user.name === user.email.split('@')[0]

  return c.html(
    <AuthLayout title="Set up your business">
      <div class="bg-white rounded-2xl shadow-lg shadow-horizon/5 p-5 sm:p-8">
        <div class="flex items-center gap-2 mb-6">
          <a href="/onboarding" class="text-gray-400 hover:text-gray-600 transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </a>
          <h2 class="text-2xl font-bold">Set up your business</h2>
        </div>
        <p class="text-sm text-gray-500 mb-6">Tell us about your business to get started.</p>
        {error && <p class="text-sm text-grapefruit-700 font-medium mb-4">{error}</p>}
        <form method="post" action="/onboarding/business">
          <div class="space-y-4">
            {needsName && (
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="name">
                  Your name
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                />
              </div>
            )}
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="business_name">
                Business name
              </label>
              <input
                type="text"
                id="business_name"
                name="business_name"
                required
                class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="category">
                What do you do?
              </label>
              <select
                id="category"
                name="category"
                required
                class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent bg-white"
              >
                <option value="">Select a category</option>
                {VENDOR_CATEGORIES.map((cat) => (
                  <option value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="submit"
            class="mt-6 w-full bg-horizon-600 text-white py-3 px-4 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            Continue
          </button>
        </form>
      </div>
    </AuthLayout>
  )
})

onboarding.post('/onboarding/business', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()

  try {
    const businessName = requireString(body.business_name, 'Business name')
    const category = requireString(body.category, 'Category')

    if (!VENDOR_CATEGORIES.includes(category as any)) {
      return c.redirect('/onboarding/business?error=Invalid+category')
    }

    // Save name if provided (new user)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name) {
      const { updateUser } = await import('../db/users')
      await updateUser(c.env.DB, user.id, { name })
    }

    await createVendor(c.env.DB, user.id, businessName, category)
    return c.redirect('/app')
  } catch (e: any) {
    return c.redirect(`/onboarding/business?error=${encodeURIComponent(e.message)}`)
  }
})

// ─── Wedding setup ───

onboarding.get('/onboarding/wedding', async (c) => {
  const user = c.get('user')
  const existing = await getFirstCoupleWedding(c.env.DB, user.id)
  if (existing) return c.redirect(`/wedding/${existing.wedding_id}`)

  const error = c.req.query('error')
  const needsName = !user.name || user.name === user.email.split('@')[0]

  return c.html(
    <AuthLayout title="Plan your wedding">
      <div class="bg-white rounded-2xl shadow-lg shadow-horizon/5 p-5 sm:p-8">
        <div class="flex items-center gap-2 mb-6">
          <a href="/onboarding" class="text-gray-400 hover:text-gray-600 transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </a>
          <h2 class="text-2xl font-bold">Plan your wedding</h2>
        </div>
        <p class="text-sm text-gray-500 mb-6">Tell us about your day. You can always update these details later.</p>
        {error && <p class="text-sm text-grapefruit-700 font-medium mb-4">{error}</p>}
        <form method="post" action="/onboarding/wedding">
          <div class="space-y-4">
            {needsName && (
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="name">
                  Your name
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                />
              </div>
            )}
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="partner_name">
                Your partner's name
              </label>
              <input
                type="text"
                id="partner_name"
                name="partner_name"
                placeholder="Optional — you can add this later"
                class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="date">
                Wedding date
              </label>
              <input
                type="date"
                id="date"
                name="date"
                class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
              <p class="text-xs text-gray-400 mt-1">Don't have a date yet? No worries — leave it blank.</p>
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="location">
                Location
              </label>
              <input
                type="text"
                id="location"
                name="location"
                placeholder="City or venue name"
                class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
            </div>
          </div>
          <button
            type="submit"
            class="mt-6 w-full bg-grapefruit-600 text-white py-3 px-4 rounded-xl text-sm font-bold hover:bg-grapefruit-700 transition-colors"
          >
            Create my wedding
          </button>
        </form>
      </div>
    </AuthLayout>
  )
})

onboarding.post('/onboarding/wedding', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()

  try {
    // Save name if provided (new user)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name) {
      const { updateUser } = await import('../db/users')
      await updateUser(c.env.DB, user.id, { name })
    }

    const partnerName = typeof body.partner_name === 'string' ? body.partner_name.trim() : ''
    const date = typeof body.date === 'string' && body.date ? body.date : null
    const location = typeof body.location === 'string' ? body.location.trim() : ''

    // Build wedding title from names
    const userName = name || user.name
    const firstName = userName.split(' ')[0]
    let title = firstName + "'s Wedding"
    if (partnerName) {
      const partnerFirst = partnerName.split(' ')[0]
      title = `${firstName} & ${partnerFirst}'s Wedding`
    }

    // Create the wedding
    const wedding = await createWedding(c.env.DB, {
      title,
      date,
      location: location || null,
      created_by_user_id: user.id,
    })

    // Add user as couple member
    await addWeddingMember(c.env.DB, {
      wedding_id: wedding.id,
      user_id: user.id,
      role: 'couple',
    })

    return c.redirect(`/wedding/${wedding.id}`)
  } catch (e: any) {
    return c.redirect(`/onboarding/wedding?error=${encodeURIComponent(e.message)}`)
  }
})

export default onboarding
