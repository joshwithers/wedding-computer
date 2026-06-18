// Sunrise / sunset / golden-hour for a wedding's location + date.
//
// The maths is the well-known SunCalc / NOAA solar-position algorithm (accurate
// to ~1 minute) — pure, no network. It returns instants in UTC; callers format
// them in the wedding's local timezone.
//
// Timezone: we don't store an IANA zone per wedding, so resolveLocationTimezone
// derives one from the geocoded state/country — exact for Australian states
// (including which ones observe DST) and a handful of common countries, with a
// caller-supplied fallback (usually the viewer's zone) otherwise.

const rad = Math.PI / 180
const dayMs = 86400000
const J1970 = 2440588
const J2000 = 2451545
const e = rad * 23.4397 // obliquity of the ecliptic

function toDays(date: Date): number {
  return date.valueOf() / dayMs - 0.5 + J1970 - J2000
}
function fromJulian(j: number): Date {
  return new Date((j + 0.5 - J1970) * dayMs)
}
function solarMeanAnomaly(d: number): number {
  return rad * (357.5291 + 0.98560028 * d)
}
function eclipticLongitude(M: number): number {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  const P = rad * 102.9372 // perihelion of the Earth
  return M + C + P + Math.PI
}
function declination(l: number): number {
  return Math.asin(Math.sin(e) * Math.sin(l))
}

const J0 = 0.0009
function approxTransit(Ht: number, lw: number, n: number): number {
  return J0 + (Ht + lw) / (2 * Math.PI) + n
}
function solarTransitJ(ds: number, M: number, L: number): number {
  return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L)
}
function hourAngle(h: number, phi: number, dec: number): number {
  return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)))
}
function getSetJ(h: number, lw: number, phi: number, dec: number, n: number, M: number, L: number): number {
  const w = hourAngle(h, phi, dec)
  return solarTransitJ(approxTransit(w, lw, n), M, L)
}

export type SunTimes = {
  sunrise: Date | null
  sunset: Date | null
  /** Start of the evening golden hour (sun at +6°), running until sunset. */
  goldenHourStart: Date | null
}

/**
 * Sun events for `date` (its calendar day, evaluated at solar noon) at
 * lat/lng. Returns UTC instants, or null for that event in the polar case
 * where the sun never crosses the horizon.
 */
export function sunTimes(date: Date, lat: number, lng: number): SunTimes {
  const lw = rad * -lng
  const phi = rad * lat
  const d = toDays(date)

  const n = Math.round(d - J0 - lw / (2 * Math.PI))
  const ds = approxTransit(0, lw, n)
  const M = solarMeanAnomaly(ds)
  const L = eclipticLongitude(M)
  const dec = declination(L)
  const Jnoon = solarTransitJ(ds, M, L)

  const h0 = rad * -0.833 // sun's upper limb at the horizon, with refraction
  const Jset = getSetJ(h0, lw, phi, dec, n, M, L)
  const Jrise = Jnoon - (Jset - Jnoon)

  const Jgolden = getSetJ(rad * 6, lw, phi, dec, n, M, L) // evening golden-hour start

  return {
    sunrise: isNaN(Jrise) ? null : fromJulian(Jrise),
    sunset: isNaN(Jset) ? null : fromJulian(Jset),
    goldenHourStart: isNaN(Jgolden) ? null : fromJulian(Jgolden),
  }
}

// Australian states map to a specific IANA zone — this captures which ones
// observe daylight saving (NSW/VIC/ACT/TAS/SA do; QLD/WA/NT don't), which a
// longitude guess can't.
const AU_STATE_TZ: Record<string, string> = {
  'new south wales': 'Australia/Sydney',
  'australian capital territory': 'Australia/Sydney',
  victoria: 'Australia/Melbourne',
  tasmania: 'Australia/Hobart',
  queensland: 'Australia/Brisbane',
  'south australia': 'Australia/Adelaide',
  'western australia': 'Australia/Perth',
  'northern territory': 'Australia/Darwin',
}

// Single-zone (or close enough) countries we commonly see.
const COUNTRY_TZ: Record<string, string> = {
  'new zealand': 'Pacific/Auckland',
  'united kingdom': 'Europe/London',
  ireland: 'Europe/Dublin',
  singapore: 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong',
  japan: 'Asia/Tokyo',
  fiji: 'Pacific/Fiji',
  italy: 'Europe/Rome',
  france: 'Europe/Paris',
  germany: 'Europe/Berlin',
  spain: 'Europe/Madrid',
  netherlands: 'Europe/Amsterdam',
  greece: 'Europe/Athens',
  portugal: 'Europe/Lisbon',
}

