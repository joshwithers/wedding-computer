import { Hono } from 'hono'
import type { Env } from '../types'
import { SharedHead } from '../views/head'
import type { HeadMeta } from '../views/head'
import { getFormByToken, getFormSendByToken, getFormSubmission } from '../db/forms'
import type { Form, FormSend } from '../types'
import type { FormConfig } from '../lib/form-schema'
import { getVendorById } from '../db/vendors'
import { embedFrameAncestors } from '../lib/csp'
import { generateToken } from '../lib/crypto'
import { rateLimit } from '../middleware/rate-limit'
import { PublicFormBody, ThankYou } from '../lib/form-render'
import { createSubmission } from '../services/form-submit'
import { t } from '../i18n'
import { BrandThemeHead, BrandLogo, parseBrandTheme, formLogoUrl, formOgImage } from '../lib/form-theme'
import type { BrandTheme } from '../lib/form-theme'
import { withDoctype } from '../views/document'

const form = new Hono<Env>()

// A /form/:token URL is either a form's own public_token (vendor-global use) or
// a "send to a couple" token, which also carries the wedding the response
// belongs to. Resolve to the form to render plus the optional send context.
async function resolveFormToken(
  db: D1Database,
  token: string
): Promise<{ form: Form; send: FormSend | null } | null> {
  const sent = await getFormSendByToken(db, token)
  if (sent) return { form: sent.form, send: sent.send }
  const f = await getFormByToken(db, token)
  return f ? { form: f, send: null } : null
}

// ─── Public form render ───

form.get('/form/:token', async (c) => {
  const token = c.req.param('token')
  const resolved = await resolveFormToken(c.env.DB, token)
  if (!resolved) {
    return c.html(<FormShell embed={c.req.query('embed') === '1'}><p class="text-gray-600">{t('forms.public.unavailable')}</p></FormShell>, 404)
  }
  const formRecord = resolved.form

  // Booking forms create a contact AND join the wedding — they go through the
  // booking funnel at /book-form, never the information-form handler here.
  if (formRecord.kind === 'booking') return c.redirect(`/book-form/${token}`)

  const vendor = await getVendorById(c.env.DB, formRecord.vendor_id)
  if (!vendor) return c.html(<FormShell embed={false}><p class="text-gray-600">{t('forms.public.unavailable')}</p></FormShell>, 404)
  const fa = embedFrameAncestors(vendor.website)
  if (fa) c.set('embedFrameAncestors', fa)

  const config = JSON.parse(formRecord.config) as FormConfig
  const embed = c.req.query('embed') === '1'
  const theme = parseBrandTheme(vendor.brand_theme)
  const logoUrl = formLogoUrl(vendor)
  const meta: HeadMeta = {
    title: 'Form',
    ogTitle: `${config.title} · ${vendor.business_name}`,
    ogDescription: config.subtitle ?? `${config.title} — ${vendor.business_name}.`,
    ogUrl: `${c.env.APP_URL}/form/${token}`,
    ogImageAlt: vendor.business_name,
    noindex: true,
    ...formOgImage(vendor, c.env.APP_URL),
  }

  return c.html(
    <FormShell embed={embed} theme={theme} logoUrl={logoUrl} meta={meta}>
      <FormHeader config={config} vendorName={vendor.business_name} />
      <PublicFormBody config={config} action={`/form/${token}`} formType={formRecord.type} siteKey={c.env.TURNSTILE_SITE_KEY} mapsKey={c.env.GOOGLE_MAPS_API_KEY} />
    </FormShell>
  )
})

// ─── Public form submission (delegates to the unified funnel) ───

