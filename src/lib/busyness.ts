// Shared interpretation of a busyness/demand score into a human-readable tier.
//
// A score is a ratio of a date's weighted activity (enquiries + 3×bookings) to
// the average across all dates for that area, so 1.0 == an average date, >1 is
// busier than average, <1 is quieter. Thresholds mirror the analytics heatmap
// shading (see HeatmapGrid in routes/vendor/analytics.tsx) so the same date
// reads consistently wherever it appears.

export type DemandTier = 'normal' | 'quiet' | 'below' | 'above' | 'high'

export type DemandDescription = {
  tier: DemandTier
  label: string
  dotClass: string // Tailwind background for the indicator dot
  textClass: string // Tailwind text colour for the label
}

export function describeDemand(score: number | null | undefined): DemandDescription {
  // No aggregation row just means nothing notable was recorded for the date —
  // report that as normal rather than an apologetic "not enough data".
  if (score === null || score === undefined || Number.isNaN(score)) {
    return { tier: 'normal', label: 'Normal demand', dotClass: 'bg-gray-300', textClass: 'text-gray-600' }
  }
  if (score >= 2.0) {
    return { tier: 'high', label: 'Very high demand', dotClass: 'bg-horizon-700', textClass: 'text-horizon-700' }
  }
  if (score >= 1.0) {
    return { tier: 'above', label: 'Above-average demand', dotClass: 'bg-horizon-500', textClass: 'text-horizon-700' }
  }
  if (score >= 0.5) {
    return { tier: 'below', label: 'Below-average demand', dotClass: 'bg-horizon-300', textClass: 'text-gray-600' }
  }
  return { tier: 'quiet', label: 'Quiet date', dotClass: 'bg-gray-300', textClass: 'text-gray-500' }
}

// ─── Historical bucket helpers ───
//
// Calendar dates don't repeat across years, but "September", "spring", and
// "the 3rd weekend of September" do. These helpers map a date onto those
// recurring buckets so demand_history can compare year-on-year.

// Southern-hemisphere seasons — the platform is Australia-first. December is
// bucketed into its own calendar year's summer (so "summer 2025" = Dec 2025 +
// Jan/Feb 2025), keeping each year self-contained.
export function seasonOf(month: number): 'summer' | 'autumn' | 'winter' | 'spring' {
  if (month === 12 || month <= 2) return 'summer'
  if (month <= 5) return 'autumn'
  if (month <= 8) return 'winter'
  return 'spring'
}

export const SEASON_LABELS: Record<string, string> = {
  summer: 'Summer (Dec–Feb)',
  autumn: 'Autumn (Mar–May)',
  winter: 'Winter (Jun–Aug)',
  spring: 'Spring (Sep–Nov)',
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

/**
 * The weekend a Fri/Sat/Sun date belongs to, anchored on its Saturday: the
 * Nth weekend of a month is the one containing the month's Nth Saturday.
 * Weekday dates (Mon–Thu) return null — they aren't part of a weekend.
 * Fri/Sun near a month boundary take the anchor Saturday's month and year.
 */
export function weekendBucketOf(dateStr: string): { year: number; month: number; index: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return null
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dow = new Date(Date.UTC(y, mo - 1, da)).getUTCDay() // 0=Sun … 6=Sat
  let offset: number
  if (dow === 6) offset = 0
  else if (dow === 5) offset = 1
  else if (dow === 0) offset = -1
  else return null
  const sat = new Date(Date.UTC(y, mo - 1, da + offset))
  return {
    year: sat.getUTCFullYear(),
    month: sat.getUTCMonth() + 1,
    index: Math.ceil(sat.getUTCDate() / 7),
  }
}

export function ordinal(n: number): string {
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
}

/**
 * Render a demand ratio (1.0 = average) as a relative phrase. The underlying
 * counts are cross-vendor aggregates, so the UI only ever shows how a window
 * compares to the average window of the same kind — never absolute volumes.
 *   formatVsAverage(1.45, 'month')   → "+45% vs the average month"
 *   formatVsAverage(0.7, 'weekend')  → "−30% vs the average weekend"
 *   formatVsAverage(3.25, 'date')    → "3.3× the average date"
 *   formatVsAverage(1.05, 'season')  → "in line with the average season"
 */
export function formatVsAverage(ratio: number | null | undefined, noun: string): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) {
    return `in line with the average ${noun}`
  }
  const pct = Math.round((ratio - 1) * 100)
  if (Math.abs(pct) <= 10) {
    return `in line with the average ${noun}`
  }
  // Sparse data makes big multipliers meaninglessly precise ("52× the average
  // weekend" when one weekend held a year's only activity) — go qualitative.
  if (ratio >= 5) {
    return `well above the average ${noun}`
  }
  if (ratio >= 2) {
    const mult = Math.round(ratio * 10) / 10
    return `${Number.isInteger(mult) ? mult.toFixed(0) : mult}× the average ${noun}`
  }
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% vs the average ${noun}`
}
