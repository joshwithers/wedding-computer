// Pure derivations for the analytics dashboard. Kept free of D1/i18n so the
// logic is unit-testable; the route feeds in raw numbers and renders the
// result. Insights return codes + params, not prose — the route maps codes to
// translated strings.

// ─── Conversion funnel ───
//
// We only store a contact's *current* status, so a real cohort funnel isn't
// reconstructable. Instead we show "how many leads reached at least this
// stage": rank the current status and count everyone at-or-beyond each stage.
// That guarantees monotonically non-increasing bars and meaningful drop-off,
// unlike grouping by current status (which lets Booked exceed Quoted).

const STATUS_RANK: Record<string, number> = {
  new: 1,
  contacted: 2,
  meeting: 3,
  quoted: 4,
  booked: 5,
  completed: 5, // a completed wedding reached booking
  // lost/archived: terminal with unknown progress — floored to 1 (was a lead)
  lost: 1,
  archived: 1,
}

export const FUNNEL_STAGES = [
  { status: 'new', rank: 1 },
  { status: 'contacted', rank: 2 },
  { status: 'meeting', rank: 3 },
  { status: 'quoted', rank: 4 },
  { status: 'booked', rank: 5 },
] as const

export type FunnelStage = {
  status: string
  count: number
  /** % lost from the previous stage (0 for the first stage). */
  dropOffPct: number
}

/**
 * Cumulative funnel from a map of current-status → count.
 * Each stage count = contacts whose current status ranks at or above it.
 */
export function buildFunnel(statusCounts: Record<string, number>): FunnelStage[] {
  const reached = (rank: number) =>
    Object.entries(statusCounts).reduce(
      (sum, [status, count]) => sum + ((STATUS_RANK[status] ?? 1) >= rank ? count : 0),
      0
    )

  let prev = 0
  return FUNNEL_STAGES.map((stage, i) => {
    const count = reached(stage.rank)
    const dropOffPct = i > 0 && prev > 0 ? Math.round(((prev - count) / prev) * 100) : 0
    prev = count
    return { status: stage.status, count, dropOffPct }
  })
}

// ─── Median (response time, etc.) ───

/** Median of a numeric list, or null when empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Compact "2h" / "1.5d" / "30m" label for an hours value (viewer-neutral). */
export function formatDuration(hours: number): { code: string; value: number } {
  if (hours < 1) return { code: 'minutes', value: Math.max(1, Math.round(hours * 60)) }
  if (hours < 48) return { code: 'hours', value: Math.round(hours * 10) / 10 }
  return { code: 'days', value: Math.round((hours / 24) * 10) / 10 }
}

// ─── Insights ───
//
// Turn the headline numbers into at most a few prescriptive lines. Each insight
// is a { code, params, tone } the route translates. Order = priority; the route
// shows the top N.

export type InsightTone = 'good' | 'warn' | 'info'
export type Insight = { code: string; params: Record<string, string | number>; tone: InsightTone }

export type InsightInputs = {
  enquiries30d: number
  enquiriesPrev30d: number
  bookings30d: number
  bookingRate: number
  industryBookingRate: number | null
  medianResponseHours: number | null
  busiestUpcomingMonth: string | null // month label, e.g. "October"
}

export function buildInsights(i: InsightInputs): Insight[] {
  const out: Insight[] = []

  // Response time — the single most actionable lever for vendors.
  if (i.medianResponseHours != null) {
    if (i.medianResponseHours <= 4) {
      out.push({ code: 'response_fast', params: {}, tone: 'good' })
    } else if (i.medianResponseHours >= 24) {
      // Raw hours — the route formats to a localised duration string.
      out.push({ code: 'response_slow', params: { hours: i.medianResponseHours }, tone: 'warn' })
    }
  }

  // Booking rate vs industry.
  if (i.industryBookingRate != null && i.industryBookingRate > 0) {
    const diff = i.bookingRate - i.industryBookingRate
    if (diff <= -5) {
      out.push({ code: 'rate_below', params: { yours: i.bookingRate, industry: i.industryBookingRate }, tone: 'warn' })
    } else if (diff >= 5) {
      out.push({ code: 'rate_above', params: { yours: i.bookingRate, industry: i.industryBookingRate }, tone: 'good' })
    }
  }

  // Enquiry volume movement.
  if (i.enquiries30d === 0 && i.enquiriesPrev30d === 0) {
    out.push({ code: 'no_enquiries', params: {}, tone: 'warn' })
  } else if (i.enquiriesPrev30d > 0) {
    const change = Math.round(((i.enquiries30d - i.enquiriesPrev30d) / i.enquiriesPrev30d) * 100)
    if (change <= -25) out.push({ code: 'enquiries_down', params: { pct: Math.abs(change) }, tone: 'warn' })
    else if (change >= 25) out.push({ code: 'enquiries_up', params: { pct: change }, tone: 'good' })
  }

  // Seasonality nudge.
  if (i.busiestUpcomingMonth) {
    out.push({ code: 'busy_month', params: { month: i.busiestUpcomingMonth }, tone: 'info' })
  }

  return out
}
