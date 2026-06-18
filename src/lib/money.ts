import { getI18n } from '../i18n'

// The platform bills in AUD (Stripe AUD, single-currency). We still format
// through the viewer's locale so digit grouping and the symbol match their
// conventions — never a hardcoded 'en-AU'.
const CURRENCY = 'AUD'

/**
 * Format integer cents as money in the viewer's locale.
 * `cents=0`, no fraction digits by default (e.g. "$1,250"); pass
 * `{ cents: true }` for "$1,250.00".
 */
export function formatMoneyCents(cents: number, opts?: { cents?: boolean }): string {
  const { locale } = getI18n()
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: CURRENCY,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: opts?.cents ? 2 : 0,
    maximumFractionDigits: opts?.cents ? 2 : 0,
  }).format(cents / 100)
}
