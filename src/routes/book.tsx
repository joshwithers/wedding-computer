import { Hono } from 'hono'
import type { Env } from '../types'
import type { LineItem } from '../types'
import { SharedHead } from '../views/head'
import type { HeadMeta } from '../views/head'
import { getInvoiceByToken } from '../db/invoices'
import { listPayments, claimBookingSubmission } from '../db/invoices'
import { updateContact } from '../storage/contacts'
import { getStorageWithSecrets } from '../storage'
import { createActivity } from '../db/activities'
import { getVendorById } from '../db/vendors'
import { getContractByInvoice, signContract, getContractById } from '../db/contracts'
import { formatDate, formatDateTime } from '../lib/date'
import { isValidEmail } from '../lib/validation'
import { parseBookingFormConfig } from '../lib/form-schema'
import type { FormConfig, FormField } from '../lib/form-schema'
import { FormEnhancements } from '../lib/form-enhance'
import { t } from '../i18n'
import { verifyTurnstile } from '../services/turnstile'
import { rateLimit } from '../middleware/rate-limit'
import { BrandThemeHead, BrandLogo, parseBrandTheme, formLogoUrl, formOgImage } from '../lib/form-theme'
import type { BrandTheme } from '../lib/form-theme'

const book = new Hono<Env>()

