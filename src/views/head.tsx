import type { FC } from 'hono/jsx'

export const SharedHead: FC<{ title?: string }> = ({ title }) => (
  <>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title ? `${title} — Wedding Computer` : 'Wedding Computer'}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png" />
    <link rel="icon" href="/favicon-16x16.png" sizes="16x16" type="image/png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <meta name="theme-color" content="#C53030" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content={title ? `${title} — Wedding Computer` : 'Wedding Computer'} />
    <meta property="og:description" content="CRM, calendar, invoicing, and collaboration — built for the people who make weddings happen." />
    <meta property="og:image" content="https://wedding.computer/og-image.png" />
    <meta property="og:url" content="https://wedding.computer" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..800;1,9..40,300..800&display=swap" rel="stylesheet" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script dangerouslySetInnerHTML={{
      __html: `tailwind.config = {
        theme: {
          extend: {
            colors: {
              horizon: { DEFAULT: '#58A6FF', 50: '#EBF3FF', 100: '#D6E8FF', 200: '#A8CEFF', 300: '#58A6FF', 400: '#3D96FF', 500: '#2186FF', 600: '#0066E6', 700: '#004DB3' },
              grapefruit: { DEFAULT: '#FF6B6B', 50: '#FFF0F0', 100: '#FFE0E0', 200: '#FFC2C2', 300: '#FF9B9B', 400: '#FF6B6B', 500: '#FF4040', 600: '#E62020', 700: '#C53030', 800: '#9B2020' },
              papaya: { DEFAULT: '#FFEDD5', 50: '#FFFBF5', 100: '#FFF6EB', 200: '#FFEDD5', 300: '#FFE0B5', 400: '#FFD094' },
            },
            fontFamily: {
              sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
            },
            borderRadius: {
              '2xl': '1rem',
              '3xl': '1.5rem',
            },
          },
        },
      }`
    }} />
  </>
)
