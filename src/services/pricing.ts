// Multi-currency presentment for the Pro subscription.
//
// A$28/month (incl. 10% Australian GST) is the SINGLE source of truth. Every
// other currency is *derived* from it: a daily cron fetches AUD→X rates (ECB
// data via Frankfurter), converts, and rounds UP to a clean whole unit so the
// headline price stays stable across small FX wobbles and never undercharges.
//
// Tax model is deliberately simple (see the pricing decision): foreign prices
// are treated as tax-inclusive all-in, with no Stripe Tax. Australian GST
// handling is unchanged — AUD is fixed at the $28 anchor.
//
// The viewer's presentment currency is resolved at the edge from Cloudflare's
// request.cf.country (free, no geo-IP service), overridable by the
// wc_currency cookie, and carried on the i18n context so any component can
// read it via getI18n().currency without prop-drilling — mirroring t().

import type { Env } from '../types'
import { getI18n } from '../i18n'

export type CurrencyCode = 'AUD' | 'USD' | 'GBP' | 'EUR' | 'NZD' | 'CAD' | 'SGD' | 'JPY'

const BASE_CODE: CurrencyCode = 'AUD'
const BASE_MAJOR = 28 // A$28 incl. GST — the anchor every other price derives from

// Stripe zero-decimal currencies: amount is the whole unit, NOT cents. JPY is
// the only one in our set, so ¥2800 means unit_amount 2800 (not 280000).
const ZERO_DECIMAL = new Set<CurrencyCode>(['JPY'])

type CurrencyDef = {
  label: string
  // Round UP to the nearest multiple of `step` major units. Whole dollars for
  // most; ¥ rounds to the nearest 100 so it stays a clean figure.
  step: number
  // Seed/fallback price in Stripe minor units (cents, or whole yen for JPY).
  // Used before the first cron refresh and whenever the FX fetch fails.
  fallback: number
}

export const CURRENCIES: Record<CurrencyCode, CurrencyDef> = {
  AUD: { label: 'Australian dollar', step: 1, fallback: 2800 },
  USD: { label: 'US dollar', step: 1, fallback: 1900 },
  GBP: { label: 'British pound', step: 1, fallback: 1500 },
  EUR: { label: 'Euro', step: 1, fallback: 1800 },
  NZD: { label: 'New Zealand dollar', step: 1, fallback: 3100 },
  CAD: { label: 'Canadian dollar', step: 1, fallback: 2600 },
  SGD: { label: 'Singapore dollar', step: 1, fallback: 2500 },
  JPY: { label: 'Japanese yen', step: 100, fallback: 2800 },
}

export const PRESENTMENT_CURRENCIES = Object.keys(CURRENCIES) as CurrencyCode[]

// ISO-3166 alpha-2 → presentment currency. The Eurozone (and de-facto euro
// users) share EUR; anything unmapped falls back to USD, the international
// default. AUD is home.
const EUROZONE = ['AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES', 'AD', 'MC', 'SM', 'VA', 'ME', 'XK']
const COUNTRY_CURRENCY: Record<string, CurrencyCode> = {
  AU: 'AUD', US: 'USD', GB: 'GBP', NZ: 'NZD', CA: 'CAD', SG: 'SGD', JP: 'JPY',
  ...Object.fromEntries(EUROZONE.map((c) => [c, 'EUR' as CurrencyCode])),
}

export function isCurrencyCode(value?: string | null): value is CurrencyCode {
  return !!value && value.toUpperCase() in CURRENCIES
}

export function countryToCurrency(country?: string | null): CurrencyCode {
  if (!country) return 'AUD' // geo unknown (non-edge request, local dev) → home/anchor currency
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? 'USD' // known but unmapped → international default
}

/** Resolve the viewer's presentment currency: an explicit cookie wins, else geo. */
export function resolveCurrency(country?: string | null, cookie?: string | null): CurrencyCode {
  if (isCurrencyCode(cookie)) return cookie.toUpperCase() as CurrencyCode
  return countryToCurrency(country)
}

function roundUpTo(major: number, step: number): number {
  return Math.ceil(major / step) * step
}

