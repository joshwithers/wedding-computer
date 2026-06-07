import { Hono } from 'hono'
import type { Env, QuoteCalculator, QuoteCalculatorConfig, QuoteOption } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import {
  listQuoteCalculators,
  getQuoteCalculator,
  createQuoteCalculator,
  updateQuoteCalculator,
  deleteQuoteCalculator,
} from '../../db/quotes'
import { requireString, trimOrNull } from '../../lib/validation'

const quotes = new Hono<Env>()

quotes.use('/app/*', requireAuth, csrf, requireVendor)

const CURRENCIES = ['AUD', 'USD', 'GBP', 'EUR', 'NZD']
const OPTION_TYPES: QuoteOption['type'][] = ['addon', 'upgrade', 'hourly']

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

function parseDollars(val: unknown): number {
  if (typeof val !== 'string') return 0
  const n = parseFloat(val)
  return isNaN(n) ? 0 : Math.round(n * 100)
}

function parseConfig(body: Record<string, string | File>): QuoteCalculatorConfig {
  const base_price_cents = parseDollars(body.base_price)
  const currency = typeof body.currency === 'string' && CURRENCIES.includes(body.currency)
    ? body.currency
    : 'AUD'

  const options: QuoteOption[] = []
  let i = 0
  while (typeof body[`option_name_${i}`] === 'string') {
    const name = (body[`option_name_${i}`] as string).trim()
    if (name) {
      options.push({
        name,
        description: trimOrNull(body[`option_desc_${i}`]) ?? undefined,
        price_cents: parseDollars(body[`option_price_${i}`]),
        type: OPTION_TYPES.includes(body[`option_type_${i}`] as QuoteOption['type'])
          ? (body[`option_type_${i}`] as QuoteOption['type'])
          : 'addon',
      })
    }
    i++
  }

  return { base_price_cents, currency, options }
}

// ─── Option row partial (htmx) ───

function OptionRow({ index, option }: { index: number; option?: QuoteOption }) {
  const inputClass = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent'
  return (
    <div class="border border-gray-200 rounded-xl p-4 space-y-3 bg-white" id={`option-row-${index}`}>
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">Option {index + 1}</span>
        <button
          type="button"
          class="text-xs text-grapefruit-600 hover:text-grapefruit-700 font-bold"
          onclick={`document.getElementById('option-row-${index}').remove()`}
        >
          Remove
        </button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1">Name</label>
          <input type="text" name={`option_name_${index}`} value={option?.name ?? ''} class={inputClass} placeholder="e.g. Extra hour" required />
        </div>
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1">Price ($)</label>
          <input type="number" name={`option_price_${index}`} value={option ? formatCents(option.price_cents) : ''} class={inputClass} step="0.01" min="0" placeholder="0.00" />
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1">Type</label>
          <select name={`option_type_${index}`} class={inputClass}>
            <option value="addon" selected={option?.type === 'addon'}>Add-on</option>
            <option value="upgrade" selected={option?.type === 'upgrade'}>Upgrade</option>
            <option value="hourly" selected={option?.type === 'hourly'}>Hourly</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1">Description</label>
          <input type="text" name={`option_desc_${index}`} value={option?.description ?? ''} class={inputClass} placeholder="Optional" />
        </div>
      </div>
    </div>
  )
}

// ─── List ───

