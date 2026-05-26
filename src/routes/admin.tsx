import { Hono } from 'hono'
import type { FC, PropsWithChildren } from 'hono/jsx'
import type { Env, User } from '../types'
import { SharedHead } from '../views/head'
import { Logo } from '../views/logo'
import { requireAuth } from '../middleware/auth'
import { requireAdmin } from '../middleware/admin'
import { csrf } from '../middleware/csrf'
import { getTotalVendors, getTotalWeddings, getTotalCouples, getSignupsByMonth, countEventsGlobal, getRevenueGlobal, getAverageSpendPerWedding, getLocationBreakdown, getMonthlyEventCountsGlobal } from '../db/analytics'
import { getActiveProCount, getMRR, getConversionRate } from '../db/subscriptions'

const admin = new Hono<Env>()

admin.use('/admin', requireAuth, requireAdmin, csrf)
admin.use('/admin/*', requireAuth, requireAdmin, csrf)

// ─── Layout ───

const AdminLayout: FC<PropsWithChildren<{ title?: string; user: User; csrfToken: string }>> = ({ title, user, csrfToken, children }) => (
  <html lang="en">
    <head>
      <SharedHead title={title ? `Admin — ${title}` : 'Admin'} />
      <meta name="csrf-token" content={csrfToken} />
    </head>
    <body class="bg-gray-50 text-gray-900 antialiased font-sans">
      <header class="bg-gray-900 px-4 sm:px-8 py-4">
        <div class="max-w-6xl mx-auto flex items-center justify-between">
          <a href="/admin" class="flex items-center gap-2 text-base font-bold tracking-tight text-white whitespace-nowrap">
            <Logo class="w-5 h-5 shrink-0" />
            Wedding Computer <span class="text-gray-400 font-normal ml-1">Admin</span>
          </a>
          <div class="flex items-center gap-4">
            <a href="/app" class="text-sm text-gray-400 hover:text-white">Back to app</a>
            <span class="text-sm text-gray-500">{user.email}</span>
          </div>
        </div>
      </header>
      <main class="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-8">{children}</main>
    </body>
  </html>
)

// ─── Components ───

const StatCard: FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div class="bg-white rounded-2xl p-5 border border-gray-200">
    <p class="text-sm text-gray-500 font-medium mb-1">{label}</p>
    <p class="text-2xl sm:text-3xl font-bold text-gray-900">{value}</p>
    {sub && <p class="text-xs text-gray-400 mt-1">{sub}</p>}
  </div>
)