form.post('/form/:token', rateLimit(10, 60), async (c) => {
  const token = c.req.param('token')
  const resolved = await resolveFormToken(c.env.DB, token)
  if (!resolved) return c.text('Not found', 404)
  const formRecord = resolved.form

  if (formRecord.kind === 'booking') return c.redirect(`/book-form/${token}`)

  const vendor = await getVendorById(c.env.DB, formRecord.vendor_id)
  if (!vendor) return c.text('Not found', 404)

  const config = JSON.parse(formRecord.config) as FormConfig
  const embed = c.req.query('embed') === '1'
  const theme = parseBrandTheme(vendor.brand_theme)
  const logoUrl = formLogoUrl(vendor)

  const result = await createSubmission(c, {
    vendor,
    kind: formRecord.kind,
    config,
    slug: formRecord.slug ?? '',
    configJson: formRecord.config,
    form: formRecord,
    formType: formRecord.type,
    send: resolved.send,
  })

  if (result.ok) {
    if (result.redirectUrl) return c.redirect(result.redirectUrl)
    // NOIM PDF download: mint a short-TTL one-time-ish capability token bound to
    // this submission instead of exposing the raw DB id. The token (not the
    // submission_id) is what the thank-you page posts back to /pdf, so the
    // sensitive PII can't be re-downloaded by anyone who later learns the id.
    let pdfToken: string | undefined
    if (formRecord.type === 'noim' && result.submissionId) {
      pdfToken = await generateToken(18)
      await c.env.KV.put(`noimpdf:${pdfToken}`, result.submissionId, { expirationTtl: 60 * 60 })
    }
    return c.html(
      <FormShell embed={embed} theme={theme} logoUrl={logoUrl}>
        <ThankYou
          vendorName={vendor.business_name}
          showPdfLink={!!pdfToken}
          pdfAction={`/form/${formRecord.public_token}/pdf`}
          pdfToken={pdfToken}
        />
      </FormShell>
    )
  }

  return c.html(
    <FormShell embed={embed} theme={theme} logoUrl={logoUrl}>
      <FormHeader config={config} vendorName={vendor.business_name} />
      <PublicFormBody
        config={config}
        action={`/form/${token}`}
        formType={formRecord.type}
        siteKey={c.env.TURNSTILE_SITE_KEY}
        error={result.error}
        values={result.values}
        mapsKey={c.env.GOOGLE_MAPS_API_KEY}
      />
    </FormShell>
  )
})

// ─── NOIM PDF download ───

// Anonymous post-submit NOIM download. The submission is highly sensitive PII,
// so this requires the short-TTL capability token minted at submit time (held
// only by the submitting couple's browser) — NOT a raw submission_id. The token
// resolves to the submission, which is still re-verified against the form's
// vendor + form id as defence-in-depth. Celebrants download via the
// authenticated inbox route instead (routes/vendor/forms.tsx).
form.post('/form/:token/pdf', rateLimit(5, 60), async (c) => {
  const formRecord = await getFormByToken(c.env.DB, c.req.param('token'))
  if (!formRecord || formRecord.type !== 'noim') return c.text('Not found', 404)

  const body = await c.req.parseBody()
  const dl = typeof body.dl === 'string' ? body.dl : ''
  if (!dl) return c.text('Not found', 404)
  const submissionId = await c.env.KV.get(`noimpdf:${dl}`)
  if (!submissionId) return c.text('This download link has expired. Please re-submit the form.', 410)

  const submission = await getFormSubmission(c.env.DB, formRecord.vendor_id, submissionId)
  if (!submission || submission.form_id !== formRecord.id) return c.text('Not found', 404)

  const { noimPdfResponse } = await import('../forms/noim/pdf-generator')
  return noimPdfResponse(submission.data)
})

// ─── Components ───

function FormShell({ children, embed, theme, logoUrl, meta }: { children: any; embed?: boolean; theme?: BrandTheme; logoUrl?: string | null; meta?: HeadMeta }) {
  if (embed) {
    return withDoctype(
      <html>
        <head>
          <SharedHead title="Form" {...meta} />
          <BrandThemeHead theme={theme} />
        </head>
        <body class="bg-transparent p-4">
          <BrandLogo logoUrl={logoUrl} />
          <div class="bg-[var(--form-surface)] rounded-2xl p-5 sm:p-6">
            {children}
          </div>
        </body>
      </html>
    )
  }

  return withDoctype(
    <html>
      <head>
        <SharedHead title="Form" {...meta} />
        <BrandThemeHead theme={theme} />
      </head>
      <body class="bg-[var(--form-bg)] min-h-screen">
        <div class="max-w-2xl mx-auto px-4 py-8 sm:py-12">
          <BrandLogo logoUrl={logoUrl} />
          <div class="bg-[var(--form-surface)] rounded-2xl shadow-lg shadow-gray-900/5 p-5 sm:p-8">
            {children}
          </div>
        </div>
      </body>
    </html>
  )
}

function FormHeader({ config, vendorName }: { config: FormConfig; vendorName: string }) {
  return (
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-[var(--form-ink)]">{config.title}</h1>
      {config.subtitle && <p class="text-sm text-[var(--form-ink-muted)] mt-1">{config.subtitle}</p>}
      <p class="text-xs text-gray-400 mt-2">{vendorName}</p>
    </div>
  )
}

export default form
