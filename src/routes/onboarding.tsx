import { Hono } from 'hono'
import { getCookie, deleteCookie } from 'hono/cookie'
import type { Env } from '../types'
import { AuthLayout } from '../views/layouts/auth'
import { requireAuth } from '../middleware/auth'
import { getVendorByUserId, createVendor, getVendorByReferralCode, updateVendor } from '../db/vendors'
import { createReferral } from '../db/referrals'
import { getFirstCoupleWedding, createWedding, addWeddingMember, listWeddingsForVendor } from '../db/weddings'
import { formatDate } from '../lib/date'
import { linkPendingInvites } from '../db/couple-vendors'
import { ensureCoupleContact } from '../services/couple-contact'
import { requireString, trimOrNull } from '../lib/validation'
import { FormEnhancements } from '../lib/form-enhance'
import { VENDOR_CATEGORIES } from '../types'
import { t } from '../i18n'
import { categorySetup } from '../lib/onboarding'

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
  // Re-fill the form after a validation error so the user doesn't re-type everything.
  const bizName = c.req.query('business_name') ?? ''
  const emailHandle = c.req.query('email_handle') ?? ''
  const nameVal = c.req.query('name') ?? ''
  const selectedCats = (c.req.query('cats') ?? '').split(',').filter(Boolean)
  const needsName = !user.name || user.name === user.email.split('@')[0]

  return c.html(
    <AuthLayout title="Set up your business">
      <div class="bg-white rounded-2xl shadow-lg shadow-horizon/5 p-5 sm:p-8">
        <p class="text-xs font-bold text-horizon-700 mb-2">Step 1 of 3</p>
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
                  value={nameVal}
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
                value={bizName}
                required
                class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
            </div>
            <div>
              <span class="block text-sm font-bold text-gray-700 mb-1.5">
                What do you do? <span class="text-grapefruit-700">*</span>
                <span class="font-normal text-gray-400">(choose at least one)</span>
              </span>
              <p class="text-xs text-gray-500 mb-2">{t('settings.categories.help')}</p>
              <div class="grid grid-cols-2 gap-2">
                {VENDOR_CATEGORIES.map((cat) => (
                  <label class="flex items-center gap-2 border border-gray-300 rounded-xl px-3 py-2.5 text-sm cursor-pointer hover:border-horizon-600/40 has-[:checked]:border-horizon-600 has-[:checked]:bg-horizon-50">
                    <input
                      type="checkbox"
                      name="category"
                      value={cat}
                      checked={selectedCats.includes(cat)}
                      class="rounded border-gray-300 text-horizon-600 focus:ring-horizon-600"
                    />
                    <span>{cat.charAt(0).toUpperCase() + cat.slice(1)}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="email_handle">
                Your email address
              </label>
              <p class="text-xs text-gray-500 mb-2">
                Choose a handle for sending and receiving emails on Wedding Computer.
              </p>
              <div class="flex items-center gap-0">
                <input
                  type="text"
                  id="email_handle"
                  name="email_handle"
                  value={emailHandle}
                  placeholder="yourname"
                  pattern="[a-z0-9\-]+"
                  required
                  class="flex-1 border border-gray-300 rounded-l-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                  oninput="this.value = this.value.toLowerCase().replace(/[^a-z0-9-]/g, '')"
                />
                <span class="border border-l-0 border-gray-300 rounded-r-xl px-4 py-3 text-sm text-gray-500 bg-gray-50 whitespace-nowrap">
                  @wedding.computer
                </span>
              </div>
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
  const body = await c.req.parseBody({ all: true })

  try {
    const businessName = requireString(body.business_name, 'Business name')

    const rawCats = body.category
    const selected = (Array.isArray(rawCats) ? rawCats : rawCats ? [rawCats] : [])
      .map((v) => String(v).trim().toLowerCase())

    // Round-trip what the user typed so a validation error doesn't blank the form.
    const preserve = (msg: string) => {
      const p = new URLSearchParams({ error: msg })
      const bn = typeof body.business_name === 'string' ? body.business_name : ''
      const eh = typeof body.email_handle === 'string' ? body.email_handle : ''
      const nm = typeof body.name === 'string' ? body.name : ''
      if (bn) p.set('business_name', bn)
      if (eh) p.set('email_handle', eh)
      if (nm) p.set('name', nm)
      if (selected.length) p.set('cats', selected.join(','))
      return `/onboarding/business?${p.toString()}`
    }

    // Whitelist and keep canonical order; the first becomes the primary type.
    const categories = VENDOR_CATEGORIES.filter((cat) => selected.includes(cat))
    if (categories.length === 0) {
      return c.redirect(preserve('Pick at least one category'))
    }
    const category = categories[0]

    // Save name if provided (new user)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name) {
      const { updateUser } = await import('../db/users')
      await updateUser(c.env.DB, user.id, { name })
    }

    // Validate and claim email handle
    const rawHandle = typeof body.email_handle === 'string' ? body.email_handle.trim().toLowerCase() : ''
    const emailHandle = rawHandle.replace(/[^a-z0-9-]/g, '') || null

    if (emailHandle && emailHandle.length < 3) {
      return c.redirect(preserve('Email handle must be at least 3 characters'))
    }

    if (emailHandle) {
      const existing = await c.env.DB
        .prepare('SELECT id FROM vendor_profiles WHERE email_handle = ?')
        .bind(emailHandle)
        .first()
      if (existing) {
        return c.redirect(preserve('That email handle is already taken'))
      }
    }

    // Referral attribution: resolve a ?ref code captured at signup (cookie)
    const refCode = getCookie(c, 'wc_ref')
    let referrerVendorId: string | null = null
    if (refCode) {
      const referrer = await getVendorByReferralCode(c.env.DB, refCode)
      if (referrer && referrer.user_id !== user.id) {
        referrerVendorId = referrer.id
      }
    }

    const vendor = await createVendor(c.env.DB, user.id, businessName, category, emailHandle, referrerVendorId, categories)
    if (referrerVendorId) {
      await createReferral(c.env.DB, referrerVendorId, vendor.id)
    }
    // If this vendor was invited to weddings before they had a profile, link
    // their fresh profile onto those waiting memberships so they auto-join,
    // and add each couple to their CRM contacts.
    try {
      const linked = await linkPendingInvites(c.env.DB, user.id, vendor.id)
      for (const wid of linked) c.executionCtx.waitUntil(ensureCoupleContact(c.env, vendor, wid))
    } catch (e: any) {
      console.error('[ONBOARDING] linkPendingInvites failed', e.message)
    }
    deleteCookie(c, 'wc_ref', { path: '/' })
    await c.env.EMAIL_QUEUE.send({
      type: 'notify_admin_signup',
      payload: JSON.stringify({ kind: 'vendor', name: user.name, email: user.email, businessName, category: categories.join(', ') }),
    }).catch((e: any) => console.error('[ONBOARDING] admin signup enqueue failed', e.message))
    return c.redirect('/onboarding/profile')
  } catch (e: any) {
    return c.redirect(`/onboarding/business?error=${encodeURIComponent(e.message)}`)
  }
})

// ─── Step 2: profile details (optional) ───

onboarding.get('/onboarding/profile', async (c) => {
  const user = c.get('user')
  const vendor = await getVendorByUserId(c.env.DB, user.id)
  if (!vendor) return c.redirect('/onboarding/business')

  return c.html(
    <AuthLayout title="Your details">
      <div class="bg-white rounded-2xl shadow-lg shadow-horizon/5 p-5 sm:p-8">
        <p class="text-xs font-bold text-horizon-700 mb-2">Step 2 of 3</p>
        <h2 class="text-2xl font-bold mb-1">Add your details</h2>
        <p class="text-sm text-gray-500 mb-6">
          These show on your profile and enquiry form. You can skip and add them later.
        </p>
        <form method="post" action="/onboarding/profile">
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="phone">Phone</label>
              <input type="tel" id="phone" name="phone" value={vendor.phone ?? ''}
                class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent" />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="location">Location</label>
              <input type="text" id="location" name="location" value={vendor.location ?? ''} placeholder="City or region you serve" autocomplete="off" data-region="true"
                class="address-autocomplete w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent" />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="website">Website</label>
              <input type="url" id="website" name="website" value={vendor.website ?? ''} placeholder="https://"
                class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent" />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="instagram">Instagram</label>
              <input type="text" id="instagram" name="instagram" value={vendor.instagram ?? ''} placeholder="@yourhandle"
                class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent" />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="bio">Short bio</label>
              <textarea id="bio" name="bio" rows={3} placeholder="A sentence or two about what you do"
                class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent">{vendor.bio ?? ''}</textarea>
            </div>
          </div>
          <button type="submit"
            class="mt-6 w-full bg-horizon-600 text-white py-3 px-4 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
            Continue
          </button>
          <a href="/onboarding/next" class="block text-center text-sm text-gray-400 hover:text-gray-600 mt-3">Skip for now</a>
        </form>
      </div>
      <FormEnhancements mapsKey={c.env.GOOGLE_MAPS_API_KEY} />
    </AuthLayout>
  )
})

onboarding.post('/onboarding/profile', async (c) => {
  const user = c.get('user')
  const vendor = await getVendorByUserId(c.env.DB, user.id)
  if (!vendor) return c.redirect('/onboarding/business')
  const body = await c.req.parseBody()

  await updateVendor(c.env.DB, vendor.id, {
    phone: trimOrNull(body.phone),
    location: trimOrNull(body.location),
    website: trimOrNull(body.website),
    instagram: trimOrNull(body.instagram),
    bio: trimOrNull(body.bio),
  })
  return c.redirect('/onboarding/next')
})

// ─── Step 3: what to set up first (category-tailored, educational) ───

onboarding.get('/onboarding/next', async (c) => {
  const user = c.get('user')
  const vendor = await getVendorByUserId(c.env.DB, user.id)
  if (!vendor) return c.redirect('/onboarding/business')

  const setup = categorySetup(vendor.category)

  // Weddings whose couples/vendors added this email before they signed up —
  // linkPendingInvites stamped them onto the new profile, so they're already
  // here. Surface that as the "wow" moment on the final onboarding step.
  const joined = (await listWeddingsForVendor(c.env.DB, user.id)).filter((w) => w.role === 'vendor')

  return c.html(
    <AuthLayout title="You're all set">
      <div class="bg-white rounded-2xl shadow-lg shadow-horizon/5 p-5 sm:p-8">
        <p class="text-xs font-bold text-horizon-700 mb-2">Step 3 of 3</p>
        <h2 class="text-2xl font-bold mb-1">You're all set, {vendor.business_name}</h2>
        <p class="text-sm text-gray-500 mb-6">{setup.blurb}</p>

        {joined.length > 0 && (
          <div class="mb-6 bg-horizon-50 border border-horizon-200 rounded-2xl p-4 sm:p-5">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-lg" aria-hidden="true">🎉</span>
              <h3 class="text-sm font-bold text-horizon-700">
                You're already on {joined.length} wedding{joined.length !== 1 ? 's' : ''}
              </h3>
            </div>
            <p class="text-xs text-gray-600 mb-3">
              These were set up by couples and vendors who added you before you even signed up — they're waiting in your dashboard.
            </p>
            <div class="space-y-1.5">
              {joined.slice(0, 5).map((w) => (
                <div class="flex items-center justify-between gap-3 bg-white rounded-lg px-3 py-2">
                  <span class="text-sm font-medium text-gray-900 truncate">{w.title}</span>
                  <span class="text-xs text-gray-500 shrink-0">{w.date ? formatDate(w.date) : 'Date TBC'}</span>
                </div>
              ))}
            </div>
            {joined.length > 5 && (
              <p class="text-xs text-gray-400 mt-2">+{joined.length - 5} more in your dashboard</p>
            )}
          </div>
        )}

        <div class="space-y-2">
          {setup.recommended.map((f) => (
            <a href={f.href}
              class="block border border-papaya-300/30 rounded-xl p-3 hover:border-horizon-600/40 hover:bg-papaya-50 transition-colors">
              <p class="text-sm font-bold text-gray-900">{f.label}</p>
              <p class="text-xs text-gray-500 mt-0.5">{f.desc}</p>
            </a>
          ))}
        </div>
        <a href="/app"
          class="mt-6 block text-center bg-horizon-600 text-white py-3 px-4 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
          Go to your dashboard
        </a>
        <p class="text-xs text-gray-400 text-center mt-3">You'll find a setup checklist there to finish the basics.</p>
      </div>
    </AuthLayout>
  )
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
                data-future-date="true"
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
                autocomplete="off"
                class="address-autocomplete w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
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
      <FormEnhancements mapsKey={c.env.GOOGLE_MAPS_API_KEY} />
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

    // Add user as couple member (couples are not can_manage — the shared doc /
    // others' web links are intentionally read-only to them; they edit their
    // wedding + manage vendors via role-based checks).
    await addWeddingMember(c.env.DB, {
      wedding_id: wedding.id,
      user_id: user.id,
      role: 'couple',
    })

    await c.env.EMAIL_QUEUE.send({
      type: 'notify_admin_signup',
      payload: JSON.stringify({ kind: 'couple', name: userName, email: user.email }),
    }).catch((e: any) => console.error('[ONBOARDING] admin signup enqueue failed', e.message))

    return c.redirect(`/wedding/${wedding.id}`)
  } catch (e: any) {
    return c.redirect(`/onboarding/wedding?error=${encodeURIComponent(e.message)}`)
  }
})

export default onboarding