quotes.get('/app/quotes', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const list = await listQuoteCalculators(c.env.DB, vendor.id)

  return c.html(
    <AppLayout title="Quote Calculators" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-4xl">
        <div class="flex items-center justify-between mb-6">
          <p class="text-sm text-gray-500">
            {list.length} calculator{list.length !== 1 ? 's' : ''}
          </p>
          <a
            href="/app/quotes/new"
            class="bg-horizon-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            New calculator
          </a>
        </div>

        {list.length === 0 ? (
          <div class="bg-white rounded-2xl border border-gray-200 p-8 text-center">
            <p class="text-gray-500 text-sm mb-4">
              No quote calculators yet. Create one to let clients estimate costs on your website.
            </p>
            <a href="/app/quotes/new" class="text-horizon-600 text-sm font-bold hover:text-horizon-700">
              Create your first calculator
            </a>
          </div>
        ) : (
          <div class="space-y-3">
            {list.map((calc) => {
              const config: QuoteCalculatorConfig = JSON.parse(calc.config || '{}')
              return (
                <a href={`/app/quotes/${calc.id}`} class="block bg-white rounded-2xl border border-gray-200 p-5 hover:border-horizon-600/30 transition-colors">
                  <div class="flex items-center justify-between gap-4">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <h3 class="font-bold text-gray-900 truncate">{calc.title}</h3>
                        <span class={`text-xs font-bold px-2 py-0.5 rounded-full ${calc.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {calc.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p class="text-sm text-gray-500 mt-1">
                        Base: ${formatCents(config.base_price_cents || 0)} {config.currency || 'AUD'}
                        {' '}&middot;{' '}
                        {(config.options || []).length} option{(config.options || []).length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    {calc.public_token && (
                      <button
                        type="button"
                        class="shrink-0 text-xs font-bold text-horizon-600 hover:text-horizon-700 bg-horizon-600/5 px-3 py-1.5 rounded-lg"
                        onclick={`event.preventDefault();navigator.clipboard.writeText(window.location.origin+'/quote/${calc.public_token}');this.textContent='Copied!'`}
                      >
                        Copy link
                      </button>
                    )}
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </div>
    </AppLayout>
  )
})

// ─── New form ───

quotes.get('/app/quotes/new', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const inputClass = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent'

  return c.html(
    <AppLayout title="New Quote Calculator" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 class="text-xl font-bold">New quote calculator</h1>
          <p class="text-sm text-gray-500 mt-1">
            Create an interactive pricing calculator that clients can use to estimate costs.
          </p>
        </div>

        <form method="post" action="/app/quotes" class="space-y-6">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-1.5" for="title">Title</label>
            <input type="text" id="title" name="title" class={inputClass} placeholder="e.g. Wedding Photography Quote" required />
          </div>

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-1.5" for="description">Description</label>
            <textarea id="description" name="description" rows={3} class={inputClass} placeholder="A short description shown to clients (optional)" />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="base_price">Base price ($)</label>
              <input type="number" id="base_price" name="base_price" class={inputClass} step="0.01" min="0" placeholder="0.00" required />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="currency">Currency</label>
              <select id="currency" name="currency" class={inputClass}>
                {CURRENCIES.map((cur) => (
                  <option value={cur} selected={cur === 'AUD'}>{cur}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-3">
              <label class="text-sm font-bold text-gray-700">Options</label>
              <button
                type="button"
                class="text-sm font-bold text-horizon-600 hover:text-horizon-700"
                hx-get="/app/quotes/option-row"
                hx-target="#options-list"
                hx-swap="beforeend"
              >
                + Add option
              </button>
            </div>
            <div id="options-list" class="space-y-3">
              <OptionRow index={0} />
            </div>
          </div>

          <div class="flex items-center gap-3">
            <button type="submit" class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
              Create calculator
            </button>
            <a href="/app/quotes" class="text-sm text-gray-500 hover:text-gray-700">Cancel</a>
          </div>
        </form>
      </div>
    </AppLayout>
  )
})

// ─── htmx: add option row ───

quotes.get('/app/quotes/option-row', async (c) => {
  const index = parseInt(c.req.query('index') ?? '0', 10) || Date.now()
  return c.html(<OptionRow index={index} />)
})

// ─── Create ───

quotes.post('/app/quotes', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()
  const title = requireString(body.title, 'Title')
  const description = trimOrNull(body.description)
  const config = parseConfig(body as Record<string, string | File>)

  await createQuoteCalculator(c.env.DB, {
    vendor_id: vendor.id,
    title,
    description,
    config: JSON.stringify(config),
  })

  return c.redirect('/app/quotes')
})

// ─── Edit form ───

quotes.get('/app/quotes/:id', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const calc = await getQuoteCalculator(c.env.DB, c.req.param('id'), vendor.id)
  if (!calc) return c.redirect('/app/quotes')

  const config: QuoteCalculatorConfig = JSON.parse(calc.config || '{}')
  const options = config.options || []
  const inputClass = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent'

  return c.html(
    <AppLayout title={`Edit: ${calc.title}`} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-3xl mx-auto space-y-6">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-xl font-bold">{calc.title}</h1>
            <p class="text-sm text-gray-500 mt-1">
              {calc.is_active ? 'Active' : 'Inactive'}
              {calc.public_token && (
                <span>
                  {' '}&middot;{' '}
                  <button
                    type="button"
                    class="text-horizon-600 hover:text-horizon-700 font-bold"
                    onclick={`navigator.clipboard.writeText(window.location.origin+'/quote/${calc.public_token}');this.textContent='Copied!'`}
                  >
                    Copy public link
                  </button>
                </span>
              )}
            </p>
          </div>
          <form method="post" action={`/app/quotes/${calc.id}/delete`}>
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <button type="submit" class="text-sm font-bold text-grapefruit-600 hover:text-grapefruit-700" onclick="return confirm('Delete this calculator?')">
              Delete
            </button>
          </form>
        </div>

        <form method="post" action={`/app/quotes/${calc.id}`} class="space-y-6">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-1.5" for="title">Title</label>
            <input type="text" id="title" name="title" value={calc.title} class={inputClass} required />
          </div>

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-1.5" for="description">Description</label>
            <textarea id="description" name="description" rows={3} class={inputClass}>{calc.description ?? ''}</textarea>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="base_price">Base price ($)</label>
              <input type="number" id="base_price" name="base_price" value={formatCents(config.base_price_cents || 0)} class={inputClass} step="0.01" min="0" required />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1.5" for="currency">Currency</label>
              <select id="currency" name="currency" class={inputClass}>
                {CURRENCIES.map((cur) => (
                  <option value={cur} selected={cur === (config.currency || 'AUD')}>{cur}</option>
                ))}
              </select>
            </div>
          </div>

          <div class="flex items-center gap-4">
            <label class="text-sm font-bold text-gray-700">Status</label>
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_active" value="1" checked={!!calc.is_active} class="rounded border-gray-300" />
              Active (visible to clients)
            </label>
          </div>

          <div>
            <div class="flex items-center justify-between mb-3">
              <label class="text-sm font-bold text-gray-700">Options</label>
              <button
                type="button"
                class="text-sm font-bold text-horizon-600 hover:text-horizon-700"
                hx-get="/app/quotes/option-row"
                hx-target="#options-list"
                hx-swap="beforeend"
              >
                + Add option
              </button>
            </div>
            <div id="options-list" class="space-y-3">
              {options.length > 0 ? (
                options.map((opt, i) => <OptionRow index={i} option={opt} />)
              ) : (
                <p class="text-sm text-gray-400">No options yet. Add one above.</p>
              )}
            </div>
          </div>

          <div class="flex items-center gap-3">
            <button type="submit" class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
              Save changes
            </button>
            <a href="/app/quotes" class="text-sm text-gray-500 hover:text-gray-700">Back to list</a>
          </div>
        </form>
      </div>
    </AppLayout>
  )
})

// ─── Update ───

quotes.post('/app/quotes/:id', async (c) => {
  const vendor = c.get('vendor')!
  const id = c.req.param('id')
  const body = await c.req.parseBody()
  const title = requireString(body.title, 'Title')
  const description = trimOrNull(body.description)
  const config = parseConfig(body as Record<string, string | File>)
  const is_active = body.is_active === '1' ? 1 : 0

  await updateQuoteCalculator(c.env.DB, id, vendor.id, {
    title,
    description,
    config: JSON.stringify(config),
    is_active,
  })

  return c.redirect(`/app/quotes/${id}`)
})

// ─── Delete ───

quotes.post('/app/quotes/:id/delete', async (c) => {
  const vendor = c.get('vendor')!
  await deleteQuoteCalculator(c.env.DB, c.req.param('id'), vendor.id)
  return c.redirect('/app/quotes')
})

export default quotes