/**
 * Best-effort IANA timezone for a geocoded location. Exact for Australian
 * states; a sensible default for common single-zone countries; otherwise the
 * caller's fallback (typically the viewer's zone). Large multi-zone countries
 * (US, Canada, …) fall through to the fallback — store a real per-location zone
 * before relying on those.
 */
export function resolveLocationTimezone(
  country: string | null | undefined,
  state: string | null | undefined,
  fallback: string
): string {
  const c = (country ?? '').toLowerCase().trim()
  const s = (state ?? '').toLowerCase().trim()
  if ((c === 'australia' || c === '') && AU_STATE_TZ[s]) return AU_STATE_TZ[s]
  if (COUNTRY_TZ[c]) return COUNTRY_TZ[c]
  return fallback
}

// ── No-API coordinate fallback ──────────────────────────────────────────────
// Precise per-venue coordinates come from geocoding (weddings.location_lat/lng).
// When those are absent we derive approximate coordinates + timezone from the
// location text so the daylight strip + sun anchors still work — accurate to a
// few minutes, which is plenty for "golden hour is ~5pm". Each place carries its
// own timezone so the clock (not just the latitude) is right.

type Place = { lat: number; lng: number; tz: string }
const SYD = 'Australia/Sydney', MEL = 'Australia/Melbourne', BNE = 'Australia/Brisbane'
const ADL = 'Australia/Adelaide', PER = 'Australia/Perth', HOB = 'Australia/Hobart', DRW = 'Australia/Darwin'

const AU_STATE_PLACE: Record<string, Place> = {
  'new south wales': { lat: -33.87, lng: 151.21, tz: SYD },
  'australian capital territory': { lat: -35.28, lng: 149.13, tz: SYD },
  victoria: { lat: -37.81, lng: 144.96, tz: MEL },
  queensland: { lat: -27.47, lng: 153.03, tz: BNE },
  'south australia': { lat: -34.93, lng: 138.6, tz: ADL },
  'western australia': { lat: -31.95, lng: 115.86, tz: PER },
  tasmania: { lat: -42.88, lng: 147.33, tz: HOB },
  'northern territory': { lat: -12.46, lng: 130.84, tz: DRW },
}
// State abbreviations as they appear in free text ("Gold Coast QLD").
const AU_STATE_ABBR: Record<string, string> = {
  nsw: 'new south wales', act: 'australian capital territory', vic: 'victoria',
  qld: 'queensland', sa: 'south australia', wa: 'western australia',
  tas: 'tasmania', nt: 'northern territory',
}

