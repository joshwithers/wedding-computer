import type { FC } from 'hono/jsx'
import { STYLESHEET_HREF } from '../lib/assets'

// Per-page <head> overrides. Everything is optional; omitting a field falls
// back to the platform default, so existing callers that pass only `title`
// keep their current output. Public forms pass vendor-specific OG so a shared
// enquiry/booking/form link unfurls with the vendor's name, logo, and URL
// instead of the generic Wedding Computer card.
export type HeadMeta = {
  title?: string
  description?: string
  ogTitle?: string
  ogDescription?: string
  ogImage?: string
  ogImageAlt?: string
  ogUrl?: string
  ogType?: string
  twitterCard?: 'summary' | 'summary_large_image'
  noindex?: boolean
}

const DEFAULT_DESCRIPTION =
  'CRM, calendar, invoicing, email, and wedding collaboration tools for vendors, venues, planners, and couples.'
const DEFAULT_OG_DESCRIPTION =
  'CRM, calendar, invoicing, and collaboration — built for the people who make weddings happen.'
const DEFAULT_OG_IMAGE = 'https://wedding.computer/og-image.png'
const DEFAULT_URL = 'https://wedding.computer'

export const SharedHead: FC<HeadMeta> = ({
  title,
  description,
  ogTitle,
  ogDescription,
  ogImage,
  ogImageAlt,
  ogUrl,
  ogType,
  twitterCard,
  noindex,
}) => {
  const fullTitle = title ? `${title} — Wedding Computer` : 'Wedding Computer'
  const desc = description ?? DEFAULT_DESCRIPTION
  const oTitle = ogTitle ?? fullTitle
  const oDesc = ogDescription ?? DEFAULT_OG_DESCRIPTION
  const oImage = ogImage ?? DEFAULT_OG_IMAGE
  const oUrl = ogUrl ?? DEFAULT_URL
  const oType = ogType ?? 'website'
  const twCard = twitterCard ?? 'summary_large_image'
  return (
    <>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      {noindex && <meta name="robots" content="noindex, nofollow" />}
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png" />
      <link rel="icon" href="/favicon-16x16.png" sizes="16x16" type="image/png" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <link rel="manifest" href="/site.webmanifest" />
      <link rel="preload" href={STYLESHEET_HREF} as="style" />
      <link rel="stylesheet" href={STYLESHEET_HREF} />
      <meta name="theme-color" content="#C53030" />
      <meta property="og:type" content={oType} />
      <meta property="og:site_name" content="Wedding Computer" />
      <meta property="og:title" content={oTitle} />
      <meta property="og:description" content={oDesc} />
      <meta property="og:image" content={oImage} />
      {ogImageAlt && <meta property="og:image:alt" content={ogImageAlt} />}
      <meta property="og:url" content={oUrl} />
      <meta name="twitter:card" content={twCard} />
      <meta name="twitter:title" content={oTitle} />
      <meta name="twitter:description" content={oDesc} />
      <meta name="twitter:image" content={oImage} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..800;1,9..40,300..800&display=swap" rel="stylesheet" media="print" onload="this.media='all'" />
      <noscript><link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..800;1,9..40,300..800&display=swap" rel="stylesheet" /></noscript>
    </>
  )
}
