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
import { getUserByEmail } from '../db/users'
import { getVendorByUserId } from '../db/vendors'
import { grantFreeMonths, listRecentGrants, FREE_MONTHS_CAP, type GrantRow } from '../db/referrals'
import { redeemBankedMonthsToStripe } from '../services/free-months'
import { auditLog } from '../middleware/audit'

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
            <a href="/admin" class="text-sm text-gray-400 hover:text-white">Dashboard</a>
            <a href="/admin/gifts" class="text-sm text-gray-400 hover:text-white">Gifts</a>
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
          <StatCard label="MRR" value={formatCents(mrr)} sub={`${activeProCount} x $28/mo`} />
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

// ─── Gift free months ───

const GRANT_SOURCE_LABEL: Record<string, string> = {
  referral_reward: 'Referral reward',
  referred_signup: 'Signup reward',
  admin_gift: 'Admin gift',
}

admin.get('/admin/gifts', async (c) => {
  const user = c.get('user')
  const csrfToken = c.get('csrfToken')
  const grants = await listRecentGrants(c.env.DB, 25)

  const granted = c.req.query('granted')
  const grantedEmail = c.req.query('email')
  const clamped = c.req.query('clamped') === '1'
  const error = c.req.query('error')

  return c.html(
    <AdminLayout title="Gifts" user={user} csrfToken={csrfToken}>
      <div class="space-y-8 max-w-3xl">
        <div>
          <h1 class="text-2xl font-bold">Gift free months</h1>
          <p class="text-sm text-gray-500 mt-1">
            Add free months to a vendor's Pro billing. Capped at {FREE_MONTHS_CAP} unredeemed months
            per vendor (shared with referral rewards). Credits apply automatically to their next Pro invoices.
          </p>
        </div>

        {granted && (
          <div class="bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl p-3">
            Gifted {granted} free month{granted === '1' ? '' : 's'} to {grantedEmail}.
            {clamped && ' (Reduced to stay within the 9-month cap.)'}
          </div>
        )}
        {error && (
          <div class="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>
        )}

        <div class="bg-white rounded-2xl p-5 sm:p-6 border border-gray-200">
          <form method="post" action="/admin/gift-months" class="space-y-4">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1" for="email">User email</label>
              <input
                type="email"
                id="email"
                name="email"
                required
                placeholder="vendor@example.com"
                class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1" for="months">Free months</label>
              <input
                type="number"
                id="months"
                name="months"
                min="1"
                max={String(FREE_MONTHS_CAP)}
                value="1"
                required
                class="w-32 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1" for="note">Note (optional)</label>
              <input
                type="text"
                id="note"
                name="note"
                placeholder="Reason for the gift"
                class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <button type="submit" class="bg-gray-900 text-white rounded-xl px-6 py-2.5 text-sm font-bold hover:bg-gray-800 transition-colors">
              Gift months
            </button>
          </form>
        </div>

        <div class="bg-white rounded-2xl p-5 sm:p-6 border border-gray-200">
          <h2 class="text-lg font-bold mb-4">Recent grants</h2>
          {grants.length === 0 ? (
            <p class="text-sm text-gray-400">No grants yet.</p>
          ) : (
            <div class="divide-y divide-gray-100">
              {grants.map((g: GrantRow) => (
                <div class="py-2.5 flex items-center justify-between gap-4 text-sm">
                  <div class="min-w-0">
                    <p class="font-medium text-gray-900 truncate">{g.business_name}</p>
                    <p class="text-xs text-gray-400 truncate">{g.vendor_email}</p>
                  </div>
                  <div class="text-right shrink-0">
                    <p class="font-bold text-gray-900">+{g.months} mo</p>
                    <p class="text-xs text-gray-400">{GRANT_SOURCE_LABEL[g.source] ?? g.source}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  )
})

admin.post('/admin/gift-months', async (c) => {
  const adminUser = c.get('user')
  const body = await c.req.parseBody()
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const months = parseInt(String(body.months || '0'), 10)
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null

  if (!email || !Number.isFinite(months) || months < 1) {
    return c.redirect('/admin/gifts?error=' + encodeURIComponent('Enter an email and a number of months (1 or more).'))
  }

  const recipient = await getUserByEmail(c.env.DB, email)
  if (!recipient) {
    return c.redirect('/admin/gifts?error=' + encodeURIComponent('No user found with that email.'))
  }
  const vendor = await getVendorByUserId(c.env.DB, recipient.id)
  if (!vendor) {
    return c.redirect('/admin/gifts?error=' + encodeURIComponent('That user is not a vendor, so they have no Pro billing to credit.'))
  }

  const result = await grantFreeMonths(c.env.DB, vendor.id, months, 'admin_gift', {
    grantedByUserId: adminUser.id,
    note,
  })

  // If they're already an active subscriber, apply the months as a Stripe
  // account credit now (otherwise they stay banked and redeem at next checkout).
  await redeemBankedMonthsToStripe(c.env.STRIPE_SECRET_KEY, c.env.DB, vendor.id).catch((e) =>
    console.error('[admin] redeem gifted months failed', e)
  )

  await auditLog(c, 'gift_free_months', 'vendor', vendor.id, {
    requested: months,
    applied: result.applied,
    balance: result.balance,
  }).catch(() => {})

  if (result.applied <= 0) {
    return c.redirect('/admin/gifts?error=' + encodeURIComponent(`${vendor.business_name} is already at the ${FREE_MONTHS_CAP}-month cap.`))
  }

  return c.redirect(
    `/admin/gifts?granted=${result.applied}&email=${encodeURIComponent(email)}&clamped=${result.clamped ? '1' : '0'}`
  )
})

export default admin
