// Weather forecast for a wedding's venue, shown on the dashboard when the date
// is within a week. One forecast is fetched per venue (rounded lat/lng) and
// cached in KV for an hour, so every wedding at that location — and an open
// dashboard polling hourly — shares a single upstream call.
//
// Provider is abstracted (WeatherProvider) so it can be swapped later. The
// default is Open-Meteo, whose `best_match` model auto-selects the Australian
// Bureau of Meteorology ACCESS model for AU locations (falling back to ECMWF
// IFS), which is the most accurate option for Australian venues. Forecasts are
// fetched in metric (°C); display units are converted at render time.

import type { Bindings } from '../types'

export type WeatherDaily = {
  date: string // YYYY-MM-DD (venue-local)
  tempMax: number | null // °C
  tempMin: number | null // °C
  precipProb: number | null // 0-100
  code: number // WMO weather code
}

export type WeatherHourly = {
  time: string // ISO, venue-local
  hour: number // 0-23 venue-local
  temp: number | null // °C
  precipProb: number | null // 0-100
  code: number // WMO weather code
  isDay: boolean
}

export type Forecast = {
  daily: WeatherDaily[]
  hourly: WeatherHourly[]
  timezone: string
  fetchedAt: string
}

export interface WeatherProvider {
  fetch(opts: { lat: number; lng: number }): Promise<Forecast | null>
}

const FORECAST_DAYS = 10 // covers any wedding within 7 days + its run-up
const FRESH_MS = 60 * 60 * 1000 // refresh hourly
const STALE_TTL_SECONDS = 24 * 60 * 60 // keep a servable copy for a day past the last refresh

// ─── Open-Meteo provider ───

class OpenMeteoProvider implements WeatherProvider {
  constructor(private apiKey?: string) {}

  async fetch({ lat, lng }: { lat: number; lng: number }): Promise<Forecast | null> {
    // Commercial endpoint when a key is configured; free endpoint otherwise
    // (local dev only — Open-Meteo's free tier is non-commercial).
    const host = this.apiKey ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com'
    const url = new URL(`${host}/v1/forecast`)
    url.searchParams.set('latitude', String(lat))
    url.searchParams.set('longitude', String(lng))
    url.searchParams.set('timezone', 'auto') // venue-local day boundaries + hour labels
    url.searchParams.set('forecast_days', String(FORECAST_DAYS))
    url.searchParams.set('temperature_unit', 'celsius')
    url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max')
    url.searchParams.set('hourly', 'weather_code,temperature_2m,precipitation_probability,is_day')
    // best_match (the default) picks BoM ACCESS for AU, else ECMWF IFS.
    if (this.apiKey) url.searchParams.set('apikey', this.apiKey)

    let json: any
    try {
      const res = await fetch(url.toString(), { headers: { 'User-Agent': 'WeddingComputer/1.0 (wedding.computer)' } })
      if (!res.ok) return null
      json = await res.json()
    } catch {
      return null
    }
    return normalizeOpenMeteo(json)
  }
}

export function normalizeOpenMeteo(json: any): Forecast | null {
  if (!json || typeof json !== 'object') return null
  const tz = String(json.timezone ?? 'UTC')
  const d = json.daily ?? {}
  const h = json.hourly ?? {}
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  const daily: WeatherDaily[] = Array.isArray(d.time)
    ? d.time.map((date: string, i: number) => ({
        date: String(date),
        tempMax: num(d.temperature_2m_max?.[i]),
        tempMin: num(d.temperature_2m_min?.[i]),
        precipProb: num(d.precipitation_probability_max?.[i]),
        code: num(d.weather_code?.[i]) ?? 0,
      }))
    : []

  const hourly: WeatherHourly[] = Array.isArray(h.time)
    ? h.time.map((time: string, i: number) => ({
        time: String(time),
        hour: parseInt(String(time).slice(11, 13), 10) || 0,
        temp: num(h.temperature_2m?.[i]),
        precipProb: num(h.precipitation_probability?.[i]),
        code: num(h.weather_code?.[i]) ?? 0,
        isDay: h.is_day?.[i] === 1 || h.is_day?.[i] === true,
      }))
    : []

  if (daily.length === 0) return null
  return { daily, hourly, timezone: tz, fetchedAt: new Date().toISOString() }
}

// ─── Public API (cached) ───

