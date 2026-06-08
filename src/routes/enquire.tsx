import { Hono } from 'hono'
import type { Env } from '../types'
import { SharedHead } from '../views/head'
import { getVendorById } from '../db/vendors'
import { verifyTurnstile } from '../services/turnstile'
import { rateLimit } from '../middleware/rate-limit'
import { parseFormConfig } from '../lib/form-schema'
import type { FormConfig, FormField } from '../lib/form-schema'
import { processSubmission, createEnquiry } from '../services/enquiry'

const enquire = new Hono<Env>()

enquire.get('/enquire/:vendorId', async (c) => {
  const vendor = await getVendorById(c.env.DB, c.req.param('vendorId'))
  const embed = c.req.query('embed') === '1'
  if (!vendor) {
    return c.html(
      <EnquiryShell embed={embed}>
        <p class="text-gray-600">This enquiry form is no longer available.</p>
      </EnquiryShell>,
      404
    )
  }

  const config = parseFormConfig(vendor.enquiry_form)

  return c.html(
    <EnquiryShell embed={embed}>
      <EnquiryForm
        vendor={vendor}
        config={config}
        siteKey={c.env.TURNSTILE_SITE_KEY}
      />
    </EnquiryShell>
  )
})

enquire.post('/enquire/:vendorId', rateLimit(10, 60), async (c) => {
  const vendorId = c.req.param('vendorId')
  const vendor = await getVendorById(c.env.DB, vendorId)
  if (!vendor) return c.text('Not found', 404)

  const config = parseFormConfig(vendor.enquiry_form)
  const body = await c.req.parseBody()
  const embed = c.req.query('embed') === '1'

  if (body.website_url) {
    return c.html(
      <EnquiryShell embed={embed}>
        <ThankYou businessName={vendor.business_name} />
      </EnquiryShell>
    )
  }

  const turnstileToken = typeof body['cf-turnstile-response'] === 'string'
    ? body['cf-turnstile-response']
    : ''
  const ip = c.req.header('cf-connecting-ip') ?? null

  const turnstileOk = await verifyTurnstile(
    c.env.TURNSTILE_SECRET_KEY,
    turnstileToken,
    ip
  )

  if (!turnstileOk) {
    return c.html(
      <EnquiryShell embed={embed}>
        <EnquiryForm
          vendor={vendor}
          config={config}
          siteKey={c.env.TURNSTILE_SITE_KEY}
          error="Verification failed. Please try again."
          values={body as Record<string, string>}
        />
      </EnquiryShell>
    )
  }

  try {
    const { contactData, formData } = processSubmission(config, body as Record<string, string>)
    await createEnquiry(c.env, vendor, { contactData, formData, source: 'website' })

    // Vendor-configured success URL (used by raw HTML forms on their own site).
    if (config.redirectUrl && isValidRedirect(config.redirectUrl)) {
      return c.redirect(config.redirectUrl)
    }

    return c.html(
      <EnquiryShell embed={embed}>
        <ThankYou businessName={vendor.business_name} />
      </EnquiryShell>
    )
  } catch (e: any) {
    return c.html(
      <EnquiryShell embed={embed}>
        <EnquiryForm
          vendor={vendor}
          config={config}
          siteKey={c.env.TURNSTILE_SITE_KEY}
          error={e.message}
          values={body as Record<string, string>}
        />
      </EnquiryShell>
    )
  }
})

export default enquire