// Common wedding cities/regions — more precise than the state capital. AU is the
// bulk of the data; a handful of popular overseas destinations are included too.
const CITY_PLACE: Record<string, Place> = {
  sydney: { lat: -33.87, lng: 151.21, tz: SYD },
  newcastle: { lat: -32.93, lng: 151.78, tz: SYD },
  'hunter valley': { lat: -32.73, lng: 151.3, tz: SYD },
  'central coast': { lat: -33.43, lng: 151.34, tz: SYD },
  wollongong: { lat: -34.42, lng: 150.89, tz: SYD },
  'southern highlands': { lat: -34.48, lng: 150.42, tz: SYD },
  mittagong: { lat: -34.45, lng: 150.45, tz: SYD },
  bowral: { lat: -34.48, lng: 150.42, tz: SYD },
  'blue mountains': { lat: -33.71, lng: 150.31, tz: SYD },
  'port macquarie': { lat: -31.43, lng: 152.91, tz: SYD },
  'coffs harbour': { lat: -30.3, lng: 153.12, tz: SYD },
  ballina: { lat: -28.86, lng: 153.56, tz: SYD },
  'byron bay': { lat: -28.64, lng: 153.61, tz: SYD },
  canberra: { lat: -35.28, lng: 149.13, tz: SYD },
  brisbane: { lat: -27.47, lng: 153.03, tz: BNE },
  'gold coast': { lat: -28.0, lng: 153.43, tz: BNE },
  'sunshine coast': { lat: -26.65, lng: 153.07, tz: BNE },
  noosa: { lat: -26.4, lng: 153.09, tz: BNE },
  toowoomba: { lat: -27.56, lng: 151.95, tz: BNE },
  cairns: { lat: -16.92, lng: 145.77, tz: BNE },
  'port douglas': { lat: -16.48, lng: 145.46, tz: BNE },
  townsville: { lat: -19.26, lng: 146.82, tz: BNE },
  'airlie beach': { lat: -20.27, lng: 148.72, tz: BNE },
  whitsundays: { lat: -20.29, lng: 148.76, tz: BNE },
  melbourne: { lat: -37.81, lng: 144.96, tz: MEL },
  geelong: { lat: -38.15, lng: 144.36, tz: MEL },
  'mornington peninsula': { lat: -38.36, lng: 144.99, tz: MEL },
  'yarra valley': { lat: -37.65, lng: 145.44, tz: MEL },
  ballarat: { lat: -37.56, lng: 143.86, tz: MEL },
  bendigo: { lat: -36.76, lng: 144.28, tz: MEL },
  adelaide: { lat: -34.93, lng: 138.6, tz: ADL },
  'barossa valley': { lat: -34.53, lng: 138.95, tz: ADL },
  perth: { lat: -31.95, lng: 115.86, tz: PER },
  'margaret river': { lat: -33.95, lng: 115.07, tz: PER },
  hobart: { lat: -42.88, lng: 147.33, tz: HOB },
  launceston: { lat: -41.43, lng: 147.14, tz: HOB },
  darwin: { lat: -12.46, lng: 130.84, tz: DRW },
  // Popular overseas destinations.
  auckland: { lat: -36.85, lng: 174.76, tz: 'Pacific/Auckland' },
  queenstown: { lat: -45.03, lng: 168.66, tz: 'Pacific/Auckland' },
  bali: { lat: -8.41, lng: 115.19, tz: 'Asia/Makassar' },
  london: { lat: 51.51, lng: -0.13, tz: 'Europe/London' },
}

const COUNTRY_PLACE: Record<string, Place> = {
  'new zealand': { lat: -36.85, lng: 174.76, tz: 'Pacific/Auckland' },
  'united kingdom': { lat: 51.51, lng: -0.13, tz: 'Europe/London' },
  ireland: { lat: 53.35, lng: -6.26, tz: 'Europe/Dublin' },
  singapore: { lat: 1.35, lng: 103.82, tz: 'Asia/Singapore' },
  'hong kong': { lat: 22.32, lng: 114.17, tz: 'Asia/Hong_Kong' },
  japan: { lat: 35.68, lng: 139.69, tz: 'Asia/Tokyo' },
  fiji: { lat: -18.14, lng: 178.44, tz: 'Pacific/Fiji' },
  italy: { lat: 41.9, lng: 12.5, tz: 'Europe/Rome' },
  france: { lat: 48.85, lng: 2.35, tz: 'Europe/Paris' },
  germany: { lat: 52.52, lng: 13.4, tz: 'Europe/Berlin' },
  spain: { lat: 40.42, lng: -3.7, tz: 'Europe/Madrid' },
  netherlands: { lat: 52.37, lng: 4.9, tz: 'Europe/Amsterdam' },
  greece: { lat: 37.98, lng: 23.73, tz: 'Europe/Athens' },
  portugal: { lat: 38.72, lng: -9.14, tz: 'Europe/Lisbon' },
}

// City keys longest-first so "gold coast" wins over a hypothetical "coast".
const CITY_KEYS = Object.keys(CITY_PLACE).sort((a, b) => b.length - a.length)