book.get('/book/:token', async (c) => {
  const invoice = await getInvoiceByToken(c.env.DB, c.req.param('token'))
  if (!invoice) {
    return c.html(
      <FormShell embed={c.req.query('embed') === '1'}>
        <div class="bg-[var(--form-surface)] rounded-2xl shadow-lg shadow-gray-900/5 p-5 sm:p-8 text-center">
          <p class="text-gray-600">This booking link is no longer available.</p>
        </div>
      </FormShell>,
      404
    )
  }

  const payments = await listPayments(c.env.DB, invoice.id)
  const lineItems: LineItem[] = invoice.line_items ? JSON.parse(invoice.line_items) : []
  const embed = c.req.query('embed') === '1'
  const totalPaid = payments.filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amount_cents, 0)
  const isPaid = invoice.status === 'paid'
  const category = invoice.vendor_category.charAt(0).toUpperCase() + invoice.vendor_category.slice(1)
  const confirmed = c.req.query('confirmed') === '1'

  const vendor = await getVendorById(c.env.DB, invoice.vendor_id)
  const bookingConfig = vendor ? parseBookingFormConfig(vendor.booking_form) : null
  const hasBookingForm = bookingConfig && bookingConfig.fields.length > 0
  const alreadySubmitted = !!invoice.booking_form_data
  const showForm = hasBookingForm && !isPaid && !alreadySubmitted && totalPaid === 0 && !confirmed

  // Load contract
  const contract = await getContractByInvoice(c.env.DB, invoice.id)
  const contractSigned = contract?.signed_at != null
  const showContract = contract && !contractSigned && showForm

  const theme = vendor ? parseBrandTheme(vendor.brand_theme) : {}
  const logoUrl = vendor ? formLogoUrl(vendor) : null
  const meta: HeadMeta = {
    title: 'Booking',
    ogTitle: `${invoice.title} · ${invoice.vendor_name}`,
    ogDescription: `Review and confirm your booking with ${invoice.vendor_name}.`,
    ogUrl: `${c.env.APP_URL}/book/${c.req.param('token')}`,
    ogImageAlt: invoice.vendor_name,
    noindex: true,
    ...(vendor ? formOgImage(vendor, c.env.APP_URL) : {}),
  }

  return c.html(
    <FormShell embed={embed} theme={theme} meta={meta}>
      <BrandLogo logoUrl={logoUrl} />
      <div class="bg-[var(--form-surface)] rounded-2xl shadow-lg shadow-gray-900/5 p-5 sm:p-8">
        {/* Vendor header */}
        <div class="mb-6 pb-4 border-b border-gray-100">
          <p class="text-xs text-gray-400 uppercase tracking-wide mb-1">{category}</p>
          <h1 class="text-xl font-bold">{invoice.vendor_name}</h1>
          {invoice.vendor_business_address && (
            <p class="text-xs text-gray-400 mt-0.5">{invoice.vendor_business_address}</p>
          )}
          {invoice.vendor_tax_number && (
            <p class="text-xs text-gray-400 mt-0.5">
              {invoice.tax_label === 'GST' ? 'ABN' : invoice.tax_label === 'VAT' ? 'VAT No.' : 'Tax No.'}: {invoice.vendor_tax_number}
            </p>
          )}
        </div>

        {/* Document title + invoice number */}
        <div class="flex items-center justify-between mb-1">
          <h2 class="text-lg font-bold">{invoice.title}</h2>
          {invoice.invoice_number && (
            <span class="text-sm text-gray-400">{invoice.invoice_number}</span>
          )}
        </div>
        {invoice.tax_rate > 0 && (
          <p class="text-xs font-bold text-gray-500 mb-1">
            {invoice.tax_label === 'GST' ? 'Tax Invoice' : invoice.tax_label === 'VAT' ? 'VAT Invoice' : 'Tax Invoice'}
          </p>
        )}
        {invoice.description && (
          <p class="text-sm text-gray-600 mb-4 whitespace-pre-wrap">{invoice.description}</p>
        )}

        {/* Line items */}
        {lineItems.length > 0 && (
          <div class="border border-gray-100 rounded-xl overflow-hidden mb-4">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-gray-50 text-left">
                  <th class="px-4 py-2 font-medium text-gray-500">Item</th>
                  <th class="px-4 py-2 font-medium text-gray-500 text-right">Amount</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                {lineItems.map((li) => (
                  <tr>
                    <td class="px-4 py-2.5">
                      {li.description}
                      {li.quantity > 1 && <span class="text-gray-400"> x{li.quantity}</span>}
                    </td>
                    <td class="px-4 py-2.5 text-right font-medium">
                      ${((li.amount_cents * li.quantity) / 100).toLocaleString('en-AU')}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {invoice.tax_rate > 0 && (
                  <>
                    <tr class="text-gray-500">
                      <td class="px-4 py-1.5">
                        Subtotal {invoice.tax_inclusive ? `(incl. ${invoice.tax_label ?? 'tax'})` : '(ex-tax)'}
                      </td>
                      <td class="px-4 py-1.5 text-right">${(invoice.subtotal_cents / 100).toLocaleString('en-AU')}</td>
                    </tr>
                    <tr class="text-gray-500">
                      <td class="px-4 py-1.5">{invoice.tax_label ?? 'Tax'} ({invoice.tax_rate}%)</td>
                      <td class="px-4 py-1.5 text-right">${(invoice.tax_amount_cents / 100).toLocaleString('en-AU')}</td>
                    </tr>
                  </>
                )}
                {invoice.card_fee_cents > 0 && (
                  <tr class="text-gray-500">
                    <td class="px-4 py-1.5">Card fee ({invoice.card_fee_percent}%)</td>
                    <td class="px-4 py-1.5 text-right">${(invoice.card_fee_cents / 100).toLocaleString('en-AU')}</td>
                  </tr>
                )}
                <tr class="bg-gray-50 font-bold">
                  <td class="px-4 py-2.5">Total</td>
                  <td class="px-4 py-2.5 text-right">${(invoice.amount_cents / 100).toLocaleString('en-AU')}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Payment schedule */}
        {payments.length > 0 && (
          <div class="mb-4">
            <h3 class="text-sm font-bold text-gray-500 mb-2">Payment schedule</h3>
            <div class="space-y-2">
              {payments.map((p) => (
                <div class="flex items-center justify-between text-sm px-3 py-2 bg-gray-50 rounded-lg">
                  <div>
                    <p class="font-medium text-gray-900">{p.label}</p>
                    {p.due_date && <p class="text-xs text-gray-500">Due {formatDate(p.due_date)}</p>}
                  </div>
                  <div class="text-right">
                    <p class="font-bold">${(p.amount_cents / 100).toLocaleString('en-AU')}</p>
                    <p class={`text-xs font-bold ${p.status === 'paid' ? 'text-horizon-700' : 'text-gray-400'}`}>
                      {p.status === 'paid' ? 'Paid' : 'Pending'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status / CTA */}
        {confirmed ? (
          <div class="bg-horizon-50 rounded-xl p-4 text-center">
            <p class="text-sm font-bold text-horizon-700">Booking confirmed</p>
            <p class="text-xs text-gray-500 mt-1">Your vendor will be in touch about next steps.</p>
          </div>
        ) : isPaid ? (
          <div class="bg-horizon-50 rounded-xl p-4 text-center">
            <p class="text-sm font-bold text-horizon-700">Booking confirmed — fully paid</p>
          </div>
        ) : alreadySubmitted ? (
          <div class="bg-horizon-50 rounded-xl p-4 text-center">
            <p class="text-sm font-bold text-horizon-700">Booking confirmed</p>
            <p class="text-xs text-gray-500 mt-1">Your vendor will be in touch about payments.</p>
          </div>
        ) : totalPaid > 0 ? (
          <div class="bg-papaya-100 rounded-xl p-4 text-center">
            <p class="text-sm font-bold text-gray-900">
              ${(totalPaid / 100).toLocaleString('en-AU')} of ${(invoice.amount_cents / 100).toLocaleString('en-AU')} paid
            </p>
            <p class="text-xs text-gray-500 mt-1">Your vendor will be in touch about remaining payments.</p>
          </div>
        ) : showForm ? (
          <BookingForm
            config={hasBookingForm ? bookingConfig! : null}
            token={c.req.param('token')}
            siteKey={c.env.TURNSTILE_SITE_KEY}
            contactName={invoice.contact_name}
            contract={showContract ? contract : null}
            mapsKey={c.env.GOOGLE_MAPS_API_KEY}
          />
        ) : (
          <div class="text-center mt-6">
            <p class="text-sm text-gray-500 mb-3">
              {invoice.contact_name
                ? `${invoice.contact_name}, ready to lock in your date?`
                : 'Ready to lock in your date?'}
            </p>
            <p class="text-xs text-gray-400 mb-4">
              Your vendor will send you a payment link when it's time to pay.
            </p>
          </div>
        )}

        {invoice.notes && (
          <div class="mt-4 pt-4 border-t border-gray-100">
            <p class="text-xs text-gray-500 font-bold mb-1">Notes</p>
            <p class="text-sm text-gray-600 whitespace-pre-wrap">{invoice.notes}</p>
          </div>
        )}

        <p class="text-xs text-gray-400 text-center mt-6">
          Powered by <a href="/" target="_blank" class="underline hover:text-gray-600">Wedding Computer</a>
        </p>
      </div>
    </FormShell>
  )
})

// ─── Booking form submission ───

book.post('/book/:token', rateLimit(10, 60), async (c) => {
  const token = c.req.param('token')
  const invoice = await getInvoiceByToken(c.env.DB, token)
  if (!invoice) return c.text('Not found', 404)

  if (invoice.booking_form_data) {
    return c.redirect(`/book/${token}?confirmed=1`)
  }

  const vendor = await getVendorById(c.env.DB, invoice.vendor_id)
  if (!vendor) return c.text('Not found', 404)

  const config = parseBookingFormConfig(vendor.booking_form)
  const body = await c.req.parseBody()

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
    return c.redirect(`/book/${token}`)
  }

  // Process booking form fields
  const formData: Record<string, string> = {}
  const contactUpdates: Record<string, string> = {}

  if (config.fields.length > 0) {
    for (const field of config.fields) {
      if (field.type === 'heading') continue

      const raw = body[field.id]
      const value = typeof raw === 'string' ? raw.trim() : ''

      if (field.required && !value) {
        return c.redirect(`/book/${token}`)
      }

      if (!value) continue

      // Store raw text (trimmed). Escaped at render time by JSX / email templates.
      const clean = value

      if (field.mapTo) {
        contactUpdates[field.mapTo] = clean
      }

      formData[field.label] = clean
    }
  }

  // Sign contract if present
  const contract = await getContractByInvoice(c.env.DB, invoice.id)
  let sigEmail = ''
  if (contract && !contract.signed_at) {
    const sigName = typeof body.contract_signature === 'string' ? body.contract_signature.trim() : ''
    sigEmail = typeof body.contract_email === 'string' ? body.contract_email.trim() : ''
    const agreed = body.contract_agree === 'yes'

    if (!sigName || !agreed) {
      return c.redirect(`/book/${token}`)
    }

    await signContract(c.env.DB, contract.id, {
      signed_by_name: sigName,
      signed_by_email: sigEmail,
      signed_ip: ip ?? 'unknown',
    })
  }

  // Atomically claim the submission (also saves the form data). Only the
  // request that flips booking_form_data from empty proceeds; a concurrent
  // double-submit loses the race here and just lands on the confirmed page,
  // so the notifications and confirmation email fire exactly once.
  const claimed = await claimBookingSubmission(
    c.env.DB,
    invoice.vendor_id,
    invoice.id,
    JSON.stringify(Object.keys(formData).length > 0 ? formData : { _submitted: 'true' })
  )
  if (!claimed) {
    const embed = c.req.query('embed') === '1'
    return c.redirect(`/book/${token}?confirmed=1${embed ? '&embed=1' : ''}`)
  }

  if (invoice.contact_id) {
    if (Object.keys(contactUpdates).length > 0) {
      try {
        const storage = await getStorageWithSecrets(c.env, vendor)
        await updateContact(storage, c.env.DB, invoice.vendor_id, invoice.contact_id, contactUpdates)
      } catch (err) {
        // Contact update is non-critical — the booking form submission
        // and contract signing are the important parts.
        console.error(`[book] Failed to update contact ${invoice.contact_id}:`, err)
      }
    }
    await createActivity(c.env.DB, invoice.contact_id, 'note',
      contract ? 'Booking form submitted and contract signed' : 'Booking form submitted'
    )
  }

  // Notify all vendors on the wedding that this vendor got booked
  if (invoice.wedding_id) {
    const contactName = invoice.contact_name ?? 'A couple'
    await c.env.EMAIL_QUEUE.send({
      type: 'notify_vendor_booked',
      payload: JSON.stringify({
        weddingId: invoice.wedding_id,
        bookedVendorId: invoice.vendor_id,
        coupleName: contactName,
      }),
    })
  }

  // Email the couple a booking confirmation + a copy of the contract they
  // signed. Use whichever address we have: the one typed when signing, a
  // booking-form email field, then the contact on file. The top-of-handler
  // booking_form_data guard makes this a once-only send per booking.
  const coupleEmail = [sigEmail, contactUpdates.email, invoice.contact_email].find(
    (e) => e && isValidEmail(e)
  )
  if (coupleEmail) {
    let signedContract:
      | { title: string; body: string; signedByName: string | null; signedAt: string | null }
      | null = null
    if (contract) {
      const fresh = await getContractById(c.env.DB, contract.id)
      if (fresh?.signed_at) {
        signedContract = {
          title: fresh.title,
          body: fresh.body,
          signedByName: fresh.signed_by_name,
          signedAt: formatDateTime(fresh.signed_at),
        }
      }
    }
    await c.env.EMAIL_QUEUE.send({
      type: 'booking_confirmation_to_couple',
      to: coupleEmail,
      coupleName: invoice.contact_name,
      vendorName: invoice.vendor_name,
      bookingTitle: invoice.title,
      viewUrl: `${c.env.APP_URL}/book/${token}?confirmed=1`,
      replyTo: vendor.email_handle ? `${vendor.email_handle}@wedding.computer` : null,
      contract: signedContract,
    })
  }

  // Check if vendor has Stripe connected and there's a booking fee
  const bookingFeePayment = (await listPayments(c.env.DB, invoice.id))
    .find((p) => p.label.toLowerCase().includes('booking') && p.status === 'pending')

  if (bookingFeePayment && vendor.stripe_account_id && vendor.stripe_onboarding_complete) {
    // Create Stripe Checkout Session for the booking fee
    try {
      const session = await createStripeCheckoutSession(
        c.env.STRIPE_SECRET_KEY,
        vendor.stripe_account_id,
        bookingFeePayment.amount_cents,
        invoice.currency,
        invoice.vendor_name,
        bookingFeePayment.label,
        `${c.env.APP_URL}/book/${token}?confirmed=1`,
        `${c.env.APP_URL}/book/${token}`,
        invoice.id,
        bookingFeePayment.id
      )

      if (session.url) {
        return c.redirect(session.url)
      }
    } catch (e: any) {
      console.error('[BOOK] Stripe checkout failed', e.message)
      // Fall through to confirmation without payment
    }
  }

  const embed = c.req.query('embed') === '1'
  return c.redirect(`/book/${token}?confirmed=1${embed ? '&embed=1' : ''}`)
})

export default book

// ─── Stripe Checkout ───

async function createStripeCheckoutSession(
  stripeSecretKey: string,
  connectedAccountId: string,
  amountCents: number,
  currency: string,
  vendorName: string,
  paymentLabel: string,
  successUrl: string,
  cancelUrl: string,
  invoiceId: string,
  paymentId: string
): Promise<{ url: string | null }> {
  const params = new URLSearchParams()
  params.append('mode', 'payment')
  params.append('line_items[0][price_data][currency]', currency)
  params.append('line_items[0][price_data][product_data][name]', `${vendorName} — ${paymentLabel}`)
  params.append('line_items[0][price_data][unit_amount]', String(amountCents))
  params.append('line_items[0][quantity]', '1')
  params.append('success_url', successUrl)
  params.append('cancel_url', cancelUrl)
  params.append('metadata[invoice_id]', invoiceId)
  params.append('metadata[payment_id]', paymentId)

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Account': connectedAccountId,
    },
    body: params.toString(),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Stripe Checkout error ${res.status}: ${body}`)
  }

  return res.json() as Promise<{ url: string | null }>
}

// ─── Components ───

function FormShell({ embed, children, theme, meta }: { embed: boolean; children: any; theme?: BrandTheme; meta?: HeadMeta }) {
  return (
    <html lang="en">
      <head>
        <SharedHead title="Booking" {...meta} />
        <BrandThemeHead theme={theme} />
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
      </head>
      <body class={`antialiased ${embed ? 'bg-transparent' : 'bg-[var(--form-bg)] min-h-screen flex items-center justify-center'}`}>
        <div class={`w-full max-w-lg mx-auto ${embed ? 'p-0' : 'px-4 py-8 sm:py-12'}`}>
          {children}
        </div>
      </body>
    </html>
  )
}

function BookingForm({
  config,
  token,
  siteKey,
  contactName,
  contract,
  mapsKey,
}: {
  config: FormConfig | null
  token: string
  siteKey: string
  contactName: string | null
  contract: { id: string; title: string; body: string } | null
  mapsKey?: string
}) {
  const hasFields = config && config.fields.length > 0
  const inputClass = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent'

  return (
    <div class="mt-6 pt-6 border-t border-gray-100">
      {/* Service contract */}
      {contract && (
        <div class="mb-6">
          <h3 class="text-base font-bold mb-2">{contract.title}</h3>
          <div class="border border-gray-200 rounded-xl p-4 max-h-64 overflow-y-auto bg-gray-50 mb-4">
            <p class="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{contract.body}</p>
          </div>
        </div>
      )}

      {hasFields && (
        <>
          <h3 class="text-base font-bold mb-1">{config!.title}</h3>
          {config!.subtitle ? (
            <p class="text-sm text-gray-500 mb-4">{config!.subtitle}</p>
          ) : contactName ? (
            <p class="text-sm text-gray-500 mb-4">{contactName}, please fill in the details below to confirm your booking.</p>
          ) : (
            <p class="text-sm text-gray-500 mb-4">Please fill in the details below to confirm your booking.</p>
          )}
        </>
      )}

      {!hasFields && !contract && (
        <p class="text-sm text-gray-500 mb-4">
          {contactName ? `${contactName}, confirm your booking below.` : 'Confirm your booking below.'}
        </p>
      )}

      <form method="post">
        <div class="space-y-4">
          {hasFields && <FieldRenderer fields={config!.fields} />}

          {/* Contract signature fields */}
          {contract && (
            <div class="border-t border-gray-100 pt-4 mt-4 space-y-4">
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="contract_signature">
                  Your full name (as signature) <span class="text-grapefruit-700">*</span>
                </label>
                <input
                  type="text"
                  id="contract_signature"
                  name="contract_signature"
                  required
                  class={inputClass}
                  placeholder="Type your full legal name"
                />
              </div>
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="contract_email">
                  Your email
                </label>
                <input
                  type="email"
                  id="contract_email"
                  name="contract_email"
                  class={inputClass}
                  placeholder="your@email.com"
                />
              </div>
              <label class="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  name="contract_agree"
                  value="yes"
                  required
                  class="accent-grapefruit-700 mt-0.5"
                />
                <span class="text-gray-700">
                  I have read and agree to the terms of the <strong>{contract.title}</strong> above.
                </span>
              </label>
            </div>
          )}

          <div class="cf-turnstile" data-sitekey={siteKey} data-theme="light"></div>
        </div>

        <button
          type="submit"
          class="mt-6 w-full bg-[var(--form-accent)] text-[var(--form-accent-ink)] py-3 px-4 rounded-xl text-sm font-bold hover:bg-[var(--form-accent-hover)] transition-colors"
        >
          {hasFields && config!.submitLabel ? config!.submitLabel : 'Confirm booking'}
        </button>

        <p class="text-xs text-gray-400 text-center mt-3">
          By confirming, you agree to proceed with this booking.
          {contract && ' Your signature will be recorded as a legal agreement.'}
        </p>
      </form>

      <FormEnhancements mapsKey={mapsKey} />
    </div>
  )
}

function FieldRenderer({ fields }: { fields: FormField[] }) {
  const elements: any[] = []
  let halfBuffer: FormField[] = []

  const flushHalves = () => {
    if (halfBuffer.length === 0) return
    elements.push(
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {halfBuffer.map((f) => (
          <RenderField field={f} />
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
      elements.push(<RenderField field={field} />)
    }
  }

  flushHalves()
  return <>{elements}</>
}

function RenderField({ field }: { field: FormField }) {
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
        ></textarea>
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
            return <option value={optVal}>{optLabel}</option>
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
          required={field.required}
          class="accent-grapefruit-700 mt-0.5"
        />
        <span>{field.label}</span>
      </label>
    )
  }

  if (field.type === 'address') {
    return (
      <div>
        {labelEl}
        <input
          type="text"
          id={field.id}
          name={field.id}
          required={field.required}
          placeholder={field.placeholder || t('forms.address.placeholder')}
          autocomplete="off"
          class={`${inputClass} address-autocomplete`}
        />
      </div>
    )
  }

  return (
    <div>
      {labelEl}
      <input
        type={field.type}
        id={field.id}
        name={field.id}
        required={field.required}
        placeholder={field.placeholder}
        class={inputClass}
        data-future-date={field.type === 'date' && field.mapTo === 'wedding_date' ? 'true' : undefined}
      />
    </div>
  )
}