/** Convert the AUD anchor into one currency's Stripe unit amount. */
function deriveUnitAmount(code: CurrencyCode, audRate: number): number {
  if (code === BASE_CODE) return CURRENCIES[BASE_CODE].fallback // AUD fixed at the anchor
  const major = roundUpTo(BASE_MAJOR * audRate, CURRENCIES[code].step)
  return ZERO_DECIMAL.has(code) ? major : major * 100
}

type PriceMap = Record<CurrencyCode, number>

const KV_KEY = 'pricing:prices'
const MEM_TTL_MS = 60 * 60 * 1000 // 1h in-isolation cache; FX only refreshes daily

let memCache: { at: number; map: PriceMap } | null = null

function fallbackMap(): PriceMap {
  return Object.fromEntries(PRESENTMENT_CURRENCIES.map((c) => [c, CURRENCIES[c].fallback])) as PriceMap
}

/**
 * The current price map (Stripe unit amounts per currency), KV-backed with an
 * in-isolation memory cache and a hardcoded fallback so prices always resolve
 * — even before the first cron refresh or if KV/FX is unavailable.
 */
export async function getPriceMap(env: Env['Bindings']): Promise<PriceMap> {
  if (memCache && Date.now() - memCache.at < MEM_TTL_MS) return memCache.map
  let map = fallbackMap()
  try {
    const raw = await env.KV.get(KV_KEY)
    if (raw) {
      const stored = JSON.parse(raw) as Partial<PriceMap>
      // Merge over the fallback so a newly-added currency still resolves until
      // the next refresh writes it.
      map = { ...map, ...stored }
    }
  } catch {
    // KV miss / parse error → fallback map.
  }
  memCache = { at: Date.now(), map }
  return map
}

export type ProPrice = {
  currency: CurrencyCode
  unitAmount: number // Stripe unit_amount (cents, or whole yen for JPY)
  stripeCurrency: string // lowercase, for the Stripe API
  formatted: string // localized for the viewer, e.g. "US$19", "¥2,800"
}

/** Resolve the Pro price for a currency, formatted in the viewer's locale. */
export async function getProPrice(env: Env['Bindings'], code: CurrencyCode): Promise<ProPrice> {
  const map = await getPriceMap(env)
  const unitAmount = map[code] ?? CURRENCIES[code].fallback
  return {
    currency: code,
    unitAmount,
    stripeCurrency: code.toLowerCase(),
    formatted: formatPrice(unitAmount, code),
  }
}

/** Localized currency string. Prices are whole units, so no fraction digits. */
export function formatPrice(unitAmount: number, code: CurrencyCode): string {
  const value = ZERO_DECIMAL.has(code) ? unitAmount : unitAmount / 100
  try {
    return new Intl.NumberFormat(getI18n().locale, {
      style: 'currency',
      currency: code,
      // Prefer the glyph (€, £, ¥, $) over the ISO code. Dollar currencies
      // collapse to "$", which reads correctly since each viewer sees their
      // own currency; the switcher + ISO label disambiguate elsewhere.
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${code} ${value}`
  }
}

/**
 * Daily cron: fetch AUD→X rates and recompute the rounded price map into KV.
 * Frankfurter is free, key-less, ECB-sourced. On any failure we keep the last
 * good KV value (or the fallback) rather than writing garbage.
 */
export async function refreshPrices(env: Env['Bindings']): Promise<PriceMap> {
  const res = await fetch(`https://api.frankfurter.app/latest?base=${BASE_CODE}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`fx ${res.status}`)
  const data = (await res.json()) as { rates?: Record<string, number> }
  const rates = data.rates ?? {}

  const map = fallbackMap()
  for (const code of PRESENTMENT_CURRENCIES) {
    if (code === BASE_CODE) continue
    const rate = rates[code]
    if (typeof rate === 'number' && rate > 0) {
      map[code] = deriveUnitAmount(code, rate)
    }
    // else: keep this currency's fallback rather than dropping it.
  }

  await env.KV.put(KV_KEY, JSON.stringify(map))
  memCache = { at: Date.now(), map }
  return map
}
