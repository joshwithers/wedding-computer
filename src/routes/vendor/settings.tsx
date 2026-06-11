import { Hono } from 'hono'
import type { Env, VendorProfile, ServiceTemplate, InvoiceDefaults } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { updateVendor } from '../../db/vendors'
import { isProVendor } from '../../db/subscriptions'
import { softDeleteAccount } from '../../services/account'
import { VENDOR_CATEGORIES } from '../../types'
import { trimOrNull, requireString } from '../../lib/validation'
import { auditLog } from '../../middleware/audit'
import { listContacts } from '../../storage/contacts'
import { listInvoices } from '../../db/invoices'
import { deleteCookie } from 'hono/cookie'
import { verifyGitHubToken, createGitHubRepo, ensureGitHubWebhook } from '../../storage/github'
import { deleteVendorSecret, putVendorSecret, resolveSecret } from '../../services/secrets'
import { redactedVendorProfile } from '../../lib/redaction'

const settings = new Hono<Env>()

settings.use('/app/*', requireAuth, csrf, requireVendor)

settings.get('/app/settings', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const saved = c.req.query('saved')
  const error = c.req.query('error')
  const isPro = await isProVendor(c.env.DB, vendor.id)

  // One-time sync token reveal: the generate handler stashes the new
  // token in KV under a single-use id; we show it once and delete it.
  const revealId = c.req.query('reveal')
  let revealedToken: string | null = null
  if (revealId && /^[0-9a-f]{32}$/.test(revealId)) {
    const revealKey = `token_reveal:${vendor.id}:${revealId}`
    revealedToken = await c.env.KV.get(revealKey)
    if (revealedToken) await c.env.KV.delete(revealKey)
  }

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

        <nav class="sticky top-0 z-10 py-2 mb-6 bg-papaya-50/95 backdrop-blur-sm overflow-x-auto">
          <div class="flex gap-1 whitespace-nowrap text-sm">
            <a href="#business" class="px-3 py-1.5 rounded-lg font-medium text-gray-600 hover:bg-papaya-100 hover:text-gray-900 transition-colors">Business</a>
            <a href="#invoicing" class="px-3 py-1.5 rounded-lg font-medium text-gray-600 hover:bg-papaya-100 hover:text-gray-900 transition-colors">Payments &amp; invoicing</a>
            <a href="#email" class="px-3 py-1.5 rounded-lg font-medium text-gray-600 hover:bg-papaya-100 hover:text-gray-900 transition-colors">Email</a>
            <a href="#sharing" class="px-3 py-1.5 rounded-lg font-medium text-gray-600 hover:bg-papaya-100 hover:text-gray-900 transition-colors">Sharing</a>
            <a href="#integrations" class="px-3 py-1.5 rounded-lg font-medium text-gray-600 hover:bg-papaya-100 hover:text-gray-900 transition-colors">Integrations</a>
            <a href="#data" class="px-3 py-1.5 rounded-lg font-medium text-gray-600 hover:bg-papaya-100 hover:text-gray-900 transition-colors">Your data</a>
          </div>
        </nav>

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

          <section id="business" class="scroll-mt-24">
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
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5">Location</label>
                <div class="relative" data-places>
                  <input
                    type="text"
                    name="location"
                    id="location-input"
                    value={vendor.location ?? ''}
                    placeholder="Start typing a city or region..."
                    autocomplete="off"
                    class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                    hx-get="/api/places/search?field=location&mode=region"
                    hx-trigger="keyup changed delay:300ms"
                    hx-target="#suggestions-location"
                    hx-include="this"
                  />
                  <div id="suggestions-location" class="relative"></div>
                </div>
                {vendor.location_city && (
                  <p class="text-xs text-gray-400 mt-1">
                    {[vendor.location_city, vendor.location_state, vendor.location_country].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
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

        <section id="invoicing" class="mt-10 pt-8 border-t border-gray-200 scroll-mt-24">
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
          <h2 class="text-base font-bold mb-2">Invoicing</h2>
          <p class="text-sm text-gray-500 mb-4">
            Configure tax, numbering, and fees for your invoices.
          </p>
          <form method="post" action="/app/settings/invoicing" class="space-y-5">
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />

            <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
              <h3 class="text-sm font-bold">Tax</h3>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-bold text-gray-700 mb-1" for="tax_label">Tax type</label>
                  <select id="tax_label" name="tax_label"
                    class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600">
                    <option value="" selected={!vendor.tax_label}>No tax</option>
                    <option value="GST" selected={vendor.tax_label === 'GST'}>GST (Australia, NZ, Singapore, India)</option>
                    <option value="VAT" selected={vendor.tax_label === 'VAT'}>VAT (UK, EU, South Africa)</option>
                    <option value="Sales Tax" selected={vendor.tax_label === 'Sales Tax'}>Sales Tax (USA, Canada)</option>
                  </select>
                </div>
                <div>
                  <label class="block text-xs font-bold text-gray-700 mb-1" for="tax_rate">Rate (%)</label>
                  <input type="number" id="tax_rate" name="tax_rate" min="0" max="50" step="0.5"
                    value={String(vendor.tax_rate || '')} placeholder="e.g. 10"
                    class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
                </div>
              </div>
              <div>
                <label class="block text-xs font-bold text-gray-700 mb-1">Pricing model</label>
                <div class="flex gap-4">
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="tax_inclusive" value="1" checked={!!vendor.tax_inclusive}
                      class="w-4 h-4 border-gray-300 text-horizon-600 focus:ring-horizon-600" />
                    <span class="text-sm text-gray-700">Prices include tax</span>
                  </label>
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="tax_inclusive" value="0" checked={!vendor.tax_inclusive}
                      class="w-4 h-4 border-gray-300 text-horizon-600 focus:ring-horizon-600" />
                    <span class="text-sm text-gray-700">Prices exclude tax (added on top)</span>
                  </label>
                </div>
                <p class="text-xs text-gray-400 mt-1">
                  {vendor.tax_inclusive
                    ? 'Your service prices already include tax. The tax component will be shown separately on invoices.'
                    : 'Tax will be calculated and added on top of your service prices.'}
                </p>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-bold text-gray-700 mb-1" for="tax_number">
                    {vendor.tax_label === 'GST' ? 'ABN' : vendor.tax_label === 'VAT' ? 'VAT number' : 'Tax registration number'}
                  </label>
                  <input type="text" id="tax_number" name="tax_number" value={vendor.tax_number ?? ''} placeholder="e.g. 12 345 678 901"
                    class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
                </div>
                <div>
                  <label class="block text-xs font-bold text-gray-700 mb-1" for="business_address">Business address</label>
                  <input type="text" id="business_address" name="business_address" value={vendor.business_address ?? ''} placeholder="123 Main St, Sydney NSW"
                    class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
                </div>
              </div>
            </div>

            <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
              <h3 class="text-sm font-bold">Invoice numbering</h3>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-bold text-gray-700 mb-1" for="invoice_prefix">Prefix</label>
                  <input type="text" id="invoice_prefix" name="invoice_prefix" value={vendor.invoice_prefix || 'INV-'} placeholder="INV-"
                    class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
                </div>
                <div>
                  <label class="block text-xs font-bold text-gray-700 mb-1" for="next_invoice_number">Next number</label>
                  <input type="number" id="next_invoice_number" name="next_invoice_number" min="1"
                    value={String(vendor.next_invoice_number || 1)}
                    class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
                  <p class="text-xs text-gray-400 mt-1">Next invoice will be {vendor.invoice_prefix || 'INV-'}{String(vendor.next_invoice_number || 1).padStart(4, '0')}</p>
                </div>
              </div>
            </div>

            <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
              <h3 class="text-sm font-bold">Credit card surcharge</h3>
              <p class="text-xs text-gray-500">
                Optionally pass on card processing fees to clients. You can choose per-invoice whether to apply it.
              </p>
              <label class="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" name="card_fee_enabled" value="1" checked={!!vendor.card_fee_enabled}
                  class="w-4 h-4 rounded border-gray-300 text-horizon-600 focus:ring-horizon-600" />
                <span class="text-sm text-gray-700">Enable card fee surcharge</span>
              </label>
              <div>
                <label class="block text-xs font-bold text-gray-700 mb-1" for="card_fee_percent">Fee percentage</label>
                <input type="number" id="card_fee_percent" name="card_fee_percent" min="0" max="5" step="0.1"
                  value={vendor.card_fee_percent ? String(vendor.card_fee_percent) : ''} placeholder="e.g. 1.5"
                  class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 max-w-xs" />
                <p class="text-xs text-gray-400 mt-1">Typically 1–2%. Must not exceed your actual processing cost.</p>
              </div>
            </div>

            <button type="submit"
              class="bg-horizon-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
              Save invoicing settings
            </button>
          </form>

          {/* Service templates */}
          <ServiceTemplatesEditor vendor={vendor} csrfToken={c.get('csrfToken')} />

          {/* Invoice defaults */}
          <InvoiceDefaultsEditor vendor={vendor} csrfToken={c.get('csrfToken')} />
        </section>

        <section id="email" class="mt-10 pt-8 border-t border-gray-200 scroll-mt-24">
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
          <div class="mt-6 pt-4 border-t border-gray-100">
            <h3 class="text-sm font-bold text-gray-700 mb-1">Email notifications</h3>
            <p class="text-sm text-gray-500 mb-3">
              Choose what Wedding Computer emails you about — enquiries, payments, daily summaries, and more.
            </p>
            <a
              href="/account/notifications"
              class="inline-block bg-white border border-gray-200 text-gray-700 py-2 px-4 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
            >
              Manage notifications
            </a>
          </div>
        </section>

        <section id="sharing" class="mt-10 pt-8 border-t border-gray-200 scroll-mt-24">
          <h2 class="text-base font-bold mb-2">Availability sharing</h2>
          <p class="text-sm text-gray-500 mb-4">
            Control who can see your calendar availability.
          </p>
          <form method="post" action="/app/settings/availability-sharing">
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <div class="space-y-3">
              {([
                ['private', 'Private', 'Only you can see your availability', false],
                ['vendors_only', 'Vendors only', 'Other vendors on shared weddings can see your availability', false],
                ['public', 'Public', 'Anyone with your profile link can see available dates', false],
                ['ai_reply', 'AI auto-reply', 'AI includes your availability when replying to enquiries', true],
              ] as const).map(([value, label, desc, pro]) => {
                const locked = pro && !isPro
                return (
                <label class={`flex items-start gap-3 p-3 rounded-xl border border-gray-200 transition-colors ${locked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-horizon-300'}`}>
                  <input
                    type="radio"
                    name="availability_sharing"
                    value={value}
                    checked={vendor.availability_sharing === value}
                    disabled={locked}
                    class="mt-0.5 w-4 h-4 border-gray-300 text-horizon-600 focus:ring-horizon-600"
                  />
                  <div>
                    <span class="text-sm font-bold text-gray-900">{label} {pro && <ProBadge />}</span>
                    <p class="text-xs text-gray-500">{desc}{locked ? ' — upgrade to Pro to enable.' : ''}</p>
                  </div>
                </label>
                )
              })}
            </div>
            <button type="submit"
              class="mt-4 bg-horizon-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
              Save
            </button>
          </form>
        </section>

        <section class="mt-10 pt-8 border-t border-gray-200" id="logo-section" data-csrf={c.get('csrfToken')}>
          <h2 class="text-base font-bold mb-2">Logo / icon</h2>
          <p class="text-sm text-gray-500 mb-4">
            A square logo or icon for your business — shown around Wedding Computer and on your public
            directory listing. Upload any image and crop it to a square.
          </p>
          <div class="flex items-center gap-4">
            <div class="w-20 h-20 rounded-2xl bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
              {vendor.logo_r2_key ? (
                <img src={`/vendor-logo/${vendor.id}`} alt="Business logo" class="w-full h-full object-cover" />
              ) : (
                <span class="text-gray-400 text-xs">No logo</span>
              )}
            </div>
            <div class="flex items-center gap-2">
              <label class="bg-horizon-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors cursor-pointer">
                {vendor.logo_r2_key ? 'Replace logo' : 'Upload logo'}
                <input type="file" id="logo-file" accept="image/png,image/jpeg,image/webp" class="hidden" />
              </label>
              {vendor.logo_r2_key && (
                <form method="post" action="/app/settings/logo/remove">
                  <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                  <button type="submit" class="border border-gray-300 text-gray-700 py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors">
                    Remove
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Cropper — revealed after a file is chosen */}
          <div id="logo-cropper" class="hidden mt-5">
            <p class="text-sm text-gray-600 mb-2">Drag to reposition, slide to zoom.</p>
            <canvas id="logo-canvas" width="280" height="280" class="rounded-2xl bg-gray-50 border border-gray-200 cursor-move touch-none"></canvas>
            <input type="range" id="logo-zoom" min="1" max="3" step="0.01" value="1" class="block w-[280px] max-w-full mt-3 accent-horizon-600" />
            <div class="flex items-center gap-2 mt-3">
              <button id="logo-save" type="button" class="bg-horizon-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">Save logo</button>
              <button id="logo-cancel" type="button" class="border border-gray-300 text-gray-700 py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors">Cancel</button>
              <span id="logo-status" class="text-xs text-gray-400"></span>
            </div>
          </div>
          <script dangerouslySetInnerHTML={{ __html: `
(function(){
  var root=document.getElementById('logo-section'); if(!root) return;
  var csrf=root.getAttribute('data-csrf');
  var fileInput=document.getElementById('logo-file');
  var cropper=document.getElementById('logo-cropper');
  var canvas=document.getElementById('logo-canvas');
  var zoom=document.getElementById('logo-zoom');
  var saveBtn=document.getElementById('logo-save');
  var cancelBtn=document.getElementById('logo-cancel');
  var statusEl=document.getElementById('logo-status');
  if(!fileInput||!canvas) return;
  var ctx=canvas.getContext('2d');
  var VP=280, img=null, baseScale=1, scale=1, ox=0, oy=0, dragging=false, lastX=0, lastY=0;
  function clamp(){ var w=img.width*scale, h=img.height*scale; ox=Math.min(0,Math.max(VP-w,ox)); oy=Math.min(0,Math.max(VP-h,oy)); }
  function draw(){ ctx.clearRect(0,0,VP,VP); ctx.drawImage(img,ox,oy,img.width*scale,img.height*scale); }
  function applyZoom(z){ var prev=scale; scale=baseScale*z; var c=VP/2; ox=c-(c-ox)*(scale/prev); oy=c-(c-oy)*(scale/prev); clamp(); draw(); }
  fileInput.addEventListener('change',function(e){
    var f=e.target.files&&e.target.files[0]; if(!f) return;
    if(f.size>5*1024*1024){ alert('Image is too large (max 5MB).'); fileInput.value=''; return; }
    var url=URL.createObjectURL(f);
    img=new Image();
    img.onload=function(){ baseScale=Math.max(VP/img.width,VP/img.height); scale=baseScale; zoom.value='1'; ox=(VP-img.width*scale)/2; oy=(VP-img.height*scale)/2; clamp(); draw(); cropper.classList.remove('hidden'); URL.revokeObjectURL(url); };
    img.onerror=function(){ alert('Could not read that image.'); };
    img.src=url;
  });
  zoom.addEventListener('input',function(){ if(img) applyZoom(parseFloat(zoom.value)); });
  canvas.addEventListener('pointerdown',function(e){ if(!img) return; dragging=true; lastX=e.clientX; lastY=e.clientY; try{canvas.setPointerCapture(e.pointerId);}catch(_){} });
  canvas.addEventListener('pointermove',function(e){ if(!dragging) return; ox+=(e.clientX-lastX); oy+=(e.clientY-lastY); lastX=e.clientX; lastY=e.clientY; clamp(); draw(); });
  canvas.addEventListener('pointerup',function(){ dragging=false; });
  canvas.addEventListener('pointercancel',function(){ dragging=false; });
  cancelBtn.addEventListener('click',function(){ cropper.classList.add('hidden'); fileInput.value=''; img=null; statusEl.textContent=''; });
  saveBtn.addEventListener('click',function(){
    if(!img) return;
    var out=document.createElement('canvas'); out.width=512; out.height=512;
    var octx=out.getContext('2d'); var sf=512/VP;
    octx.drawImage(img,ox*sf,oy*sf,img.width*scale*sf,img.height*scale*sf);
    statusEl.textContent='Uploading...'; saveBtn.disabled=true;
    out.toBlob(function(blob){
      var fd=new FormData(); fd.append('logo',blob,'logo.png');
      fetch('/app/settings/logo',{method:'POST',headers:{'x-csrf-token':csrf},body:fd})
        .then(function(r){ if(!r.ok) throw new Error('upload'); return r.json(); })
        .then(function(){ window.location.reload(); })
        .catch(function(){ statusEl.textContent='Upload failed. Please try again.'; saveBtn.disabled=false; });
    },'image/png');
  });
})();
` }} />
        </section>

        <section class="mt-10 pt-8 border-t border-gray-200">
          <h2 class="text-base font-bold mb-2">Directory listing</h2>
          <p class="text-sm text-gray-500 mb-4">
            Opt in to appear in the public wedding vendor directory at wedding.institute.
          </p>
          <form method="post" action="/app/settings/directory-listing">
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <label class="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="directory_listed"
                value="1"
                checked={!!vendor.directory_listed}
                class="w-4 h-4 rounded border-gray-300 text-horizon-600 focus:ring-horizon-600"
              />
              <span class="text-sm text-gray-700">List my business in the public directory</span>
            </label>
            {!vendor.location_city && (
              <p class="text-xs text-grapefruit-600 mt-2">
                Set your location above to appear in location-based directory searches.
              </p>
            )}
            <button type="submit"
              class="mt-4 bg-horizon-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
              Save
            </button>
          </form>
        </section>

        <section id="integrations" class="mt-10 pt-8 border-t border-gray-200 scroll-mt-24">
          <h2 class="text-base font-bold mb-2">GitHub sync <ProBadge /></h2>
          <p class="text-sm text-gray-500 mb-4">
            Sync your contacts and weddings to a private GitHub repository. Open your files in Obsidian, VS Code, or any text editor.
          </p>
          {(() => {
            let gitConfig: { git_repo?: string; git_access_token?: string; git_access_token_ref?: string; git_webhook_active?: boolean } | null = null
            if (vendor.storage_config) {
              try { gitConfig = JSON.parse(vendor.storage_config) } catch { /* ignore */ }
            }
            const isConnected = vendor.storage_type === 'git' && gitConfig?.git_repo && (gitConfig?.git_access_token_ref || gitConfig?.git_access_token)

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
                      Two-way sync: changes you make here are pushed to your repo, and edits you make
                      in the repo (Obsidian, VS Code, GitHub) are pulled back in.
                    </p>
                    <p class="text-xs text-gray-500 mt-1">
                      {gitConfig!.git_webhook_active
                        ? 'Repo edits sync back within seconds (webhook active).'
                        : 'Repo edits sync back within 5 minutes. For instant sync, use a token with webhook (admin:repo_hook) permission and press "Sync all files now".'}
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

            if (!isPro) {
              return <ProUpsell feature="GitHub sync" />
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
                value=""
                placeholder={vendor.anthropic_api_key ? 'Key saved — enter a new key to replace it' : 'sk-ant-...'}
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

        <section id="device-sync" class="mt-10 pt-8 border-t border-gray-200">
          <h2 class="text-base font-bold mb-2">Device sync <ProBadge /></h2>
          <p class="text-sm text-gray-500 mb-4">
            Sync your contacts and calendar to your phone and computer. Works with Apple Contacts, Apple Calendar, and any CardDAV/CalDAV client.
          </p>
          {!isPro ? (
            <ProUpsell feature="Device sync (CalDAV, CardDAV, and iCal)" />
          ) : (
            <div class="space-y-4">
              {revealedToken && (
                <div class="bg-horizon-50 border border-horizon-600/20 rounded-xl p-4">
                  <p class="text-sm font-bold text-horizon-700 mb-1">Your new sync token</p>
                  <code class="text-sm text-gray-700 break-all select-all">{revealedToken}</code>
                  <p class="text-xs text-gray-500 mt-2">
                    Copy it now — it's stored hashed and can't be shown again. Use it as both the
                    username and password for CardDAV/CalDAV, and as the token in the Obsidian plugin.
                  </p>
                  <p class="text-xs text-gray-500 mt-2">
                    Your iCal feed URL:{' '}
                    <code class="break-all select-all">{`${c.env.APP_URL}/cal/${revealedToken}`}</code>
                  </p>
                </div>
              )}
              {vendor.ical_token ? (
                <>
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
                    url={`${c.env.APP_URL}/cal/<your-sync-token>`}
                    description="Replace <your-sync-token> with your token and subscribe in any calendar app."
                  />
                  <div class="bg-gray-50 rounded-xl p-4">
                    <p class="text-xs font-bold text-gray-700 mb-1">Obsidian (markdown vault)</p>
                    <p class="text-xs text-gray-500">
                      Install the official{' '}
                      <a
                        href="https://community.obsidian.md/plugins/wedding-computer-sync"
                        target="_blank"
                        rel="noopener"
                        class="font-medium text-horizon-600 hover:underline"
                      >
                        Wedding Computer Sync plugin
                      </a>{' '}
                      from Obsidian's community directory (in Obsidian: Settings → Community plugins →
                      Browse → "Wedding Computer Sync") and paste your sync token. Your contacts,
                      weddings, and checklists become editable markdown files — changes sync both ways
                      on desktop and mobile.
                    </p>
                  </div>
                  {!revealedToken && (
                    <div class="bg-gray-50 rounded-xl p-4">
                      <p class="text-xs font-bold text-gray-700 mb-1">Sync token</p>
                      <p class="text-xs text-gray-500">
                        Active. For security the token is stored hashed and was shown only once when
                        generated. Lost it? Regenerate below — devices using the old token will need
                        the new one.
                      </p>
                    </div>
                  )}
                  <div class="flex gap-3">
                    <form
                      method="post"
                      action="/app/settings/generate-sync-token"
                      onsubmit="return confirm('Regenerate your sync token? Devices using the current token will stop syncing until you give them the new one.')"
                    >
                      <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                      <button
                        type="submit"
                        class="bg-horizon-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
                      >
                        Regenerate token
                      </button>
                    </form>
                    <form
                      method="post"
                      action="/app/settings/revoke-sync-token"
                      onsubmit="return confirm('Revoke your sync token? CalDAV, CardDAV, iCal, and Obsidian sync will all stop immediately.')"
                    >
                      <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                      <button
                        type="submit"
                        class="border border-gray-200 text-gray-600 py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
                      >
                        Revoke
                      </button>
                    </form>
                  </div>
                </>
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
                    Creates a unique token for syncing to personal devices. It's shown once — store it
                    somewhere safe.
                  </p>
                </form>
              )}
            </div>
          )}
        </section>

        <section id="data" class="mt-10 pt-8 border-t border-gray-200 scroll-mt-24">
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
            <form method="post" action="/app/settings/delete-account" onsubmit="return confirm('Schedule your account for deletion? You will be signed out, and everything is permanently removed in 30 days. Sign back in any time within 30 days to restore it.')">
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

    const location = trimOrNull(body.location)

    const updates: Parameters<typeof updateVendor>[2] = {
      business_name: businessName,
      category,
      phone: trimOrNull(body.phone),
      website: trimOrNull(body.website),
      instagram: trimOrNull(body.instagram),
      bio: trimOrNull(body.bio),
      location,
    }

    if (location && location !== vendor.location && c.env.GOOGLE_MAPS_API_KEY) {
      try {
        const geoRes = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${c.env.GOOGLE_MAPS_API_KEY}`
        )
        if (geoRes.ok) {
          const geoData = (await geoRes.json()) as { results?: Array<{ address_components?: Array<{ long_name: string; types: string[] }>; geometry?: { location?: { lat: number; lng: number } }; place_id?: string }> }
          const result = geoData.results?.[0]
          if (result) {
            const find = (type: string) => result.address_components?.find((c) => c.types.includes(type))?.long_name ?? null
            updates.location_city = find('locality') ?? find('administrative_area_level_2')
            updates.location_state = find('administrative_area_level_1')
            updates.location_country = find('country')
            updates.location_lat = result.geometry?.location?.lat ?? null
            updates.location_lng = result.geometry?.location?.lng ?? null
            updates.location_place_id = result.place_id ?? null
          }
        }
      } catch { /* geocoding is best-effort */ }
    }

    await updateVendor(c.env.DB, vendor.id, updates)

    await auditLog(c, 'settings_updated', 'vendor', vendor.id).catch(() => {})
    return c.redirect('/app/settings?saved=1')
  } catch (e: any) {
    return c.redirect(`/app/settings?error=${encodeURIComponent(e.message)}`)
  }
})

// ─── Invoicing settings ───

settings.post('/app/settings/invoicing', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()

  const taxLabel = trimOrNull(body.tax_label)
  const taxRate = Math.max(0, Math.min(50, parseFloat(String(body.tax_rate || '0')) || 0))
  const taxInclusive = body.tax_inclusive === '1' ? 1 : 0
  let taxNumber = trimOrNull(body.tax_number)
  if (taxNumber && taxLabel === 'GST') {
    const digits = taxNumber.replace(/\s/g, '')
    if (!/^\d{11}$/.test(digits)) {
      return c.redirect('/app/settings?error=' + encodeURIComponent('ABN must be exactly 11 digits'))
    }
    taxNumber = digits.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, '$1 $2 $3 $4')
  }
  const businessAddress = trimOrNull(body.business_address)
  const invoicePrefix = (typeof body.invoice_prefix === 'string' && body.invoice_prefix.trim())
    ? body.invoice_prefix.trim()
    : 'INV-'
  const nextInvoiceNumber = Math.max(1, parseInt(String(body.next_invoice_number || '1')) || 1)
  const cardFeeEnabled = body.card_fee_enabled === '1' ? 1 : 0
  const cardFeePercent = Math.max(0, Math.min(5, parseFloat(String(body.card_fee_percent || '0')) || 0))

  await updateVendor(c.env.DB, vendor.id, {
    tax_label: taxLabel,
    tax_rate: taxRate,
    tax_inclusive: taxInclusive,
    tax_number: taxNumber,
    business_address: businessAddress,
    invoice_prefix: invoicePrefix,
    next_invoice_number: nextInvoiceNumber,
    card_fee_enabled: cardFeeEnabled,
    card_fee_percent: cardFeePercent,
  })

  await auditLog(c, 'invoicing_settings_updated', 'vendor', vendor.id).catch(() => {})
  return c.redirect('/app/settings?saved=1')
})

// ─── Service templates ───

settings.post('/app/settings/service-templates', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody({ all: true })

  const names = Array.isArray(body.svc_name) ? body.svc_name : [body.svc_name]
  const descs = Array.isArray(body.svc_desc) ? body.svc_desc : [body.svc_desc]
  const prices = Array.isArray(body.svc_price) ? body.svc_price : [body.svc_price]

  const templates: ServiceTemplate[] = []
  for (let i = 0; i < names.length; i++) {
    const name = typeof names[i] === 'string' ? (names[i] as string).trim() : ''
    const desc = typeof descs[i] === 'string' ? (descs[i] as string).trim() : ''
    const price = parseFloat(String(prices[i] || '0'))
    if (name) {
      templates.push({
        name,
        description: desc || name,
        price_cents: Math.round(Math.max(0, price) * 100),
      })
    }
  }

  await updateVendor(c.env.DB, vendor.id, {
    service_templates: templates.length > 0 ? JSON.stringify(templates) : null,
  })

  return c.redirect('/app/settings?saved=1')
})

// ─── Invoice defaults ───

settings.post('/app/settings/invoice-defaults', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()

  const defaults: InvoiceDefaults = {
    booking_fee_type: body.default_fee_type === 'percentage' ? 'percentage' : 'fixed',
    booking_fee_value: parseFloat(String(body.default_fee_value || '0')) || 0,
    installments: Math.max(1, Math.min(6, parseInt(String(body.default_installments || '1')) || 1)),
    notes: typeof body.default_notes === 'string' ? body.default_notes.trim() : '',
    include_card_fee: body.default_card_fee === '1',
  }

  await updateVendor(c.env.DB, vendor.id, {
    invoice_defaults: JSON.stringify(defaults),
  })

  return c.redirect('/app/settings?saved=1')
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

// ─── Availability sharing ───

settings.post('/app/settings/availability-sharing', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()
  const sharing = String(body.availability_sharing ?? 'private')
  const valid = ['private', 'vendors_only', 'public', 'ai_reply'] as const
  const value = valid.includes(sharing as any) ? sharing as typeof valid[number] : 'private'

  // AI auto-reply is a Pro feature; other sharing modes are free.
  if (value === 'ai_reply' && !(await isProVendor(c.env.DB, vendor.id))) {
    return c.redirect('/app/settings?error=' + encodeURIComponent('AI auto-reply requires a Pro subscription'))
  }

  await updateVendor(c.env.DB, vendor.id, { availability_sharing: value })
  return c.redirect('/app/settings?saved=1')
})

// ─── Directory listing ───

settings.post('/app/settings/directory-listing', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()
  const listed = body.directory_listed === '1' ? 1 : 0

  await updateVendor(c.env.DB, vendor.id, { directory_listed: listed })
  return c.redirect('/app/settings?saved=1')
})

// ─── Logo / icon (square, cropped client-side, stored in R2) ───

settings.post('/app/settings/logo', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()
  const file = body.logo

  if (!file || !(file instanceof File) || file.size === 0) {
    return c.json({ error: 'No file uploaded' }, 400)
  }
  if (file.size > 5 * 1024 * 1024) {
    return c.json({ error: 'Image is too large (max 5MB)' }, 400)
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    return c.json({ error: 'Invalid file type' }, 400)
  }
  if (!c.env.STORAGE) {
    return c.json({ error: 'File storage not configured' }, 500)
  }

  const r2Key = `vendor-logos/${vendor.id}.png`
  await c.env.STORAGE.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type },
  })
  await updateVendor(c.env.DB, vendor.id, { logo_r2_key: r2Key })
  await auditLog(c, 'update_logo', 'vendor', vendor.id).catch(() => {})
  return c.json({ ok: true })
})

settings.post('/app/settings/logo/remove', async (c) => {
  const vendor = c.get('vendor')!
  if (vendor.logo_r2_key && c.env.STORAGE) {
    await c.env.STORAGE.delete(vendor.logo_r2_key).catch(() => {})
  }
  await updateVendor(c.env.DB, vendor.id, { logo_r2_key: null })
  return c.redirect('/app/settings?saved=1')
})

// ─── AI settings ───

settings.post('/app/settings/ai', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()
  const key = typeof body.anthropic_api_key === 'string' ? body.anthropic_api_key.trim() || null : null

  if (key) {
    const ref = await putVendorSecret(c.env.KV, vendor.id, 'anthropic_api_key', key)
    await updateVendor(c.env.DB, vendor.id, { anthropic_api_key: ref })
  } else {
    await deleteVendorSecret(c.env.KV, vendor.id, 'anthropic_api_key')
    await updateVendor(c.env.DB, vendor.id, { anthropic_api_key: null })
  }

  return c.redirect('/app/settings?saved=1')
})

// ─── Sync token ───

settings.post('/app/settings/generate-sync-token', async (c) => {
  const vendor = c.get('vendor')!
  // Device sync (CalDAV/CardDAV/iCal/vault) is a Pro feature.
  if (!(await isProVendor(c.env.DB, vendor.id))) {
    return c.redirect('/app/settings?error=' + encodeURIComponent('Device sync requires a Pro subscription'))
  }

  const { generateToken, sha256Hex } = await import('../../lib/crypto')

  // Generating always rotates: only the hash is stored, the raw token is
  // shown exactly once via a short-lived single-use KV stash.
  const token = await generateToken(16)
  await updateVendor(c.env.DB, vendor.id, { ical_token: `sha256:${await sha256Hex(token)}` })

  const revealId = await generateToken(16)
  await c.env.KV.put(`token_reveal:${vendor.id}:${revealId}`, token, { expirationTtl: 300 })

  await auditLog(
    c,
    vendor.ical_token ? 'sync_token_rotated' : 'sync_token_generated',
    'vendor',
    vendor.id
  ).catch(() => {})

  return c.redirect(`/app/settings?reveal=${revealId}`)
})

settings.post('/app/settings/revoke-sync-token', async (c) => {
  const vendor = c.get('vendor')!
  await updateVendor(c.env.DB, vendor.id, { ical_token: null })
  await auditLog(c, 'sync_token_revoked', 'vendor', vendor.id).catch(() => {})
  return c.redirect('/app/settings?saved=1')
})

// ─── GitHub sync ───

settings.post('/app/settings/github/connect', async (c) => {
  const vendor = c.get('vendor')!
  // GitHub sync is a Pro feature.
  if (!(await isProVendor(c.env.DB, vendor.id))) {
    return c.redirect('/app/settings?error=' + encodeURIComponent('GitHub sync requires a Pro subscription'))
  }
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

    const tokenRef = await putVendorSecret(c.env.KV, vendor.id, 'github_access_token', token)

    // Register a push webhook for instant pull of external edits.
    // Needs hook permission on the token — when missing, the 5-minute
    // background sync still picks changes up.
    const webhookActive = await registerGitHubWebhook(c.env, vendor.id, token, repoFullName)

    // Save the config
    const config = JSON.stringify({
      type: 'git',
      git_provider: 'github',
      git_repo: repoFullName,
      git_branch: 'main',
      git_path: '',
      git_access_token_ref: tokenRef,
      git_webhook_active: webhookActive,
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

  await deleteVendorSecret(c.env.KV, vendor.id, 'github_access_token')
  await deleteVendorSecret(c.env.KV, vendor.id, 'github_webhook_secret')

  await updateVendor(c.env.DB, vendor.id, {
    storage_type: 'r2',
    storage_config: null,
  })

  await auditLog(c, 'github_disconnected', 'vendor', vendor.id).catch(() => {})
  return c.redirect('/app/settings?saved=1')
})

settings.post('/app/settings/github/sync', async (c) => {
  const vendor = c.get('vendor')!
  // GitHub sync is a Pro feature.
  if (!(await isProVendor(c.env.DB, vendor.id))) {
    return c.redirect('/app/settings?error=' + encodeURIComponent('GitHub sync requires a Pro subscription'))
  }

  let config: { git_repo?: string; git_access_token?: string; git_access_token_ref?: string } | null = null
  if (vendor.storage_config) {
    try { config = JSON.parse(vendor.storage_config) } catch { /* ignore */ }
  }

  const token = await resolveSecret(c.env.KV, config?.git_access_token_ref ?? config?.git_access_token)
  if (!config?.git_repo || !token) {
    return c.redirect('/app/settings?error=GitHub+is+not+connected')
  }

  try {
    // Re-attempt webhook registration — picks up token permission changes
    const webhookActive = await registerGitHubWebhook(c.env, vendor.id, token, config.git_repo)
    if (vendor.storage_config) {
      try {
        const fullConfig = JSON.parse(vendor.storage_config)
        if (fullConfig.git_webhook_active !== webhookActive) {
          fullConfig.git_webhook_active = webhookActive
          await updateVendor(c.env.DB, vendor.id, { storage_config: JSON.stringify(fullConfig) })
        }
      } catch { /* leave config as-is */ }
    }

    const result = await initialGitHubSync(c.env.DB, vendor, token, config.git_repo)
    return c.redirect(`/app/settings?saved=1&synced=${result.pushed}`)
  } catch (err: any) {
    console.error('[github] sync error:', err)
    return c.redirect(`/app/settings?error=${encodeURIComponent('Sync failed: ' + (err.message || 'unknown error'))}`)
  }
})

/**
 * Generate (or reuse) the per-vendor webhook secret and make sure the
 * repo has a push webhook pointing at /webhooks/github. Returns whether
 * the webhook is in place.
 */
async function registerGitHubWebhook(
  env: Env['Bindings'],
  vendorId: string,
  token: string,
  repo: string
): Promise<boolean> {
  try {
    const { vendorSecretKey } = await import('../../services/secrets')
    let secret = await env.KV.get(vendorSecretKey(vendorId, 'github_webhook_secret'))
    if (!secret) {
      const bytes = new Uint8Array(32)
      crypto.getRandomValues(bytes)
      secret = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
      await putVendorSecret(env.KV, vendorId, 'github_webhook_secret', secret)
    }
    return await ensureGitHubWebhook(token, repo, `${env.APP_URL}/webhooks/github`, secret)
  } catch (err) {
    console.error('[github] webhook registration failed:', err)
    return false
  }
}

/**
 * Full reconciliation against a GitHub repo: pull external edits in,
 * then push all contacts and weddings (wedding.md, todo.md, log.md) out.
 * Runs when a user first connects and via the "Sync all files now" button.
 */
async function initialGitHubSync(
  db: D1Database,
  vendor: VendorProfile,
  token: string,
  repo: string
): Promise<{ pushed: number; skipped: number }> {
  const { GitHubStorageBackend } = await import('../../storage/github')
  const { contactToMarkdown } = await import('../../storage/contacts')
  const { cleanupLegacyWeddingFile } = await import('../../storage/weddings')
  const { serializeMarkdown } = await import('../../storage/markdown')
  const { contactFilename } = await import('../../storage/slug')
  const { pushWeddingFiles } = await import('../../services/storage-push')
  const { syncVendor } = await import('../../storage/sync')

  const github = new GitHubStorageBackend({ token, repo, branch: 'main', path: '' })

  // Clean up boilerplate files (Obsidian Welcome.md, GitHub README.md)
  for (const junkFile of ['Welcome.md', 'README.md']) {
    try {
      const exists = await github.head(junkFile)
      if (exists) {
        await github.delete(junkFile)
        console.log(`[github-sync] Deleted ${junkFile} from repo`)
      }
    } catch { /* ignore — file might not exist or delete might fail */ }
  }

  // Pull external edits first so the push below doesn't fight them
  try {
    await syncVendor(github, db, vendor.id)
  } catch (err) {
    console.error('[github-sync] Pull phase failed:', err)
  }

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
      await pushWeddingFiles(db, github, vendor.id, w)
      await cleanupLegacyWeddingFile(github, w).catch(() => false)
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
      vendor_profile: redactedVendorProfile(vendor),
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
      const dateSlug = w.date ? `${w.date}-` : ''
      lines.push(`FILE: weddings/${dateSlug}${slugify(w.title || 'untitled', '')}/wedding.md`)
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

  await auditLog(c, 'account_delete_scheduled', 'user', user.id).catch(() => {})
  // Soft-delete: 30-day grace, logged out everywhere. Signing back in restores it.
  await softDeleteAccount(c.env, user)

  deleteCookie(c, 'wc_session', { path: '/' })
  return c.redirect('/login?deleted=1')
})

export default settings

function ProBadge() {
  return (
    <span class="align-middle inline-block bg-horizon-100 text-horizon-700 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded">Pro</span>
  )
}

function ProUpsell({ feature }: { feature: string }) {
  return (
    <div class="bg-horizon-50 border border-horizon-600/20 rounded-xl p-4">
      <p class="text-sm text-gray-700 mb-2">
        <strong>{feature}</strong> is a Pro feature.
      </p>
      <a href="/app/subscription" class="inline-block bg-horizon-600 text-white py-2 px-4 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
        Upgrade to Pro
      </a>
    </div>
  )
}

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

function ServiceTemplatesEditor({ vendor, csrfToken }: { vendor: VendorProfile; csrfToken: string }) {
  let templates: ServiceTemplate[] = []
  if (vendor.service_templates) {
    try { templates = JSON.parse(vendor.service_templates) } catch { /* ignore */ }
  }

  return (
    <div class="mt-6">
      <form method="post" action="/app/settings/service-templates">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
          <div>
            <h3 class="text-sm font-bold">Service catalogue</h3>
            <p class="text-xs text-gray-500 mt-0.5">
              Pre-defined services you can quickly add to invoices. They pre-fill description and price but can be edited per-invoice.
            </p>
          </div>

          <div id="svc-templates" class="space-y-3">
            {templates.length > 0 ? templates.map((t, i) => (
              <ServiceTemplateRow index={i} name={t.name} desc={t.description} price={t.price_cents / 100} />
            )) : (
              <ServiceTemplateRow index={0} />
            )}
          </div>

          <button type="button" id="add-svc-btn"
            class="text-sm text-horizon-600 font-bold hover:text-horizon-700">
            + Add service
          </button>

          <div>
            <button type="submit"
              class="bg-horizon-600 text-white px-5 py-2 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
              Save services
            </button>
          </div>
        </div>
      </form>

      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          let svcCount = ${Math.max(templates.length, 1)};
          document.getElementById('add-svc-btn').addEventListener('click', function() {
            const container = document.getElementById('svc-templates');
            const idx = svcCount++;
            const div = document.createElement('div');
            div.className = 'grid grid-cols-12 gap-2 items-end';
            div.innerHTML = '<div class="col-span-4"><input type="text" name="svc_name" placeholder="Service name" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" /></div><div class="col-span-4"><input type="text" name="svc_desc" placeholder="Description on invoice" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" /></div><div class="col-span-3"><input type="number" name="svc_price" min="0" step="0.01" placeholder="Price ($)" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" /></div><div class="col-span-1"><button type="button" onclick="this.closest(\\'.grid\\').remove()" class="text-gray-400 hover:text-grapefruit-700 text-sm p-2">✕</button></div>';
            container.appendChild(div);
          });
        })();
      ` }} />
    </div>
  )
}

function ServiceTemplateRow({ index, name, desc, price }: { index: number; name?: string; desc?: string; price?: number }) {
  return (
    <div class="grid grid-cols-12 gap-2 items-end">
      <div class="col-span-4">
        {index === 0 && <label class="block text-xs text-gray-500 mb-1">Name</label>}
        <input type="text" name="svc_name" value={name ?? ''} placeholder="e.g. Wedding Ceremony"
          class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
      </div>
      <div class="col-span-4">
        {index === 0 && <label class="block text-xs text-gray-500 mb-1">Invoice description</label>}
        <input type="text" name="svc_desc" value={desc ?? ''} placeholder="Description on invoice"
          class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
      </div>
      <div class="col-span-3">
        {index === 0 && <label class="block text-xs text-gray-500 mb-1">Price ($)</label>}
        <input type="number" name="svc_price" min="0" step="0.01" value={price ? String(price) : ''} placeholder="0.00"
          class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
      </div>
      <div class="col-span-1">
        {index > 0 && (
          <button type="button" onclick="this.closest('.grid').remove()"
            class="text-gray-400 hover:text-grapefruit-700 text-sm p-2">✕</button>
        )}
      </div>
    </div>
  )
}

function InvoiceDefaultsEditor({ vendor, csrfToken }: { vendor: VendorProfile; csrfToken: string }) {
  let defaults: Partial<InvoiceDefaults> = {}
  if (vendor.invoice_defaults) {
    try { defaults = JSON.parse(vendor.invoice_defaults) } catch { /* ignore */ }
  }

  return (
    <div class="mt-6">
      <form method="post" action="/app/settings/invoice-defaults">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
          <div>
            <h3 class="text-sm font-bold">Invoice defaults</h3>
            <p class="text-xs text-gray-500 mt-0.5">
              Pre-fill these values when creating a new invoice. You can always change them per-invoice.
            </p>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1" for="default_fee_type">Default booking fee type</label>
              <select id="default_fee_type" name="default_fee_type"
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600">
                <option value="fixed" selected={defaults.booking_fee_type !== 'percentage'}>Fixed amount</option>
                <option value="percentage" selected={defaults.booking_fee_type === 'percentage'}>Percentage</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1" for="default_fee_value">Default booking fee</label>
              <input type="number" id="default_fee_value" name="default_fee_value" min="0" step="1"
                value={defaults.booking_fee_value ? String(defaults.booking_fee_value) : ''} placeholder="e.g. 500 or 20"
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
              <p class="text-xs text-gray-400 mt-1">Dollars for fixed, whole number for %</p>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1" for="default_installments">Default installments</label>
              <select id="default_installments" name="default_installments"
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600">
                <option value="1" selected={!defaults.installments || defaults.installments === 1}>1 (final payment)</option>
                <option value="2" selected={defaults.installments === 2}>2 payments</option>
                <option value="3" selected={defaults.installments === 3}>3 payments</option>
                <option value="4" selected={defaults.installments === 4}>4 payments</option>
                <option value="6" selected={defaults.installments === 6}>6 payments</option>
              </select>
            </div>
            {vendor.card_fee_enabled && vendor.card_fee_percent > 0 && (
              <div class="flex items-end pb-1">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" name="default_card_fee" value="1" checked={!!defaults.include_card_fee}
                    class="w-4 h-4 rounded border-gray-300 text-horizon-600 focus:ring-horizon-600" />
                  <span class="text-sm text-gray-700">Apply card fee by default</span>
                </label>
              </div>
            )}
          </div>

          <div>
            <label class="block text-xs font-bold text-gray-700 mb-1" for="default_notes">Default invoice notes</label>
            <textarea id="default_notes" name="default_notes" rows={3} placeholder="Payment terms, conditions, etc."
              class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600">{defaults.notes ?? ''}</textarea>
          </div>

          <div>
            <button type="submit"
              class="bg-horizon-600 text-white px-5 py-2 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
              Save defaults
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
