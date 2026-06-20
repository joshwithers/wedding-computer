// Light branding for a vendor's public forms (enquiry, booking, custom).
//
// A vendor picks an accent colour, a page background, a text/ink colour, a
// font, and whether to show their logo. We store the chosen values as a small
// JSON blob on `vendor_profiles.brand_theme` (NULL = house default). At render
// time we resolve that into a set of CSS custom properties injected into the
// form's <head>; the form markup reads them via Tailwind arbitrary values like
// `bg-[var(--form-accent)]`. Derived shades (hover, tint, muted ink, the text
// colour that sits on the accent) are computed server-side as concrete hex so
// there's no dependency on `color-mix` in the browser.
//
// Everything interpolated into the <style> block is either a sanitised
// #rrggbb hex or an allow-listed font stack, so the blob can't inject CSS.

import type { FC } from 'hono/jsx'

export type BrandTheme = {
  accent?: string // hex — buttons, highlights, focus
  background?: string // hex — page canvas behind the form card
  ink?: string // hex — heading + body text
  font?: string // id from BRAND_FONTS
  logo?: boolean // show the vendor's logo above the form
}

type BrandFont = { id: string; label: string; stack: string; google?: string }

// Curated, performance-safe set. `google` is the css2 `family=` query; it's
// omitted for DM Sans, which the shared <head> already loads everywhere.
export const BRAND_FONTS: BrandFont[] = [
  { id: 'dm-sans', label: 'DM Sans (default)', stack: "'DM Sans', system-ui, sans-serif" },
  { id: 'inter', label: 'Inter', stack: "'Inter', system-ui, sans-serif", google: 'Inter:wght@400;500;600;700' },
  { id: 'poppins', label: 'Poppins', stack: "'Poppins', system-ui, sans-serif", google: 'Poppins:wght@400;500;600;700' },
  { id: 'montserrat', label: 'Montserrat', stack: "'Montserrat', system-ui, sans-serif", google: 'Montserrat:wght@400;500;600;700' },
  { id: 'playfair', label: 'Playfair Display', stack: "'Playfair Display', Georgia, serif", google: 'Playfair+Display:wght@400;500;600;700' },
  { id: 'cormorant', label: 'Cormorant Garamond', stack: "'Cormorant Garamond', Georgia, serif", google: 'Cormorant+Garamond:wght@400;500;600;700' },
  { id: 'lora', label: 'Lora', stack: "'Lora', Georgia, serif", google: 'Lora:wght@400;500;600;700' },
  { id: 'libre-baskerville', label: 'Libre Baskerville', stack: "'Libre Baskerville', Georgia, serif", google: 'Libre+Baskerville:wght@400;700' },
]

const FONT_BY_ID = new Map(BRAND_FONTS.map((f) => [f.id, f]))

// House defaults — these reproduce the standard Wedding Computer form look.
export const THEME_DEFAULTS = {
  accent: '#c53030', // grapefruit-700
  background: '#fffbf5', // papaya-50
  ink: '#111827', // gray-900
  surface: '#ffffff',
  font: 'dm-sans',
} as const

const HEX = /^#?[0-9a-fA-F]{6}$/

export function sanitizeHex(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const v = input.trim()
  if (!HEX.test(v)) return null
  return (v[0] === '#' ? v : '#' + v).toLowerCase()
}

export function isBrandFont(id: unknown): id is string {
  return typeof id === 'string' && FONT_BY_ID.has(id)
}

function toRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

// Mix colour `a` toward `b` by `t` (0..1).
export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = toRgb(a)
  const [r2, g2, b2] = toRgb(b)
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// Black or white, whichever reads better on `hex` (WCAG relative luminance).
export function contrastOn(hex: string): string {
  return luminance(hex) > 0.5 ? '#1a1a1a' : '#ffffff'
}

export function parseBrandTheme(json: string | null | undefined): BrandTheme {
  if (!json) return {}
  try {
    const t = JSON.parse(json)
    return t && typeof t === 'object' ? (t as BrandTheme) : {}
  } catch {
    return {}
  }
}

