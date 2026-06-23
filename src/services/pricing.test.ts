import { describe, it, expect, vi, afterEach } from 'vitest'
import { runWithI18n } from '../i18n'
import { countryToCurrency, resolveCurrency, isCurrencyCode, formatPrice, refreshPrices } from './pricing'

describe('countryToCurrency', () => {
  it('maps the home market and key currencies', () => {
    expect(countryToCurrency('AU')).toBe('AUD')
    expect(countryToCurrency('US')).toBe('USD')
    expect(countryToCurrency('GB')).toBe('GBP')
    expect(countryToCurrency('NZ')).toBe('NZD')
    expect(countryToCurrency('CA')).toBe('CAD')
    expect(countryToCurrency('SG')).toBe('SGD')
    expect(countryToCurrency('JP')).toBe('JPY')
  })

  it('maps the eurozone to EUR, case-insensitively', () => {
    expect(countryToCurrency('FR')).toBe('EUR')
    expect(countryToCurrency('DE')).toBe('EUR')
    expect(countryToCurrency('hr')).toBe('EUR')
  })

  it('defaults a known-but-unmapped country to USD', () => {
    expect(countryToCurrency('IN')).toBe('USD')
    expect(countryToCurrency('BR')).toBe('USD')
  })

  it('falls back to the AUD anchor when geo is unknown', () => {
    expect(countryToCurrency(undefined)).toBe('AUD')
    expect(countryToCurrency(null)).toBe('AUD')
    expect(countryToCurrency('')).toBe('AUD')
  })
})

describe('resolveCurrency', () => {
  it('lets a valid cookie override geo', () => {
    expect(resolveCurrency('AU', 'usd')).toBe('USD')
    expect(resolveCurrency('US', 'EUR')).toBe('EUR')
  })

  it('ignores an invalid cookie and uses geo', () => {
    expect(resolveCurrency('US', 'bitcoin')).toBe('USD')
    expect(resolveCurrency('AU', '')).toBe('AUD')
  })
})

describe('isCurrencyCode', () => {
  it('accepts supported codes case-insensitively', () => {
    expect(isCurrencyCode('aud')).toBe(true)
    expect(isCurrencyCode('JPY')).toBe(true)
  })

  it('rejects unknown or empty values', () => {
    expect(isCurrencyCode('xxx')).toBe(false)
    expect(isCurrencyCode(null)).toBe(false)
    expect(isCurrencyCode(undefined)).toBe(false)
  })
})

describe('formatPrice', () => {
  it('formats whole-unit amounts without decimals', () => {
    runWithI18n({ locale: 'en-AU' }, () => {
      expect(formatPrice(2800, 'AUD')).not.toContain('.')
      expect(formatPrice(2800, 'AUD')).toMatch(/28/)
      expect(formatPrice(1900, 'USD')).toMatch(/19/)
    })
  })

  it('treats JPY as zero-decimal: the amount is whole yen, not cents', () => {
    runWithI18n({ locale: 'en-AU' }, () => {
      // 2800 must render as ¥2,800 — NOT ¥28 (which would be 2800/100).
      const yen = formatPrice(2800, 'JPY')
      expect(yen).toMatch(/2.?800/)
      expect(yen).not.toContain('.')
    })
  })
})

describe('refreshPrices', () => {
  afterEach(() => vi.unstubAllGlobals())

  const stubFx = (rates: Record<string, number>) =>
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ rates }) })))

  it('derives rounded-up local prices from the AUD anchor', async () => {
    stubFx({ USD: 0.66, EUR: 0.61, GBP: 0.52, JPY: 99 })
    const put = vi.fn(async () => {})
    const env = { KV: { put, get: async () => null } } as any

    const map = await refreshPrices(env)

    expect(map.USD).toBe(1900) // 28 × 0.66 = 18.48 → ceil $19
    expect(map.EUR).toBe(1800) // 28 × 0.61 = 17.08 → ceil €18
    expect(map.GBP).toBe(1500) // 28 × 0.52 = 14.56 → ceil £15
    expect(map.JPY).toBe(2800) // 28 × 99 = 2772 → ceil to ¥2,800 (whole yen, zero-decimal)
    expect(map.AUD).toBe(2800) // anchor unchanged
    expect(put).toHaveBeenCalledOnce()
  })

  it('keeps a currency fallback when the FX response omits it', async () => {
    stubFx({ USD: 0.66 })
    const env = { KV: { put: async () => {}, get: async () => null } } as any

    const map = await refreshPrices(env)

    expect(map.USD).toBe(1900)
    expect(map.NZD).toBe(3100) // missing from FX → fallback retained, not dropped
  })
})
