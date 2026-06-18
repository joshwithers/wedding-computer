import { Hono } from 'hono'
import type { Env } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { isProVendor } from '../../db/subscriptions'
import {
  countEvents,
  countEventsGlobal,
  getMonthlyEventCounts,
  getConversionFunnel,
  getRevenue,
  getSourceBreakdown,
  getAverageSpendPerWedding,
  countVendors,
  getFirstResponseDurations,
  getMonthlyRevenue,
} from '../../db/analytics'
import { listGoals, upsertGoal, deleteGoal, getCurrentYearGoals } from '../../db/goals'
import { getDateHeatmap } from '../../db/busyness'
import { formatVsAverage } from '../../lib/busyness'
import { aggregateSources } from '../../lib/sources'
import { buildFunnel, buildInsights, median, formatDuration, type Insight } from '../../lib/analytics-derive'
import { formatMoneyCents } from '../../lib/money'
import { t, getI18n } from '../../i18n'
import { todayString, formatDayLabel } from '../../lib/date'

const analytics = new Hono<Env>()

analytics.use('/app/analytics', requireAuth, csrf, requireVendor)
analytics.use('/app/analytics/*', requireAuth, csrf, requireVendor)

// ─── Helpers ───

function formatPct(value: number): string {
  return `${Math.round(value)}%`
}

function pctChange(current: number, previous: number): { value: number; label: string; positive: boolean } {
  if (previous === 0 && current === 0) return { value: 0, label: '0%', positive: true }
  if (previous === 0) return { value: 100, label: '+100%', positive: true }
  const change = Math.round(((current - previous) / previous) * 100)
  return {
    value: change,
    label: `${change >= 0 ? '+' : ''}${change}%`,
    positive: change >= 0,
  }
}

/** Day offsets and the calendar year computed from the viewer's "today". */
function dateWindows(today: string) {
  const dayOffset = (n: number) =>
    new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
  const year = Number(today.slice(0, 4))
  return {
    today,
    tomorrow: dayOffset(1),
    thirtyDaysAgo: dayOffset(-30),
    sixtyDaysAgo: dayOffset(-60),
    thirtyAhead: dayOffset(30),
    ninetyAhead: dayOffset(90),
    yearStart: `${year}-01-01`,
    yearEnd: `${year + 1}-01-01`,
    year,
  }
}

function shortMonth(year: number, month: number, locale: string): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })
}

function last12Months(today: string, locale: string): { year: number; month: number; label: string }[] {
  const [y, m] = today.split('-').map(Number)
  const months: { year: number; month: number; label: string }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    const yy = d.getUTCFullYear()
    const mm = d.getUTCMonth() + 1
    months.push({ year: yy, month: mm, label: shortMonth(yy, mm, locale) })
  }
  return months
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

/**
 * [start, end) window for a goal's period.
 * period_value is free text: "2026" (year), "2026-06" (month), "summer-2026"
 * or "2026-spring" (season). Seasons use Southern-Hemisphere bounds matching
 * lib/busyness seasonOf (summer = Dec–Feb, wrapping into the next year).
 */
function goalPeriodRange(periodType: string, periodValue: string, fallbackYear: number): [string, string] {
  if (periodType === 'month' && /^\d{4}-\d{2}$/.test(periodValue)) {
    const [y, m] = periodValue.split('-').map(Number)
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    return [`${periodValue}-01`, `${next}-01`]
  }
  const year = Number(periodValue.match(/\d{4}/)?.[0] ?? fallbackYear)
  if (periodType === 'season') {
    const name = periodValue.toLowerCase()
    if (name.includes('summer')) return [`${year}-12-01`, `${year + 1}-03-01`]
    if (name.includes('autumn') || name.includes('fall')) return [`${year}-03-01`, `${year}-06-01`]
    if (name.includes('winter')) return [`${year}-06-01`, `${year}-09-01`]
    if (name.includes('spring')) return [`${year}-09-01`, `${year}-12-01`]
  }
  return [`${year}-01-01`, `${year + 1}-01-01`]
}

/** Localised, compact duration label from an hours value. */
function durationLabel(hours: number): string {
  const d = formatDuration(hours)
  return t(`analytics.unit.${d.code}` as any, { value: d.value })
}

// ─── Main dashboard ───

