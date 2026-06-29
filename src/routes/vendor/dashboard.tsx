import { Hono } from 'hono'
import type { Env } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { weddingDisplayTitle } from '../../lib/wedding-display'
import { getI18n, t, tp, type MessageKey } from '../../i18n'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { formatDate, daysUntil } from '../../lib/date'
import { countEvents } from '../../db/analytics'
import { isProVendor } from '../../db/subscriptions'
import { listWeddingTodosWithProgress } from '../../db/todos'
import { listVendorCalendarRows } from '../../db/timeline'
import { todoStats } from '../../lib/todo-parser'
import { buildSetupChecklist, categorySetup, type SetupChecklist, type CategorySetup } from '../../lib/onboarding'
import { dismissSetup, dismissDemo } from '../../db/vendors'
import { SQL_WEDDING_ACTIVE, SQL_CALENDAR_EVENT_NOT_CANCELLED } from '../../db/weddings'
import { seedDemoData, teardownDemoData, hasDemoData, isNewVendor } from '../../services/demo-data'
import { auditLog } from '../../middleware/audit'
import { dbOf } from '../../middleware/d1-session'
import { timed } from '../../lib/timing'

const dashboard = new Hono<Env>()

dashboard.use('/app', requireAuth, csrf, requireVendor)
dashboard.use('/app/*', requireAuth, csrf, requireVendor)