// ─── Helpers ───

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 0 })}`
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function generateLast12Months(): { key: string; label: string }[] {
  const months: { key: string; label: string }[] = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })
    months.push({ key, label })
  }
  return months
}

function buildMonthMap(rows: { month: string; count: number }[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rows) map.set(r.month, r.count)
  return map
}

// ─── Routes ───

admin.get('/admin', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  const yearStart = new Date().getFullYear() + '-01-01'
  const yearEnd = (new Date().getFullYear() + 1) + '-01-01'
  const last12 = generateLast12Months()

  const [
    totalVendors,
    totalWeddings,
    totalCouples,
    activeProCount,
    mrr,
    conversionRate,
    signupRows,
    enquiriesThisYear,
    bookingsThisYear,
    revenueThisYear,
    avgSpend,
    locationRows,
    monthlyEnquiryRows,
    monthlyBookingRows,
  ] = await Promise.all([
    getTotalVendors(db),
    getTotalWeddings(db),
    getTotalCouples(db),
    getActiveProCount(db),
    getMRR(db),
    getConversionRate(db),
    getSignupsByMonth(db, 12),
    countEventsGlobal(db, 'enquiry_received', yearStart, yearEnd),
    countEventsGlobal(db, 'booking_confirmed', yearStart, yearEnd),
    getRevenueGlobal(db, yearStart, yearEnd),
    getAverageSpendPerWedding(db, null, yearStart, yearEnd),
    getLocationBreakdown(db, null, yearStart, yearEnd),
    getMonthlyEventCountsGlobal(db, 'enquiry_received', 12),
    getMonthlyEventCountsGlobal(db, 'booking_confirmed', 12),
  ])

  const bookingRate = enquiriesThisYear > 0
    ? ((bookingsThisYear / enquiriesThisYear) * 100).toFixed(1)
    : '0.0'

  const signupMap = buildMonthMap(signupRows)
  const signupMax = Math.max(1, ...last12.map((m) => signupMap.get(m.key) ?? 0))

  const enquiryMap = buildMonthMap(monthlyEnquiryRows)
  const bookingMap = buildMonthMap(monthlyBookingRows)
  const activityMax = Math.max(
    1,
    ...last12.map((m) => Math.max(enquiryMap.get(m.key) ?? 0, bookingMap.get(m.key) ?? 0))
  )

  const topLocations = locationRows.slice(0, 10)
  const locationMax = Math.max(1, ...topLocations.map((l) => l.count))

  return c.html(
    <AdminLayout title="Dashboard" user={user} csrfToken={c.get('csrfToken')}>
      <div class="space-y-8">
        <h1 class="text-2xl font-bold">Platform overview</h1>

        {/* Platform stats */}
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCard label="Total vendors" value={String(totalVendors)} />
          <StatCard label="Total weddings" value={String(totalWeddings)} />
          <StatCard label="Total couples" value={String(totalCouples)} />
          <StatCard label="Active Pro subscribers" value={String(activeProCount)} />
          <StatCard label="MRR" value={formatCents(mrr)} sub={`${activeProCount} x $14/mo`} />
          <StatCard label="Pro conversion rate" value={formatPercent(conversionRate)} />
        </div>

        {/* Signups chart */}
        <section class="bg-white rounded-2xl p-5 sm:p-6 border border-gray-200">
          <h2 class="text-sm font-bold text-gray-900 mb-4">Vendor signups (last 12 months)</h2>
          <div class="space-y-1.5">
            {last12.map((m) => {
              const count = signupMap.get(m.key) ?? 0
              const pct = Math.round((count / signupMax) * 100)
              return (
                <div class="flex items-center gap-2 text-xs">
                  <span class="w-16 text-gray-500 text-right shrink-0">{m.label}</span>
                  <div class="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    {pct > 0 && (
                      <div
                        class="bg-gray-900 h-4 rounded-full"
                        style={`width: ${pct}%`}
                      />
                    )}
                  </div>
                  <span class="w-8 text-gray-700 font-medium text-right">{count}</span>
                </div>
              )
            })}
          </div>
        </section>

        {/* Industry insights */}
        <section class="bg-white rounded-2xl p-5 sm:p-6 border border-gray-200">
          <h2 class="text-sm font-bold text-gray-900 mb-4">Industry insights ({new Date().getFullYear()})</h2>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p class="text-sm text-gray-500 font-medium mb-1">Total enquiries</p>
              <p class="text-2xl font-bold text-gray-900">{enquiriesThisYear.toLocaleString()}</p>
            </div>
            <div>
              <p class="text-sm text-gray-500 font-medium mb-1">Total bookings</p>
              <p class="text-2xl font-bold text-gray-900">{bookingsThisYear.toLocaleString()}</p>
            </div>
            <div>
              <p class="text-sm text-gray-500 font-medium mb-1">Booking rate</p>
              <p class="text-2xl font-bold text-gray-900">{bookingRate}%</p>
            </div>
            <div>
              <p class="text-sm text-gray-500 font-medium mb-1">Avg spend per wedding</p>
              <p class="text-2xl font-bold text-gray-900">{formatCents(avgSpend)}</p>
            </div>
            <div>
              <p class="text-sm text-gray-500 font-medium mb-1">Revenue processed</p>
              <p class="text-2xl font-bold text-gray-900">{formatCents(revenueThisYear)}</p>
            </div>
          </div>
        </section>

        {/* Top locations */}
        {topLocations.length > 0 && (
          <section class="bg-white rounded-2xl p-5 sm:p-6 border border-gray-200">
            <h2 class="text-sm font-bold text-gray-900 mb-4">Top wedding locations ({new Date().getFullYear()})</h2>
            <div class="space-y-1.5">
              {topLocations.map((loc) => {
                const pct = Math.round((loc.count / locationMax) * 100)
                return (
                  <div class="flex items-center gap-2 text-xs">
                    <span class="w-36 text-gray-500 text-right shrink-0 truncate" title={loc.location}>{loc.location}</span>
                    <div class="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      {pct > 0 && (
                        <div
                          class="bg-gray-900 h-4 rounded-full"
                          style={`width: ${pct}%`}
                        />
                      )}
                    </div>
                    <span class="w-8 text-gray-700 font-medium text-right">{loc.count}</span>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Monthly activity */}
        <section class="bg-white rounded-2xl p-5 sm:p-6 border border-gray-200">
          <h2 class="text-sm font-bold text-gray-900 mb-4">Monthly activity (last 12 months)</h2>
          <div class="flex items-center gap-4 mb-3 text-xs">
            <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-gray-900 inline-block" /> Enquiries</span>
            <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-gray-400 inline-block" /> Bookings</span>
          </div>
          <div class="space-y-1.5">
            {last12.map((m) => {
              const eq = enquiryMap.get(m.key) ?? 0
              const bk = bookingMap.get(m.key) ?? 0
              const eqPct = Math.round((eq / activityMax) * 100)
              const bkPct = Math.round((bk / activityMax) * 100)
              return (
                <div class="space-y-0.5">
                  <div class="flex items-center gap-2 text-xs">
                    <span class="w-16 text-gray-500 text-right shrink-0">{m.label}</span>
                    <div class="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                      {eqPct > 0 && (
                        <div
                          class="bg-gray-900 h-3 rounded-full"
                          style={`width: ${eqPct}%`}
                        />
                      )}
                    </div>
                    <span class="w-8 text-gray-700 font-medium text-right">{eq}</span>
                  </div>
                  <div class="flex items-center gap-2 text-xs">
                    <span class="w-16 shrink-0" />
                    <div class="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                      {bkPct > 0 && (
                        <div
                          class="bg-gray-400 h-3 rounded-full"
                          style={`width: ${bkPct}%`}
                        />
                      )}
                    </div>
                    <span class="w-8 text-gray-500 font-medium text-right">{bk}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </AdminLayout>
  )
})

export default admin
