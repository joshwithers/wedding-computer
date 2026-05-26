import { Hono } from 'hono'
import type { Env } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { updateVendor } from '../../db/vendors'
import { deleteUser } from '../../db/users'
import { VENDOR_CATEGORIES } from '../../types'
import { trimOrNull, requireString } from '../../lib/validation'
import { auditLog } from '../../middleware/audit'
import { listContacts } from '../../db/contacts'
import { listInvoices } from '../../db/invoices'
import { deleteCookie } from 'hono/cookie'
import { destroySession } from '../../services/auth'

const settings = new Hono<Env>()

settings.use('/app/*', requireAuth, csrf, requireVendor)

settings.get('/app/settings', (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const saved = c.req.query('saved')

  return c.html(
    <AppLayout title="Settings" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        {saved && (
          <div class="bg-horizon-50 border border-horizon-600/20 text-horizon-700 text-sm font-bold rounded-xl p-3 mb-6">
            Settings saved.
          </div>
        )}
        <form method="post" action="/app/settings" class="space-y-6">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />

          <section class="bg-papaya-100 rounded-xl p-4 mb-2">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-bold text-gray-900">{user.name}</p>
                <p class="text-xs text-gray-500">{user.email}</p>
              </div>
              <a
                href="/account"
                class="text-sm font-bold text-horizon-600 hover:text-horizon-700 transition-colors"
              >
                Edit profile
              </a>
            </div>
          </section>

          <section>
            <h2 class="text-base font-bold mb-4">Business details</h2>
            <div class="space-y-4">
              <Field label="Business name" name="business_name" value={vendor.business_name} required />
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="category">Category</label>
                <select
                  id="category"
                  name="category"
                  required
                  class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                >
                  {VENDOR_CATEGORIES.map((cat) => (
                    <option value={cat} selected={cat === vendor.category}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <Field label="Phone" name="phone" value={vendor.phone ?? ''} type="tel" />
              <Field label="Website" name="website" value={vendor.website ?? ''} type="url" />
              <Field label="Instagram" name="instagram" value={vendor.instagram ?? ''} placeholder="@handle" />
              <Field label="Location" name="location" value={vendor.location ?? ''} />
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="bio">Bio</label>
                <textarea
                  id="bio"
                  name="bio"
                  rows={4}
                  class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                >{vendor.bio ?? ''}</textarea>
              </div>
            </div>
          </section>

          <button
            type="submit"
            class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            Save changes
          </button>
        </form>

        <section class="mt-10 pt-8 border-t border-gray-200">
          <h2 class="text-base font-bold mb-2">Ceremony types</h2>
          <p class="text-sm text-gray-500 mb-4">
            Define the types of ceremonies you offer. These appear as options when creating a new booking.
          </p>
          <form method="post" action="/app/settings/ceremony-types">
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <div class="space-y-2 mb-4" id="ceremony-types">
              {(() => {
                const types: string[] = vendor.ceremony_types
                  ? JSON.parse(vendor.ceremony_types)
                  : ['wedding', 'elopement']
                return types.map((t, i) => (
                  <div class="flex gap-2 items-center">
                    <input
                      type="text"
                      name="ceremony_type"
                      value={t}
                      class="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                      placeholder="e.g. wedding, elopement, micro wedding"
                    />
                  </div>
                ))
              })()}
              <div class="flex gap-2 items-center">
                <input
                  type="text"
                  name="ceremony_type"
                  value=""
                  class="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                  placeholder="Add another type..."
                />
              </div>
            </div>
            <button
              type="submit"
              class="bg-horizon-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Save ceremony types
            </button>
          </form>
          <p class="text-xs text-gray-400 mt-2">
            Leave a field blank to remove it. The first type is the default for new bookings.
          </p>
        </section>

        <section class="mt-10 pt-8 border-t border-gray-200">
          <h2 class="text-base font-bold mb-2">Payments</h2>
          <p class="text-sm text-gray-500 mb-4">
            Connect your Stripe account to accept online payments from clients.
          </p>
          <div class="bg-white border border-papaya-300/30 rounded-2xl p-5">
            {vendor.stripe_onboarding_complete ? (
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-bold text-gray-900">Stripe connected</p>
                  <p class="text-xs text-gray-500 mt-0.5">
                    Account {vendor.stripe_account_id?.slice(-8) ?? ''}
                  </p>
                </div>
                <span class="bg-horizon-50 text-horizon-700 text-xs font-bold px-3 py-1 rounded-full">Active</span>
              </div>
            ) : vendor.stripe_account_id ? (
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-bold text-gray-900">Stripe setup incomplete</p>
                  <p class="text-xs text-gray-500 mt-0.5">Complete your onboarding to accept payments.</p>
                </div>
                <form method="post" action="/app/settings/stripe/connect">
                  <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                  <button type="submit" class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
                    Continue setup
                  </button>
                </form>
              </div>
            ) : (
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-bold text-gray-900">Accept online payments</p>
                  <p class="text-xs text-gray-500 mt-0.5">Let clients pay invoices via card or bank transfer.</p>
                </div>
                <form method="post" action="/app/settings/stripe/connect">
                  <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                  <button type="submit" class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
                    Connect Stripe
                  </button>
                </form>
              </div>
            )}
          </div>
          <p class="text-xs text-gray-400 mt-2">
            You can always record cash, direct debit, and PayID payments manually without Stripe.
          </p>
        </section>

        <section class="mt-10 pt-8 border-t border-gray-200">
          <h2 class="text-base font-bold mb-2">Email</h2>
          <p class="text-sm text-gray-500 mb-4">
            Set your email handle to send and receive emails as <strong>handle@wedding.computer</strong>.
          </p>
          <form method="post" action="/app/settings/email-handle">
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <div class="max-w-md">
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="email_handle">
                Email handle
              </label>
              <div class="flex items-center gap-0">
                <input
                  type="text"
                  id="email_handle"
                  name="email_handle"
                  value={vendor.email_handle ?? ''}
                  placeholder="yourname"
                  pattern="[a-z0-9\-]+"
                  class="flex-1 border border-gray-200 rounded-l-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                />
                <span class="border border-l-0 border-gray-200 rounded-r-xl px-4 py-3 text-sm text-gray-500 bg-gray-50">
                  @wedding.computer
                </span>
              </div>
            </div>
            <button
              type="submit"
              class="mt-3 bg-horizon-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Save
            </button>
          </form>
          {vendor.email_handle && (
            <p class="text-xs text-horizon-600 mt-2 font-medium">
              Your email: {vendor.email_handle}@wedding.computer
            </p>
          )}
        </section>

        <section class="mt-10 pt-8 border-t border-gray-200">
          <h2 class="text-base font-bold mb-2">AI</h2>
          <p class="text-sm text-gray-500 mb-4">
            Email drafting uses Cloudflare AI by default. Add your own Anthropic API key for higher quality drafts powered by Claude.
          </p>
          <form method="post" action="/app/settings/ai">
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <div class="max-w-md">
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="anthropic_api_key">
                Anthropic API key <span class="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                type="password"
                id="anthropic_api_key"
                name="anthropic_api_key"
                value={vendor.anthropic_api_key ?? ''}
                placeholder="sk-ant-..."
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
            </div>
            <button
              type="submit"
              class="mt-3 bg-horizon-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Save
            </button>
          </form>
          {vendor.anthropic_api_key ? (
            <p class="text-xs text-horizon-600 mt-2 font-medium">Using your Anthropic API key (Claude)</p>
          ) : (
            <p class="text-xs text-gray-400 mt-2">Using Cloudflare AI (Llama)</p>
          )}
        </section>

        <section class="mt-10 pt-8 border-t border-gray-200">
          <h2 class="text-base font-bold mb-2">Device sync</h2>
          <p class="text-sm text-gray-500 mb-4">
            Sync your contacts and calendar to your phone and computer. Works with Apple Contacts, Apple Calendar, and any CardDAV/CalDAV client.
          </p>
          {vendor.ical_token ? (
            <div class="space-y-4">
              <FeedUrl
                label="CardDAV (contacts)"
                url={`${c.env.APP_URL}/carddav`}
                description="Add as a CardDAV account. Username and password are both your sync token."
              />
              <FeedUrl
                label="CalDAV (calendar)"
                url={`${c.env.APP_URL}/caldav`}
                description="Add as a CalDAV account. Username and password are both your sync token."
              />
              <FeedUrl
                label="iCal feed (read-only)"
                url={`${c.env.APP_URL}/cal/${vendor.ical_token}`}
                description="Subscribe to this URL in any calendar app for a read-only feed."
              />
              <div class="bg-gray-50 rounded-xl p-4">
                <p class="text-xs font-bold text-gray-700 mb-1">Your sync token</p>
                <code class="text-xs text-gray-600 break-all select-all">{vendor.ical_token}</code>
                <p class="text-xs text-gray-400 mt-2">
                  Use this as both the username and password when adding a CardDAV or CalDAV account.
                </p>
              </div>
            </div>
          ) : (
            <form method="post" action="/app/settings/generate-sync-token">
              <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
              <button
                type="submit"
                class="bg-horizon-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
              >
                Generate sync token
              </button>
              <p class="text-xs text-gray-400 mt-2">
                This creates a unique token for syncing your contacts and calendar to personal devices.
              </p>
            </form>
          )}
        </section>

        <section class="mt-10 pt-8 border-t border-gray-200">
          <h2 class="text-base font-bold mb-2">Your data</h2>
          <p class="text-sm text-gray-500 mb-4">
            Download or delete all your data.
          </p>
          <div class="flex flex-col sm:flex-row gap-3">
            <a
              href="/app/settings/export"
              class="inline-block bg-white border border-gray-200 text-gray-700 py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors text-center"
            >
              Export data (JSON)
            </a>
            <form method="post" action="/app/settings/delete-account" onsubmit="return confirm('Are you sure? This will permanently delete your account and all data. This cannot be undone.')">
              <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
              <button
                type="submit"
                class="bg-grapefruit-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-grapefruit-700 transition-colors"
              >
                Delete account
              </button>
            </form>
          </div>
        </section>
      </div>
    </AppLayout>
  )
})

settings.post('/app/settings', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()

  try {
    const businessName = requireString(body.business_name, 'Business name')
    const category = requireString(body.category, 'Category')

    await updateVendor(c.env.DB, vendor.id, {
      business_name: businessName,
      category,
      phone: trimOrNull(body.phone),
      website: trimOrNull(body.website),
      instagram: trimOrNull(body.instagram),
      bio: trimOrNull(body.bio),
      location: trimOrNull(body.location),
    })

    await auditLog(c, 'settings_updated', 'vendor', vendor.id).catch(() => {})
    return c.redirect('/app/settings?saved=1')
  } catch (e: any) {
    return c.redirect(`/app/settings?error=${encodeURIComponent(e.message)}`)
  }
})

// ─── Ceremony types ───

settings.post('/app/settings/ceremony-types', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody({ all: true })
  const raw = body.ceremony_type
  const types = (Array.isArray(raw) ? raw : [raw])
    .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)

  await updateVendor(c.env.DB, vendor.id, {
    ceremony_types: types.length > 0 ? JSON.stringify(types) : null,
  })

  return c.redirect('/app/settings?saved=1')
})

