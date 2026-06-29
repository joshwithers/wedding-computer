import { Hono } from 'hono'
import type { Env } from '../types'
import { SharedHead } from '../views/head'
import type { HeadMeta } from '../views/head'
import { getVendorById } from '../db/vendors'
import { categoriesLabel } from '../lib/categories'
import { rateLimit } from '../middleware/rate-limit'
import type { FormConfig } from '../lib/form-schema'
import { t } from '../i18n'
import { resolveEnquiryFormConfig, createSubmission } from '../services/form-submit'
import { PublicFormBody, ThankYou } from '../lib/form-render'
import { BrandThemeHead, BrandLogo, parseBrandTheme, formLogoUrl, formOgImage } from '../lib/form-theme'
import type { BrandTheme } from '../lib/form-theme'
import { withDoctype } from '../views/document'

const enquire = new Hono<Env>()

enquire.get('/enquire/:vendorId', async (c) => {
  const vendor = await getVendorById(c.env.DB, c.req.param('vendorId'))
  const embed = c.req.query('embed') === '1'
  if (!vendor) {
    return c.html(
      <EnquiryShell embed={embed}>
        <p class="text-gray-600">{t('forms.public.unavailable')}</p>
      </EnquiryShell>,
      404
    )
  }

  const { config } = await resolveEnquiryFormConfig(c.env.DB, vendor)
  const theme = parseBrandTheme(vendor.brand_theme)
  const logoUrl = formLogoUrl(vendor)
  const category = categoriesLabel(vendor)
  const meta: HeadMeta = {
    title: 'Enquiry',
    ogTitle: `Enquire with ${vendor.business_name}`,
    ogDescription: config.subtitle ?? `Send an enquiry to ${vendor.business_name} · ${category}.`,
    ogUrl: `${c.env.APP_URL}/enquire/${vendor.id}`,
    ogImageAlt: vendor.business_name,
    ...formOgImage(vendor, c.env.APP_URL),
  }

  return c.html(
    <EnquiryShell embed={embed} theme={theme} meta={meta}>
      <EnquiryCard vendor={vendor} config={config} siteKey={c.env.TURNSTILE_SITE_KEY} mapsKey={c.env.GOOGLE_MAPS_API_KEY} logoUrl={logoUrl} />
    </EnquiryShell>
  )
})

enquire.post('/enquire/:vendorId', rateLimit(10, 60), async (c) => {
  const vendor = await getVendorById(c.env.DB, c.req.param('vendorId'))
  if (!vendor) return c.text('Not found', 404)

  const { config, configJson } = await resolveEnquiryFormConfig(c.env.DB, vendor)
  const theme = parseBrandTheme(vendor.brand_theme)
  const logoUrl = formLogoUrl(vendor)
  const embed = c.req.query('embed') === '1'

  const result = await createSubmission(c, { vendor, kind: 'enquiry', config, slug: 'enquiry', configJson })

  if (result.ok) {
    if (result.redirectUrl) return c.redirect(result.redirectUrl)
    return c.html(
      <EnquiryShell embed={embed} theme={theme}>
        <ThankYou title={t('forms.public.enquirySent')} message={t('forms.public.enquirySentBody', { vendor: vendor.business_name })} />
      </EnquiryShell>
    )
  }

  return c.html(
    <EnquiryShell embed={embed} theme={theme}>
      <EnquiryCard vendor={vendor} config={config} siteKey={c.env.TURNSTILE_SITE_KEY} mapsKey={c.env.GOOGLE_MAPS_API_KEY} logoUrl={logoUrl} error={result.error} values={result.values} />
    </EnquiryShell>
  )
})

export default enquire

// ─── Components ───

function EnquiryShell({ embed, children, theme, meta }: { embed?: boolean; children: any; theme?: BrandTheme; meta?: HeadMeta }) {
  return withDoctype(
    <html lang="en">
      <head>
        <SharedHead title="Enquiry" {...meta} />
        <BrandThemeHead theme={theme} />
      </head>
      <body class={`antialiased ${embed ? 'bg-transparent' : 'bg-[var(--form-bg)] min-h-screen flex items-center justify-center'}`}>
        <div class={`w-full max-w-lg mx-auto ${embed ? 'p-0' : 'px-4 py-8 sm:py-12'}`}>
          {children}
        </div>
      </body>
    </html>
  )
}

function EnquiryCard({
  vendor, config, siteKey, mapsKey, logoUrl, error, values,
}: {
  vendor: { id: string; business_name: string; category: string; categories?: string | null; celebrant_term?: string | null }
  config: FormConfig
  siteKey: string
  mapsKey?: string
  logoUrl?: string | null
  error?: string
  values?: Record<string, string>
}) {
  const category = categoriesLabel(vendor)
  return (
    <>
      <BrandLogo logoUrl={logoUrl} />
      <div class="bg-[var(--form-surface)] rounded-2xl shadow-lg shadow-gray-900/5 p-5 sm:p-8">
        <div class="mb-6">
          <h1 class="text-xl font-bold mb-1">{config.title}</h1>
          <p class="text-sm text-gray-500">
            {config.subtitle ?? (
              <>Send an enquiry to <strong class="text-gray-900">{vendor.business_name}</strong>
              <span class="text-gray-400"> · {category}</span></>
            )}
          </p>
        </div>

        <PublicFormBody
          config={config}
          action={`/enquire/${vendor.id}`}
          siteKey={siteKey}
          mapsKey={mapsKey}
          error={error}
          values={values}
        />

        <p class="text-xs text-gray-400 text-center mt-4">
          {t('forms.public.poweredBy')} <a href="/" target="_blank" class="underline hover:text-gray-600">Wedding Computer</a>
        </p>
      </div>
    </>
  )
}