// Only allow http(s) absolute URLs as the post-submit redirect target. The URL
// is vendor-configured (stored in their form config), never read from the
// request, so this is just a sanity guard, not open-redirect protection.
function isValidRedirect(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

// ─── Components ───

function EnquiryShell({ embed, children }: { embed?: boolean; children: any }) {
  return (
    <html lang="en">
      <head>
        <SharedHead title="Enquiry" />
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
      </head>
      <body class={`text-gray-900 antialiased font-sans ${embed ? 'bg-transparent' : 'bg-papaya-50 min-h-screen flex items-center justify-center'}`}>
        <div class={`w-full max-w-lg mx-auto ${embed ? 'p-0' : 'px-4 py-8 sm:py-12'}`}>
          {children}
        </div>
      </body>
    </html>
  )
}

function EnquiryForm({
  vendor,
  config,
  siteKey,
  error,
  values,
}: {
  vendor: { business_name: string; category: string }
  config: FormConfig
  siteKey: string
  error?: string
  values?: Record<string, string>
}) {
  const v = (name: string) => (values?.[name] as string) ?? ''
  const category = vendor.category.charAt(0).toUpperCase() + vendor.category.slice(1)

  return (
    <div class="bg-white rounded-2xl shadow-lg shadow-gray-900/5 p-5 sm:p-8">
      <div class="mb-6">
        <h1 class="text-xl font-bold mb-1">{config.title}</h1>
        <p class="text-sm text-gray-500">
          {config.subtitle ?? (
            <>Send an enquiry to <strong class="text-gray-900">{vendor.business_name}</strong>
            <span class="text-gray-400"> · {category}</span></>
          )}
        </p>
      </div>

      {error && (
        <div class="bg-grapefruit-50 text-grapefruit-700 text-sm font-medium rounded-xl p-3 mb-4">
          {error}
        </div>
      )}

      <form method="post">
        {/* Honeypot */}
        <div style="position:absolute;left:-9999px" aria-hidden="true">
          <input type="text" name="website_url" tabindex={-1} autocomplete="off" />
        </div>

        <div class="space-y-4">
          <FieldRenderer fields={config.fields} values={v} />
          <div class="cf-turnstile" data-sitekey={siteKey} data-theme="light"></div>
        </div>

        <button
          type="submit"
          class="mt-6 w-full bg-grapefruit-700 text-white py-3 px-4 rounded-xl text-sm font-bold hover:bg-grapefruit-800 transition-colors"
        >
          {config.submitLabel}
        </button>
      </form>

      <p class="text-xs text-gray-400 text-center mt-4">
        Powered by <a href="/" target="_blank" class="underline hover:text-gray-600">Wedding Computer</a>
      </p>
    </div>
  )
}

function FieldRenderer({
  fields,
  values,
}: {
  fields: FormField[]
  values: (name: string) => string
}) {
  const elements: any[] = []
  let halfBuffer: FormField[] = []

  const flushHalves = () => {
    if (halfBuffer.length === 0) return
    elements.push(
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {halfBuffer.map((f) => (
          <RenderField field={f} value={values(f.id)} />
        ))}
      </div>
    )
    halfBuffer = []
  }

  for (const field of fields) {
    if (field.type === 'heading') {
      flushHalves()
      elements.push(
        <h2 class="text-base font-bold text-gray-900 pt-2">{field.label}</h2>
      )
      continue
    }

    if (field.width === 'half') {
      halfBuffer.push(field)
      if (halfBuffer.length === 2) flushHalves()
    } else {
      flushHalves()
      elements.push(<RenderField field={field} value={values(field.id)} />)
    }
  }

  flushHalves()
  return <>{elements}</>
}

function RenderField({ field, value }: { field: FormField; value: string }) {
  const labelEl = (
    <label class="block text-sm font-bold text-gray-700 mb-1.5" for={field.id}>
      {field.label}
      {field.required && <span class="text-grapefruit-700 ml-0.5">*</span>}
    </label>
  )

  const inputClass = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent'

  if (field.type === 'textarea') {
    return (
      <div>
        {labelEl}
        <textarea
          id={field.id}
          name={field.id}
          rows={4}
          maxlength={2000}
          required={field.required}
          placeholder={field.placeholder}
          class={inputClass}
        >{value}</textarea>
      </div>
    )
  }

  if (field.type === 'select') {
    return (
      <div>
        {labelEl}
        <select
          id={field.id}
          name={field.id}
          required={field.required}
          class={`${inputClass} bg-white`}
        >
          <option value="">{field.placeholder ?? 'Select...'}</option>
          {field.options?.map((opt) => {
            const optVal = typeof opt === 'string' ? opt : opt.value
            const optLabel = typeof opt === 'string' ? opt : opt.label
            return <option value={optVal} selected={value === optVal}>{optLabel}</option>
          })}
        </select>
      </div>
    )
  }

  if (field.type === 'radio') {
    return (
      <div>
        {labelEl}
        <div class="space-y-2 mt-1">
          {field.options?.map((opt) => {
            const optVal = typeof opt === 'string' ? opt : opt.value
            const optLabel = typeof opt === 'string' ? opt : opt.label
            return (
            <label class="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name={field.id}
                value={optVal}
                checked={value === optVal}
                required={field.required}
                class="accent-grapefruit-700"
              />
              {optLabel}
            </label>
            )
          })}
        </div>
      </div>
    )
  }

  if (field.type === 'checkbox') {
    return (
      <label class="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          name={field.id}
          value="yes"
          checked={value === 'yes'}
          class="accent-grapefruit-700 mt-0.5"
        />
        <span>{field.label}</span>
      </label>
    )
  }

  return (
    <div>
      {labelEl}
      <input
        type={field.type}
        id={field.id}
        name={field.id}
        value={value}
        required={field.required}
        placeholder={field.placeholder}
        class={inputClass}
      />
    </div>
  )
}

function ThankYou({ businessName }: { businessName: string }) {
  return (
    <div class="bg-white rounded-2xl shadow-lg shadow-gray-900/5 p-5 sm:p-8 text-center">
      <div class="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg class="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h1 class="text-xl font-bold mb-2">Enquiry sent</h1>
      <p class="text-sm text-gray-600">
        Your enquiry has been sent to <strong>{businessName}</strong>.
        They'll be in touch soon.
      </p>
    </div>
  )
}
