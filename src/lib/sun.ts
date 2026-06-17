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
  country?: string | null
  state?: string | null
  fallbackTimezone: string
}): { sunrise: number | null; sunset: number | null; golden_hour: number | null } | null {
  const { lat, lng, dateStr, fallbackTimezone } = opts
  if (lat == null || lng == null || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const tz = resolveLocationTimezone(opts.country, opts.state, fallbackTimezone)
  const s = sunTimes(anchor, lat, lng)
  return {
    sunrise: s.sunrise ? localMinutesInTz(s.sunrise, tz) : null,
    sunset: s.sunset ? localMinutesInTz(s.sunset, tz) : null,
    golden_hour: s.goldenHourStart ? localMinutesInTz(s.goldenHourStart, tz) : null,
  }
}

export type DaylightStrip = {
  sunrise: string | null
  sunset: string | null
  goldenHourStart: string | null
}

/**
 * Compute the localized daylight strip for a wedding. Returns null when we lack
 * coordinates or a date (nothing to show). `dateStr` is YYYY-MM-DD.
 */
export function daylightStrip(opts: {
  lat: number | null | undefined
  lng: number | null | undefined
  dateStr: string | null | undefined
  country?: string | null
  state?: string | null
  fallbackTimezone: string
  locale: string
}): (DaylightStrip & { timezone: string }) | null {
  const { lat, lng, dateStr, fallbackTimezone, locale } = opts
  if (lat == null || lng == null || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null

  const [y, m, d] = dateStr.split('-').map(Number)
  // Solar noon-ish anchor for the calendar day, in UTC.
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const tz = resolveLocationTimezone(opts.country, opts.state, fallbackTimezone)
  const s = sunTimes(anchor, lat, lng)

  return {
    timezone: tz,
    sunrise: s.sunrise ? formatLocalTime(s.sunrise, tz, locale) : null,
    sunset: s.sunset ? formatLocalTime(s.sunset, tz, locale) : null,
    goldenHourStart: s.goldenHourStart ? formatLocalTime(s.goldenHourStart, tz, locale) : null,
  }
}