// ─── Email handle ───

settings.post('/app/settings/email-handle', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()
  const raw = typeof body.email_handle === 'string' ? body.email_handle.trim().toLowerCase() : ''
  const handle = raw.replace(/[^a-z0-9\-]/g, '') || null

  if (handle && handle.length < 3) {
    return c.redirect('/app/settings?error=Handle+must+be+at+least+3+characters')
  }

  if (handle) {
    const existing = await c.env.DB
      .prepare('SELECT id FROM vendor_profiles WHERE email_handle = ? AND id != ?')
      .bind(handle, vendor.id)
      .first()
    if (existing) {
      return c.redirect('/app/settings?error=That+email+handle+is+already+taken')
    }
  }

  await updateVendor(c.env.DB, vendor.id, { email_handle: handle })

  return c.redirect('/app/settings?saved=1')
})

// ─── AI settings ───

settings.post('/app/settings/ai', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()
  const key = typeof body.anthropic_api_key === 'string' ? body.anthropic_api_key.trim() || null : null

  await updateVendor(c.env.DB, vendor.id, { anthropic_api_key: key })
  return c.redirect('/app/settings?saved=1')
})

// ─── Sync token ───

settings.post('/app/settings/generate-sync-token', async (c) => {
  const vendor = c.get('vendor')!
  if (vendor.ical_token) return c.redirect('/app/settings')

  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')

  await updateVendor(c.env.DB, vendor.id, { ical_token: token })
  return c.redirect('/app/settings?saved=1')
})

