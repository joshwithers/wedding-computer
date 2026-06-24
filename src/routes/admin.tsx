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
import { aggregateBusynessScores, aggregateDemandHistory } from '../db/busyness'
import { geocodePendingLocations } from '../services/geocode'
import { getUserByEmail } from '../db/users'
import { getVendorByUserId, getVendorById, updateVendor, listVendorsForAdmin } from '../db/vendors'
import { grantFreeMonths, listRecentGrants, FREE_MONTHS_CAP, type GrantRow } from '../db/referrals'
import { redeemBankedMonthsToStripe } from '../services/free-months'
import { getBroadcastRecipients, getBroadcastCountries, createBroadcast } from '../db/broadcast'
import { countWaitlist, getWaitlistStats, getWaitlistCountryBreakdown, listWaitlist, listWaitlistForExport } from '../db/waitlist'
import { makeUnsubscribeToken, unsubscribeUrl } from '../services/notification-prefs'
import { auditLog } from '../middleware/audit'
import { listVendorTypes, addVendorType, setVendorTypeActive, vendorTypeLabel } from '../db/vendor-types'
import { ensureCoupleContact } from '../services/couple-contact'
import { sanitizeInstagramHandle } from '../lib/instagram'
import { normalizeCelebrantTerm, celebrantTermOf, celebrantTermLabel, CELEBRANT_SLUG, OFFICIANT_TERM } from '../lib/celebrant-term'

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
            <a href="/admin/waitlist" class="text-sm text-gray-400 hover:text-white">Waitlist</a>
            <a href="/admin/broadcast" class="text-sm text-gray-400 hover:text-white">Broadcast</a>
            <a href="/admin/gifts" class="text-sm text-gray-400 hover:text-white">Gifts</a>
            <a href="/admin/coupons" class="text-sm text-gray-400 hover:text-white">Coupons</a>
            <a href="/admin/vendor-types" class="text-sm text-gray-400 hover:text-white">Vendor types</a>
            <a href="/admin/businesses" class="text-sm text-gray-400 hover:text-white">Businesses</a>
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
    waitlistCount,
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
    countWaitlist(db),
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
          <StatCard label="Waitlist" value={String(waitlistCount)} />
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

        <section class="bg-white rounded-2xl p-5 sm:p-6">
          <h3 class="font-bold text-gray-900 mb-1">Demand aggregations</h3>
          <p class="text-sm text-gray-500 mb-3">
            Busyness scores and year-on-year demand history rebuild nightly. Run them now to backfill.
          </p>
          <form method="post" action="/admin/aggregate-demand">
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <button
              type="submit"
              class="bg-horizon-600 text-white rounded-xl px-4 py-2 text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Rebuild now
            </button>
          </form>
        </section>

        <section class="bg-white rounded-2xl p-5 border border-gray-200 mt-6">
          <h2 class="text-lg font-bold mb-1">Clean up Instagram handles</h2>
          <p class="text-sm text-gray-500 mb-4">
            One-off: normalise any vendor / couple-vendor Instagram values saved as a URL (or with @)
            down to a bare handle, so @mentions and profile links work. Safe to re-run.
          </p>
          <form method="post" action="/admin/backfill-instagram">
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <button type="submit" class="bg-gray-900 text-white rounded-xl px-4 py-2 text-sm font-bold hover:bg-gray-800 transition-colors">
              Clean up now
            </button>
          </form>
        </section>

        <section class="bg-white rounded-2xl p-5 border border-gray-200 mt-6">
          <h2 class="text-lg font-bold mb-1">Backfill couple contacts</h2>
          <p class="text-sm text-gray-500 mb-4">
            One-off: give every vendor on every wedding the couple's full contact details (names, emails,
            phones, address, socials) as a CRM contact, so vendors added before this fix can see and reach
            the couple. Couple-owned fields come from the couple's account; the rest from the richest existing
            contact on the wedding. Non-destructive (fills only missing fields) and safe to re-run. Runs in
            small batches.
          </p>
          <form id="backfill-cc-form">
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <button id="backfill-cc-btn" type="submit" class="bg-gray-900 text-white rounded-xl px-4 py-2 text-sm font-bold hover:bg-gray-800 transition-colors">
              Backfill now
            </button>
          </form>
          <p id="backfill-cc-status" class="text-sm text-gray-600 mt-3" role="status" aria-live="polite"></p>
          <script
            dangerouslySetInnerHTML={{
              __html: `
            (function () {
              var form = document.getElementById('backfill-cc-form');
              if (!form) return;
              form.addEventListener('submit', async function (e) {
                e.preventDefault();
                var btn = document.getElementById('backfill-cc-btn');
                var status = document.getElementById('backfill-cc-status');
                var csrf = form.querySelector('input[name=_csrf]').value;
                btn.disabled = true; btn.style.opacity = '0.6';
                var after = '', touched = 0, fail = 0, done = false, lastError = '', batches = 0;
                try {
                  while (!done) {
                    var fd = new FormData();
                    fd.set('_csrf', csrf);
                    fd.set('after', after);
                    var res = await fetch('/admin/backfill-couple-contacts', { method: 'POST', body: fd });
                    if (!res.ok) { status.textContent = 'Request failed (' + res.status + '). Click to resume.'; break; }
                    var j = await res.json();
                    touched += j.vendorsTouched; fail += j.fail; after = j.nextCursor || after; done = !!j.done; batches++;
                    if (j.lastError) lastError = j.lastError;
                    status.textContent = 'Vendors processed ' + touched + ', failed ' + fail + ' (' + batches + ' batches)' + (done ? ' — done.' : '…') + (lastError ? ' Last error: ' + lastError : '');
                    if (!j.batch) break;
                  }
                } catch (err) {
                  status.textContent = 'Stopped: ' + (err && err.message ? err.message : err) + '. Click to resume.';
                } finally {
                  btn.disabled = false; btn.style.opacity = '1';
                }
              });
            })();
          `,
            }}
          />
        </section>
      </div>
    </AdminLayout>
  )
})

