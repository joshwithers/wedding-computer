import { Hono } from 'hono'
import type { Env, QuoteCalculator, QuoteCalculatorConfig } from '../../types'
import { SharedHead } from '../../views/head'
import { createContact } from '../../storage/contacts'
import { getStorageWithSecrets } from '../../storage'
import { getVendorById } from '../../db/vendors'
import { createActivity } from '../../db/activities'
import { track } from '../../services/analytics'
import { rateLimit } from '../../middleware/rate-limit'
import { sanitize, isValidEmail } from '../../lib/validation'
import { verifyTurnstile } from '../../services/turnstile'

const quote = new Hono<Env>()

// ─── GET /quote/:token — Render calculator ───

quote.get('/quote/:token', async (c) => {
  const token = c.req.param('token')
  const calc = await c.env.DB
    .prepare('SELECT * FROM quote_calculators WHERE public_token = ? AND is_active = 1')
    .bind(token)
    .first<QuoteCalculator>()

  if (!calc) {
    return c.html(
      <QuoteShell title="Not Found">
        <div class="text-center py-12">
          <p class="text-gray-500 text-sm">This quote calculator is no longer available.</p>
        </div>
      </QuoteShell>,
      404,
    )
  }

  const config: QuoteCalculatorConfig = JSON.parse(calc.config)

  return c.html(
    <QuoteShell title={calc.title}>
      <Calculator
        calc={calc}
        config={config}
        token={token}
        siteKey={c.env.TURNSTILE_SITE_KEY}
      />
    </QuoteShell>,
    200,
    { 'X-Frame-Options': 'ALLOWALL' },
  )
})

// ─── POST /quote/:token/enquire — Submit enquiry ───

quote.post('/quote/:token/enquire', rateLimit(10, 60), async (c) => {
  const token = c.req.param('token')
  const calc = await c.env.DB
    .prepare('SELECT * FROM quote_calculators WHERE public_token = ? AND is_active = 1')
    .bind(token)
    .first<QuoteCalculator>()

  if (!calc) return c.text('Not found', 404)

  const vendor = await getVendorById(c.env.DB, calc.vendor_id)
  if (!vendor) return c.text('Not found', 404)

  const body = await c.req.parseBody()

  // Honeypot
  if (body.website_url) {
    return c.html(
      <QuoteShell title={calc.title}>
        <ThankYou title={calc.title} />
      </QuoteShell>,
      200,
      { 'X-Frame-Options': 'ALLOWALL' },
    )
  }

  // Turnstile verification
  const turnstileToken = typeof body['cf-turnstile-response'] === 'string'
    ? body['cf-turnstile-response']
    : ''
  const ip = c.req.header('cf-connecting-ip') ?? null

  const turnstileOk = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, turnstileToken, ip)
  if (!turnstileOk) {
    const config: QuoteCalculatorConfig = JSON.parse(calc.config)
    return c.html(
      <QuoteShell title={calc.title}>
        <Calculator
          calc={calc}
          config={config}
          token={token}
          siteKey={c.env.TURNSTILE_SITE_KEY}
          error="Verification failed. Please try again."
        />
      </QuoteShell>,
      200,
      { 'X-Frame-Options': 'ALLOWALL' },
    )
  }

  const name = sanitize(String(body.name ?? '').trim())
  const email = String(body.email ?? '').trim()
  const weddingDate = sanitize(String(body.wedding_date ?? '').trim())
  const message = sanitize(String(body.message ?? '').trim())
  const selectedOptions = sanitize(String(body.selected_options ?? '').trim())

  if (!name || !email || !isValidEmail(email)) {
    const config: QuoteCalculatorConfig = JSON.parse(calc.config)
    return c.html(
      <QuoteShell title={calc.title}>
        <Calculator
          calc={calc}
          config={config}
          token={token}
          siteKey={c.env.TURNSTILE_SITE_KEY}
          error="Name and a valid email are required."
        />
      </QuoteShell>,
      200,
      { 'X-Frame-Options': 'ALLOWALL' },
    )
  }

  // Split name into first/last
  const parts = name.split(/\s+/)
  const firstName = parts[0] || name
  const lastName = parts.slice(1).join(' ') || ''

  const formData = JSON.stringify({
    source: 'quote_calculator',
    calculator_title: calc.title,
    selected_options: selectedOptions,
    message,
  })

  try {
    const storage = await getStorageWithSecrets(c.env, vendor)
    const contact = await createContact(storage, c.env.DB, vendor.id, {
      first_name: firstName,
      last_name: lastName,
      email,
      wedding_date: weddingDate || null,
      source: 'quote_calculator',
      notes: message || null,
      form_data: formData,
    })

    await createActivity(c.env.DB, contact.id, 'lead', `Enquiry submitted via quote calculator: ${calc.title}`)

    track(c.env.DB, vendor.id, 'enquiry_received', {
      contactId: contact.id,
      metadata: { source: 'quote_calculator' },
    })

    await c.env.EMAIL_QUEUE.send({
      type: 'new_lead',
      vendorId: vendor.id,
      contactId: contact.id,
    })
  } catch (e: any) {
    console.error('[quote] Contact creation failed', e.message)
  }

  return c.html(
    <QuoteShell title={calc.title}>
      <ThankYou title={calc.title} />
    </QuoteShell>,
    200,
    { 'X-Frame-Options': 'ALLOWALL' },
  )
})

