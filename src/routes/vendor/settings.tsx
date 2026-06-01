import { Hono } from 'hono'
import type { Env, VendorProfile } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { updateVendor } from '../../db/vendors'
import { deleteUser } from '../../db/users'
import { VENDOR_CATEGORIES } from '../../types'
import { trimOrNull, requireString } from '../../lib/validation'
import { auditLog } from '../../middleware/audit'
import { listContacts } from '../../storage/contacts'
import { listInvoices } from '../../db/invoices'
import { deleteCookie } from 'hono/cookie'
import { destroySession } from '../../services/auth'
import { verifyGitHubToken, createGitHubRepo } from '../../storage/github'

const settings = new Hono<Env>()

settings.use('/app/*', requireAuth, csrf, requireVendor)

settings.get('/app/settings', (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const saved = c.req.query('saved')
  const error = c.req.query('error')

  return c.html(
    <AppLayout title="Settings" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        {saved && (
          <div class="bg-horizon-50 border border-horizon-600/20 text-horizon-700 text-sm font-bold rounded-xl p-3 mb-6">
            Settings saved.
          </div>
        )}
        {error && (
          <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-3 mb-6">
            {decodeURIComponent(error)}
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
          <h2 class="text-base font-bold mb-2">GitHub sync</h2>
          <p class="text-sm text-gray-500 mb-4">
            Sync your contacts and weddings to a private GitHub repository. Open your files in Obsidian, VS Code, or any text editor.
          </p>
          {(() => {
            let gitConfig: { git_repo?: string; git_access_token?: string } | null = null
            if (vendor.storage_config) {
              try { gitConfig = JSON.parse(vendor.storage_config) } catch { /* ignore */ }
            }
            const isConnected = vendor.storage_type === 'git' && gitConfig?.git_repo && gitConfig?.git_access_token

            if (isConnected) {
              return (
                <div class="space-y-4">
                  <div class="bg-horizon-50 border border-horizon-600/20 rounded-xl p-4">
                    <div class="flex items-center gap-2 mb-1">
                      <div class="w-2 h-2 rounded-full bg-green-500" />
                      <p class="text-sm font-bold text-horizon-700">Connected to GitHub</p>
                    </div>
                    <p class="text-xs text-gray-600">
                      Repository: <a href={`https://github.com/${gitConfig!.git_repo}`} class="font-medium text-horizon-600 hover:underline" target="_blank" rel="noopener">{gitConfig!.git_repo}</a>
                    </p>
                    <p class="text-xs text-gray-500 mt-1">
                      Changes to contacts and weddings are automatically pushed to your repo.
                    </p>
                  </div>
                  <div class="flex gap-3">
                    <form method="post" action="/app/settings/github/sync">
                      <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                      <button type="submit" class="bg-horizon-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
                        Sync all files now
                      </button>
                    </form>
                    <form method="post" action="/app/settings/github/disconnect">
                      <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                      <button type="submit" class="border border-gray-200 text-gray-600 py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors">
                        Disconnect
                      </button>
                    </form>
                  </div>
                </div>
              )
            }

            return (
              <form method="post" action="/app/settings/github/connect" class="space-y-4">
                <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                <div>
                  <label class="block text-sm font-bold text-gray-700 mb-1.5" for="github_token">
                    GitHub Personal Access Token
                  </label>
                  <input
                    type="password"
                    id="github_token"
                    name="github_token"
                    required
                    placeholder="ghp_..."
                    class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                  />
                  <p class="text-xs text-gray-400 mt-1.5">
                    Create a token at{' '}
                    <a href="https://github.com/settings/tokens/new?scopes=repo&description=Wedding+Computer" target="_blank" rel="noopener" class="text-horizon-600 hover:underline">
                      github.com/settings/tokens
                    </a>
                    {' '}with <strong>repo</strong> scope.
                  </p>
                </div>
                <div>
                  <label class="block text-sm font-bold text-gray-700 mb-1.5" for="github_repo">
                    Repository name
                  </label>
                  <input
                    type="text"
                    id="github_repo"
                    name="github_repo"
                    required
                    placeholder="wedding-data"
                    class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                  />
                  <p class="text-xs text-gray-400 mt-1.5">
                    {"We'll create a private repo with this name if it doesn't exist."}
                  </p>
                </div>
                <button type="submit" class="bg-horizon-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
                  Connect GitHub
                </button>
              </form>
            )
          })()}
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

        <section id="data" class="mt-10 pt-8 border-t border-gray-200">
          <h2 class="text-base font-bold mb-2">Your data</h2>
          <p class="text-sm text-gray-500 mb-1">
            Your contacts and weddings are stored as plain text Markdown files. Download them anytime.
          </p>
          <a href="/docs/plain-text" class="text-xs text-horizon-600 font-bold hover:text-horizon-700 inline-block mb-4">
            Learn more about plain text data &rarr;
          </a>
          <div class="flex flex-col sm:flex-row gap-3 items-start">
            <a
              href="/app/settings/export-markdown"
              class="bg-horizon-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors text-center"
            >
              Download Markdown files
            </a>
            <a
              href="/app/settings/export"
              class="bg-white border border-gray-200 text-gray-700 py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors text-center"
            >
              Export as JSON
            </a>
          </div>
          <div class="mt-8 pt-6 border-t border-gray-200">
            <h3 class="text-sm font-bold text-grapefruit-700 mb-2">Danger zone</h3>
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

// ─── GitHub sync ───

settings.post('/app/settings/github/connect', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()
  const token = typeof body.github_token === 'string' ? body.github_token.trim() : ''
  const repoName = typeof body.github_repo === 'string' ? body.github_repo.trim() : ''

  if (!token || !repoName) {
    return c.redirect('/app/settings?error=Token+and+repository+name+are+required')
  }

  try {
    // Verify the token works
    const user = await verifyGitHubToken(token)
    if (!user) {
      return c.redirect('/app/settings?error=Invalid+GitHub+token.+Check+it+has+repo+scope.')
    }

    // Check if repo exists, create if not
    const fullRepoName = repoName.includes('/') ? repoName : `${user.login}/${repoName}`
    const repoCheck = await fetch(`https://api.github.com/repos/${fullRepoName}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'WeddingComputer/1.0',
      },
    })

    let repoFullName = fullRepoName
    if (repoCheck.status === 404) {
      // Create the repo
      const simpleName = repoName.includes('/') ? repoName.split('/').pop()! : repoName
      const created = await createGitHubRepo(
        token,
        simpleName,
        `Wedding Computer data for ${vendor.business_name}`
      )
      if (!created) {
        return c.redirect('/app/settings?error=Failed+to+create+GitHub+repository')
      }
      repoFullName = created.full_name
    } else if (!repoCheck.ok) {
      return c.redirect('/app/settings?error=Could+not+access+that+repository.+Check+your+token+permissions.')
    }

    // Save the config
    const config = JSON.stringify({
      type: 'git',
      git_provider: 'github',
      git_repo: repoFullName,
      git_branch: 'main',
      git_path: '',
      git_access_token: token,
    })

    await updateVendor(c.env.DB, vendor.id, {
      storage_type: 'git',
      storage_config: config,
    })

    await auditLog(c, 'github_connected', 'vendor', vendor.id, { repo: repoFullName }).catch(() => {})

    // Trigger initial sync — push all existing contacts to GitHub
    try {
      await initialGitHubSync(c.env.DB, vendor, token, repoFullName)
    } catch (syncErr) {
      console.error('[github] Initial sync failed:', syncErr)
      // Don't fail the connect — the repo is linked, sync can happen later
    }

    return c.redirect('/app/settings?saved=1')
  } catch (err: any) {
    console.error('[github] connect error:', err)
    return c.redirect(`/app/settings?error=${encodeURIComponent(err.message || 'Failed to connect GitHub')}`)
  }
})

settings.post('/app/settings/github/disconnect', async (c) => {
  const vendor = c.get('vendor')!

  await updateVendor(c.env.DB, vendor.id, {
    storage_type: 'r2',
    storage_config: null,
  })

  await auditLog(c, 'github_disconnected', 'vendor', vendor.id).catch(() => {})
  return c.redirect('/app/settings?saved=1')
})

settings.post('/app/settings/github/sync', async (c) => {
  const vendor = c.get('vendor')!

  let config: { git_repo?: string; git_access_token?: string } | null = null
  if (vendor.storage_config) {
    try { config = JSON.parse(vendor.storage_config) } catch { /* ignore */ }
  }

  if (!config?.git_repo || !config?.git_access_token) {
    return c.redirect('/app/settings?error=GitHub+is+not+connected')
  }

  try {
    const result = await initialGitHubSync(c.env.DB, vendor, config.git_access_token, config.git_repo)
    return c.redirect(`/app/settings?saved=1&synced=${result.pushed}`)
  } catch (err: any) {
    console.error('[github] sync error:', err)
    return c.redirect(`/app/settings?error=${encodeURIComponent('Sync failed: ' + (err.message || 'unknown error'))}`)
  }
})

/**
 * Push all existing contacts and weddings from D1 to a GitHub repo.
 * This is the "initial sync" that runs when a user first connects,
 * and can be re-run via the "Sync all files now" button.
 */
async function initialGitHubSync(
  db: D1Database,
  vendor: VendorProfile,
  token: string,
  repo: string
): Promise<{ pushed: number; skipped: number }> {
  const { GitHubStorageBackend } = await import('../../storage/github')
  const { contactToMarkdown } = await import('../../storage/contacts')
  const { serializeMarkdown } = await import('../../storage/markdown')
  const { contactFilename } = await import('../../storage/slug')

  const github = new GitHubStorageBackend({ token, repo, branch: 'main', path: '' })

  // Get all contacts from D1
  const contacts = await db
    .prepare('SELECT * FROM contacts WHERE vendor_id = ? ORDER BY created_at ASC')
    .bind(vendor.id)
    .all<any>()
    .then((r) => r.results)

  let pushed = 0
  let skipped = 0

  for (const ct of contacts) {
    try {
      const filename = contactFilename(
        ct.first_name || '',
        ct.last_name || '',
        ct.partner_first_name,
        ct.partner_last_name
      )
      const doc = contactToMarkdown(ct)
      const content = serializeMarkdown(doc)
      await github.write(`contacts/${filename}`, content)
      pushed++
    } catch (err) {
      console.error(`[github-sync] Failed to push contact ${ct.id}:`, err)
      skipped++
    }
  }

  // Get weddings
  const weddings = await db
    .prepare(
      `SELECT w.* FROM weddings w
       JOIN wedding_members wm ON wm.wedding_id = w.id
       WHERE wm.vendor_profile_id = ? AND wm.status = 'active'
       ORDER BY w.created_at ASC`
    )
    .bind(vendor.id)
    .all<any>()
    .then((r) => r.results)

  for (const w of weddings) {
    try {
      const title = (w.title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const content = [
        '---',
        `id: "${w.id}"`,
        `title: "${w.title || ''}"`,
        w.date ? `date: "${w.date}"` : null,
        w.time ? `time: "${w.time}"` : null,
        w.location ? `location: "${w.location}"` : null,
        `status: "${w.status || 'planning'}"`,
        w.ceremony_type ? `ceremony_type: "${w.ceremony_type}"` : null,
        `created_at: "${w.created_at || ''}"`,
        '---',
        '',
        w.notes || '',
      ].filter((line) => line !== null).join('\n')

      await github.write(`weddings/${title}.md`, content)
      pushed++
    } catch (err) {
      console.error(`[github-sync] Failed to push wedding ${w.id}:`, err)
      skipped++
    }
  }

  console.log(`[github-sync] Vendor ${vendor.id}: pushed ${pushed}, skipped ${skipped}`)
  return { pushed, skipped }
}

// ─── Stripe Connect ───

settings.post('/app/settings/stripe/connect', async (c) => {
  const vendor = c.get('vendor')!
  const user = c.get('user')

  if (!c.env.STRIPE_SECRET_KEY) {
    return c.redirect('/app/settings?error=Stripe+is+not+configured+yet.+The+platform+needs+a+Stripe+secret+key.')
  }

  try {
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
      const account = (await res.json()) as { id: string; error?: { message: string } }
      if (!account.id || account.error) {
        console.error('[stripe] create account failed:', account)
        return c.redirect(`/app/settings?error=${encodeURIComponent(account.error?.message || 'Failed to create Stripe account')}`)
      }
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
    const link = (await res.json()) as { url: string; error?: { message: string } }
    if (!link.url || link.error) {
      console.error('[stripe] account_links failed:', link)
      return c.redirect(`/app/settings?error=${encodeURIComponent(link.error?.message || 'Failed to create Stripe onboarding link')}`)
    }

    return c.redirect(link.url)
  } catch (err: any) {
    console.error('[stripe] connect error:', err)
    return c.redirect(`/app/settings?error=${encodeURIComponent('Stripe connection failed: ' + (err.message || 'unknown error'))}`)
  }
})

settings.get('/app/settings/stripe/callback', async (c) => {
  return c.redirect('/app/settings?stripe=complete')
})

// ─── Data export (JSON) ───

settings.get('/app/settings/export', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!

  try {
    // Try file_index first, fall back to old contacts table
    let contacts
    try {
      contacts = await listContacts(c.env.DB, vendor.id, {})
    } catch {
      contacts = await c.env.DB
        .prepare('SELECT * FROM contacts WHERE vendor_id = ? ORDER BY created_at DESC')
        .bind(vendor.id).all().then((r) => r.results)
    }

    const [invoiceList, events, weddings] = await Promise.all([
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
  } catch (err) {
    console.error('[export] JSON export failed:', err)
    return c.redirect('/app/settings?error=Export+failed.+Please+try+again.')
  }
})

// ─── Data export (Markdown ZIP) ───

settings.get('/app/settings/export-markdown', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!

  try {
    // Get contacts from D1 (works whether file_index or old contacts table)
    let contacts
    try {
      contacts = await listContacts(c.env.DB, vendor.id, {})
    } catch {
      contacts = await c.env.DB
        .prepare('SELECT * FROM contacts WHERE vendor_id = ? ORDER BY created_at DESC')
        .bind(vendor.id).all<any>().then((r) => r.results)
    }

    // Get weddings
    const weddings = await c.env.DB
      .prepare(
        `SELECT w.* FROM weddings w
         JOIN wedding_members wm ON wm.wedding_id = w.id
         WHERE wm.user_id = ? ORDER BY w.created_at DESC`
      ).bind(user.id).all<any>().then((r) => r.results)

    // Build a simple text bundle — each file separated by a header
    // Since we can't create ZIPs in Workers easily, we generate
    // a single concatenated Markdown document with all files
    const lines: string[] = []

    lines.push('# Wedding Computer — Markdown Export')
    lines.push(`# Exported: ${new Date().toISOString()}`)
    lines.push(`# Vendor: ${vendor.business_name}`)
    lines.push('')

    // Contact files
    lines.push('---')
    lines.push('')
    lines.push('# CONTACTS')
    lines.push('')

    for (const ct of contacts) {
      lines.push(`${'='.repeat(60)}`)
      lines.push(`FILE: contacts/${slugify(ct.first_name, ct.last_name)}.md`)
      lines.push(`${'='.repeat(60)}`)
      lines.push('---')
      lines.push(`id: "${ct.id}"`)
      lines.push(`first_name: "${ct.first_name ?? ''}"`)
      lines.push(`last_name: "${ct.last_name ?? ''}"`)
      if (ct.email) lines.push(`email: "${ct.email}"`)
      if (ct.phone) lines.push(`phone: "${ct.phone}"`)
      if (ct.partner_first_name) lines.push(`partner_first_name: "${ct.partner_first_name}"`)
      if (ct.partner_last_name) lines.push(`partner_last_name: "${ct.partner_last_name}"`)
      if (ct.partner_email) lines.push(`partner_email: "${ct.partner_email}"`)
      if (ct.partner_phone) lines.push(`partner_phone: "${ct.partner_phone}"`)
      if (ct.source) lines.push(`source: "${ct.source}"`)
      lines.push(`status: "${ct.status}"`)
      if (ct.wedding_date) lines.push(`wedding_date: "${ct.wedding_date}"`)
      if (ct.wedding_location) lines.push(`wedding_location: "${ct.wedding_location}"`)
      lines.push(`created_at: "${ct.created_at}"`)
      lines.push(`updated_at: "${ct.updated_at}"`)
      lines.push('---')
      if (ct.notes) {
        lines.push('')
        lines.push(ct.notes)
      }
      lines.push('')
    }

    // Wedding files
    lines.push('---')
    lines.push('')
    lines.push('# WEDDINGS')
    lines.push('')

    for (const w of weddings) {
      lines.push(`${'='.repeat(60)}`)
      lines.push(`FILE: weddings/${slugify(w.title || 'untitled', '')}.md`)
      lines.push(`${'='.repeat(60)}`)
      lines.push('---')
      lines.push(`id: "${w.id}"`)
      lines.push(`title: "${w.title}"`)
      if (w.date) lines.push(`date: "${w.date}"`)
      if (w.time) lines.push(`time: "${w.time}"`)
      if (w.location) lines.push(`location: "${w.location}"`)
      lines.push(`status: "${w.status}"`)
      if (w.ceremony_type) lines.push(`ceremony_type: "${w.ceremony_type}"`)
      lines.push(`created_at: "${w.created_at}"`)
      lines.push('---')
      if (w.notes) {
        lines.push('')
        lines.push(w.notes)
      }
      lines.push('')
    }

    const content = lines.join('\n')

    await auditLog(c, 'data_export', 'user', user.id, { format: 'markdown' }).catch(() => {})

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="wedding-computer-${new Date().toISOString().slice(0, 10)}.md"`,
      },
    })
  } catch (err) {
    console.error('[export] Markdown export failed:', err)
    return c.redirect('/app/settings?error=Export+failed.+Please+try+again.')
  }
})

function slugify(first: string, last: string): string {
  return [first, last].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unnamed'
}

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