analytics.get('/app/analytics', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const vendor = c.get('vendor')
  if (!vendor) return c.redirect('/onboarding')
  const db = c.env.DB
  const csrfToken = c.get('csrfToken')
  const { locale } = getI18n()

  const isPro = await isProVendor(db, vendor.id)
  const w = dateWindows(todayString())

  // ── Free-safe data (always computed) ──
  const [
    enquiriesCurrent,
    enquiriesPrevious,
    bookingsCurrent,
    bookingsPrevious,
    revenueCurrent,
    revenuePrevious,
    monthlyEnquiries,
    monthlyBookings,
    freeDemand,
  ] = await Promise.all([
    countEvents(db, vendor.id, 'enquiry_received', w.thirtyDaysAgo, w.tomorrow),
    countEvents(db, vendor.id, 'enquiry_received', w.sixtyDaysAgo, w.thirtyDaysAgo),
    countEvents(db, vendor.id, 'booking_confirmed', w.thirtyDaysAgo, w.tomorrow),
    countEvents(db, vendor.id, 'booking_confirmed', w.sixtyDaysAgo, w.thirtyDaysAgo),
    getRevenue(db, vendor.id, w.thirtyDaysAgo, w.tomorrow),
    getRevenue(db, vendor.id, w.sixtyDaysAgo, w.thirtyDaysAgo),
    getMonthlyEventCounts(db, vendor.id, 'enquiry_received', 12),
    getMonthlyEventCounts(db, vendor.id, 'booking_confirmed', 12),
    getDateHeatmap(db, w.today, w.thirtyAhead, 'global', 'global'),
  ])

  const bookingRate = enquiriesCurrent > 0 ? Math.round((bookingsCurrent / enquiriesCurrent) * 100) : 0
  const prevBookingRate = enquiriesPrevious > 0 ? Math.round((bookingsPrevious / enquiriesPrevious) * 100) : 0
  const enquiryChange = pctChange(enquiriesCurrent, enquiriesPrevious)
  const bookingChange = pctChange(bookingsCurrent, bookingsPrevious)
  const revenueChange = pctChange(revenueCurrent, revenuePrevious)
  const rateChange = pctChange(bookingRate, prevBookingRate)

  const months = last12Months(w.today, locale)
  const enquiryMap = new Map(monthlyEnquiries.map((r) => [r.month, r.count]))
  const bookingMap = new Map(monthlyBookings.map((r) => [r.month, r.count]))
  const chartData = months.map((m) => ({
    label: m.label,
    enquiries: enquiryMap.get(monthKey(m.year, m.month)) ?? 0,
    bookings: bookingMap.get(monthKey(m.year, m.month)) ?? 0,
  }))
  const maxMonthly = Math.max(1, ...chartData.map((d) => Math.max(d.enquiries, d.bookings)))

  const overview = (
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <OverviewCard label={t('analytics.overview.enquiries')} value={String(enquiriesCurrent)} change={enquiryChange} subtitle={t('analytics.overview.last30')} />
      <OverviewCard label={t('analytics.overview.bookings')} value={String(bookingsCurrent)} change={bookingChange} subtitle={t('analytics.overview.last30')} />
      <OverviewCard label={t('analytics.overview.revenue')} value={formatMoneyCents(revenueCurrent)} change={revenueChange} subtitle={t('analytics.overview.last30')} />
      <OverviewCard label={t('analytics.overview.bookingRate')} value={formatPct(bookingRate)} change={rateChange} subtitle={t('analytics.overview.rateSubtitle')} />
    </div>
  )

  const trends = <MonthlyTrends chartData={chartData} maxMonthly={maxMonthly} />

  // ── Free view: live overview + trends + demand teaser, rest locked ──
  if (!isPro) {
    return c.html(
      <AppLayout title={t('nav.analytics')} user={user} vendor={vendor} csrfToken={csrfToken}>
        <div class="max-w-5xl space-y-6">
          <div class="bg-horizon-50 border border-horizon-200 rounded-2xl px-5 py-3 flex items-center justify-between gap-4">
            <p class="text-sm text-horizon-700">{t('analytics.free.banner')}</p>
            <a href="/app/subscription/checkout" class="shrink-0 bg-horizon-600 text-white rounded-xl px-4 py-2 text-sm font-bold hover:bg-horizon-700 transition-colors">
              {t('analytics.lock.cta')}
            </a>
          </div>
          {overview}
          {trends}
          <DemandTeaser data={freeDemand} />
          <div class="grid sm:grid-cols-2 gap-6">
            <LockedSection title={t('analytics.insights.title')} subtitle={t('analytics.insights.subtitle')} variant="lines" />
            <LockedSection title={t('analytics.overview.responseTime')} subtitle={t('analytics.overview.responseSubtitle')} variant="stat" />
            <LockedSection title={t('analytics.funnel.title')} subtitle={t('analytics.funnel.subtitle')} variant="bars" />
            <LockedSection title={t('analytics.sources.title')} subtitle={t('analytics.sources.subtitle')} variant="bars" />
            <LockedSection title={t('analytics.benchmarks.title')} subtitle={t('analytics.benchmarks.subtitle', { category: vendor.category })} variant="bars" />
            <LockedSection title={t('analytics.goals.title')} subtitle={t('analytics.goals.subtitle')} variant="bars" />
          </div>
        </div>
      </AppLayout>
    )
  }

  // ── Pro-only data ──
  const [
    funnelRows,
    sourceRows,
    avgSpendVendor,
    avgSpendIndustry,
    vendorCount,
    yearGoals,
    industryEnquiriesTotal,
    industryBookingsTotal,
    responseDurations,
    monthlyRevenue,
    cityHeatmap,
    stateHeatmap,
    globalHeatmap,
  ] = await Promise.all([
    getConversionFunnel(db, vendor.id, w.yearStart, w.yearEnd),
    getSourceBreakdown(db, vendor.id, w.yearStart, w.yearEnd),
    getAverageSpendPerWedding(db, vendor.id, w.yearStart, w.yearEnd),
    getAverageSpendPerWedding(db, null, w.yearStart, w.yearEnd, { category: vendor.category }),
    countVendors(db, { category: vendor.category }),
    getCurrentYearGoals(db, vendor.id),
    countEventsGlobal(db, 'enquiry_received', w.thirtyDaysAgo, w.tomorrow, { category: vendor.category }),
    countEventsGlobal(db, 'booking_confirmed', w.thirtyDaysAgo, w.tomorrow, { category: vendor.category }),
    getFirstResponseDurations(db, vendor.id, w.sixtyDaysAgo, w.tomorrow),
    getMonthlyRevenue(db, vendor.id, 12),
    vendor.location_city
      ? getDateHeatmap(db, w.today, w.ninetyAhead, 'city', vendor.location_city)
      : Promise.resolve([]),
    vendor.location_state
      ? getDateHeatmap(db, w.today, w.ninetyAhead, 'state', vendor.location_state)
      : Promise.resolve([]),
    getDateHeatmap(db, w.today, w.ninetyAhead, 'global', 'global'),
  ])

  // Funnel — cumulative "reached at least this stage"
  const statusCounts: Record<string, number> = {}
  for (const r of funnelRows) statusCounts[r.status] = r.count
  const funnel = buildFunnel(statusCounts)
  const funnelMax = Math.max(1, ...funnel.map((s) => s.count))

  // Sources — normalised + relabelled
  const sources = aggregateSources(sourceRows)
  const sourceMax = Math.max(1, ...sources.map((s) => s.count))

  // Benchmarks — per-vendor category averages, not platform totals
  const denom = Math.max(1, vendorCount)
  const industryEnquiriesAvg = Math.round(industryEnquiriesTotal / denom)
  const industryBookingsAvg = Math.round(industryBookingsTotal / denom)
  const industryBookingRate =
    industryEnquiriesTotal > 0 ? Math.round((industryBookingsTotal / industryEnquiriesTotal) * 100) : null

  // Response time (median over the last 60 days)
  const medianResponseHours = median(responseDurations)

  // Revenue trend
  const revenueByMonth = new Map(monthlyRevenue.map((r) => [r.month, r.total]))
  const revenueChart = months.map((m) => ({ label: m.label, total: revenueByMonth.get(monthKey(m.year, m.month)) ?? 0 }))
  const revenueMax = Math.max(1, ...revenueChart.map((d) => d.total))

  // Busiest upcoming month from the 90-day global demand
  let busiestUpcomingMonth: string | null = null
  if (globalHeatmap.length > 0) {
    const byMonth = new Map<string, number>()
    for (const d of globalHeatmap) {
      const key = d.date.slice(0, 7)
      byMonth.set(key, (byMonth.get(key) ?? 0) + d.score)
    }
    let best = -1
    for (const [key, total] of byMonth) {
      if (total > best) {
        best = total
        const [yy, mm] = key.split('-').map(Number)
        busiestUpcomingMonth = new Date(Date.UTC(yy, mm - 1, 1)).toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' })
      }
    }
  }

  const insights = buildInsights({
    enquiries30d: enquiriesCurrent,
    enquiriesPrev30d: enquiriesPrevious,
    bookings30d: bookingsCurrent,
    bookingRate,
    industryBookingRate,
    medianResponseHours,
    busiestUpcomingMonth,
  })

  // Goals progress — measured over each goal's own period
  const goalsWithProgress = await Promise.all(
    yearGoals.map(async (g) => {
      const [start, end] = goalPeriodRange(g.period_type, g.period_value, w.year)
      let current = 0
      if (g.goal_type === 'enquiries') current = await countEvents(db, vendor.id, 'enquiry_received', start, end)
      else if (g.goal_type === 'bookings') current = await countEvents(db, vendor.id, 'booking_confirmed', start, end)
      else if (g.goal_type === 'revenue') current = await getRevenue(db, vendor.id, start, end)
      const pct = g.target > 0 ? Math.min(100, Math.round((current / g.target) * 100)) : 0
      return { ...g, current, pct }
    })
  )

  return c.html(
    <AppLayout title={t('nav.analytics')} user={user} vendor={vendor} csrfToken={csrfToken}>
      <div class="max-w-5xl space-y-6">
        {overview}

        {insights.length > 0 && <InsightsCard insights={insights} />}

        {trends}

        <div class="grid sm:grid-cols-2 gap-6">
          <ResponseTimeCard medianHours={medianResponseHours} sampleSize={responseDurations.length} />
          <RevenueTrend chart={revenueChart} max={revenueMax} />
        </div>

        <div class="grid sm:grid-cols-2 gap-6">
          {/* Conversion funnel */}
          <section class="bg-white rounded-2xl p-5 sm:p-6">
            <h3 class="font-bold text-gray-900 mb-1">{t('analytics.funnel.title')}</h3>
            <p class="text-sm text-gray-500 mb-5">{t('analytics.funnel.subtitle')}</p>
            <div class="space-y-3">
              {funnel.map((stage) => (
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-sm font-medium text-gray-700">{t(`analytics.funnel.stage.${stage.status}` as any)}</span>
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-bold text-gray-900">{stage.count}</span>
                      {stage.dropOffPct > 0 && <span class="text-xs text-grapefruit-600">-{stage.dropOffPct}%</span>}
                    </div>
                  </div>
                  <div class="bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div class="bg-horizon-500 h-full rounded-full transition-all" style={`width: ${(stage.count / funnelMax) * 100}%`} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Source breakdown */}
          <section class="bg-white rounded-2xl p-5 sm:p-6">
            <h3 class="font-bold text-gray-900 mb-1">{t('analytics.sources.title')}</h3>
            <p class="text-sm text-gray-500 mb-5">{t('analytics.sources.subtitle')}</p>
            {sources.length === 0 ? (
              <p class="text-sm text-gray-400">{t('analytics.sources.empty')}</p>
            ) : (
              <div class="space-y-3">
                {sources.map((s) => (
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-sm text-gray-700">{s.label}</span>
                      <span class="text-sm font-bold text-gray-900">{s.count}</span>
                    </div>
                    <div class="bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div class="bg-papaya-400 h-full rounded-full transition-all" style={`width: ${(s.count / sourceMax) * 100}%`} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Goals */}
        <section class="bg-white rounded-2xl p-5 sm:p-6">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h3 class="font-bold text-gray-900">{t('analytics.goals.title')}</h3>
              <p class="text-sm text-gray-500">{t('analytics.goals.subtitle')}</p>
            </div>
            <a href="/app/analytics/goals" class="bg-horizon-600 text-white rounded-xl px-4 py-2.5 text-sm font-bold hover:bg-horizon-700 transition-colors">
              {t('analytics.goals.manage')}
            </a>
          </div>

          {goalsWithProgress.length === 0 ? (
            <div class="text-center py-6">
              <p class="text-sm text-gray-400 mb-2">{t('analytics.goals.none')}</p>
              <a href="/app/analytics/goals" class="text-sm text-horizon-600 font-bold hover:text-horizon-700">{t('analytics.goals.setFirst')}</a>
            </div>
          ) : (
            <div class="space-y-4">
              {goalsWithProgress.map((g) => (
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-sm font-medium text-gray-700 capitalize">
                      {t(`analytics.goals.type.${g.goal_type}` as any)} — {g.period_value}
                    </span>
                    <span class="text-sm text-gray-500">
                      {g.goal_type === 'revenue' ? formatMoneyCents(g.current) : g.current} / {g.goal_type === 'revenue' ? formatMoneyCents(g.target) : g.target}
                    </span>
                  </div>
                  <div class="bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div class={`h-full rounded-full transition-all ${g.pct >= 100 ? 'bg-green-500' : 'bg-horizon-600'}`} style={`width: ${g.pct}%`} />
                  </div>
                  <p class="text-xs text-gray-400 mt-0.5">{t('analytics.goals.complete', { pct: g.pct })}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Industry benchmarks */}
        <section class="bg-white rounded-2xl p-5 sm:p-6">
          <h3 class="font-bold text-gray-900 mb-1">{t('analytics.benchmarks.title')}</h3>
          <p class="text-sm text-gray-500 mb-5">{t('analytics.benchmarks.subtitle', { category: vendor.category })}</p>
          <div class="grid sm:grid-cols-2 gap-6">
            <BenchmarkCard label={t('analytics.benchmarks.avgSpend')} yours={avgSpendVendor} industry={avgSpendIndustry} format="currency" />
            <BenchmarkCard label={t('analytics.benchmarks.bookingRate')} yours={bookingRate} industry={industryBookingRate ?? 0} format="percent" />
            <BenchmarkCard label={t('analytics.benchmarks.enquiries30')} yours={enquiriesCurrent} industry={industryEnquiriesAvg} format="number" />
            <BenchmarkCard label={t('analytics.benchmarks.bookings30')} yours={bookingsCurrent} industry={industryBookingsAvg} format="number" />
          </div>
        </section>

        {/* Date demand heatmap */}
        <section class="bg-white rounded-2xl p-5 sm:p-6">
          <h3 class="font-bold text-gray-900 mb-1">{t('analytics.demand.title')}</h3>
          <p class="text-sm text-gray-500 mb-5">{t('analytics.demand.subtitle')}</p>
          {globalHeatmap.length > 0 ? (
            <div class="space-y-6">
              {vendor.location_city && cityHeatmap.length > 0 && (
                <div>
                  <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{vendor.location_city}</h4>
                  <HeatmapGrid data={cityHeatmap} />
                </div>
              )}
              {vendor.location_state && stateHeatmap.length > 0 && (
                <div>
                  <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{vendor.location_state}</h4>
                  <HeatmapGrid data={stateHeatmap} />
                </div>
              )}
              <div>
                <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{t('analytics.demand.global')}</h4>
                <HeatmapGrid data={globalHeatmap} />
              </div>
              <HeatmapLegend />
            </div>
          ) : (
            <p class="text-sm text-gray-400">{t('analytics.demand.empty')}</p>
          )}
        </section>
      </div>
    </AppLayout>
  )
})

// ─── Goals page ───

analytics.get('/app/analytics/goals', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const vendor = c.get('vendor')
  if (!vendor) return c.redirect('/onboarding')
  const db = c.env.DB
  const csrfToken = c.get('csrfToken')

  const isPro = await isProVendor(db, vendor.id)
  if (!isPro) return c.redirect('/app/analytics')

  const goals = await listGoals(db, vendor.id)
  const error = c.req.query('error')

  return c.html(
    <AppLayout title={t('analytics.goals.title')} user={user} vendor={vendor} csrfToken={csrfToken}>
      <div class="max-w-2xl">
        <p class="text-sm text-gray-500 mb-4">
          <a href="/app/analytics" class="hover:text-horizon-700">{t('analytics.goals.breadcrumb')}</a> / {t('analytics.goals.title')}
        </p>

        {error && (
          <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-3 mb-4">
            {decodeURIComponent(error)}
          </div>
        )}

        <section class="bg-white rounded-2xl p-5 sm:p-6 mb-6">
          <h3 class="font-bold text-gray-900 mb-4">{t('analytics.goals.add')}</h3>
          <form method="post" action="/app/analytics/goals" class="space-y-4">
            <input type="hidden" name="_csrf" value={csrfToken} />

            <div class="grid sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="period_type">{t('analytics.goals.periodType')}</label>
                <select id="period_type" name="period_type" class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600">
                  <option value="year">{t('analytics.goals.period.year')}</option>
                  <option value="season">{t('analytics.goals.period.season')}</option>
                  <option value="month">{t('analytics.goals.period.month')}</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="period_value">{t('analytics.goals.periodValue')}</label>
                <input type="text" id="period_value" name="period_value" required placeholder={t('analytics.goals.placeholderValue')} class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
              </div>
            </div>

            <div class="grid sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="goal_type">{t('analytics.goals.goalType')}</label>
                <select id="goal_type" name="goal_type" class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600">
                  <option value="enquiries">{t('analytics.goals.type.enquiries')}</option>
                  <option value="bookings">{t('analytics.goals.type.bookings')}</option>
                  <option value="revenue">{t('analytics.goals.type.revenue')}</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="target">{t('analytics.goals.target')}</label>
                <input type="number" id="target" name="target" required min="1" placeholder={t('analytics.goals.placeholderTarget')} class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
                <p class="text-xs text-gray-400 mt-1">{t('analytics.goals.targetRevenueHint')}</p>
              </div>
            </div>

            <button type="submit" class="bg-horizon-600 text-white rounded-xl px-4 py-2.5 text-sm font-bold hover:bg-horizon-700 transition-colors">{t('analytics.goals.save')}</button>
          </form>
        </section>

        <section class="bg-white rounded-2xl p-5 sm:p-6">
          <h3 class="font-bold text-gray-900 mb-4">{t('analytics.goals.yours')}</h3>
          {goals.length === 0 ? (
            <p class="text-sm text-gray-400">{t('analytics.goals.emptyList')}</p>
          ) : (
            <div class="space-y-3">
              {goals.map((g) => (
                <div class="flex items-center justify-between border border-gray-100 rounded-xl px-4 py-3">
                  <div>
                    <p class="text-sm font-medium text-gray-900 capitalize">
                      {t(`analytics.goals.type.${g.goal_type}` as any)} — {g.period_value}
                    </p>
                    <p class="text-xs text-gray-500">
                      {t('analytics.goals.targetLabel', {
                        period: g.period_type,
                        target: g.goal_type === 'revenue' ? formatMoneyCents(g.target) : String(g.target),
                      })}
                    </p>
                  </div>
                  <form method="post" action={`/app/analytics/goals/${g.id}/delete`}>
                    <input type="hidden" name="_csrf" value={csrfToken} />
                    <button type="submit" onclick={`return confirm('${t('analytics.goals.deleteConfirm')}')`} class="text-sm text-grapefruit-600 hover:text-grapefruit-700 font-medium">{t('analytics.goals.delete')}</button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  )
})

// ─── Create/update goal ───

analytics.post('/app/analytics/goals', async (c) => {
  const vendor = c.get('vendor')
  if (!vendor) return c.redirect('/onboarding')
  const db = c.env.DB

  const isPro = await isProVendor(db, vendor.id)
  if (!isPro) return c.redirect('/app/analytics')

  const body = await c.req.parseBody()
  const periodType = String(body.period_type || '').trim()
  const periodValue = String(body.period_value || '').trim()
  const goalType = String(body.goal_type || '').trim()
  let target = parseInt(String(body.target || '0'), 10)

  if (!periodType || !periodValue || !goalType || target <= 0) {
    return c.redirect('/app/analytics/goals?error=' + encodeURIComponent(t('analytics.goals.error.required')))
  }
  if (!['year', 'season', 'month'].includes(periodType)) {
    return c.redirect('/app/analytics/goals?error=' + encodeURIComponent(t('analytics.goals.error.period')))
  }
  if (!['enquiries', 'bookings', 'revenue'].includes(goalType)) {
    return c.redirect('/app/analytics/goals?error=' + encodeURIComponent(t('analytics.goals.error.type')))
  }

  // Revenue targets are entered in dollars; stored in cents to match getRevenue.
  if (goalType === 'revenue') target = target * 100

  await upsertGoal(db, {
    vendor_id: vendor.id,
    period_type: periodType,
    period_value: periodValue,
    goal_type: goalType,
    target,
  })

  return c.redirect('/app/analytics/goals')
})

// ─── Delete goal ───

analytics.post('/app/analytics/goals/:id/delete', async (c) => {
  const vendor = c.get('vendor')
  if (!vendor) return c.redirect('/onboarding')
  const db = c.env.DB

  const isPro = await isProVendor(db, vendor.id)
  if (!isPro) return c.redirect('/app/analytics')

  await deleteGoal(db, c.req.param('id'), vendor.id)
  return c.redirect('/app/analytics/goals')
})

export default analytics

// ─── Components ───

function OverviewCard({ label, value, change, subtitle }: { label: string; value: string; change: { label: string; positive: boolean }; subtitle: string }) {
  return (
    <div class="bg-white rounded-2xl p-5">
      <p class="text-xs text-gray-500 mb-1">{label}</p>
      <p class="text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
      <div class="flex items-center gap-1.5 mt-1.5">
        <span class={`text-xs font-bold ${change.positive ? 'text-horizon-600' : 'text-grapefruit-600'}`}>{change.label}</span>
        <span class="text-xs text-gray-400">{subtitle}</span>
      </div>
    </div>
  )
}

function MonthlyTrends({ chartData, maxMonthly }: { chartData: { label: string; enquiries: number; bookings: number }[]; maxMonthly: number }) {
  return (
    <section class="bg-white rounded-2xl p-5 sm:p-6">
      <h3 class="font-bold text-gray-900 mb-1">{t('analytics.trends.title')}</h3>
      <p class="text-sm text-gray-500 mb-5">{t('analytics.trends.subtitle')}</p>
      <div class="space-y-2.5">
        {chartData.map((d) => (
          <div class="flex items-center gap-3 text-sm">
            <span class="w-8 text-gray-500 text-xs shrink-0">{d.label}</span>
            <div class="flex-1 space-y-1">
              <div class="flex items-center gap-2">
                <div class="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                  <div class="bg-horizon-500 h-full rounded-full transition-all" style={`width: ${(d.enquiries / maxMonthly) * 100}%`} />
                </div>
                <span class="w-8 text-right text-xs text-gray-600 tabular-nums">{d.enquiries}</span>
              </div>
              <div class="flex items-center gap-2">
                <div class="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                  <div class="bg-green-500 h-full rounded-full transition-all" style={`width: ${(d.bookings / maxMonthly) * 100}%`} />
                </div>
                <span class="w-8 text-right text-xs text-gray-600 tabular-nums">{d.bookings}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div class="flex items-center gap-4 mt-4 text-xs text-gray-500">
        <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full bg-horizon-500" />{t('analytics.trends.enquiries')}</div>
        <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full bg-green-500" />{t('analytics.trends.bookings')}</div>
      </div>
    </section>
  )
}

function RevenueTrend({ chart, max }: { chart: { label: string; total: number }[]; max: number }) {
  return (
    <section class="bg-white rounded-2xl p-5 sm:p-6">
      <h3 class="font-bold text-gray-900 mb-1">{t('analytics.revenueTrend.title')}</h3>
      <p class="text-sm text-gray-500 mb-5">{t('analytics.revenueTrend.subtitle')}</p>
      <div class="flex items-end gap-1.5 h-32">
        {chart.map((d) => (
          <div class="flex-1 flex flex-col items-center gap-1 group">
            <div class="w-full bg-gray-100 rounded-t relative flex items-end" style="height: 100%">
              <div class="w-full bg-horizon-500 rounded-t transition-all" style={`height: ${(d.total / max) * 100}%`} title={formatMoneyCents(d.total)} />
            </div>
            <span class="text-[10px] text-gray-400">{d.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function ResponseTimeCard({ medianHours, sampleSize }: { medianHours: number | null; sampleSize: number }) {
  const hasData = medianHours != null && sampleSize > 0
  const fast = hasData && medianHours! <= 4
  return (
    <section class="bg-white rounded-2xl p-5 sm:p-6">
      <h3 class="font-bold text-gray-900 mb-1">{t('analytics.overview.responseTime')}</h3>
      <p class="text-sm text-gray-500 mb-5">{t('analytics.overview.responseSubtitle')}</p>
      {hasData ? (
        <div>
          <p class={`text-3xl font-bold ${fast ? 'text-horizon-600' : 'text-gray-900'}`}>{durationLabel(medianHours!)}</p>
          <p class="text-xs text-gray-400 mt-1">{t('analytics.overview.last30')}</p>
        </div>
      ) : (
        <p class="text-sm text-gray-400">{t('analytics.overview.noData')}</p>
      )}
    </section>
  )
}

function InsightsCard({ insights }: { insights: Insight[] }) {
  const toneClass: Record<string, string> = {
    good: 'bg-green-50 border-green-200 text-green-800',
    warn: 'bg-papaya-100 border-papaya-300 text-gray-800',
    info: 'bg-horizon-50 border-horizon-200 text-horizon-700',
  }
  return (
    <section class="bg-white rounded-2xl p-5 sm:p-6">
      <h3 class="font-bold text-gray-900 mb-1">{t('analytics.insights.title')}</h3>
      <p class="text-sm text-gray-500 mb-4">{t('analytics.insights.subtitle')}</p>
      <div class="space-y-2.5">
        {insights.slice(0, 4).map((ins) => {
          const params: Record<string, string | number> = { ...ins.params }
          if (ins.code === 'response_slow') params.duration = durationLabel(Number(ins.params.hours) || 0)
          return (
            <div class={`border rounded-xl px-4 py-3 text-sm ${toneClass[ins.tone]}`}>
              {t(`analytics.insights.${ins.code}` as any, params)}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function BenchmarkCard({ label, yours, industry, format }: { label: string; yours: number; industry: number; format: 'currency' | 'percent' | 'number' }) {
  const fmt = (v: number) => (format === 'currency' ? formatMoneyCents(v) : format === 'percent' ? formatPct(v) : String(v))
  const diff = yours - industry
  const hasIndustry = industry > 0
  const verdict =
    !hasIndustry ? null : diff === 0 ? t('analytics.benchmarks.onPar')
      : format === 'currency'
        ? t(diff > 0 ? 'analytics.benchmarks.aboveBy' : 'analytics.benchmarks.belowBy', { amount: formatMoneyCents(Math.abs(diff)) })
        : t(diff > 0 ? 'analytics.benchmarks.above' : 'analytics.benchmarks.below')
  const verdictColor = !hasIndustry ? '' : diff === 0 ? 'text-gray-500' : diff > 0 ? 'text-horizon-600' : 'text-grapefruit-600'
  return (
    <div class="border border-gray-100 rounded-xl p-4">
      <p class="text-sm font-medium text-gray-700 mb-3">{label}</p>
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-500">{t('analytics.benchmarks.you')}</span>
          <span class="text-sm font-bold text-gray-900">{fmt(yours)}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-500">{t('analytics.benchmarks.industryAvg')}</span>
          <span class="text-sm text-gray-600">{fmt(industry)}</span>
        </div>
        {verdict && <p class={`text-xs font-bold ${verdictColor}`}>{verdict}</p>}
      </div>
    </div>
  )
}

function HeatmapGrid({ data }: { data: Array<{ date: string; score: number; enquiry_count: number; booking_count: number }> }) {
  return (
    <div class="flex flex-wrap gap-1">
      {data.map((d) => {
        const bg = d.score === 0 ? 'bg-gray-100' : d.score < 0.5 ? 'bg-horizon-100' : d.score < 1.0 ? 'bg-horizon-300' : d.score < 2.0 ? 'bg-horizon-500' : 'bg-horizon-700'
        // Cross-vendor data: the tooltip stays relative, never absolute counts.
        return <div class={`w-6 h-6 rounded ${bg} cursor-default`} title={`${formatDayLabel(d.date)}: ${formatVsAverage(d.score, 'date')}`} />
      })}
    </div>
  )
}

function HeatmapLegend() {
  return (
    <div class="flex items-center gap-2 text-xs text-gray-400">
      <span>{t('analytics.demand.low')}</span>
      <div class="flex gap-0.5">
        <div class="w-4 h-4 rounded bg-gray-100" />
        <div class="w-4 h-4 rounded bg-horizon-100" />
        <div class="w-4 h-4 rounded bg-horizon-300" />
        <div class="w-4 h-4 rounded bg-horizon-500" />
        <div class="w-4 h-4 rounded bg-horizon-700" />
      </div>
      <span>{t('analytics.demand.high')}</span>
    </div>
  )
}

// Free-tier demand teaser: next 30 days, global only.
function DemandTeaser({ data }: { data: Array<{ date: string; score: number; enquiry_count: number; booking_count: number }> }) {
  return (
    <section class="bg-white rounded-2xl p-5 sm:p-6">
      <div class="flex items-center justify-between mb-1">
        <h3 class="font-bold text-gray-900">{t('analytics.demand.title')}</h3>
        <span class="text-[11px] font-bold uppercase tracking-wider bg-horizon-100 text-horizon-700 rounded-full px-2 py-0.5">{t('analytics.lock.badge')}</span>
      </div>
      <p class="text-sm text-gray-500 mb-5">{t('analytics.demand.subtitle')}</p>
      {data.length > 0 ? (
        <div class="space-y-4">
          <div>
            <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{t('analytics.demand.global')}</h4>
            <HeatmapGrid data={data} />
          </div>
          <HeatmapLegend />
        </div>
      ) : (
        <p class="text-sm text-gray-400">{t('analytics.demand.empty')}</p>
      )}
      <div class="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between gap-4">
        <p class="text-sm text-gray-500">{t('analytics.upgrade.feature.demand')}</p>
        <a href="/app/subscription/checkout" class="shrink-0 text-sm text-horizon-600 font-bold hover:text-horizon-700">{t('analytics.lock.cta')} →</a>
      </div>
    </section>
  )
}

// A blurred placeholder section with a lock overlay, for free-tier teasing.
function LockedSection({ title, subtitle, variant }: { title: string; subtitle: string; variant: 'bars' | 'lines' | 'stat' }) {
  return (
    <section class="bg-white rounded-2xl p-5 sm:p-6 relative overflow-hidden">
      <div class="flex items-center justify-between mb-1">
        <h3 class="font-bold text-gray-900">{title}</h3>
        <span class="text-[11px] font-bold uppercase tracking-wider bg-horizon-100 text-horizon-700 rounded-full px-2 py-0.5">{t('analytics.lock.badge')}</span>
      </div>
      <p class="text-sm text-gray-500 mb-5">{subtitle}</p>
      <div class="blur-[3px] select-none pointer-events-none opacity-70" aria-hidden="true">
        {variant === 'stat' ? (
          <div class="h-10 w-24 bg-gray-200 rounded" />
        ) : variant === 'lines' ? (
          <div class="space-y-2">
            <div class="h-9 bg-gray-100 rounded-xl" />
            <div class="h-9 bg-gray-100 rounded-xl w-5/6" />
          </div>
        ) : (
          <div class="space-y-3">
            {[80, 55, 35, 20].map((wpc) => (
              <div class="bg-gray-100 rounded-full h-4 overflow-hidden">
                <div class="bg-gray-200 h-full rounded-full" style={`width: ${wpc}%`} />
              </div>
            ))}
          </div>
        )}
      </div>
      <a href="/app/subscription/checkout" class="absolute inset-0 top-16 flex items-center justify-center">
        <span class="bg-horizon-600 text-white rounded-xl px-4 py-2 text-sm font-bold shadow hover:bg-horizon-700 transition-colors">{t('analytics.lock.overlay')}</span>
      </a>
    </section>
  )
}