// ─── Demand aggregations (manual rebuild/backfill) ───

admin.post('/admin/aggregate-demand', async (c) => {
  await geocodePendingLocations(c.env, 50).catch((err) => console.error('[admin] geocode backfill failed:', err))
  await aggregateBusynessScores(c.env.DB)
  await aggregateDemandHistory(c.env.DB)
  return c.redirect('/admin')
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
  await redeemBankedMonthsToStripe(c.env, vendor.id).catch((e) =>
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

// ─── Coupons (Stripe promotion codes) ───

/** Thin Stripe REST helper (form-encoded), mirroring the checkout call. */
async function stripeApi(
  secretKey: string,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, string>
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: method === 'POST' && body ? new URLSearchParams(body).toString() : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

const couponDiscountLabel = (coupon: any): string =>
  coupon?.percent_off != null ? `${coupon.percent_off}% off`
  : coupon?.amount_off != null ? `${formatCents(coupon.amount_off)} off`
  : '—'

const couponDurationLabel = (coupon: any): string =>
  coupon?.duration === 'repeating' ? `for ${coupon.duration_in_months} months`
  : coupon?.duration === 'forever' ? 'forever'
  : 'first payment'

admin.get('/admin/coupons', async (c) => {
  const user = c.get('user')
  const csrfToken = c.get('csrfToken')
  const created = c.req.query('created')
  const deactivated = c.req.query('deactivated') === '1'
  const error = c.req.query('error')

  const list = await stripeApi(c.env.STRIPE_SECRET_KEY, 'GET', 'promotion_codes?limit=100&expand[]=data.promotion.coupon')
  const codes: any[] = list.ok && Array.isArray(list.data?.data) ? list.data.data : []
  const fmtDate = (ts?: number | null) => (ts ? new Date(ts * 1000).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : null)

  return c.html(
    <AdminLayout title="Coupons" user={user} csrfToken={csrfToken}>
      <div class="space-y-8 max-w-3xl">
        <div>
          <h1 class="text-2xl font-bold">Discount codes</h1>
          <p class="text-sm text-gray-500 mt-1">
            Create a marketing code customers enter at Pro checkout. Stripe enforces the
            discount, expiry and usage limit. Percentage or fixed amount, one-off or recurring.
          </p>
        </div>

        {created && (
          <div class="bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl p-3">
            Created code <strong>{created}</strong>. Customers can enter it at checkout now.
          </div>
        )}
        {deactivated && (
          <div class="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3">Code deactivated.</div>
        )}
        {error && <div class="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>}

        <div class="bg-white rounded-2xl p-5 sm:p-6 border border-gray-200">
          <form method="post" action="/admin/coupons" class="space-y-4">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1" for="code">Code</label>
              <input type="text" id="code" name="code" required placeholder="LAUNCH50" autocomplete="off"
                class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-gray-900" />
              <p class="text-xs text-gray-400 mt-1">Letters, numbers, - or _. Shown to customers exactly.</p>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1" for="discount_type">Discount</label>
                <select id="discount_type" name="discount_type" class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                  <option value="percent">Percentage off</option>
                  <option value="amount">Fixed amount off (AUD)</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1" for="value">Value</label>
                <input type="number" id="value" name="value" min="1" step="0.01" required placeholder="50"
                  class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                <p class="text-xs text-gray-400 mt-1">e.g. 50 = 50% or $50</p>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1" for="duration">Applies to</label>
                <select id="duration" name="duration" class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                  <option value="once">First payment only</option>
                  <option value="repeating">First N months</option>
                  <option value="forever">Every payment (forever)</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1" for="duration_months">Months (if "First N")</label>
                <input type="number" id="duration_months" name="duration_months" min="1" placeholder="3"
                  class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1" for="expires">Expires (optional)</label>
                <input type="date" id="expires" name="expires" class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1" for="max_redemptions">Max uses (optional)</label>
                <input type="number" id="max_redemptions" name="max_redemptions" min="1" placeholder="∞"
                  class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
            </div>
            <button type="submit" class="bg-gray-900 text-white rounded-xl px-6 py-2.5 text-sm font-bold hover:bg-gray-800 transition-colors">
              Create code
            </button>
          </form>
        </div>

        <div class="bg-white rounded-2xl p-5 sm:p-6 border border-gray-200">
          <h2 class="text-lg font-bold mb-4">Active &amp; past codes</h2>
          {!list.ok ? (
            <p class="text-sm text-red-500">Couldn't load codes from Stripe ({list.status}).</p>
          ) : codes.length === 0 ? (
            <p class="text-sm text-gray-400">No codes yet.</p>
          ) : (
            <div class="divide-y divide-gray-100">
              {codes.map((p: any) => {
                // Coupon now lives at promotion.coupon (was top-level on older API versions).
                const cpn = p.promotion?.coupon ?? p.coupon
                return (
                <div class="py-3 flex items-center justify-between gap-4 text-sm">
                  <div class="min-w-0">
                    <p class="font-bold text-gray-900 font-mono">
                      {p.code}
                      {!p.active && <span class="ml-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">inactive</span>}
                    </p>
                    <p class="text-xs text-gray-500">
                      {couponDiscountLabel(cpn)} · {couponDurationLabel(cpn)}
                      {p.expires_at && ` · expires ${fmtDate(p.expires_at)}`}
                    </p>
                  </div>
                  <div class="flex items-center gap-3 shrink-0">
                    <div class="text-right">
                      <p class="font-bold text-gray-900">{p.times_redeemed}{p.max_redemptions ? ` / ${p.max_redemptions}` : ''}</p>
                      <p class="text-xs text-gray-400">used</p>
                    </div>
                    {p.active && (
                      <form method="post" action={`/admin/coupons/${p.id}/deactivate`}>
                        <input type="hidden" name="_csrf" value={csrfToken} />
                        <button type="submit" class="text-xs text-gray-400 hover:text-red-600 border border-gray-200 rounded-lg px-2.5 py-1.5">Deactivate</button>
                      </form>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  )
})

admin.post('/admin/coupons', async (c) => {
  const body = await c.req.parseBody()
  const code = String(body.code || '').trim().toUpperCase()
  const discountType = String(body.discount_type || 'percent')
  const value = parseFloat(String(body.value || '0'))
  const duration = String(body.duration || 'once')
  const durationMonths = parseInt(String(body.duration_months || '0'), 10)
  const expires = String(body.expires || '').trim()
  const maxRedemptions = parseInt(String(body.max_redemptions || '0'), 10)
  const fail = (msg: string) => c.redirect('/admin/coupons?error=' + encodeURIComponent(msg))

  if (!/^[A-Z0-9_-]{2,40}$/.test(code)) return fail('Enter a code using letters, numbers, - or _ (2–40 chars).')
  if (!Number.isFinite(value) || value <= 0) return fail('Enter a discount value greater than 0.')
  if (discountType === 'percent' && value > 100) return fail('Percentage off can’t exceed 100.')

  // 1) Coupon = the discount definition.
  const couponParams: Record<string, string> = { duration, name: code }
  if (discountType === 'amount') {
    couponParams.amount_off = String(Math.round(value * 100))
    couponParams.currency = 'aud'
  } else {
    couponParams.percent_off = String(value)
  }
  if (duration === 'repeating') {
    if (!Number.isFinite(durationMonths) || durationMonths < 1) return fail('Enter how many months a recurring discount lasts.')
    couponParams.duration_in_months = String(durationMonths)
  }
  const coupon = await stripeApi(c.env.STRIPE_SECRET_KEY, 'POST', 'coupons', couponParams)
  if (!coupon.ok) return fail('Stripe rejected the discount: ' + (coupon.data?.error?.message ?? coupon.status))
  if (!coupon.data?.id) return fail('Stripe created the discount but returned no id — please try again.')

  // 2) Promotion code = the customer-facing code + expiry/usage limits. Stripe's
  // promotion_codes API nests the coupon under `promotion[...]` — a top-level
  // `coupon` param now errors with "Received unknown parameter: coupon".
  const promoParams: Record<string, string> = {
    'promotion[type]': 'coupon',
    'promotion[coupon]': coupon.data.id,
    code,
  }
  if (Number.isFinite(maxRedemptions) && maxRedemptions > 0) promoParams.max_redemptions = String(maxRedemptions)
  if (expires) {
    const ts = Math.floor(new Date(expires + 'T23:59:59').getTime() / 1000)
    if (!Number.isFinite(ts) || ts <= Math.floor(Date.now() / 1000)) return fail('Expiry date must be in the future.')
    promoParams.expires_at = String(ts)
  }
  const promo = await stripeApi(c.env.STRIPE_SECRET_KEY, 'POST', 'promotion_codes', promoParams)
  if (!promo.ok) {
    console.error('[coupons] promotion_code create failed', promo.status, JSON.stringify(promo.data?.error ?? promo.data))
    return fail(`Couldn’t create code “${code}” (it may already exist): ` + (promo.data?.error?.message ?? promo.status))
  }

  await auditLog(c, 'create_coupon', 'coupon', promo.data.id, { code, discountType, value, duration, expires, maxRedemptions }).catch(() => {})
  return c.redirect('/admin/coupons?created=' + encodeURIComponent(code))
})

admin.post('/admin/coupons/:id/deactivate', async (c) => {
  const id = c.req.param('id')
  const res = await stripeApi(c.env.STRIPE_SECRET_KEY, 'POST', `promotion_codes/${id}`, { active: 'false' })
  await auditLog(c, 'deactivate_coupon', 'coupon', id, {}).catch(() => {})
  if (!res.ok) return c.redirect('/admin/coupons?error=' + encodeURIComponent('Couldn’t deactivate that code.'))
  return c.redirect('/admin/coupons?deactivated=1')
})

// ─── Vendor types (the "type of vendor" dropdown when adding a vendor) ───

admin.get('/admin/vendor-types', async (c) => {
  const user = c.get('user')
  const csrfToken = c.get('csrfToken')
  const added = c.req.query('added')
  const error = c.req.query('error')
  const types = await listVendorTypes(c.env.DB, { includeInactive: true })

  return c.html(
    <AdminLayout title="Vendor types" user={user} csrfToken={csrfToken}>
      <div class="space-y-8 max-w-2xl">
        <div>
          <h1 class="text-2xl font-bold">Vendor types</h1>
          <p class="text-sm text-gray-500 mt-1">
            The approved “type of vendor” options shown when a vendor is added to a wedding.
            Removing a type hides it from the dropdown; weddings already using it are unaffected.
          </p>
        </div>

        {added && (
          <div class="bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl p-3">
            Added <strong>{added}</strong>.
          </div>
        )}
        {error && <div class="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>}

        <div class="bg-white rounded-2xl p-5 sm:p-6 border border-gray-200">
          <form method="post" action="/admin/vendor-types" class="flex gap-3 items-end">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <div class="flex-1">
              <label class="block text-sm font-medium text-gray-700 mb-1" for="label">Add a type</label>
              <input type="text" id="label" name="label" required maxlength={60} placeholder="e.g. Drone operator" autocomplete="off"
                class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              <p class="text-xs text-gray-400 mt-1">Becomes a lowercase slug, e.g. “drone operator”.</p>
            </div>
            <button type="submit" class="bg-gray-900 text-white rounded-xl px-6 py-2.5 text-sm font-bold hover:bg-gray-800 transition-colors">Add</button>
          </form>
        </div>

        <div class="bg-white rounded-2xl p-5 sm:p-6 border border-gray-200">
          <h2 class="text-lg font-bold mb-4">All types</h2>
          <div class="divide-y divide-gray-100">
            {types.map((vt) => (
              <div class="py-3 flex items-center justify-between gap-4 text-sm">
                <div class="min-w-0">
                  <p class="font-bold text-gray-900">
                    {vendorTypeLabel(vt)}
                    {vt.active === 0 && <span class="ml-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">removed</span>}
                    {vt.is_system === 1 && <span class="ml-2 text-[10px] font-bold uppercase tracking-wide text-horizon-700 bg-horizon-50 rounded px-1.5 py-0.5">default</span>}
                  </p>
                  <p class="text-xs text-gray-400 font-mono">{vt.slug}</p>
                </div>
                <form method="post" action={`/admin/vendor-types/${encodeURIComponent(vt.slug)}/toggle`} class="shrink-0">
                  <input type="hidden" name="_csrf" value={csrfToken} />
                  <input type="hidden" name="active" value={vt.active === 1 ? '0' : '1'} />
                  <button type="submit" class={`text-xs border rounded-lg px-2.5 py-1.5 ${vt.active === 1 ? 'text-gray-400 hover:text-red-600 border-gray-200' : 'text-horizon-700 hover:text-horizon-800 border-horizon-200'}`}>
                    {vt.active === 1 ? 'Remove' : 'Restore'}
                  </button>
                </form>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  )
})

admin.post('/admin/vendor-types', async (c) => {
  const body = await c.req.parseBody()
  const label = String(body.label || '').trim()
  const res = await addVendorType(c.env.DB, label)
  if (!res.ok) return c.redirect('/admin/vendor-types?error=' + encodeURIComponent(res.error || 'Could not add that type.'))
  await auditLog(c, 'add_vendor_type', 'vendor_type', res.slug, { label }).catch(() => {})
  return c.redirect('/admin/vendor-types?added=' + encodeURIComponent(label))
})

admin.post('/admin/vendor-types/:slug/toggle', async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.parseBody()
  const active = String(body.active) === '1'
  await setVendorTypeActive(c.env.DB, slug, active)
  await auditLog(c, active ? 'restore_vendor_type' : 'remove_vendor_type', 'vendor_type', slug, {}).catch(() => {})
  return c.redirect('/admin/vendor-types')
})

// ─── Businesses: edit a vendor's brand/business profile (not their account) ───
admin.get('/admin/businesses', async (c) => {
  const user = c.get('user')
  const q = (c.req.query('q') ?? '').trim()
  const businesses = await listVendorsForAdmin(c.env.DB, q)
  return c.html(
    <AdminLayout title="Businesses" user={user} csrfToken={c.get('csrfToken')}>
      <div class="space-y-6">
        <div>
          <h1 class="text-2xl font-bold">Businesses <span class="text-gray-400 font-normal text-lg">({businesses.length}{q ? ' matching' : ''})</span></h1>
          <p class="text-sm text-gray-500 mt-1">Edit a vendor's public brand details — name, links, location, directory listing, logo, bio. Account settings stay with the vendor.</p>
        </div>
        <form method="get" action="/admin/businesses" class="flex gap-2">
          <input
            type="search"
            name="q"
            value={q}
            placeholder="Search by business name or email…"
            class="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <button type="submit" class="bg-gray-900 text-white rounded-xl px-4 py-2.5 text-sm font-bold hover:bg-gray-800 transition-colors">Search</button>
        </form>
        <div class="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
          {businesses.length === 0 ? (
            <p class="text-sm text-gray-400 p-5">No businesses found.</p>
          ) : (
            businesses.map((b) => {
              const place = [b.location_city, b.location_state].filter(Boolean).join(', ')
              return (
                <a href={`/admin/businesses/${b.id}`} class="flex items-center justify-between gap-4 p-4 hover:bg-gray-50 transition-colors">
                  <div class="min-w-0">
                    <p class="font-bold text-gray-900 truncate">{b.business_name}</p>
                    <p class="text-xs text-gray-500 truncate">
                      {b.category === CELEBRANT_SLUG
                        ? celebrantTermLabel(b)
                        : vendorTypeLabel({ slug: b.category ?? '', label: b.category ?? '—' })}
                      {place ? ` · ${place}` : ''} · {b.user_email}
                    </p>
                  </div>
                  <div class="flex items-center gap-3 shrink-0 text-xs text-gray-400">
                    {b.instagram && <span>@{b.instagram}</span>}
                    {b.website && <span class="hidden sm:inline truncate max-w-[160px]">{b.website}</span>}
                    <span class="text-gray-900 font-bold">Edit →</span>
                  </div>
                </a>
              )
            })
          )}
        </div>
      </div>
    </AdminLayout>
  )
})

admin.get('/admin/businesses/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const [vendor, types] = await Promise.all([getVendorById(c.env.DB, id), listVendorTypes(c.env.DB, { includeInactive: true })])
  if (!vendor) return c.notFound()
  const saved = c.req.query('saved') === '1'
  let cats: string[] = []
  try {
    const arr = vendor.categories ? JSON.parse(vendor.categories) : []
    if (Array.isArray(arr)) cats = arr.filter((s): s is string => typeof s === 'string')
  } catch { /* ignore */ }
  // Surface any current category/type that's no longer in the active catalog so it's still editable.
  const typeSlugs = new Set(types.map((t) => t.slug))
  const extra = [vendor.category, ...cats].filter((s): s is string => !!s && !typeSlugs.has(s))
  const allTypes = [...types, ...Array.from(new Set(extra)).map((slug) => ({ slug, label: slug }))]
  const field = 'w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'
  return c.html(
    <AdminLayout title={vendor.business_name} user={user} csrfToken={c.get('csrfToken')}>
      <div class="max-w-2xl space-y-6">
        <div class="flex items-center justify-between gap-4">
          <div>
            <a href="/admin/businesses" class="text-xs text-gray-400 hover:text-gray-600">← Businesses</a>
            <h1 class="text-2xl font-bold mt-1">{vendor.business_name}</h1>
          </div>
          <a href={`/app/vendors/${vendor.id}`} class="text-xs text-gray-400 hover:text-gray-600 shrink-0">View profile →</a>
        </div>
        {saved && <p class="bg-green-50 text-green-700 text-sm rounded-xl px-4 py-2.5 border border-green-100">Saved.</p>}
        <form method="post" action={`/admin/businesses/${vendor.id}`} class="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1" for="business_name">Business name</label>
            <input id="business_name" name="business_name" required value={vendor.business_name} class={field} />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1" for="category">Primary type</label>
            <select id="category" name="category" class={field}>
              {allTypes.map((t) => (
                <option value={t.slug} selected={vendor.category === t.slug}>{vendorTypeLabel(t)}</option>
              ))}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">All types (for credits + directory)</label>
            <div class="flex flex-wrap gap-1.5">
              {allTypes.map((t) => {
                const on = cats.includes(t.slug)
                return (
                  <label class="cursor-pointer">
                    <input type="checkbox" name="categories" value={t.slug} checked={on} class="sr-only peer" />
                    <span class="inline-block text-xs px-2.5 py-1 rounded-full border transition-colors bg-white border-gray-200 text-gray-600 hover:border-gray-300 peer-checked:bg-gray-900 peer-checked:border-gray-900 peer-checked:text-white">{vendorTypeLabel(t)}</span>
                  </label>
                )
              })}
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1" for="website">Website</label>
              <input id="website" name="website" value={vendor.website ?? ''} placeholder="https://…" class={field} />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1" for="instagram">Instagram</label>
              <input id="instagram" name="instagram" value={vendor.instagram ?? ''} placeholder="@handle or URL" class={field} />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1" for="phone">Phone</label>
              <input id="phone" name="phone" value={vendor.phone ?? ''} class={field} />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1" for="location">Location (display)</label>
              <input id="location" name="location" value={vendor.location ?? ''} placeholder="e.g. Byron Bay, NSW" class={field} />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1" for="location_city">City</label>
              <input id="location_city" name="location_city" value={vendor.location_city ?? ''} class={field} />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1" for="location_state">State / region</label>
              <input id="location_state" name="location_state" value={vendor.location_state ?? ''} class={field} />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1" for="location_country">Country</label>
              <input id="location_country" name="location_country" value={vendor.location_country ?? ''} class={field} />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1" for="bio">Bio</label>
            <textarea id="bio" name="bio" rows={4} class={field}>{vendor.bio ?? ''}</textarea>
          </div>
          {(cats.includes(CELEBRANT_SLUG) || vendor.category === CELEBRANT_SLUG) && (
            <div>
              <span class="block text-sm font-medium text-gray-700 mb-1">Celebrant role shown as</span>
              <div class="flex gap-4">
                <label class="flex items-center gap-2 text-sm text-gray-700">
                  <input type="radio" name="celebrant_term" value="" checked={celebrantTermOf(vendor) !== OFFICIANT_TERM} class="border-gray-300 text-gray-900 focus:ring-gray-900" />
                  Celebrant
                </label>
                <label class="flex items-center gap-2 text-sm text-gray-700">
                  <input type="radio" name="celebrant_term" value={OFFICIANT_TERM} checked={celebrantTermOf(vendor) === OFFICIANT_TERM} class="border-gray-300 text-gray-900 focus:ring-gray-900" />
                  Officiant
                </label>
              </div>
            </div>
          )}
          <div class="flex flex-wrap gap-x-6 gap-y-2 pt-1">
            <label class="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="directory_listed" value="1" checked={!!vendor.directory_listed} class="rounded border-gray-300 text-gray-900 focus:ring-gray-900" />
              Listed in the public directory
            </label>
            <label class="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="is_agency" value="1" checked={vendor.is_agency === 1} class="rounded border-gray-300 text-gray-900 focus:ring-gray-900" />
              Agency (manages a team)
            </label>
          </div>
          <div class="flex justify-end">
            <button type="submit" class="bg-gray-900 text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:bg-gray-800 transition-colors">Save business</button>
          </div>
        </form>

        <div class="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 class="text-sm font-bold text-gray-900 mb-1">Logo</h2>
          <p class="text-xs text-gray-500 mb-4">Square logo shown across the directory + public pages.</p>
          <div class="flex items-center gap-4 flex-wrap">
            <div class="w-16 h-16 rounded-2xl bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center shrink-0">
              {vendor.logo_r2_key ? (
                <img src={`/vendor-logo/${vendor.id}`} alt="Logo" class="w-full h-full object-cover" />
              ) : (
                <span class="text-gray-400 text-xs">None</span>
              )}
            </div>
            <form method="post" action={`/admin/businesses/${vendor.id}/logo`} enctype="multipart/form-data" class="flex items-center gap-2">
              <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
              <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" required class="text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-bold hover:file:bg-gray-200" />
              <button type="submit" class="bg-gray-900 text-white rounded-xl px-3 py-2 text-sm font-bold hover:bg-gray-800 transition-colors shrink-0">Upload</button>
            </form>
            {vendor.logo_r2_key && (
              <form method="post" action={`/admin/businesses/${vendor.id}/logo/remove`}>
                <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                <button type="submit" class="text-xs text-gray-400 hover:text-red-600 transition-colors">Remove logo</button>
              </form>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  )
})

admin.post('/admin/businesses/:id', async (c) => {
  const id = c.req.param('id')
  const vendor = await getVendorById(c.env.DB, id)
  if (!vendor) return c.notFound()
  const body = await c.req.parseBody({ all: true })
  const str = (v: unknown) => {
    const s = String(Array.isArray(v) ? v[0] ?? '' : v ?? '').trim()
    return s
  }
  const categories = (() => {
    const raw = body.categories
    const arr = (Array.isArray(raw) ? raw : raw != null ? [raw] : []).map((r) => String(r).trim()).filter(Boolean)
    return Array.from(new Set(arr))
  })()
  const businessName = str(body.business_name)
  if (!businessName) return c.redirect(`/admin/businesses/${id}?error=name`)

  // The category set actually persisted (falls back to the primary).
  const savedCategories = categories.length ? categories : [str(body.category) || vendor.category]

  await updateVendor(c.env.DB, id, {
    business_name: businessName,
    category: str(body.category) || vendor.category,
    categories: JSON.stringify(savedCategories),
    website: str(body.website) || null,
    instagram: str(body.instagram) || null, // updateVendor sanitizes this to a bare handle
    phone: str(body.phone) || null,
    location: str(body.location) || null,
    location_city: str(body.location_city) || null,
    location_state: str(body.location_state) || null,
    location_country: str(body.location_country) || null,
    bio: str(body.bio) || null,
    directory_listed: body.directory_listed === '1' ? 1 : 0,
    is_agency: body.is_agency === '1' ? 1 : 0,
    // Only meaningful for celebrants; can't be set on a non-celebrant via a crafted POST.
    celebrant_term: savedCategories.includes(CELEBRANT_SLUG) ? normalizeCelebrantTerm(body.celebrant_term) : null,
  })
  await auditLog(c, 'admin_edit_business', 'vendor', id, { business_name: businessName }).catch(() => {})
  return c.redirect(`/admin/businesses/${id}?saved=1`)
})

// Admin logo upload/remove for a business (mirrors the vendor's own settings).
admin.post('/admin/businesses/:id/logo', async (c) => {
  const id = c.req.param('id')
  const vendor = await getVendorById(c.env.DB, id)
  if (!vendor) return c.notFound()
  const body = await c.req.parseBody()
  const file = body.logo
  if (!file || !(file instanceof File) || file.size === 0) return c.redirect(`/admin/businesses/${id}?error=logo`)
  if (file.size > 5 * 1024 * 1024) return c.redirect(`/admin/businesses/${id}?error=logosize`)
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return c.redirect(`/admin/businesses/${id}?error=logotype`)
  if (!c.env.STORAGE) return c.redirect(`/admin/businesses/${id}?error=storage`)
  const r2Key = `vendor-logos/${id}.png`
  await c.env.STORAGE.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type } })
  await updateVendor(c.env.DB, id, { logo_r2_key: r2Key })
  await auditLog(c, 'admin_update_logo', 'vendor', id, {}).catch(() => {})
  return c.redirect(`/admin/businesses/${id}?saved=1`)
})

admin.post('/admin/businesses/:id/logo/remove', async (c) => {
  const id = c.req.param('id')
  const vendor = await getVendorById(c.env.DB, id)
  if (!vendor) return c.notFound()
  if (vendor.logo_r2_key && c.env.STORAGE) await c.env.STORAGE.delete(vendor.logo_r2_key).catch(() => {})
  await updateVendor(c.env.DB, id, { logo_r2_key: null })
  await auditLog(c, 'admin_remove_logo', 'vendor', id, {}).catch(() => {})
  return c.redirect(`/admin/businesses/${id}?saved=1`)
})

// One-off: normalise any Instagram values that were saved as a URL (or with @)
// down to a bare handle, so @mentions + profile links work. vendor_profiles and
// couple_vendors are D1-only (the source of the credits/mentions). Idempotent.
admin.post('/admin/backfill-instagram', async (c) => {
  const fixTable = async (table: string) => {
    const rows = await c.env.DB
      .prepare(`SELECT id, instagram FROM ${table} WHERE instagram IS NOT NULL AND instagram <> ''`)
      .all<{ id: string; instagram: string }>()
      .then((r) => r.results)
    let fixed = 0
    for (const row of rows) {
      const clean = sanitizeInstagramHandle(row.instagram)
      if (clean !== row.instagram) {
        await c.env.DB.prepare(`UPDATE ${table} SET instagram = ? WHERE id = ?`).bind(clean, row.id).run()
        fixed++
      }
    }
    return fixed
  }
  const vendors = await fixTable('vendor_profiles')
  const coupleVendors = await fixTable('couple_vendors')
  await auditLog(c, 'backfill_instagram', 'system', undefined, { vendors, coupleVendors }).catch(() => {})
  return c.json({ vendors, coupleVendors })
})

// One-off: ensure every vendor on every wedding has the couple's full contact
// details as a CRM contact (names, emails, phones, address, socials). For
// vendors added before this was wired into the add-vendor flows. Cursor-batched
// (storage writes per vendor exceed the per-request budget in one go).
// ensureCoupleContact is idempotent + non-destructive (fills only missing fields).
admin.post('/admin/backfill-couple-contacts', async (c) => {
  const BATCH = 15
  const body = await c.req.parseBody().catch(() => ({} as Record<string, unknown>))
  const after = typeof body.after === 'string' ? body.after : ''
  const weddings = await c.env.DB
    .prepare(
      `SELECT DISTINCT w.id FROM weddings w
       JOIN wedding_members wm ON wm.wedding_id = w.id
       WHERE wm.role = 'vendor' AND wm.status = 'active' AND wm.vendor_profile_id IS NOT NULL
         AND w.id > ?1
       ORDER BY w.id ASC
       LIMIT ?2`
    )
    .bind(after, BATCH)
    .all<{ id: string }>()
    .then((r) => r.results)
  let vendorsTouched = 0
  let fail = 0
  let lastError = ''
  for (const w of weddings) {
    try {
      const members = await c.env.DB
        .prepare(
          `SELECT DISTINCT vendor_profile_id FROM wedding_members
           WHERE wedding_id = ? AND role = 'vendor' AND status = 'active' AND vendor_profile_id IS NOT NULL`
        )
        .bind(w.id)
        .all<{ vendor_profile_id: string }>()
        .then((r) => r.results)
      for (const m of members) {
        const vp = await getVendorById(c.env.DB, m.vendor_profile_id)
        if (!vp) continue
        await ensureCoupleContact(c.env, vp, w.id)
        vendorsTouched++
      }
    } catch (err) {
      fail++
      lastError = String((err as Error)?.message ?? err)
      console.error('[backfill-couple-contacts] failed', w.id, err)
    }
  }
  const done = weddings.length < BATCH
  const nextCursor = weddings.length ? weddings[weddings.length - 1].id : after
  await auditLog(c, 'backfill_couple_contacts', 'system', undefined, { batch: weddings.length, vendorsTouched, fail, done }).catch(() => {})
  return c.json({ batch: weddings.length, vendorsTouched, fail, done, nextCursor, lastError: lastError || undefined })
})

// ─── Waitlist ───

function csvCell(v: string | null | undefined): string {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

admin.get('/admin/waitlist', async (c) => {
  const user = c.get('user')
  const [stats, countries, entries] = await Promise.all([
    getWaitlistStats(c.env.DB),
    getWaitlistCountryBreakdown(c.env.DB),
    listWaitlist(c.env.DB, { limit: 500 }),
  ])
  const countryMax = Math.max(1, ...countries.map((x) => x.count))

  return c.html(
    <AdminLayout title="Waitlist" user={user} csrfToken={c.get('csrfToken')}>
      <div class="space-y-6">
        <div class="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 class="text-2xl font-bold">Waitlist</h1>
            <p class="text-sm text-gray-500 mt-1">People who asked to be notified when Wedding Computer launches.</p>
          </div>
          <a href="/admin/waitlist/export" class="bg-gray-900 text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:bg-gray-800 transition-colors shrink-0">
            Export CSV
          </a>
        </div>

        <div class="grid grid-cols-3 gap-4 max-w-lg">
          <StatCard label="Subscribed" value={String(stats.subscribed)} />
          <StatCard label="Unsubscribed" value={String(stats.unsubscribed)} />
          <StatCard label="Total" value={String(stats.total)} />
        </div>

        {countries.length > 0 && (
          <section class="bg-white rounded-2xl p-5 sm:p-6 border border-gray-200 max-w-lg">
            <h2 class="text-sm font-bold text-gray-900 mb-4">By country (subscribed)</h2>
            <div class="space-y-1.5">
              {countries.map((row) => {
                const pct = Math.round((row.count / countryMax) * 100)
                return (
                  <div class="flex items-center gap-2 text-xs">
                    <span class="w-28 text-gray-500 text-right shrink-0 truncate" title={row.country}>{row.country}</span>
                    <div class="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      {pct > 0 && <div class="bg-gray-900 h-4 rounded-full" style={`width: ${pct}%`} />}
                    </div>
                    <span class="w-8 text-gray-700 font-medium text-right">{row.count}</span>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <section class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div class="px-5 py-4 border-b border-gray-100">
            <h2 class="text-sm font-bold text-gray-900">
              {entries.length === 500 ? 'Most recent 500 signups' : `${entries.length} signup${entries.length === 1 ? '' : 's'}`}
            </h2>
          </div>
          {entries.length === 0 ? (
            <p class="text-sm text-gray-400 px-5 py-6">No signups yet.</p>
          ) : (
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-gray-50 text-gray-500">
                  <tr>
                    <th class="text-left font-medium px-5 py-2.5">Email</th>
                    <th class="text-left font-medium px-3 py-2.5">Name</th>
                    <th class="text-left font-medium px-3 py-2.5">Country</th>
                    <th class="text-left font-medium px-3 py-2.5">Status</th>
                    <th class="text-left font-medium px-3 py-2.5">Source</th>
                    <th class="text-left font-medium px-5 py-2.5">Joined</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  {entries.map((e) => (
                    <tr>
                      <td class="px-5 py-2.5 text-gray-900">{e.email}</td>
                      <td class="px-3 py-2.5 text-gray-600">{e.name ?? '—'}</td>
                      <td class="px-3 py-2.5 text-gray-600">{e.country ?? '—'}</td>
                      <td class="px-3 py-2.5">
                        {e.status === 'subscribed' ? (
                          <span class="inline-block bg-green-50 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">Subscribed</span>
                        ) : (
                          <span class="inline-block bg-gray-100 text-gray-500 text-xs font-medium px-2 py-0.5 rounded-full">Unsubscribed</span>
                        )}
                      </td>
                      <td class="px-3 py-2.5 text-gray-400 text-xs">{e.source ?? '—'}</td>
                      <td class="px-5 py-2.5 text-gray-500 whitespace-nowrap">{(e.created_at ?? '').slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  )
})

admin.get('/admin/waitlist/export', async (c) => {
  const entries = await listWaitlistForExport(c.env.DB)
  const header = ['email', 'name', 'country', 'status', 'source', 'created_at']
  const rows = entries.map((e) =>
    [e.email, e.name, e.country, e.status, e.source, e.created_at].map(csvCell).join(',')
  )
  const csv = [header.join(','), ...rows].join('\r\n')
  const date = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="waitlist-${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
})

// ─── Broadcast email ───

type BroadcastValues = {
  vendors: boolean
  couples: boolean
  waitlist: boolean
  country: string
  subject: string
  body: string
}

function renderBroadcast(opts: {
  user: User
  csrfToken: string
  countries: string[]
  values: BroadcastValues
  preview?: { count: number } | null
  sentCount?: number | null
  error?: string | null
}) {
  const { user, csrfToken, countries, values, preview, sentCount, error } = opts
  return (
    <AdminLayout title="Broadcast" user={user} csrfToken={csrfToken}>
      <div class="space-y-6 max-w-2xl">
        <div>
          <h1 class="text-2xl font-bold">Broadcast email</h1>
          <p class="text-sm text-gray-500 mt-1">
            Send an announcement to vendors, couples, and the waitlist. Pick an audience, preview the
            recipient count, then send. Recipients are de-duplicated by email and delivered via the queue.
          </p>
        </div>

        {sentCount != null && (
          <div class="bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl p-3">
            Queued {sentCount} email{sentCount === 1 ? '' : 's'} for delivery.
          </div>
        )}
        {error && (
          <div class="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>
        )}

        <form method="post" action="/admin/broadcast" class="bg-white rounded-2xl p-5 sm:p-6 border border-gray-200 space-y-5">
          <input type="hidden" name="_csrf" value={csrfToken} />

          <div>
            <p class="block text-sm font-medium text-gray-700 mb-2">Audience</p>
            <div class="space-y-2">
              <label class="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" name="vendors" value="1" checked={values.vendors} class="rounded border-gray-300" /> All vendors
              </label>
              <label class="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" name="couples" value="1" checked={values.couples} class="rounded border-gray-300" /> All couples
              </label>
              <label class="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" name="waitlist" value="1" checked={values.waitlist} class="rounded border-gray-300" /> Waitlist
              </label>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1" for="country">Country filter</label>
            <select id="country" name="country" class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
              <option value="">All countries</option>
              {countries.map((ct) => (
                <option value={ct} selected={values.country === ct}>{ct}</option>
              ))}
            </select>
            <p class="text-xs text-gray-400 mt-1">Matched against vendor business country, couple profile country, and waitlist country.</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1" for="subject">Subject</label>
            <input type="text" id="subject" name="subject" required value={values.subject} placeholder="Wedding Computer is live!" class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1" for="body">Message</label>
            <textarea id="body" name="body" rows={10} required placeholder="Write your announcement…" class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">{values.body}</textarea>
            <p class="text-xs text-gray-400 mt-1">Plain text — leave a blank line between paragraphs. A branded header/footer is added automatically, plus an unsubscribe link for waitlist recipients.</p>
          </div>

          <div class="flex items-center gap-3 flex-wrap pt-1">
            <button type="submit" name="action" value="preview" class="bg-white border border-gray-300 text-gray-700 rounded-xl px-5 py-2.5 text-sm font-bold hover:bg-gray-50 transition-colors">
              Preview recipients
            </button>
            {preview && preview.count > 0 && (
              <button type="submit" name="action" value="send" class="bg-gray-900 text-white rounded-xl px-6 py-2.5 text-sm font-bold hover:bg-gray-800 transition-colors">
                Send to {preview.count} recipient{preview.count === 1 ? '' : 's'}
              </button>
            )}
          </div>

          {preview && (
            <p class="text-sm text-gray-600">
              {preview.count === 0
                ? 'No recipients match this selection.'
                : `${preview.count} unique recipient${preview.count === 1 ? '' : 's'} match this selection. Review, then click Send.`}
            </p>
          )}
        </form>
      </div>
    </AdminLayout>
  )
}

admin.get('/admin/broadcast', async (c) => {
  const user = c.get('user')
  const countries = await getBroadcastCountries(c.env.DB)
  const sent = c.req.query('sent')
  return c.html(
    renderBroadcast({
      user,
      csrfToken: c.get('csrfToken'),
      countries,
      values: { vendors: false, couples: false, waitlist: true, country: '', subject: '', body: '' },
      sentCount: sent != null ? parseInt(sent, 10) || 0 : null,
    })
  )
})

admin.post('/admin/broadcast', async (c) => {
  const user = c.get('user')
  const form = await c.req.parseBody()
  const values: BroadcastValues = {
    vendors: form.vendors === '1',
    couples: form.couples === '1',
    waitlist: form.waitlist === '1',
    country: typeof form.country === 'string' ? form.country.trim() : '',
    subject: typeof form.subject === 'string' ? form.subject.trim() : '',
    body: typeof form.body === 'string' ? form.body : '',
  }
  const action = form.action === 'send' ? 'send' : 'preview'
  const countries = await getBroadcastCountries(c.env.DB)

  const rerender = (extra: { preview?: { count: number } | null; error?: string | null }) =>
    c.html(renderBroadcast({ user, csrfToken: c.get('csrfToken'), countries, values, ...extra }))

  if (!values.vendors && !values.couples && !values.waitlist) {
    return rerender({ error: 'Select at least one audience.' })
  }
  if (!values.subject) return rerender({ error: 'Enter a subject.' })
  if (!values.body.trim()) return rerender({ error: 'Enter a message.' })

  const recipients = await getBroadcastRecipients(c.env.DB, {
    vendors: values.vendors,
    couples: values.couples,
    waitlist: values.waitlist,
    country: values.country || null,
  })

  if (action === 'preview') {
    return rerender({ preview: { count: recipients.length } })
  }

  if (recipients.length === 0) {
    return rerender({ preview: { count: 0 }, error: 'No recipients match — nothing was sent.' })
  }

  // Store the body once and fan out small per-recipient messages that
  // reference it by id. Embedding full HTML in every message overruns the
  // 256KB queue-batch limit (partial enqueue) and re-sends on resubmit.
  // Platform users get a signed one-click link that disables the
  // 'announcements' preference; waitlist-only recipients keep their
  // waitlist unsubscribe token.
  const broadcastId = await createBroadcast(c.env.DB, {
    subject: values.subject,
    body: values.body,
    createdByUserId: user.id,
    recipientCount: recipients.length,
  })
  const messages = await Promise.all(recipients.map(async (r) => {
    let unsub = ''
    if (r.userId) {
      unsub = unsubscribeUrl(c.env.APP_URL, await makeUnsubscribeToken(c.env.SESSION_SECRET, r.userId, 'announcements'))
    } else if (r.unsubscribeToken) {
      unsub = `${c.env.APP_URL}/notify/unsubscribe?token=${r.unsubscribeToken}`
    }
    return {
      body: {
        type: 'broadcast_email',
        broadcastId,
        to: r.email,
        toName: r.name ?? '',
        unsub,
      },
    }
  }))
  for (let i = 0; i < messages.length; i += 100) {
    await c.env.EMAIL_QUEUE.sendBatch(messages.slice(i, i + 100))
  }

  await auditLog(c, 'broadcast_email', 'broadcast', undefined, {
    audiences: { vendors: values.vendors, couples: values.couples, waitlist: values.waitlist },
    country: values.country || null,
    subject: values.subject,
    count: recipients.length,
  }).catch(() => {})

  return c.redirect(`/admin/broadcast?sent=${recipients.length}`)
})

export default admin