// ─── Stripe Connect ───

settings.post('/app/settings/stripe/connect', async (c) => {
  const vendor = c.get('vendor')!
  const user = c.get('user')

  let accountId = vendor.stripe_account_id
  if (!accountId) {
    const res = await fetch('https://api.stripe.com/v1/accounts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        type: 'standard',
        'metadata[vendor_id]': vendor.id,
        email: user.email,
      }),
    })
    const account = (await res.json()) as { id: string }
    accountId = account.id

    const { updateVendor: update } = await import('../../db/vendors')
    await update(c.env.DB, vendor.id, { stripe_account_id: accountId } as any)
  }

  const res = await fetch('https://api.stripe.com/v1/account_links', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${c.env.APP_URL}/app/settings?stripe=refresh`,
      return_url: `${c.env.APP_URL}/app/settings?stripe=complete`,
    }),
  })
  const link = (await res.json()) as { url: string }

  return c.redirect(link.url)
})

settings.get('/app/settings/stripe/callback', async (c) => {
  return c.redirect('/app/settings?stripe=complete')
})

// ─── Data export ───

settings.get('/app/settings/export', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!

  const [contacts, invoiceList, events, weddings] = await Promise.all([
    listContacts(c.env.DB, vendor.id, {}),
    listInvoices(c.env.DB, vendor.id),
    c.env.DB.prepare('SELECT * FROM calendar_events WHERE vendor_id = ? ORDER BY date DESC').bind(vendor.id).all(),
    c.env.DB.prepare(
      `SELECT w.* FROM weddings w
       JOIN wedding_members wm ON wm.wedding_id = w.id
       WHERE wm.user_id = ? ORDER BY w.created_at DESC`
    ).bind(user.id).all(),
  ])

  const data = {
    exported_at: new Date().toISOString(),
    user: { id: user.id, email: user.email, name: user.name, created_at: user.created_at },
    vendor_profile: vendor,
    contacts,
    invoices: invoiceList,
    calendar_events: events.results,
    weddings: weddings.results,
  }

  await auditLog(c, 'data_export', 'user', user.id).catch(() => {})

  return c.json(data, 200, {
    'Content-Disposition': `attachment; filename="wedding-computer-export-${new Date().toISOString().slice(0, 10)}.json"`,
  })
})

// ─── Account deletion ───

settings.post('/app/settings/delete-account', async (c) => {
  const user = c.get('user')
  const sessionId = (await import('hono/cookie')).getCookie(c, 'wc_session')

  await auditLog(c, 'account_deleted', 'user', user.id).catch(() => {})
  await deleteUser(c.env.DB, user.id)

  if (sessionId) {
    await destroySession(c.env.DB, c.env.KV, sessionId).catch(() => {})
  }
  deleteCookie(c, 'wc_session', { path: '/' })
  return c.redirect('/')
})

export default settings

function FeedUrl({ label, url, description }: { label: string; url: string; description: string }) {
  return (
    <div>
      <p class="text-xs font-bold text-gray-700 mb-1">{label}</p>
      <div class="flex items-center gap-2">
        <input
          type="text"
          readonly
          value={url}
          class="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-600 bg-gray-50 select-all"
        />
      </div>
      <p class="text-xs text-gray-400 mt-1">{description}</p>
    </div>
  )
}

function Field({
  label,
  name,
  value,
  type = 'text',
  required = false,
  disabled = false,
  placeholder,
}: {
  label: string
  name: string
  value: string
  type?: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <div>
      <label class="block text-sm font-bold text-gray-700 mb-1.5" for={name}>
        {label}
      </label>
      <input
        type={type}
        id={name}
        name={name}
        value={value}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        class={`w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent ${
          disabled ? 'bg-gray-50 text-gray-500' : ''
        }`}
      />
    </div>
  )
}
