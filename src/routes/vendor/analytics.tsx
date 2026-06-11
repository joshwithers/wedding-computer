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
  getLocationBreakdown,
  getAverageSpendPerWedding,
} from '../../db/analytics'
import { listGoals, upsertGoal, deleteGoal, getCurrentYearGoals } from '../../db/goals'
import { getDateHeatmap } from '../../db/busyness'

const analytics = new Hono<Env>()

analytics.use('/app/analytics', requireAuth, csrf, requireVendor)
analytics.use('/app/analytics/*', requireAuth, csrf, requireVendor)

// ─── Helpers ───

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const FUNNEL_STAGES = [
  { status: 'new', label: 'New', color: 'bg-horizon-400' },
  { status: 'contacted', label: 'Contacted', color: 'bg-horizon-500' },
  { status: 'meeting', label: 'Meeting', color: 'bg-horizon-600' },
  { status: 'quoted', label: 'Quoted', color: 'bg-horizon-700' },
  { status: 'booked', label: 'Booked', color: 'bg-green-600' },
]

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

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

function last12Months(): { year: number; month: number; label: string }[] {
  const now = new Date()
  const months: { year: number; month: number; label: string }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: MONTH_LABELS[d.getMonth()],
    })
  }
  return months
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

/**
 * [start, end) window for a goal's period.
 * period_value is free text: "2026" (year), "2026-06" (month), "summer-2026"
 * (season). Seasons have no parseable bounds, so they fall back to the year
 * found in the value.
 */
function goalPeriodRange(periodType: string, periodValue: string): [string, string] {
  if (periodType === 'month' && /^\d{4}-\d{2}$/.test(periodValue)) {
    const [y, m] = periodValue.split('-').map(Number)
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    return [`${periodValue}-01`, `${next}-01`]
  }
  const year = Number(periodValue.match(/\d{4}/)?.[0] ?? new Date().getFullYear())
  return [`${year}-01-01`, `${year + 1}-01-01`]
}

// ─── Main dashboard ───

