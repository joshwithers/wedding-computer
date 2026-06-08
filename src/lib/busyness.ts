// Shared interpretation of a busyness/demand score into a human-readable tier.
//
// A score is a ratio of a date's weighted activity (enquiries + 3×bookings) to
// the average across all dates for that area, so 1.0 == an average date, >1 is
// busier than average, <1 is quieter. Thresholds mirror the analytics heatmap
// shading (see HeatmapGrid in routes/vendor/analytics.tsx) so the same date
// reads consistently wherever it appears.

export type DemandTier = 'unknown' | 'quiet' | 'below' | 'above' | 'high'

export type DemandDescription = {
  tier: DemandTier
  label: string
  dotClass: string // Tailwind background for the indicator dot
  textClass: string // Tailwind text colour for the label
}

export function describeDemand(score: number | null | undefined): DemandDescription {
  if (score === null || score === undefined || Number.isNaN(score)) {
    return { tier: 'unknown', label: 'Not enough data yet', dotClass: 'bg-gray-300', textClass: 'text-gray-500' }
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