dashboard.get('/app', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  const vendor = c.get('vendor')
  if (!vendor) return c.redirect('/onboarding')
  // Read-only landing page: route its query batch through the replica session so
  // the dashboard fan-out doesn't load the write primary. dbOf falls back to the
  // primary binding, and the "wrote-recently" window keeps it self-consistent.
  const db = dbOf(c)

  const today = new Date().toISOString().slice(0, 10)

  let upcomingWeddings: { id: string; title: string; date: string | null; location: string | null }[] = []
  let recentContacts: { id: string; first_name: string; last_name: string; status: string; created_at: string }[] = []
  let overduePayments: { id: string; label: string; amount_cents: number; due_date: string; invoice_title: string; invoice_id: string }[] = []
  let revenue = 0
  let counts = { total: 0, new_leads: 0, booked: 0 }
  let upcomingEvents: { id: string; title: string; date: string; start_time: string | null; type: string }[] = []
  let todoProgress: { wedding_id: string; wedding_title: string; wedding_date: string | null; content: string }[] = []
  let eventsCount = 0
  let enquiries30 = 0
  let bookings30 = 0
  let isPro = false
  let demoExists = false
  let demoIsNew = false
  // 30-day window for the analytics teaser strip (computed before the batch).
  const tomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
  const thirtyAgo = new Date(Date.parse(today + 'T00:00:00Z') - 30 * 86400000).toISOString().slice(0, 10)

  try {
    const [weddings, contacts, overdue, revenueRow, contactCounts, events, todos, eventsCountRow, enq30, book30, pro, demoLoaded, newVendor, tlRows] =
      await timed(c, 'dash_q', () => Promise.all([
        db
          .prepare(
            `SELECT w.id, w.title, w.emoji, w.date, w.location
             FROM weddings w
             JOIN wedding_members wm ON wm.wedding_id = w.id
             WHERE wm.user_id = ? AND wm.status = 'active' AND w.date >= ?
               AND ${SQL_WEDDING_ACTIVE('w')}
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
               AND ${SQL_CALENDAR_EVENT_NOT_CANCELLED('calendar_events')}
             ORDER BY date ASC, start_time ASC LIMIT 5`
          )
          .bind(vendor.id, today)
          .all<{ id: string; title: string; date: string; start_time: string | null; type: string }>()
          .then((r) => r.results),

        listWeddingTodosWithProgress(db, vendor.id),

        db
          .prepare('SELECT COUNT(*) AS total FROM calendar_events WHERE vendor_id = ?')
          .bind(vendor.id)
          .first<{ total: number }>(),

        // Folded in from former second/third query waves — all independent.
        countEvents(db, vendor.id, 'enquiry_received', thirtyAgo, tomorrow),
        countEvents(db, vendor.id, 'booking_confirmed', thirtyAgo, tomorrow),
        isProVendor(db, vendor.id),
        hasDemoData(db, vendor.id, user.id),
        isNewVendor(db, vendor.id, user.id),
        // The shared run sheet across every wedding this vendor is on — so the
        // dashboard "coming up" shows the whole shared timeline, not just the
        // legacy ceremony anchor in calendar_events. Bounded to upcoming rows
        // (the JS below only keeps date >= today then slices to 5); the limit
        // leaves headroom for the dedup-against-legacy-events merge before slice.
        listVendorCalendarRows(db, vendor.id, { sinceDate: today, limit: 20 }),
      ]))

    upcomingWeddings = weddings
    recentContacts = contacts
    overduePayments = overdue
    revenue = revenueRow?.total ?? 0
    counts = contactCounts ?? { total: 0, new_leads: 0, booked: 0 }
    // Merge legacy calendar_events with the shared timeline. Dedup TIMED events by
    // date+time so the legacy ceremony anchor and its timeline section don't both
    // show; untimed events stay distinct (keyed by id).
    const tlEvents = tlRows
      .filter((r) => r.wedding_date >= today)
      .map((r) => ({
        id: r.id,
        title: r.wedding_title ? `${r.wedding_title}: ${r.title}` : r.title,
        date: r.wedding_date,
        start_time: r.start_time,
        type: 'timeline',
      }))
    const seenEv = new Set<string>()
    upcomingEvents = [...events, ...tlEvents]
      .filter((ev) => {
        const k = ev.start_time ? `${ev.date}|${ev.start_time}` : `${ev.type}|${ev.id}`
        if (seenEv.has(k)) return false
        seenEv.add(k)
        return true
      })
      .sort((a, b) => a.date.localeCompare(b.date) || (a.start_time ?? '~').localeCompare(b.start_time ?? '~'))
      .slice(0, 5)
    todoProgress = todos
    eventsCount = eventsCountRow?.total ?? 0
    enquiries30 = enq30
    bookings30 = book30
    isPro = pro
    demoExists = demoLoaded
    demoIsNew = newVendor
  } catch (err) {
    console.error('[dashboard] Failed to load dashboard data:', err)
  }

  const bookingRate30 = enquiries30 > 0 ? Math.round((bookings30 / enquiries30) * 100) : 0

  // Demo-data card state comes from the single batch above: "Remove" when demo
  // data is loaded; otherwise the first-run "Load" invite to a new/empty vendor
  // who hasn't dismissed it.
  const demoCard: 'loaded' | 'invite' | null = demoExists
    ? 'loaded'
    : vendor.demo_dismissed !== 1 && demoIsNew
      ? 'invite'
      : null

  const hasData = counts.total > 0 || upcomingWeddings.length > 0
  const checklist = buildSetupChecklist(vendor, { contacts: counts.total, events: eventsCount })
  const showChecklist = vendor.setup_dismissed !== 1 && checklist.percent < 100
  const discovery = categorySetup(vendor.category)

  return c.html(
    <AppLayout title={t('dashboard.title')} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-4xl">
        {showChecklist && <SetupCard checklist={checklist} />}
        {demoCard && <DemoDataCard demoExists={demoCard === 'loaded'} />}

        {!hasData ? (
          <DiscoveryGrid userName={user.name} discovery={discovery} />
        ) : (
          <div class="space-y-6">
            {/* Stats row */}
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label={t('dashboard.contacts')} value={String(counts.total)} href="/app/contacts" />
              <StatCard label={t('dashboard.newLeads')} value={String(counts.new_leads)} href="/app/contacts?status=new" accent />
              <StatCard label={t('dashboard.booked')} value={String(counts.booked)} href="/app/contacts?status=booked" />
              <StatCard label={t('dashboard.revenue')} value={formatCents(revenue)} href="/app/invoices?status=paid" />
            </div>

            <AnalyticsTeaser enquiries={enquiries30} bookings={bookings30} rate={bookingRate30} isPro={isPro} />

            {/* Overdue payments */}
            {overduePayments.length > 0 && (
              <section class="bg-grapefruit-50 border border-grapefruit-200 rounded-2xl p-5">
                <h3 class="text-sm font-bold text-grapefruit-700 mb-3">{t('dashboard.overduePayments')}</h3>
                <div class="space-y-2">
                  {overduePayments.map((p) => (
                    <a href={`/app/invoices/${p.invoice_id}`} class="flex items-center justify-between text-sm hover:bg-grapefruit-100 rounded-lg px-2 py-1.5 -mx-2">
                      <div>
                        <span class="font-medium text-gray-900">{p.invoice_title}</span>
                        <span class="text-gray-500 ml-2">{p.label}</span>
                      </div>
                      <div class="text-right">
                        <span class="font-bold text-grapefruit-700">{formatCents(p.amount_cents)}</span>
                        <span class="text-xs text-gray-500 ml-2">{t('dashboard.paymentDue', { date: formatDate(p.due_date) })}</span>
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
                  <h3 class="text-sm font-bold">{t('dashboard.upcomingWeddings')}</h3>
                  <a href="/app/weddings" class="text-xs text-horizon-600 font-bold hover:text-horizon-700">{t('common.viewAll')}</a>
                </div>
                {upcomingWeddings.length === 0 ? (
                  <p class="text-sm text-gray-400">{t('dashboard.noUpcomingWeddings')}</p>
                ) : (
                  <div class="space-y-2">
                    {upcomingWeddings.map((w) => {
                      const days = w.date ? daysUntil(w.date) : null
                      return (
                        <a href={`/app/weddings/${w.id}`} class="block hover:bg-papaya-50 rounded-lg px-2 py-1.5 -mx-2">
                          <p class="text-sm font-medium text-gray-900">{weddingDisplayTitle(w)}</p>
                          <p class="text-xs text-gray-500">
                            {w.date ? formatDate(w.date) : t('dashboard.dateTbd')}
                            {days !== null && days >= 0 && <span class="ml-1">({tp('dashboard.day', days)})</span>}
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
                  <h3 class="text-sm font-bold">{t('dashboard.comingUp')}</h3>
                  <a href="/app/calendar" class="text-xs text-horizon-600 font-bold hover:text-horizon-700">{t('nav.calendar')}</a>
                </div>
                {upcomingEvents.length === 0 ? (
                  <p class="text-sm text-gray-400">{t('dashboard.noUpcomingEvents')}</p>
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

            {/* Checklist progress */}
            {todoProgress.length > 0 && (
              <section class="bg-white border border-papaya-300/30 rounded-2xl p-5">
                <div class="flex items-center justify-between mb-3">
                  <h3 class="text-sm font-bold">{t('dashboard.checklists')}</h3>
                  <a href="/app/checklists" class="text-xs text-horizon-600 font-bold hover:text-horizon-700">{t('dashboard.templates')}</a>
                </div>
                <div class="space-y-3">
                  {todoProgress.map((todo) => {
                    const stats = todoStats(todo.content)
                    const pct = stats.total > 0 ? Math.round((stats.checked / stats.total) * 100) : 0
                    return (
                      <a href={`/app/weddings/${todo.wedding_id}`} class="block hover:bg-papaya-50 rounded-lg px-2 py-2 -mx-2">
                        <div class="flex items-center justify-between mb-1.5">
                          <span class="text-sm font-medium text-gray-900 truncate">{todo.wedding_title}</span>
                          <span class="text-xs text-gray-500 ml-2 whitespace-nowrap">
                            {stats.checked}/{stats.total} ({pct}%)
                          </span>
                        </div>
                        <div class="w-full bg-gray-100 rounded-full h-1.5">
                          <div
                            class={`h-1.5 rounded-full transition-all ${
                              pct === 100 ? 'bg-horizon-600' : pct > 50 ? 'bg-horizon-400' : 'bg-papaya-400'
                            }`}
                            style={`width: ${pct}%`}
                          />
                        </div>
                        {todo.wedding_date && (
                          <p class="text-xs text-gray-400 mt-1">{formatDate(todo.wedding_date)}</p>
                        )}
                      </a>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Recent contacts */}
            <section class="bg-white border border-papaya-300/30 rounded-2xl p-5">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-bold">{t('dashboard.recentContacts')}</h3>
                <a href="/app/contacts" class="text-xs text-horizon-600 font-bold hover:text-horizon-700">{t('common.viewAll')}</a>
              </div>
              {recentContacts.length > 0 ? (
                <div class="space-y-1">
                  {recentContacts.map((ct) => (
                    <a href={`/app/contacts/${ct.id}`} class="flex items-center justify-between hover:bg-papaya-50 rounded-lg px-2 py-1.5 -mx-2">
                      <span class="text-sm text-gray-900">{ct.first_name} {ct.last_name}</span>
                      <span class={`text-xs font-bold px-2 py-0.5 rounded-full ${statusColor(ct.status)}`}>
                        {contactStatusLabel(ct.status)}
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <p class="text-sm text-gray-400">{t('dashboard.noContactsYet')}</p>
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
              <h3 class="text-sm font-bold text-gray-900">{t('dashboard.data.title')}</h3>
              <p class="text-xs text-gray-500 mt-0.5">
                {t('dashboard.data.desc')}
              </p>
            </div>
          </div>
          <div class="grid sm:grid-cols-2 gap-3 mt-4">
            <a
              href="/docs/plain-text"
              class="flex items-center gap-3 border border-horizon-600/20 bg-horizon-50 rounded-xl px-4 py-3 hover:bg-horizon-100 transition-colors"
            >
              <svg class="w-5 h-5 text-horizon-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <div>
                <p class="text-sm font-bold text-horizon-700">{t('dashboard.data.markdown.title')}</p>
                <p class="text-xs text-gray-600">{t('dashboard.data.markdown.desc')}</p>
              </div>
            </a>
            <a
              href="/account/export"
              class="flex items-center gap-3 border border-gray-200 rounded-xl px-4 py-3 hover:bg-papaya-50 transition-colors"
            >
              <svg class="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
              <div>
                <p class="text-sm font-bold text-gray-900">{t('dashboard.data.archive.title')}</p>
                <p class="text-xs text-gray-500">{t('dashboard.data.archive.desc')}</p>
              </div>
            </a>
          </div>
          <div class="mt-3 pt-3 border-t border-gray-100">
            <a href="/docs/plain-text" class="text-xs text-horizon-600 font-bold hover:text-horizon-700">
              {t('dashboard.data.learnStorage')} &rarr;
            </a>
          </div>
        </section>
      </div>
    </AppLayout>
  )
})

dashboard.post('/app/dashboard/dismiss-setup', async (c) => {
  const vendor = c.get('vendor')
  if (vendor) await dismissSetup(c.env.DB, vendor.id)
  return c.body('') // htmx outerHTML swap removes the card
})

// ─── Demo / sample data (first-run) ───

dashboard.post('/app/dashboard/demo/add', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')
  if (!user || !vendor) return c.body('', 400)
  // Guard against double-clicks creating two sets.
  if (await hasDemoData(c.env.DB, vendor.id, user.id)) return c.html(<DemoDataCard demoExists={true} />)
  try {
    await seedDemoData(c.env, vendor, user)
  } catch (err) {
    console.error('[dashboard] seedDemoData failed:', err)
    return c.html(<DemoDataCard demoExists={false} error />)
  }
  await auditLog(c, 'demo_data_seed', 'vendor', vendor.id).catch(() => {})
  return c.html(<DemoDataCard demoExists={true} />)
})

dashboard.post('/app/dashboard/demo/remove', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')
  if (!user || !vendor) return c.body('', 400)
  try {
    await teardownDemoData(c.env, vendor, user)
  } catch (err) {
    console.error('[dashboard] teardownDemoData failed:', err)
    return c.html(<DemoDataCard demoExists={true} error />)
  }
  await auditLog(c, 'demo_data_remove', 'vendor', vendor.id).catch(() => {})
  // Revert to the Load invite if they're still new/empty; otherwise drop the card.
  const stillInvite = vendor.demo_dismissed !== 1 && (await isNewVendor(c.env.DB, vendor.id, user.id))
  return stillInvite ? c.html(<DemoDataCard demoExists={false} />) : c.body('')
})

dashboard.post('/app/dashboard/demo/dismiss', async (c) => {
  const vendor = c.get('vendor')
  if (vendor) await dismissDemo(c.env.DB, vendor.id)
  return c.body('') // htmx outerHTML swap removes the card
})

export default dashboard

function DemoDataCard({ demoExists, error }: { demoExists: boolean; error?: boolean }) {
  // Centered overlay spinner: takes no layout space when idle (so the label
  // sits with even padding), fades in over the hidden label while the request
  // is in flight (htmx adds .htmx-request to the button).
  const spinner = (
    <svg class="hidden group-[.htmx-request]:block absolute inset-0 m-auto animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  )
  return (
    <section id="demo-card" class="bg-white border border-papaya-300/30 rounded-2xl p-5 mb-6">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h3 class="text-sm font-bold text-gray-900">
            {demoExists ? t('dashboard.demo.loadedTitle') : t('dashboard.demo.addTitle')}
          </h3>
          <p class="text-xs text-gray-500 mt-0.5">
            {demoExists ? t('dashboard.demo.loadedBlurb') : t('dashboard.demo.addBlurb')}
          </p>
          {error && <p class="text-xs text-grapefruit-600 font-bold mt-1.5">{t('dashboard.demo.error')}</p>}
        </div>
        {demoExists ? (
          <button
            type="button"
            hx-post="/app/dashboard/demo/remove"
            hx-target="#demo-card"
            hx-swap="outerHTML"
            hx-disabled-elt="this"
            class="group relative whitespace-nowrap text-sm font-bold text-grapefruit-600 hover:text-grapefruit-700 border border-grapefruit-600/30 rounded-xl px-4 py-2 transition-colors disabled:opacity-90"
          >
            <span class="group-[.htmx-request]:invisible">{t('dashboard.demo.removeCta')}</span>
            {spinner}
          </button>
        ) : (
          <div class="flex flex-col items-end gap-1.5 flex-shrink-0">
            <button
              type="button"
              hx-post="/app/dashboard/demo/add"
              hx-target="#demo-card"
              hx-swap="outerHTML"
              hx-disabled-elt="this"
              class="group relative whitespace-nowrap text-sm font-bold text-white bg-horizon-600 hover:bg-horizon-700 rounded-xl px-4 py-2 transition-colors disabled:opacity-90"
            >
              <span class="group-[.htmx-request]:invisible">{t('dashboard.demo.addCta')}</span>
              {spinner}
            </button>
            <button
              type="button"
              hx-post="/app/dashboard/demo/dismiss"
              hx-target="#demo-card"
              hx-swap="outerHTML"
              class="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              {t('common.dismiss')}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

function SetupCard({ checklist }: { checklist: SetupChecklist }) {
  return (
    <section id="setup-card" class="bg-white border border-papaya-300/30 rounded-2xl p-5 mb-6">
      <div class="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 class="text-sm font-bold text-gray-900">{t('dashboard.setup.title')}</h3>
          <p class="text-xs text-gray-500 mt-0.5">{t('dashboard.setup.progress', { done: checklist.doneCount, total: checklist.total })}</p>
        </div>
        <button
          type="button"
          hx-post="/app/dashboard/dismiss-setup"
          hx-target="#setup-card"
          hx-swap="outerHTML"
          class="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          {t('common.dismiss')}
        </button>
      </div>
      <div class="w-full bg-gray-100 rounded-full h-1.5 mb-4">
        <div
          class={`h-1.5 rounded-full transition-all ${checklist.percent > 50 ? 'bg-horizon-600' : 'bg-papaya-400'}`}
          style={`width: ${checklist.percent}%`}
        />
      </div>
      <div class="space-y-0.5">
        {checklist.items.map((it) => (
          <a href={it.href} class="flex items-center gap-3 px-2 py-1.5 -mx-2 rounded-lg hover:bg-papaya-50 transition-colors">
            {it.done ? (
              <span class="w-5 h-5 rounded-full bg-horizon-600 text-white flex items-center justify-center text-xs flex-shrink-0">&#10003;</span>
            ) : (
              <span class="w-5 h-5 rounded-full border-2 border-gray-200 flex-shrink-0" />
            )}
            <span class={`text-sm ${it.done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{it.label}</span>
          </a>
        ))}
      </div>
    </section>
  )
}

function DiscoveryGrid({ userName, discovery }: { userName: string; discovery: CategorySetup }) {
  return (
    <div class="space-y-6">
      <div class="bg-white border border-papaya-300/30 rounded-2xl p-6">
        <h2 class="text-lg font-bold mb-1">{t('dashboard.welcome', { name: userName })}</h2>
        <p class="text-sm text-gray-600 mb-5">{discovery.blurb}</p>
        <div class="grid sm:grid-cols-2 gap-3">
          {discovery.recommended.map((f) => (
            <QuickLink href={f.href} title={f.label} desc={f.desc} />
          ))}
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

// Analytics teaser strip. Free vendors see the same live 30-day pulse, but the
// link sells the locked depth (trends, benchmarks, demand); Pro vendors get a
// plain "View analytics".
function AnalyticsTeaser({ enquiries, bookings, rate, isPro }: { enquiries: number; bookings: number; rate: number; isPro: boolean }) {
  return (
    <a href="/app/analytics" class="block bg-white rounded-2xl p-5 hover:bg-horizon-50/40 transition-colors group">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-bold text-gray-900">{t('analytics.teaser.title')}</h3>
        <span class="text-xs text-horizon-600 font-bold group-hover:text-horizon-700">
          {isPro ? t('analytics.teaser.link') : t('analytics.teaser.linkFree')} →
        </span>
      </div>
      <div class="grid grid-cols-3 gap-4">
        <TeaserStat label={t('analytics.overview.enquiries')} value={String(enquiries)} />
        <TeaserStat label={t('analytics.overview.bookings')} value={String(bookings)} />
        <TeaserStat label={t('analytics.overview.bookingRate')} value={`${rate}%`} />
      </div>
      <p class="text-xs text-gray-400 mt-3">{t('analytics.overview.last30')}</p>
    </a>
  )
}

function TeaserStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p class="text-xl font-bold text-gray-900 tabular-nums">{value}</p>
      <p class="text-xs text-gray-500">{label}</p>
    </div>
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

function contactStatusLabel(status: string): string {
  const map: Record<string, MessageKey> = {
    new: 'contacts.status.new',
    contacted: 'contacts.status.contacted',
    meeting: 'contacts.status.meeting',
    quoted: 'contacts.status.quoted',
    booked: 'contacts.status.booked',
    completed: 'contacts.status.completed',
    lost: 'contacts.status.lost',
    archived: 'contacts.status.archived',
  }
  return t(map[status] ?? 'contacts.status.unknown')
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat(getI18n().locale, {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}