function hasWord(haystack: string, needle: string): boolean {
  // Word-boundary match on a lowercased haystack — keeps "sa" from matching
  // inside "Pasadena" while still catching "Adelaide SA".
  return new RegExp(`(^|[^a-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(haystack)
}

/**
 * Coordinates + timezone for a wedding's location. Uses precise geocoded
 * lat/lng when present (approx=false); otherwise derives an approximate place
 * from the location text / parsed city / state / country (approx=true). Returns
 * null only when nothing at all resolves.
 */
export function resolveLatLng(opts: {
  lat?: number | null
  lng?: number | null
  location?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  fallbackTimezone: string
}): { lat: number; lng: number; timezone: string; approx: boolean } | null {
  if (opts.lat != null && opts.lng != null) {
    return {
      lat: opts.lat,
      lng: opts.lng,
      timezone: resolveLocationTimezone(opts.country, opts.state, opts.fallbackTimezone),
      approx: false,
    }
  }

  const hay = [opts.city, opts.location, opts.state, opts.country]
    .filter(Boolean)
    .join(' , ')
    .toLowerCase()
    .trim()
  if (!hay) return null

  const approx = (p: Place) => ({ lat: p.lat, lng: p.lng, timezone: p.tz, approx: true })

  // 1. City / region (most specific).
  for (const name of CITY_KEYS) {
    if (hasWord(hay, name)) return approx(CITY_PLACE[name])
  }
  // 2. Australian state (full name or abbreviation).
  for (const full of Object.keys(AU_STATE_PLACE)) {
    if (hasWord(hay, full)) return approx(AU_STATE_PLACE[full])
  }
  for (const [abbr, full] of Object.entries(AU_STATE_ABBR)) {
    if (hasWord(hay, abbr)) return approx(AU_STATE_PLACE[full])
  }
  // 3. Single-zone country (skips large multi-zone countries by omission).
  for (const name of Object.keys(COUNTRY_PLACE)) {
    if (hasWord(hay, name)) return approx(COUNTRY_PLACE[name])
  }
  return null
}

/** Format a UTC instant as a short local time (e.g. "5:23 pm") in the given zone + locale. */
export function formatLocalTime(instant: Date, timezone: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(instant)
  } catch {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(instant)
  }
}

/** Minutes since local midnight for a UTC instant in the given zone. */
function localMinutesInTz(instant: Date, timezone: string): number {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(instant)
    const h = Number(p.find((x) => x.type === 'hour')?.value ?? '0') % 24
    const m = Number(p.find((x) => x.type === 'minute')?.value ?? '0')
    return h * 60 + m
  } catch {
    return instant.getUTCHours() * 60 + instant.getUTCMinutes()
  }
}

/**
 * Sun events as minutes-since-midnight in the wedding's local timezone — the
 * frame the timeline solver works in. Returns null when we lack coordinates or
 * a date. Keys match the solver's sun anchor refs.
 */
export function sunMinutesFor(opts: {
  lat: number | null | undefined
  lng: number | null | undefined
  dateStr: string | null | undefined
  location?: string | null
  city?: string | null
  country?: string | null
  state?: string | null
  fallbackTimezone: string
}): { sunrise: number | null; sunset: number | null; golden_hour: number | null } | null {
  const { dateStr } = opts
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const place = resolveLatLng(opts)
  if (!place) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const s = sunTimes(anchor, place.lat, place.lng)
  return {
    sunrise: s.sunrise ? localMinutesInTz(s.sunrise, place.timezone) : null,
    sunset: s.sunset ? localMinutesInTz(s.sunset, place.timezone) : null,
    golden_hour: s.goldenHourStart ? localMinutesInTz(s.goldenHourStart, place.timezone) : null,
  }
}

export type DaylightStrip = {
  sunrise: string | null
  sunset: string | null
  goldenHourStart: string | null
}

/**
 * Compute the localized daylight strip for a wedding. Uses precise geocoded
 * coordinates when present, otherwise an approximate place derived from the
 * location text (`approx: true`). Returns null only when there's no date or
 * nothing in the location resolves. `dateStr` is YYYY-MM-DD.
 */
export function daylightStrip(opts: {
  lat?: number | null
  lng?: number | null
  dateStr: string | null | undefined
  location?: string | null
  city?: string | null
  country?: string | null
  state?: string | null
  fallbackTimezone: string
  locale: string
}): (DaylightStrip & { timezone: string; approx: boolean }) | null {
  const { dateStr, locale } = opts
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const place = resolveLatLng(opts)
  if (!place) return null

  const [y, m, d] = dateStr.split('-').map(Number)
  // Solar noon-ish anchor for the calendar day, in UTC.
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const s = sunTimes(anchor, place.lat, place.lng)

  return {
    timezone: place.timezone,
    approx: place.approx,
    sunrise: s.sunrise ? formatLocalTime(s.sunrise, place.timezone, locale) : null,
    sunset: s.sunset ? formatLocalTime(s.sunset, place.timezone, locale) : null,
    goldenHourStart: s.goldenHourStart ? formatLocalTime(s.goldenHourStart, place.timezone, locale) : null,
  }
}