// Open-Meteo's free endpoint is used until WEATHER_API_KEY is set, at which
// point requests switch to the paid commercial endpoint. The free tier is
// non-commercial — fine during evaluation, but set the key (and subscribe)
// before the product is in commercial use with real customers.
function provider(env: Bindings): WeatherProvider {
  return new OpenMeteoProvider(env.WEATHER_API_KEY)
}

async function fetchAndCache(env: Bindings, key: string, lat: number, lng: number): Promise<Forecast | null> {
  const forecast = await provider(env).fetch({ lat, lng })
  if (forecast) {
    await env.KV.put(key, JSON.stringify(forecast), { expirationTtl: STALE_TTL_SECONDS }).catch(() => {})
  }
  return forecast
}

// Forecast for a venue, cached in KV per rounded location (~1km grid). Round to
// 2dp so nearby weddings share a cache entry and to keep the key stable across
// tiny geocode jitter. STALE-WHILE-REVALIDATE: a cached copy is served instantly
// (so a page view NEVER blocks on the upstream call), and when it's older than an
// hour the refresh runs in the background. Only the very first view for a venue
// (cold cache) pays the upstream latency. Returns null when unavailable.
export async function getVenueForecast(
  env: Bindings,
  opts: { lat: number; lng: number },
  ctx?: { waitUntil(p: Promise<unknown>): void }
): Promise<Forecast | null> {
  const lat = Math.round(opts.lat * 100) / 100
  const lng = Math.round(opts.lng * 100) / 100
  const key = `wx:om:${lat.toFixed(2)},${lng.toFixed(2)}`

  let cached: Forecast | null = null
  try {
    const raw = await env.KV.get(key)
    if (raw) cached = JSON.parse(raw) as Forecast
  } catch {
    /* cache is best-effort */
  }

  if (cached) {
    const fresh = Date.now() - Date.parse(cached.fetchedAt) < FRESH_MS
    if (!fresh) {
      // Serve the cached copy now; refresh hourly in the background.
      const refresh = fetchAndCache(env, key, lat, lng).catch(() => null)
      if (ctx) ctx.waitUntil(refresh)
    }
    return cached
  }

  // Cold cache: this view pays the one-off upstream latency.
  return fetchAndCache(env, key, lat, lng)
}

// ─── WMO weather code → emoji + i18n label ───

// Buckets follow the WMO interpretation codes Open-Meteo returns. The label is
// an i18n key under weather.cond.*; the icon is an emoji (day/night aware for
// clear/partly-cloudy so night forecasts read correctly).
export function wmoCondition(code: number, isDay = true): { icon: string; labelKey: string } {
  const c = (icon: string, slug: string) => ({ icon, labelKey: `weather.cond.${slug}` })
  if (code === 0) return isDay ? c('☀️', 'clear') : c('🌙', 'clear')
  if (code === 1) return isDay ? c('🌤️', 'mainlyClear') : c('🌙', 'mainlyClear')
  if (code === 2) return isDay ? c('⛅', 'partlyCloudy') : c('☁️', 'partlyCloudy')
  if (code === 3) return c('☁️', 'overcast')
  if (code === 45 || code === 48) return c('🌫️', 'fog')
  if (code >= 51 && code <= 57) return c('🌦️', 'drizzle')
  if (code >= 61 && code <= 67) return c('🌧️', 'rain')
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return c('🌨️', 'snow')
  if (code >= 80 && code <= 82) return c('🌦️', 'showers')
  if (code >= 95 && code <= 99) return c('⛈️', 'thunderstorm')
  return c('☁️', 'overcast')
}

export type TempUnit = 'c' | 'f'

// The viewer's chosen unit, defaulting to Celsius (what most of the world uses)
// regardless of locale. Stored on users.temperature_unit ('c' | 'f' | null).
export function resolveTempUnit(user?: { temperature_unit?: string | null } | null): TempUnit {
  return user?.temperature_unit === 'f' ? 'f' : 'c'
}

// Convert a stored (°C) temperature to the chosen unit. `|| 0` collapses a
// rounded -0 (e.g. -0.4°C) to 0 so it never renders as "-0°".
export function displayTemp(celsius: number | null, unit: TempUnit): { value: number; unit: string } | null {
  if (celsius == null) return null
  return unit === 'f'
    ? { value: Math.round((celsius * 9) / 5 + 32) || 0, unit: '°F' }
    : { value: Math.round(celsius) || 0, unit: '°C' }
}