export type ResolvedTheme = {
  bg: string
  surface: string
  ink: string
  inkMuted: string
  accent: string
  accentInk: string
  accentHover: string
  accentTint: string
  fontStack: string
  googleFont?: string
}

export function resolveBrandTheme(theme: BrandTheme): ResolvedTheme {
  const accent = sanitizeHex(theme.accent) ?? THEME_DEFAULTS.accent
  const bg = sanitizeHex(theme.background) ?? THEME_DEFAULTS.background
  const ink = sanitizeHex(theme.ink) ?? THEME_DEFAULTS.ink
  const surface = THEME_DEFAULTS.surface
  const font = FONT_BY_ID.get(theme.font ?? '') ?? FONT_BY_ID.get(THEME_DEFAULTS.font)!
  return {
    bg,
    surface,
    ink,
    inkMuted: mixHex(ink, surface, 0.45),
    accent,
    accentInk: contrastOn(accent),
    accentHover: mixHex(accent, '#000000', 0.16),
    accentTint: mixHex(accent, surface, 0.88),
    fontStack: font.stack,
    googleFont: font.google,
  }
}

// The `--form-*` custom properties as a CSS string. Reused by the live preview
// in settings so the editor and the real form share one source of truth.
export function brandThemeVars(theme: BrandTheme): string {
  const r = resolveBrandTheme(theme)
  return (
    `--form-bg:${r.bg};--form-surface:${r.surface};` +
    `--form-ink:${r.ink};--form-ink-muted:${r.inkMuted};` +
    `--form-accent:${r.accent};--form-accent-ink:${r.accentInk};` +
    `--form-accent-hover:${r.accentHover};--form-accent-tint:${r.accentTint};` +
    `--form-font:${r.fontStack};`
  )
}

// Drop into <head> AFTER <SharedHead/>. Sets the CSS variables plus the form's
// ink colour and font on <body>; the page background is left to the body class
// so embedded (iframe) forms can stay transparent.
export const BrandThemeHead: FC<{ theme?: BrandTheme }> = ({ theme }) => {
  const r = resolveBrandTheme(theme ?? {})
  const css = `:root{${brandThemeVars(theme ?? {})}}body{color:var(--form-ink);font-family:var(--form-font);}`
  return (
    <>
      {r.googleFont && (
        <link rel="preconnect" href="https://fonts.googleapis.com" />
      )}
      {r.googleFont && (
        <link href={`https://fonts.googleapis.com/css2?family=${r.googleFont}&display=swap`} rel="stylesheet" />
      )}
      <style dangerouslySetInnerHTML={{ __html: css }} />
    </>
  )
}

// The vendor's logo, centred above a form. Renders nothing when there's no URL.
export const BrandLogo: FC<{ logoUrl?: string | null }> = ({ logoUrl }) =>
  logoUrl ? (
    <div class="flex justify-center mb-5">
      <img src={logoUrl} alt="" class="h-16 w-auto max-w-[220px] object-contain" />
    </div>
  ) : null

// Resolve the public logo URL for a form, honouring the vendor's toggle.
export function formLogoUrl(
  vendor: { id: string; logo_r2_key: string | null; brand_theme: string | null },
): string | null {
  const theme = parseBrandTheme(vendor.brand_theme)
  return theme.logo && vendor.logo_r2_key ? `/vendor-logo/${vendor.id}` : null
}

// Share-card image for a form. If the vendor has uploaded a logo we use it
// (absolute URL, so scrapers can fetch it) regardless of the on-form toggle —
// a recognisable image beats the generic platform card. Logos are square, so
// they pair with the 'summary' Twitter card; the default art is wide. Returns
// an empty object when there's no logo, so SharedHead keeps its defaults.
export function formOgImage(
  vendor: { id: string; logo_r2_key: string | null },
  appUrl: string,
): { ogImage?: string; twitterCard?: 'summary' | 'summary_large_image' } {
  if (vendor.logo_r2_key) {
    return { ogImage: `${appUrl}/vendor-logo/${vendor.id}`, twitterCard: 'summary' }
  }
  return {}
}
