import { describe, it, expect } from 'vitest'
import { t, tp, runWithI18n, getI18n, resolveLocale, isValidTimezone, DEFAULT_LOCALE } from './index'
import { formatDate, formatDateTime, todayString } from '../lib/date'

describe('i18n context', () => {
  it('falls back to platform defaults outside a request context', () => {
    const ctx = getI18n()
    expect(ctx.locale).toBe('en-AU')
    expect(ctx.timezone).toBe('Australia/Sydney')
    expect(ctx.language).toBe('en')
  })

  it('carries the context through runWithI18n', () => {
    runWithI18n({ locale: 'en-US', timezone: 'America/New_York' }, () => {
      expect(getI18n().locale).toBe('en-US')
      expect(getI18n().language).toBe('en')
      expect(getI18n().timezone).toBe('America/New_York')
    })
  })

  it('survives awaits inside the context', async () => {
    await runWithI18n({ locale: 'en-GB' }, async () => {
      await new Promise((r) => setTimeout(r, 1))
      expect(getI18n().locale).toBe('en-GB')
    })
  })
})

describe('t — translation with fallback', () => {
  it('returns the English message for known keys', () => {
    expect(t('nav.contacts')).toBe('Contacts')
    expect(t('common.signOut')).toBe('Sign out')
  })

  it('interpolates {slots}', () => {
    expect(t('common.enquiry.one', { count: 1 })).toBe('1 enquiry')
  })

  it('leaves unknown slots intact rather than erasing them', () => {
    expect(t('common.enquiry.one', {})).toBe('{count} enquiry')
  })
})

describe('tp — plural-aware translation', () => {
  it('selects the singular and plural forms', () => {
    expect(tp('common.enquiry', 1)).toBe('1 enquiry')
    expect(tp('common.enquiry', 3)).toBe('3 enquiries')
    expect(tp('common.booking', 0)).toBe('0 bookings')
  })

  it('formats the count for the locale', () => {
    runWithI18n({ locale: 'en-US' }, () => {
      expect(tp('common.enquiry', 1234)).toBe('1,234 enquiries')
    })
  })
})

describe('resolveLocale', () => {
  it('prefers a valid stored locale', () => {
    expect(resolveLocale('en-US', 'en-GB,en;q=0.9')).toBe('en-US')
  })

  it('rejects unknown stored values and falls back to Accept-Language', () => {
    expect(resolveLocale('xx-XX', 'en-GB,en;q=0.9')).toBe('en-GB')
  })

  it('matches by language when the region is unsupported', () => {
    expect(resolveLocale(null, 'en-IE,en;q=0.9')).toBe('en-AU')
  })

  it('falls back to the default for unsupported languages (for now)', () => {
    expect(resolveLocale(null, 'fr-FR,fr;q=0.9')).toBe(DEFAULT_LOCALE)
    expect(resolveLocale(null, null)).toBe(DEFAULT_LOCALE)
  })
})

describe('isValidTimezone', () => {
  it('accepts IANA zones and rejects junk', () => {
    expect(isValidTimezone('Australia/Brisbane')).toBe(true)
    expect(isValidTimezone('America/New_York')).toBe(true)
    expect(isValidTimezone('Not/AZone')).toBe(false)
    expect(isValidTimezone('<script>')).toBe(false)
  })
})

describe('date formatting follows the i18n context', () => {
  it('orders dates per locale', () => {
    const au = runWithI18n({ locale: 'en-AU' }, () => formatDate('2026-09-19'))
    const us = runWithI18n({ locale: 'en-US' }, () => formatDate('2026-09-19'))
    expect(au).toBe('19 Sept 2026')
    expect(us).toBe('Sep 19, 2026')
  })

  it('renders datetimes in the viewer timezone', () => {
    // 05:36 UTC = 15:36 in Sydney, 01:36 in New York
    const sydney = runWithI18n({ locale: 'en-AU', timezone: 'Australia/Sydney' }, () =>
      formatDateTime('2026-06-11 05:36:00')
    )
    const newYork = runWithI18n({ locale: 'en-US', timezone: 'America/New_York' }, () =>
      formatDateTime('2026-06-11 05:36:00')
    )
    expect(sydney).toContain('3:36')
    expect(newYork).toContain('1:36')
  })

  it("computes today in the viewer's timezone", () => {
    const result = runWithI18n({ timezone: 'Pacific/Auckland' }, () => todayString())
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
