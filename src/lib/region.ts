// Resolve a wedding's place into a community region: a normalised COUNTRY (the
// room) plus an optional STATE/PROVINCE (the in-room filter tag).
//
// weddings.location_country is free-text country *names* (the COUNTRIES list in
// forms/countries.ts), not ISO codes — so we slugify names to a stable key
// ('australia', 'united-states') rather than pretend we have ISO 3166. A small
// alias map collapses the variants geocoders disagree on (UK constituents →
// United Kingdom, USA/US → United States) so couples in the same place share a
// room. When the wedding has no country we fall back to the viewer's locale and
// otherwise leave it for the join step to confirm.

export type Hemisphere = 'north' | 'south'

export type ResolvedRegion = {
  /** Stable slug used in the cohort key, e.g. 'australia'. '' when unknown. */
  countryCode: string
  /** Display name, e.g. 'Australia'. '' when unknown. */
  countryName: string
  /** State/province slug for the filter, e.g. 'new-south-wales'. Null when unknown. */
  subdivisionCode: string | null
  /** State/province display label, e.g. 'New South Wales'. Null when unknown. */
  subdivisionLabel: string | null
  hemisphere: Hemisphere
}

/** Lowercase, accent-stripped, hyphenated slug — stable across inputs. */
export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Common aliases → canonical display name. Keep small; geocoded names are the
// real signal. UK constituents are deliberately merged so England/Scotland/…
// couples share one "United Kingdom" room.
const COUNTRY_ALIASES: Record<string, string> = {
  uk: 'United Kingdom',
  'u.k.': 'United Kingdom',
  'great britain': 'United Kingdom',
  britain: 'United Kingdom',
  england: 'United Kingdom',
  scotland: 'United Kingdom',
  wales: 'United Kingdom',
  'northern ireland': 'United Kingdom',
  usa: 'United States',
  'u.s.a.': 'United States',
  'u.s.': 'United States',
  us: 'United States',
  america: 'United States',
  'united states of america': 'United States',
  uae: 'United Arab Emirates',
}

function canonicalCountryName(raw: string): string {
  const trimmed = raw.trim()
  return COUNTRY_ALIASES[trimmed.toLowerCase()] ?? trimmed
}

// Is a vendor eligible (by country) for Australia-only features like the NOIM?
// The NOIM is a Commonwealth legal form (Australia-only), so it must not be
// offered to confirmed non-Australian vendors. But `location_country` is only
// set by geocoding and is often null for legitimate AU celebrants, and Australia
// is the home market — so we DEFAULT-ALLOW on unknown and only block when we
// have a CONFIRMED non-Australian geocoded country. (timezone is not a usable
// signal — the column defaults to Australia/Sydney for everyone.)
export function isAustralianVendorCountry(country: string | null | undefined): boolean {
  const c = country?.trim()
  if (!c) return true // unknown → allow (AU is the home market)
  return slugify(canonicalCountryName(c)) === 'australia'
}

// Region subtag of a BCP 47 locale → country name, covering the SUPPORTED_LOCALES.
const LOCALE_COUNTRY: Record<string, string> = {
  AU: 'Australia', NZ: 'New Zealand', GB: 'United Kingdom', US: 'United States',
  ES: 'Spain', MX: 'Mexico', FR: 'France', CA: 'Canada', DE: 'Germany',
  AT: 'Austria', CH: 'Switzerland', GR: 'Greece', CY: 'Cyprus', IT: 'Italy',
  JP: 'Japan', NL: 'Netherlands', BE: 'Belgium', PT: 'Portugal', BR: 'Brazil',
  CN: 'China', SG: 'Singapore',
}

function countryFromLocale(locale: string | null | undefined): string | null {
  if (!locale) return null
  const region = locale.split('-')[1]?.toUpperCase()
  return (region && LOCALE_COUNTRY[region]) ?? null
}

// Southern-hemisphere country slugs — the fallback when we have a country but no
// coordinate. Equator-straddling countries (Brazil, Indonesia…) are decided by
// latitude when we have it; the few weddings without coords land here.
const SOUTHERN = new Set<string>([
  'australia', 'new-zealand', 'south-africa', 'argentina', 'chile', 'uruguay',
  'paraguay', 'bolivia', 'peru', 'brazil', 'namibia', 'botswana', 'zimbabwe',
  'zambia', 'mozambique', 'madagascar', 'angola', 'fiji', 'samoa', 'tonga',
  'vanuatu', 'lesotho', 'eswatini', 'malawi', 'papua-new-guinea',
])

function hemisphereFor(countryCode: string, lat: number | null | undefined): Hemisphere {
  if (typeof lat === 'number' && !Number.isNaN(lat)) return lat < 0 ? 'south' : 'north'
  if (countryCode && SOUTHERN.has(countryCode)) return 'south'
  if (!countryCode) return 'south' // truly unknown → Australia-first default
  return 'north' // most countries (and people) are northern
}

export function resolveRegion(input: {
  country?: string | null
  state?: string | null
  lat?: number | null
  locale?: string | null
}): ResolvedRegion {
  const rawCountry = (input.country && input.country.trim()) || countryFromLocale(input.locale) || ''
  const countryName = rawCountry ? canonicalCountryName(rawCountry) : ''
  const countryCode = countryName ? slugify(countryName) : ''
  const subdivisionLabel = input.state && input.state.trim() ? input.state.trim() : null
  const subdivisionCode = subdivisionLabel ? slugify(subdivisionLabel) : null
  return {
    countryCode,
    countryName,
    subdivisionCode,
    subdivisionLabel,
    hemisphere: hemisphereFor(countryCode, input.lat),
  }
}
