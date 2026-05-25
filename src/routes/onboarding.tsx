import { Hono } from 'hono'
import type { Env } from '../types'
import { AuthLayout } from '../views/layouts/auth'
import { requireAuth } from '../middleware/auth'
import { getVendorByUserId } from '../db/vendors'
import { createVendor } from '../db/vendors'
import { requireString } from '../lib/validation'
import { VENDOR_CATEGORIES } from '../types'

const onboarding = new Hono<Env>()

onboarding.use('/onboarding', requireAuth)

onboarding.get('/onboarding', async (c) => {
  const user = c.get('user')
  const existing = await getVendorByUserId(c.env.DB, user.id)
  if (existing) return c.redirect('/app')

  const error = c.req.query('error')
  return c.html(
    <AuthLayout title="Set up your business">
      <div class="bg-white rounded-2xl shadow-lg shadow-horizon/5 p-5 sm:p-8">
        <h2 class="text-2xl font-bold mb-1">Welcome!</h2>
        <p class="text-sm text-gray-500 mb-6">Tell us about your business to get started.</p>
        {error && <p class="text-sm text-grapefruit-700 font-medium mb-4">{error}</p>}
        <form method="post" action="/onboarding">
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="name">
                Your name
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                value={user.name !== user.email.split('@')[0] ? user.name : ''}
                class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
            </div>
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

onboarding.post('/onboarding', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()

  try {
    const name = requireString(body.name, 'Name')
    const businessName = requireString(body.business_name, 'Business name')
    const category = requireString(body.category, 'Category')

    if (!VENDOR_CATEGORIES.includes(category as any)) {
      return c.redirect('/onboarding?error=Invalid+category')
    }

    const { updateUser } = await import('../db/users')
    await updateUser(c.env.DB, user.id, { name })
    await createVendor(c.env.DB, user.id, businessName, category)
    return c.redirect('/app')
  } catch (e: any) {
    return c.redirect(`/onboarding?error=${encodeURIComponent(e.message)}`)
  }
})

export default onboarding
