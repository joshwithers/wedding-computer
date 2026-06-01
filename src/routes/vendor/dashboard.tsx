import { Hono } from 'hono'
import type { Env } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { formatDate, daysUntil } from '../../lib/date'

const dashboard = new Hono<Env>()

dashboard.use('/app', requireAuth, csrf, requireVendor)
dashboard.use('/app/*', requireAuth, csrf, requireVendor)

dashboard.get('/app', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const vendor = c.get('vendor')
  if (!vendor) return c.redirect('/onboarding')
  const db = c.env.DB

  const today = new Date().toISOString().slice(0, 10)

  let upcomingWeddings: { id: string; title: string; date: string | null; location: string | null }[] = []
  let recentContacts: { id: string; first_name: string; last_name: string; status: string; created_at: string }[] = []
  let overduePayments: { id: string; label: string; amount_cents: number; due_date: string; invoice_title: string; invoice_id: string }[] = []
  let revenue = 0
  let counts = { total: 0, new_leads: 0, booked: 0 }
  let upcomingEvents: { id: string; title: string; date: string; start_time: string | null; type: string }[] = []

  try {
    const [weddings, contacts, overdue, revenueRow, contactCounts, events] =
      await Promise.all([
        db
          .prepare(
            `SELECT w.id, w.title, w.date, w.location
             FROM weddings w
             JOIN wedding_members wm ON wm.wedding_id = w.id
             WHERE wm.user_id = ? AND wm.status = 'active' AND w.date >= ?
             ORDER BY w.date ASC LIMIT 5`
          )
          .bind(user.id, today)
          .all<{ id: string; title: string; date: string | null; location: string | null }>()
          .then((r) => r.results),

        db
          .prepare(
            `SELECT id, first_name, last_name, status, created_at
             FROM contacts WHERE vendor_id = ?
             ORDER BY CASE WHEN status = 'new' THEN 0 ELSE 1 END, created_at DESC LIMIT 5`
          )
          .bind(vendor.id)
          .all<{ id: string; first_name: string; last_name: string; status: string; created_at: string }>()
          .then((r) => r.results),

        db
          .prepare(
            `SELECT ip.id, ip.label, ip.amount_cents, ip.due_date, i.title AS invoice_title, i.id AS invoice_id
             FROM invoice_payments ip
             JOIN invoices i ON i.id = ip.invoice_id
             WHERE ip.vendor_id = ? AND ip.status = 'pending' AND ip.due_date < ?
             ORDER BY ip.due_date ASC LIMIT 5`
          )
          .bind(vendor.id, today)
          .all<{ id: string; label: string; amount_cents: number; due_date: string; invoice_title: string; invoice_id: string }>()
          .then((r) => r.results),

        db
          .prepare(
            `SELECT COALESCE(SUM(amount_cents), 0) AS total
             FROM invoice_payments
             WHERE vendor_id = ? AND status = 'paid'`
          )
          .bind(vendor.id)
          .first<{ total: number }>(),

        db
          .prepare(
            `SELECT
               COUNT(*) AS total,
               COALESCE(SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END), 0) AS new_leads,
               COALESCE(SUM(CASE WHEN status = 'booked' THEN 1 ELSE 0 END), 0) AS booked
             FROM contacts WHERE vendor_id = ?`
          )
          .bind(vendor.id)
          .first<{ total: number; new_leads: number; booked: number }>(),

        db
          .prepare(
            `SELECT id, title, date, start_time, type
             FROM calendar_events
             WHERE vendor_id = ? AND date >= ?
             ORDER BY date ASC, start_time ASC LIMIT 5`
          )
          .bind(vendor.id, today)
          .all<{ id: string; title: string; date: string; start_time: string | null; type: string }>()
          .then((r) => r.results),
      ])

    upcomingWeddings = weddings
    recentContacts = contacts
    overduePayments = overdue
    revenue = revenueRow?.total ?? 0
    counts = contactCounts ?? { total: 0, new_leads: 0, booked: 0 }
    upcomingEvents = events
  } catch (err) {
    console.error('[dashboard] Failed to load dashboard data:', err)
  }

  const hasData = counts.total > 0 || upcomingWeddings.length > 0

  return c.html(
    <AppLayout title="Dashboard" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-4xl">
        {!hasData ? (
          <GettingStarted userName={user.name} businessName={vendor.business_name} />
        ) : (
          <div class="space-y-6">
            {/* Stats row */}
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Contacts" value={String(counts.total)} href="/app/contacts" />
              <StatCard label="New leads" value={String(counts.new_leads)} href="/app/contacts?status=new" accent />
              <StatCard label="Booked" value={String(counts.booked)} href="/app/contacts?status=booked" />
              <StatCard label="Revenue" value={formatCents(revenue)} href="/app/invoices?status=paid" />
            </div>

            {/* Overdue payments */}
            {overduePayments.length > 0 && (
              <section class="bg-grapefruit-50 border border-grapefruit-200 rounded-2xl p-5">
                <h3 class="text-sm font-bold text-grapefruit-700 mb-3">Overdue payments</h3>
                <div class="space-y-2">
                  {overduePayments.map((p) => (
                    <a href={`/app/invoices/${p.invoice_id}`} class="flex items-center justify-between text-sm hover:bg-grapefruit-100 rounded-lg px-2 py-1.5 -mx-2">
                      <div>
                        <span class="font-medium text-gray-900">{p.invoice_title}</span>
                        <span class="text-gray-500 ml-2">{p.label}</span>
                      </div>
                      <div class="text-right">
                        <span class="font-bold text-grapefruit-700">{formatCents(p.amount_cents)}</span>
                        <span class="text-xs text-gray-500 ml-2">due {formatDate(p.due_date)}</span>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}

            <div class="grid sm:grid-cols-2 gap-6">
              {/* Upcoming weddings */}
              <section class="bg-white border border-papaya-300/30 rounded-2xl p-5">
                <div class="flex items-center justify-between mb-3">
                  <h3 class="text-sm font-bold">Upcoming weddings</h3>
                  <a href="/app/weddings" class="text-xs text-horizon-600 font-bold hover:text-horizon-700">View all</a>
                </div>
                {upcomingWeddings.length === 0 ? (
                  <p class="text-sm text-gray-400">No upcoming weddings</p>
                ) : (
                  <div class="space-y-2">
                    {upcomingWeddings.map((w) => {
                      const days = w.date ? daysUntil(w.date) : null
                      return (
                        <a href={`/app/weddings/${w.id}`} class="block hover:bg-papaya-50 rounded-lg px-2 py-1.5 -mx-2">
                          <p class="text-sm font-medium text-gray-900">{w.title}</p>
                          <p class="text-xs text-gray-500">
                            {w.date ? formatDate(w.date) : 'Date TBD'}
                            {days !== null && days >= 0 && <span class="ml-1">({days} days)</span>}
                            {w.location && <span> · {w.location}</span>}
                          </p>
                        </a>
                      )
                    })}
                  </div>
                )}
              </section>

              {/* Upcoming events */}
              <section class="bg-white border border-papaya-300/30 rounded-2xl p-5">
                <div class="flex items-center justify-between mb-3">
                  <h3 class="text-sm font-bold">Coming up</h3>
                  <a href="/app/calendar" class="text-xs text-horizon-600 font-bold hover:text-horizon-700">Calendar</a>
                </div>
                {upcomingEvents.length === 0 ? (
                  <p class="text-sm text-gray-400">No upcoming events</p>
                ) : (
                  <div class="space-y-2">
                    {upcomingEvents.map((ev) => (
                      <a href={`/app/calendar?month=${ev.date.slice(0, 7)}`} class="flex items-center gap-2 px-2 py-1.5 -mx-2 hover:bg-papaya-50 rounded-lg">
                        <div class={`w-2 h-2 rounded-full flex-shrink-0 ${
                          ev.type === 'booking' ? 'bg-horizon-600' :
                          ev.type === 'blocked' ? 'bg-grapefruit-400' : 'bg-gray-300'
                        }`} />
                        <div>
                          <p class="text-sm font-medium text-gray-900">{ev.title}</p>
                          <p class="text-xs text-gray-500">{formatDate(ev.date)}</p>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* Recent contacts */}
            <section class="bg-white border border-papaya-300/30 rounded-2xl p-5">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-bold">Recent contacts</h3>
                <a href="/app/contacts" class="text-xs text-horizon-600 font-bold hover:text-horizon-700">View all</a>
              </div>
              {recentContacts.length > 0 ? (
                <div class="space-y-1">
                  {recentContacts.map((ct) => (
                    <a href={`/app/contacts/${ct.id}`} class="flex items-center justify-between hover:bg-papaya-50 rounded-lg px-2 py-1.5 -mx-2">
                      <span class="text-sm text-gray-900">{ct.first_name} {ct.last_name}</span>
                      <span class={`text-xs font-bold px-2 py-0.5 rounded-full ${statusColor(ct.status)}`}>
                        {ct.status}
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <p class="text-sm text-gray-400">No contacts yet</p>
              )}
            </section>
          </div>
        )}

        {/* Your data section — always shown */}
        <section class="mt-8 bg-white border border-papaya-300/30 rounded-2xl p-5">
          <div class="flex items-start gap-3 mb-3">
            <div class="w-8 h-8 bg-horizon-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg class="w-4 h-4 text-horizon-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h3 class="text-sm font-bold text-gray-900">Your data is stored as plain text</h3>
              <p class="text-xs text-gray-500 mt-0.5">
                Every contact and wedding is a Markdown file with YAML frontmatter. Your data is readable, portable, and yours forever.
              </p>
            </div>
          </div>
          <div class="grid sm:grid-cols-3 gap-3 mt-4">
            <a
              href="/app/settings#data"
              class="flex items-center gap-3 border border-horizon-600/20 bg-horizon-50 rounded-xl px-4 py-3 hover:bg-horizon-100 transition-colors"
            >
              <svg class="w-5 h-5 text-horizon-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <div>
                <p class="text-sm font-bold text-horizon-700">Sync with GitHub</p>
                <p class="text-xs text-gray-600">Auto-sync to a private repo, open in Obsidian or VS Code</p>
              </div>
            </a>
            <a
              href="/app/settings/export-markdown"
              class="flex items-center gap-3 border border-gray-200 rounded-xl px-4 py-3 hover:bg-papaya-50 transition-colors"
            >
              <svg class="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
              <div>
                <p class="text-sm font-bold text-gray-900">Download Markdown</p>
                <p class="text-xs text-gray-500">Contacts and weddings as .md files</p>
              </div>
            </a>
            <a
              href="/app/settings/export"
              class="flex items-center gap-3 border border-gray-200 rounded-xl px-4 py-3 hover:bg-papaya-50 transition-colors"
            >
              <svg class="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <div>
                <p class="text-sm font-bold text-gray-900">Download JSON</p>
                <p class="text-xs text-gray-500">Full export for backups</p>
              </div>
            </a>
          </div>
          <div class="mt-3 pt-3 border-t border-gray-100">
            <a href="/docs/plain-text" class="text-xs text-horizon-600 font-bold hover:text-horizon-700">
              Learn more about how your data is stored &rarr;
            </a>
          </div>
        </section>
      </div>
    </AppLayout>
  )
})

export default dashboard

function GettingStarted({ userName, businessName }: { userName: string; businessName: string }) {
  return (
    <div class="space-y-6">
      <div class="bg-white border border-papaya-300/30 rounded-2xl p-8 text-center">
        <h2 class="text-lg font-bold mb-2">Welcome, {userName}</h2>
        <p class="text-sm text-gray-600 mb-6">
          {"You're signed in as "}<strong>{businessName}</strong>. Here are some things to get started:
        </p>
        <div class="grid sm:grid-cols-3 gap-4">
          <QuickLink href="/app/contacts" title="Add contacts" desc="Start tracking your leads and clients" />
          <QuickLink href="/app/calendar" title="Set availability" desc="Block out dates and manage your calendar" />
          <QuickLink href="/app/settings" title="Update profile" desc="Add your phone, website, and bio" />
        </div>
      </div>

      <div class="bg-horizon-50 border border-horizon-600/20 rounded-2xl p-5">
        <h3 class="text-sm font-bold text-horizon-700 mb-2">How Wedding Computer works</h3>
        <p class="text-sm text-gray-700 mb-3">
          Everything you store here — contacts, weddings, notes — is saved as plain text Markdown files.
          This means your data is portable, human-readable, and yours forever, even if you stop using this app.
        </p>
        <div class="grid sm:grid-cols-2 gap-3 text-xs text-gray-600">
          <div class="flex items-start gap-2">
            <span class="text-horizon-600 mt-0.5 font-bold">1.</span>
            <span>Add your contacts and weddings through the app</span>
          </div>
          <div class="flex items-start gap-2">
            <span class="text-horizon-600 mt-0.5 font-bold">2.</span>
            <span>We store them as Markdown files you can open in any text editor</span>
          </div>
          <div class="flex items-start gap-2">
            <span class="text-horizon-600 mt-0.5 font-bold">3.</span>
            <span>Connect GitHub in <a href="/app/settings#data" class="text-horizon-600 font-bold hover:underline">Settings</a> to auto-sync files to a private repo</span>
          </div>
          <div class="flex items-start gap-2">
            <span class="text-horizon-600 mt-0.5 font-bold">4.</span>
            <span>Clone the repo and open your files in Obsidian, VS Code, or any text editor</span>
          </div>
        </div>
        <div class="mt-3 pt-3 border-t border-horizon-600/10">
          <a href="/docs/plain-text" class="text-xs font-bold text-horizon-700 hover:underline">
            Read more about our plain text data philosophy &rarr;
          </a>
        </div>
      </div>
    </div>
  )
}

function QuickLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <a href={href} class="border border-papaya-300/30 rounded-2xl p-4 hover:border-horizon/30 hover:bg-papaya-100 transition-colors">
      <h3 class="font-bold text-sm mb-1">{title}</h3>
      <p class="text-xs text-gray-500">{desc}</p>
    </a>
  )
}

function StatCard({ label, value, href, accent }: { label: string; value: string; href: string; accent?: boolean }) {
  return (
    <a href={href} class="bg-white border border-papaya-300/30 rounded-2xl p-4 hover:border-horizon/30 transition-colors">
      <p class="text-xs text-gray-500">{label}</p>
      <p class={`text-xl font-bold mt-0.5 ${accent ? 'text-horizon-700' : 'text-gray-900'}`}>{value}</p>
    </a>
  )
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    new: 'bg-horizon-50 text-horizon-700',
    contacted: 'bg-papaya-100 text-papaya-700',
    meeting: 'bg-papaya-100 text-papaya-700',
    quoted: 'bg-papaya-100 text-papaya-700',
    booked: 'bg-horizon-100 text-horizon-700',
    completed: 'bg-gray-100 text-gray-600',
    lost: 'bg-grapefruit-50 text-grapefruit-700',
    archived: 'bg-gray-100 text-gray-500',
  }
  return map[status] ?? 'bg-gray-100 text-gray-600'
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
