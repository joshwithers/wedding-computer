import type { FC } from 'hono/jsx'

export const SharedHead: FC<{ title?: string }> = ({ title }) => (
  <>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title ? `${title} — Wedding Computer` : 'Wedding Computer'}</title>
    <meta name="description" content="CRM, calendar, invoicing, email, and wedding collaboration tools for vendors, venues, planners, and couples." />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png" />
    <link rel="icon" href="/favicon-16x16.png" sizes="16x16" type="image/png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="preload" href="/styles.css" as="style" />
    <link rel="stylesheet" href="/styles.css" />
    <meta name="theme-color" content="#C53030" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content={title ? `${title} — Wedding Computer` : 'Wedding Computer'} />
    <meta property="og:description" content="CRM, calendar, invoicing, and collaboration — built for the people who make weddings happen." />
    <meta property="og:image" content="https://wedding.computer/og-image.png" />
    <meta property="og:url" content="https://wedding.computer" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..800;1,9..40,300..800&display=swap" rel="stylesheet" media="print" onload="this.media='all'" />
    <noscript><link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..800;1,9..40,300..800&display=swap" rel="stylesheet" /></noscript>
  </>
)