analytics.get('/app/analytics', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const vendor = c.get('vendor')
  if (!vendor) return c.redirect('/onboarding')
  const db = c.env.DB
  const csrfToken = c.get('csrfToken')

  // Pro gate
  const isPro = await isProVendor(db, vendor.id)
  if (!isPro) {
    return c.html(
      <AppLayout title="Analytics" user={user} vendor={vendor} csrfToken={csrfToken}>
        <UpgradePrompt />
      </AppLayout>
    )
  }

  // Date ranges. End bounds are exclusive and compared against full datetimes,
  // so "now" windows must end at tomorrow's date or today's events drop out.
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)
  const yearStart = `${new Date().getFullYear()}-01-01`
  const yearEnd = `${new Date().getFullYear() + 1}-01-01`

  const [
    enquiriesCurrent,
    enquiriesPrevious,
    bookingsCurrent,
    bookingsPrevious,
    revenueCurrent,
    revenuePrevious,
    monthlyEnquiries,
    monthlyBookings,
    funnel,
    sources,
    locations,
    avgSpendVendor,
    avgSpendIndustry,
    yearGoals,
    industryEnquiries,
    industryBookings,
    cityHeatmap,
    stateHeatmap,
    globalHeatmap,
  ] = await Promise.all([
    countEvents(db, vendor.id, 'enquiry_received', thirtyDaysAgo, tomorrow),
    countEvents(db, vendor.id, 'enquiry_received', sixtyDaysAgo, thirtyDaysAgo),
    countEvents(db, vendor.id, 'booking_confirmed', thirtyDaysAgo, tomorrow),
    countEvents(db, vendor.id, 'booking_confirmed', sixtyDaysAgo, thirtyDaysAgo),
    getRevenue(db, vendor.id, thirtyDaysAgo, tomorrow),
    getRevenue(db, vendor.id, sixtyDaysAgo, thirtyDaysAgo),
    getMonthlyEventCounts(db, vendor.id, 'enquiry_received', 12),
    getMonthlyEventCounts(db, vendor.id, 'booking_confirmed', 12),
    getConversionFunnel(db, vendor.id, yearStart, yearEnd),
    getSourceBreakdown(db, vendor.id, yearStart, yearEnd),
    getLocationBreakdown(db, vendor.id, yearStart, yearEnd),
    getAverageSpendPerWedding(db, vendor.id, yearStart, yearEnd),
    getAverageSpendPerWedding(db, null, yearStart, yearEnd),
    getCurrentYearGoals(db, vendor.id),
    // Benchmarks at geographic levels
    countEventsGlobal(db, 'enquiry_received', thirtyDaysAgo, tomorrow, { category: vendor.category }),
    countEventsGlobal(db, 'booking_confirmed', thirtyDaysAgo, tomorrow, { category: vendor.category }),
    // Date demand heatmap (next 90 days)
    vendor.location_city
      ? getDateHeatmap(db, today, new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10), 'city', vendor.location_city)
      : Promise.resolve([]),
    vendor.location_state
      ? getDateHeatmap(db, today, new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10), 'state', vendor.location_state)
      : Promise.resolve([]),
    getDateHeatmap(db, today, new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10), 'global', 'global'),
  ])

  const bookingRate = enquiriesCurrent > 0 ? Math.round((bookingsCurrent / enquiriesCurrent) * 100) : 0
  const prevBookingRate = enquiriesPrevious > 0 ? Math.round((bookingsPrevious / enquiriesPrevious) * 100) : 0

  const enquiryChange = pctChange(enquiriesCurrent, enquiriesPrevious)
  const bookingChange = pctChange(bookingsCurrent, bookingsPrevious)
  const revenueChange = pctChange(revenueCurrent, revenuePrevious)
  const rateChange = pctChange(bookingRate, prevBookingRate)

  // Build monthly chart data
  const months = last12Months()
  const enquiryMap = new Map(monthlyEnquiries.map((r) => [r.month, r.count]))
  const bookingMap = new Map(monthlyBookings.map((r) => [r.month, r.count]))
  const chartData = months.map((m) => ({
    label: m.label,
    enquiries: enquiryMap.get(monthKey(m.year, m.month)) ?? 0,
    bookings: bookingMap.get(monthKey(m.year, m.month)) ?? 0,
  }))
  const maxMonthly = Math.max(1, ...chartData.map((d) => Math.max(d.enquiries, d.bookings)))

  // Funnel data
  const funnelMap = new Map(funnel.map((r) => [r.status, r.count]))
  const funnelMax = Math.max(1, ...FUNNEL_STAGES.map((s) => funnelMap.get(s.status) ?? 0))

  // Source data
  const sourceMax = Math.max(1, ...sources.map((s) => s.count))

  // Goals progress — measured over each goal's own period, not the 30-day window
  const goalsWithProgress = await Promise.all(
    yearGoals.map(async (g) => {
      const [start, end] = goalPeriodRange(g.period_type, g.period_value)
      let current = 0
      if (g.goal_type === 'enquiries') current = await countEvents(db, vendor.id, 'enquiry_received', start, end)
      else if (g.goal_type === 'bookings') current = await countEvents(db, vendor.id, 'booking_confirmed', start, end)
      else if (g.goal_type === 'revenue') current = await getRevenue(db, vendor.id, start, end)
      const pct = g.target > 0 ? Math.min(100, Math.round((current / g.target) * 100)) : 0
      return { ...g, current, pct }
    })
  )

  return c.html(
    <AppLayout title="Analytics" user={user} vendor={vendor} csrfToken={csrfToken}>
      <div class="max-w-5xl space-y-6">
        {/* Overview cards */}
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <OverviewCard
            label="Enquiries"
            value={String(enquiriesCurrent)}
            change={enquiryChange}
            subtitle="last 30 days"
          />
          <OverviewCard
            label="Bookings"
            value={String(bookingsCurrent)}
            change={bookingChange}
            subtitle="last 30 days"
          />
          <OverviewCard
            label="Revenue"
            value={formatCents(revenueCurrent)}
            change={revenueChange}
            subtitle="last 30 days"
          />
          <OverviewCard
            label="Booking rate"
            value={formatPct(bookingRate)}
            change={rateChange}
            subtitle="enquiries to bookings"
          />
        </div>

        {/* Monthly trends */}
        <section class="bg-white rounded-2xl p-5 sm:p-6">
          <h3 class="font-bold text-gray-900 mb-1">Monthly trends</h3>
          <p class="text-sm text-gray-500 mb-5">Enquiries and bookings over the last 12 months</p>

          <div class="space-y-2.5">
            {chartData.map((d) => (
              <div class="flex items-center gap-3 text-sm">
                <span class="w-8 text-gray-500 text-xs shrink-0">{d.label}</span>
                <div class="flex-1 space-y-1">
                  <div class="flex items-center gap-2">
                    <div class="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div
                        class="bg-horizon-500 h-full rounded-full transition-all"
                        style={`width: ${(d.enquiries / maxMonthly) * 100}%`}
                      />
                    </div>
                    <span class="w-8 text-right text-xs text-gray-600">{d.enquiries}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <div class="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div
                        class="bg-green-500 h-full rounded-full transition-all"
                        style={`width: ${(d.bookings / maxMonthly) * 100}%`}
                      />
                    </div>
                    <span class="w-8 text-right text-xs text-gray-600">{d.bookings}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div class="flex items-center gap-4 mt-4 text-xs text-gray-500">
            <div class="flex items-center gap-1.5">
              <div class="w-3 h-3 rounded-full bg-horizon-500" />
              Enquiries
            </div>
            <div class="flex items-center gap-1.5">
              <div class="w-3 h-3 rounded-full bg-green-500" />
              Bookings
            </div>
          </div>
        </section>

        <div class="grid sm:grid-cols-2 gap-6">
          {/* Conversion funnel */}
          <section class="bg-white rounded-2xl p-5 sm:p-6">
            <h3 class="font-bold text-gray-900 mb-1">Conversion funnel</h3>
            <p class="text-sm text-gray-500 mb-5">Pipeline stages this year</p>

            <div class="space-y-3">
              {FUNNEL_STAGES.map((stage, i) => {
                const count = funnelMap.get(stage.status) ?? 0
                const prevCount = i > 0 ? (funnelMap.get(FUNNEL_STAGES[i - 1].status) ?? 0) : count
                const dropOff = prevCount > 0 && i > 0 ? Math.round(((prevCount - count) / prevCount) * 100) : 0
                return (
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-sm font-medium text-gray-700">{stage.label}</span>
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-bold text-gray-900">{count}</span>
                        {i > 0 && dropOff > 0 && (
                          <span class="text-xs text-grapefruit-600">-{dropOff}%</span>
                        )}
                      </div>
                    </div>
                    <div class="bg-gray-100 rounded-full h-5 overflow-hidden">
                      <div
                        class={`${stage.color} h-full rounded-full transition-all`}
                        style={`width: ${(count / funnelMax) * 100}%`}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Source breakdown */}
          <section class="bg-white rounded-2xl p-5 sm:p-6">
            <h3 class="font-bold text-gray-900 mb-1">Enquiry sources</h3>
            <p class="text-sm text-gray-500 mb-5">Where your leads come from this year</p>

            {sources.length === 0 ? (
              <p class="text-sm text-gray-400">No enquiry data yet</p>
            ) : (
              <div class="space-y-3">
                {sources.map((s) => (
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-sm text-gray-700 capitalize">{s.source}</span>
                      <span class="text-sm font-bold text-gray-900">{s.count}</span>
                    </div>
                    <div class="bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div
                        class="bg-papaya-400 h-full rounded-full transition-all"
                        style={`width: ${(s.count / sourceMax) * 100}%`}
                      />
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
              <h3 class="font-bold text-gray-900">Goals</h3>
              <p class="text-sm text-gray-500">Track progress toward your targets</p>
            </div>
            <a
              href="/app/analytics/goals"
              class="bg-horizon-600 text-white rounded-xl px-4 py-2.5 text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Manage goals
            </a>
          </div>

          {goalsWithProgress.length === 0 ? (
            <div class="text-center py-6">
              <p class="text-sm text-gray-400 mb-2">No goals set for this year</p>
              <a href="/app/analytics/goals" class="text-sm text-horizon-600 font-bold hover:text-horizon-700">
                Set your first goal
              </a>
            </div>
          ) : (
            <div class="space-y-4">
              {goalsWithProgress.map((g) => (
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-sm font-medium text-gray-700 capitalize">
                      {g.goal_type} — {g.period_value}
                    </span>
                    <span class="text-sm text-gray-500">
                      {g.goal_type === 'revenue' ? formatCents(g.current) : g.current} / {g.goal_type === 'revenue' ? formatCents(g.target) : g.target}
                    </span>
                  </div>
                  <div class="bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div
                      class={`h-full rounded-full transition-all ${g.pct >= 100 ? 'bg-green-500' : 'bg-horizon-600'}`}
                      style={`width: ${g.pct}%`}
                    />
                  </div>
                  <p class="text-xs text-gray-400 mt-0.5">{g.pct}% complete</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Industry benchmarks */}
        <section class="bg-white rounded-2xl p-5 sm:p-6">
          <h3 class="font-bold text-gray-900 mb-1">Industry benchmarks</h3>
          <p class="text-sm text-gray-500 mb-5">How you compare to other {vendor.category}s this year</p>

          <div class="grid sm:grid-cols-2 gap-6">
            <BenchmarkCard
              label="Avg spend per wedding"
              yours={avgSpendVendor}
              industry={avgSpendIndustry}
              format="currency"
            />
            <BenchmarkCard
              label="Booking rate"
              yours={bookingRate}
              industry={industryBookings > 0 && industryEnquiries > 0 ? Math.round((industryBookings / industryEnquiries) * 100) : 0}
              format="percent"
            />
            <BenchmarkCard
              label="Enquiries (30d)"
              yours={enquiriesCurrent}
              industry={industryEnquiries}
              format="number"
              note={`All ${vendor.category}s on platform`}
            />
            <BenchmarkCard
              label="Bookings (30d)"
              yours={bookingsCurrent}
              industry={industryBookings}
              format="number"
              note={`All ${vendor.category}s on platform`}
            />
          </div>
        </section>

        {/* Date demand heatmap */}
        <section class="bg-white rounded-2xl p-5 sm:p-6">
          <h3 class="font-bold text-gray-900 mb-1">Date demand</h3>
          <p class="text-sm text-gray-500 mb-5">How in-demand upcoming dates are for enquiries and bookings</p>

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
                <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Global</h4>
                <HeatmapGrid data={globalHeatmap} />
              </div>
              <div class="flex items-center gap-2 text-xs text-gray-400">
                <span>Low</span>
                <div class="flex gap-0.5">
                  <div class="w-4 h-4 rounded bg-gray-100" />
                  <div class="w-4 h-4 rounded bg-horizon-100" />
                  <div class="w-4 h-4 rounded bg-horizon-300" />
                  <div class="w-4 h-4 rounded bg-horizon-500" />
                  <div class="w-4 h-4 rounded bg-horizon-700" />
                </div>
                <span>High</span>
              </div>
            </div>
          ) : (
            <p class="text-sm text-gray-400">Demand data will appear after the first daily aggregation runs.</p>
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
    <AppLayout title="Goals" user={user} vendor={vendor} csrfToken={csrfToken}>
      <div class="max-w-2xl">
        <p class="text-sm text-gray-500 mb-4">
          <a href="/app/analytics" class="hover:text-horizon-700">Analytics</a> / Goals
        </p>

        {error && (
          <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-3 mb-4">
            {decodeURIComponent(error)}
          </div>
        )}

        {/* Add/edit goal form */}
        <section class="bg-white rounded-2xl p-5 sm:p-6 mb-6">
          <h3 class="font-bold text-gray-900 mb-4">Add a goal</h3>
          <form method="post" action="/app/analytics/goals" class="space-y-4">
            <input type="hidden" name="_csrf" value={csrfToken} />

            <div class="grid sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="period_type">
                  Period type
                </label>
                <select
                  id="period_type"
                  name="period_type"
                  class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600"
                >
                  <option value="year">Year</option>
                  <option value="season">Season</option>
                  <option value="month">Month</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="period_value">
                  Period value
                </label>
                <input
                  type="text"
                  id="period_value"
                  name="period_value"
                  required
                  placeholder="e.g. 2026, summer-2026, 2026-06"
                  class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600"
                />
              </div>
            </div>

            <div class="grid sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="goal_type">
                  Goal type
                </label>
                <select
                  id="goal_type"
                  name="goal_type"
                  class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600"
                >
                  <option value="enquiries">Enquiries</option>
                  <option value="bookings">Bookings</option>
                  <option value="revenue">Revenue (cents)</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-bold text-gray-700 mb-1.5" for="target">
                  Target
                </label>
                <input
                  type="number"
                  id="target"
                  name="target"
                  required
                  min="1"
                  placeholder="e.g. 50"
                  class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600"
                />
              </div>
            </div>

            <button
              type="submit"
              class="bg-horizon-600 text-white rounded-xl px-4 py-2.5 text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Save goal
            </button>
          </form>
        </section>

        {/* Existing goals */}
        <section class="bg-white rounded-2xl p-5 sm:p-6">
          <h3 class="font-bold text-gray-900 mb-4">Your goals</h3>

          {goals.length === 0 ? (
            <p class="text-sm text-gray-400">No goals yet. Add one above to get started.</p>
          ) : (
            <div class="space-y-3">
              {goals.map((g) => (
                <div class="flex items-center justify-between border border-gray-100 rounded-xl px-4 py-3">
                  <div>
                    <p class="text-sm font-medium text-gray-900 capitalize">
                      {g.goal_type} — {g.period_value}
                    </p>
                    <p class="text-xs text-gray-500">
                      {g.period_type} target: {g.goal_type === 'revenue' ? formatCents(g.target) : g.target}
                    </p>
                  </div>
                  <form method="post" action={`/app/analytics/goals/${g.id}/delete`}>
                    <input type="hidden" name="_csrf" value={csrfToken} />
                    <button
                      type="submit"
                      onclick="return confirm('Delete this goal?')"
                      class="text-sm text-grapefruit-600 hover:text-grapefruit-700 font-medium"
                    >
                      Delete
                    </button>
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
  const target = parseInt(String(body.target || '0'), 10)

  if (!periodType || !periodValue || !goalType || target <= 0) {
    return c.redirect('/app/analytics/goals?error=' + encodeURIComponent('All fields are required and target must be positive'))
  }

  if (!['year', 'season', 'month'].includes(periodType)) {
    return c.redirect('/app/analytics/goals?error=' + encodeURIComponent('Invalid period type'))
  }

  if (!['enquiries', 'bookings', 'revenue'].includes(goalType)) {
    return c.redirect('/app/analytics/goals?error=' + encodeURIComponent('Invalid goal type'))
  }

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

function UpgradePrompt() {
  return (
    <div class="max-w-xl mx-auto text-center">
      <div class="bg-white rounded-2xl p-8 sm:p-10">
        <div class="w-14 h-14 bg-horizon-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <svg class="w-7 h-7 text-horizon-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
        </div>

        <h2 class="text-xl font-bold text-gray-900 mb-2">Unlock business analytics</h2>
        <p class="text-sm text-gray-600 mb-8 max-w-sm mx-auto">
          See how your business is performing with detailed insights, trends, and benchmarks.
        </p>

        <div class="space-y-4 text-left max-w-xs mx-auto mb-8">
          <FeatureRow label="Enquiry and booking trends" />
          <FeatureRow label="Conversion funnel analysis" />
          <FeatureRow label="Revenue tracking and reporting" />
          <FeatureRow label="Industry benchmarks" />
          <FeatureRow label="Goal setting and tracking" />
          <FeatureRow label="Source and location breakdowns" />
        </div>

        <div class="mb-6">
          <p class="text-3xl font-bold text-gray-900">$28<span class="text-base font-medium text-gray-500">/month</span></p>
        </div>

        <a
          href="/app/subscription/checkout"
          class="inline-block bg-horizon-600 text-white rounded-xl px-8 py-3 text-sm font-bold hover:bg-horizon-700 transition-colors"
        >
          Upgrade to Pro
        </a>
      </div>
    </div>
  )
}

function FeatureRow({ label }: { label: string }) {
  return (
    <div class="flex items-center gap-3">
      <div class="w-5 h-5 rounded-full bg-horizon-100 flex items-center justify-center shrink-0">
        <svg class="w-3 h-3 text-horizon-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <span class="text-sm text-gray-700">{label}</span>
    </div>
  )
}

function OverviewCard({
  label,
  value,
  change,
  subtitle,
}: {
  label: string
  value: string
  change: { value: number; label: string; positive: boolean }
  subtitle: string
}) {
  return (
    <div class="bg-white rounded-2xl p-5">
      <p class="text-xs text-gray-500 mb-1">{label}</p>
      <p class="text-2xl font-bold text-gray-900">{value}</p>
      <div class="flex items-center gap-1.5 mt-1.5">
        <span
          class={`text-xs font-bold ${change.positive ? 'text-horizon-600' : 'text-grapefruit-600'}`}
        >
          {change.label}
        </span>
        <span class="text-xs text-gray-400">{subtitle}</span>
      </div>
    </div>
  )
}

function BenchmarkCard({
  label,
  yours,
  industry,
  format,
  note,
}: {
  label: string
  yours: number
  industry: number
  format: 'currency' | 'percent' | 'number'
  note?: string
}) {
  const fmt = (v: number) =>
    format === 'currency' ? formatCents(v) : format === 'percent' ? formatPct(v) : String(v)
  const yourDisplay = fmt(yours)
  const industryDisplay = note ? note : fmt(industry)
  const diff = industry > 0 ? yours - industry : 0
  const ahead = diff >= 0

  return (
    <div class="border border-gray-100 rounded-xl p-4">
      <p class="text-sm font-medium text-gray-700 mb-3">{label}</p>
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-500">You</span>
          <span class="text-sm font-bold text-gray-900">{yourDisplay}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-500">Industry avg</span>
          <span class="text-sm text-gray-600">{industryDisplay}</span>
        </div>
        {!note && industry > 0 && (
          <p class={`text-xs font-bold ${ahead ? 'text-horizon-600' : 'text-grapefruit-600'}`}>
            {ahead ? 'Above' : 'Below'} industry average
            {format === 'currency' && ` by ${formatCents(Math.abs(diff))}`}
          </p>
        )}
      </div>
    </div>
  )
}

function HeatmapGrid({ data }: { data: Array<{ date: string; score: number; enquiry_count: number; booking_count: number }> }) {
  return (
    <div class="flex flex-wrap gap-1">
      {data.map((d) => {
        const bg = d.score === 0
          ? 'bg-gray-100'
          : d.score < 0.5
            ? 'bg-horizon-100'
            : d.score < 1.0
              ? 'bg-horizon-300'
              : d.score < 2.0
                ? 'bg-horizon-500'
                : 'bg-horizon-700'
        const dayLabel = new Date(d.date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
        return (
          <div
            class={`w-6 h-6 rounded ${bg} cursor-default`}
            title={`${dayLabel}: ${d.enquiry_count} enquiries, ${d.booking_count} bookings (score: ${d.score.toFixed(1)})`}
          />
        )
      })}
    </div>
  )
}