export default quote

// ─── Components ───

function QuoteShell({ title, children }: { title: string; children: any }) {
  return (
    <html lang="en">
      <head>
        <SharedHead title={title} />
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
      </head>
      <body class="bg-white text-gray-900 antialiased font-sans">
        <div class="max-w-lg mx-auto px-4 py-6 sm:py-8">
          {children}
        </div>
        <footer class="text-center py-4 border-t border-gray-100 mt-8">
          <a
            href="https://wedding.computer"
            class="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            target="_blank"
            rel="noopener"
          >
            Powered by Wedding Computer
          </a>
        </footer>
      </body>
    </html>
  )
}

function Calculator({
  calc,
  config,
  token,
  siteKey,
  error,
}: {
  calc: QuoteCalculator
  config: QuoteCalculatorConfig
  token: string
  siteKey: string
  error?: string
}) {
  const currency = config.currency?.toUpperCase() || 'AUD'
  const formatPrice = (cents: number) => {
    const dollars = (cents / 100).toFixed(2)
    return `$${dollars}`
  }

  // Group options by type for radio (upgrade) grouping
  const addons = config.options.filter((o) => o.type === 'addon')
  const upgrades = config.options.filter((o) => o.type === 'upgrade')
  const hourly = config.options.filter((o) => o.type === 'hourly')

  return (
    <div>
      <h1 class="text-xl font-bold mb-1">{calc.title}</h1>
      {calc.description && (
        <p class="text-sm text-gray-500 mb-4">{calc.description}</p>
      )}

      {error && (
        <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-3 mb-4">
          {error}
        </div>
      )}

      <div class="bg-gray-50 rounded-2xl p-5">
        {/* Base price */}
        <div class="flex items-center justify-between mb-4 pb-3 border-b border-gray-200">
          <span class="font-medium text-sm">Base price</span>
          <span class="font-bold text-sm">{formatPrice(config.base_price_cents)} {currency}</span>
        </div>

        {/* Addon options (checkboxes) */}
        {addons.length > 0 && (
          <div class="mb-4">
            <p class="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Add-ons</p>
            {addons.map((opt, i) => (
              <label class="flex items-start gap-3 py-2 cursor-pointer" key={`addon-${i}`}>
                <input
                  type="checkbox"
                  class="mt-0.5 rounded border-gray-300 text-horizon-600 focus:ring-horizon-600"
                  data-type="addon"
                  data-price={opt.price_cents}
                  data-name={opt.name}
                  onchange="updateTotal()"
                />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-medium">{opt.name}</span>
                    <span class="text-sm text-gray-600 ml-2 shrink-0">+{formatPrice(opt.price_cents)}</span>
                  </div>
                  {opt.description && (
                    <p class="text-xs text-gray-400 mt-0.5">{opt.description}</p>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}

        {/* Upgrade options (radio buttons) */}
        {upgrades.length > 0 && (
          <div class="mb-4">
            <p class="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Upgrades</p>
            <label class="flex items-start gap-3 py-2 cursor-pointer">
              <input
                type="radio"
                name="upgrade"
                class="mt-0.5 border-gray-300 text-horizon-600 focus:ring-horizon-600"
                data-type="upgrade"
                data-price="0"
                data-name="None"
                checked
                onchange="updateTotal()"
              />
              <span class="text-sm font-medium text-gray-500">No upgrade</span>
            </label>
            {upgrades.map((opt, i) => (
              <label class="flex items-start gap-3 py-2 cursor-pointer" key={`upgrade-${i}`}>
                <input
                  type="radio"
                  name="upgrade"
                  class="mt-0.5 border-gray-300 text-horizon-600 focus:ring-horizon-600"
                  data-type="upgrade"
                  data-price={opt.price_cents}
                  data-name={opt.name}
                  onchange="updateTotal()"
                />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-medium">{opt.name}</span>
                    <span class="text-sm text-gray-600 ml-2 shrink-0">+{formatPrice(opt.price_cents)}</span>
                  </div>
                  {opt.description && (
                    <p class="text-xs text-gray-400 mt-0.5">{opt.description}</p>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}

        {/* Hourly options (number inputs) */}
        {hourly.length > 0 && (
          <div class="mb-4">
            <p class="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Hourly rates</p>
            {hourly.map((opt, i) => (
              <div class="flex items-center gap-3 py-2" key={`hourly-${i}`}>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-medium">{opt.name}</span>
                    <span class="text-sm text-gray-600 ml-2 shrink-0">{formatPrice(opt.price_cents)}/hr</span>
                  </div>
                  {opt.description && (
                    <p class="text-xs text-gray-400 mt-0.5">{opt.description}</p>
                  )}
                </div>
                <input
                  type="number"
                  min="0"
                  max="24"
                  value="0"
                  class="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
                  data-type="hourly"
                  data-price={opt.price_cents}
                  data-name={opt.name}
                  onchange="updateTotal()"
                  oninput="updateTotal()"
                />
              </div>
            ))}
          </div>
        )}

        {/* Total */}
        <div class="flex items-center justify-between pt-3 border-t border-gray-200 mt-2">
          <span class="font-bold">Estimated total</span>
          <span class="text-lg font-bold text-horizon-700" id="quote-total">
            {formatPrice(config.base_price_cents)} {currency}
          </span>
        </div>
      </div>

      {/* Enquiry form */}
      <div class="mt-6 pt-6 border-t border-gray-100">
        <h2 class="text-base font-bold mb-3">Interested? Send an enquiry</h2>
        <form method="post" action={`/quote/${token}/enquire`}>
          {/* Honeypot */}
          <div style="position:absolute;left:-9999px" aria-hidden="true">
            <input type="text" name="website_url" tabindex={-1} autocomplete="off" />
          </div>

          <div class="space-y-3">
            <input
              type="text"
              name="name"
              placeholder="Your name"
              required
              class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            />
            <input
              type="email"
              name="email"
              placeholder="Email address"
              required
              class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            />
            <input
              type="date"
              name="wedding_date"
              class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            />
            <textarea
              name="message"
              rows={3}
              placeholder="Tell us about your wedding..."
              class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent resize-none"
            />
            {/* Hidden field to capture selected options */}
            <input type="hidden" name="selected_options" id="selected-options" />

            <div class="cf-turnstile" data-sitekey={siteKey} data-theme="light" />

            <button
              type="submit"
              onclick="captureSelections()"
              class="w-full bg-horizon-600 text-white py-3 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Send enquiry
            </button>
          </div>
        </form>
      </div>

      {/* Client-side total calculation */}
      <script dangerouslySetInnerHTML={{ __html: `
        var basePrice = ${config.base_price_cents};
        var currency = '${currency}';
        function formatCents(cents) {
          return '$' + (cents / 100).toFixed(2);
        }
        function updateTotal() {
          var total = basePrice;
          // Addons (checkboxes)
          document.querySelectorAll('input[data-type="addon"]:checked').forEach(function(el) {
            total += parseInt(el.dataset.price, 10);
          });
          // Upgrades (radio)
          var selectedUpgrade = document.querySelector('input[data-type="upgrade"]:checked');
          if (selectedUpgrade) {
            total += parseInt(selectedUpgrade.dataset.price, 10);
          }
          // Hourly (number inputs)
          document.querySelectorAll('input[data-type="hourly"]').forEach(function(el) {
            var hours = parseInt(el.value, 10) || 0;
            total += hours * parseInt(el.dataset.price, 10);
          });
          document.getElementById('quote-total').textContent = formatCents(total) + ' ' + currency;
        }
        function captureSelections() {
          var selections = [];
          document.querySelectorAll('input[data-type="addon"]:checked').forEach(function(el) {
            selections.push(el.dataset.name);
          });
          var upgrade = document.querySelector('input[data-type="upgrade"]:checked');
          if (upgrade && upgrade.dataset.name !== 'None') {
            selections.push('Upgrade: ' + upgrade.dataset.name);
          }
          document.querySelectorAll('input[data-type="hourly"]').forEach(function(el) {
            var hours = parseInt(el.value, 10) || 0;
            if (hours > 0) selections.push(el.dataset.name + ': ' + hours + 'hrs');
          });
          document.getElementById('selected-options').value = selections.join(', ');
        }
      ` }} />
    </div>
  )
}

function ThankYou({ title }: { title: string }) {
  return (
    <div class="text-center py-12">
      <div class="text-4xl mb-4">&#10003;</div>
      <h2 class="text-xl font-bold mb-2">Enquiry sent</h2>
      <p class="text-sm text-gray-500">
        Thanks for your interest. We'll be in touch soon.
      </p>
    </div>
  )
}
