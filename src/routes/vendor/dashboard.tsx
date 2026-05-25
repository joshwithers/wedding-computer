import { Hono } from 'hono'
import type { Env } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { formatDate, daysUntil } from '../../lib/date'

const dashboard = new Hono<Env>()

dashboard.use('/app/*', requireAuth, csrf, requireVendor)

dashboard.get('/app', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const db = c.env.DB

  const today = new Date().toISOString().slice(0, 10)

  const [upcomingWeddings, recentContacts, overduePayments, revenueRow, contactCounts, upcomingEvents] =
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
           ORDER BY created_at DESC LIMIT 5`
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
             SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_leads,
             SUM(CASE WHEN status = 'booked' THEN 1 ELSE 0 END) AS booked
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

  const revenue = revenueRow?.total ?? 0
  const counts = contactCounts ?? { total: 0, new_leads: 0, booked: 0 }
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
                      <div class="flex items-center gap-2 px-2 py-1.5 -mx-2">
                        <div class={`w-2 h-2 rounded-full flex-shrink-0 ${
                          ev.type === 'booking' ? 'bg-horizon-600' :
                          ev.type === 'blocked' ? 'bg-grapefruit-400' : 'bg-gray-300'
                        }`} />
                        <div>
                          <p class="text-sm font-medium text-gray-900">{ev.title}</p>
                          <p class="text-xs text-gray-500">{formatDate(ev.date)}</p>
                        </div>
                      </div>
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
            </section>
          </div>
        )}
      </div>
    </AppLayout>
  )
})

export default dashboard

function GettingStarted({ userName, businessName }: { userName: string; businessName: string }) {
  return (
    <div class="bg-white border border-papaya-300/30 rounded-2xl p-8 text-center">
      <h2 class="text-lg font-bold mb-2">Welcome, {userName}</h2>
      <p class="text-sm text-gray-600 mb-6">
        You're signed in as <strong>{businessName}</strong>. Here's what you can do:
      </p>
      <div class="grid sm:grid-cols-3 gap-4">
        <QuickLink href="/app/contacts" title="Add contacts" desc="Start tracking your leads and clients" />
        <QuickLink href="/app/calendar" title="Set availability" desc="Block out dates and manage your calendar" />
        <QuickLink href="/app/settings" title="Update profile" desc="Add your phone, website, and bio" />
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
