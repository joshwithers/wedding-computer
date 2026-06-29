import { Hono } from 'hono'
import type { Env } from '../types'
import { SharedHead } from '../views/head'
import type { HeadMeta } from '../views/head'
import { getFormByToken, getFormSendByToken, getFormSubmission } from '../db/forms'
import type { Form, FormSend } from '../types'
import type { FormConfig } from '../lib/form-schema'
import { getVendorById } from '../db/vendors'
import { embedFrameAncestors } from '../lib/csp'
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
    return c.html(
      <FormShell embed={embed} theme={theme} logoUrl={logoUrl}>
        <ThankYou
          vendorName={vendor.business_name}
          showPdfLink={formRecord.type === 'noim'}
          pdfAction={`/form/${formRecord.public_token}/pdf`}
          submissionId={result.submissionId}
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

form.post('/form/:token/pdf', rateLimit(5, 60), async (c) => {
  const formRecord = await getFormByToken(c.env.DB, c.req.param('token'))
  if (!formRecord || formRecord.type !== 'noim') return c.text('Not found', 404)

  const body = await c.req.parseBody()

  // Preferred: regenerate from the stored submission (the thank-you page no
  // longer has the form in the DOM). Fall back to inline _data if provided.
  let data: Record<string, unknown>
  const submissionId = typeof body.submission_id === 'string' ? body.submission_id : ''
  if (submissionId) {
    const submission = await getFormSubmission(c.env.DB, formRecord.vendor_id, submissionId)
    if (!submission || submission.form_id !== formRecord.id) return c.text('Not found', 404)
    try {
      data = JSON.parse(submission.data)
    } catch {
      return c.text('Invalid data', 400)
    }
  } else {
    const dataStr = body._data as string
    if (!dataStr) return c.text('Missing data', 400)
    try {
      data = JSON.parse(dataStr)
    } catch {
      return c.text('Invalid data', 400)
    }
  }

  const { generateNoimPdf } = await import('../forms/noim/pdf-generator')
  const noimPdfBytes = (await import('../forms/noim/noim-blank.pdf')).default

  const pdfBytes = await generateNoimPdf(data, noimPdfBytes)
  const p1Last = String(data.p1_last_name || 'Party1')
  const p2Last = String(data.p2_last_name || 'Party2')

  return new Response(pdfBytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="NOIM-${p1Last}-${p2Last}.pdf"`,
    },
  })
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
