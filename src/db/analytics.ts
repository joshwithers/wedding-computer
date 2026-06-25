import type { AnalyticsEvent, D1Like } from '../types'
import { SQL_WEDDING_NOT_CANCELLED } from './weddings'

export async function trackEvent(
  db: D1Database,
  data: {
    vendor_id: string
    event_type: string
    contact_id?: string | null
    wedding_id?: string | null
    invoice_id?: string | null
    metadata?: Record<string, unknown> | null
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO analytics_events (vendor_id, event_type, contact_id, wedding_id, invoice_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.vendor_id,
      data.event_type,
      data.contact_id ?? null,
      data.wedding_id ?? null,
      data.invoice_id ?? null,
      data.metadata ? JSON.stringify(data.metadata) : null
    )
    .run()
}

export async function countEvents(
  db: D1Like,
  vendorId: string,
  eventType: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as count FROM analytics_events
       WHERE vendor_id = ? AND event_type = ? AND created_at >= ? AND created_at < ?`
    )
    .bind(vendorId, eventType, startDate, endDate)
    .first<{ count: number }>()
  return row?.count ?? 0
}

export async function countEventsGlobal(
  db: D1Database,
  eventType: string,
  startDate: string,
  endDate: string,
  opts?: { category?: string; location?: string }
): Promise<number> {
  if (opts?.category || opts?.location) {
    let query = `SELECT COUNT(*) as count FROM analytics_events ae
       JOIN vendor_profiles vp ON vp.id = ae.vendor_id
       WHERE ae.event_type = ? AND ae.created_at >= ? AND ae.created_at < ?`
    const params: unknown[] = [eventType, startDate, endDate]

    if (opts.category) {
      query += ' AND vp.category = ?'
      params.push(opts.category)
    }
    if (opts.location) {
      query += ' AND vp.location LIKE ?'
      params.push(`%${opts.location}%`)
    }

    const row = await db
      .prepare(query)
      .bind(...params)
      .first<{ count: number }>()
    return row?.count ?? 0
  }

  const row = await db
    .prepare(
      `SELECT COUNT(*) as count FROM analytics_events
       WHERE event_type = ? AND created_at >= ? AND created_at < ?`
    )
    .bind(eventType, startDate, endDate)
    .first<{ count: number }>()
  return row?.count ?? 0
}

export async function getMonthlyEventCounts(
  db: D1Database,
  vendorId: string,
  eventType: string,
  months: number
): Promise<{ month: string; count: number }[]> {
  const rows = await db
    .prepare(
      `SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
       FROM analytics_events
       WHERE vendor_id = ? AND event_type = ? AND created_at >= date('now', ? || ' months')
       GROUP BY month
       ORDER BY month`
    )
    .bind(vendorId, eventType, -months)
    .all<{ month: string; count: number }>()
  return rows.results
}

export async function getMonthlyEventCountsGlobal(
  db: D1Database,
  eventType: string,
  months: number
): Promise<{ month: string; count: number }[]> {
  const rows = await db
    .prepare(
      `SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
       FROM analytics_events
       WHERE event_type = ? AND created_at >= date('now', ? || ' months')
       GROUP BY month
       ORDER BY month`
    )
    .bind(eventType, -months)
    .all<{ month: string; count: number }>()
  return rows.results
}

export async function getConversionFunnel(
  db: D1Database,
  vendorId: string,
  startDate: string,
  endDate: string
): Promise<{ status: string; count: number }[]> {
  const rows = await db
    .prepare(
      `SELECT status, COUNT(*) as count FROM contacts
       WHERE vendor_id = ? AND created_at >= ? AND created_at < ?
       GROUP BY status`
    )
    .bind(vendorId, startDate, endDate)
    .all<{ status: string; count: number }>()
  return rows.results
}

export async function getRevenue(
  db: D1Database,
  vendorId: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(ip.amount_cents), 0) as total
       FROM invoice_payments ip
       WHERE ip.vendor_id = ? AND ip.status = 'paid' AND ip.paid_at >= ? AND ip.paid_at < ?`
    )
    .bind(vendorId, startDate, endDate)
    .first<{ total: number }>()
  return row?.total ?? 0
}

export async function getRevenueGlobal(
  db: D1Database,
  startDate: string,
  endDate: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(ip.amount_cents), 0) as total
       FROM invoice_payments ip
       WHERE ip.status = 'paid' AND ip.paid_at >= ? AND ip.paid_at < ?`
    )
    .bind(startDate, endDate)
    .first<{ total: number }>()
  return row?.total ?? 0
}

export async function getSourceBreakdown(
  db: D1Database,
  vendorId: string,
  startDate: string,
  endDate: string
): Promise<{ source: string; count: number }[]> {
  const rows = await db
    .prepare(
      `SELECT COALESCE(source, 'unknown') as source, COUNT(*) as count
       FROM contacts
       WHERE vendor_id = ? AND created_at >= ? AND created_at < ?
       GROUP BY source
       ORDER BY count DESC`
    )
    .bind(vendorId, startDate, endDate)
    .all<{ source: string; count: number }>()
  return rows.results
}

export async function getLocationBreakdown(
  db: D1Database,
  vendorId: string | null,
  startDate: string,
  endDate: string
): Promise<{ location: string; count: number }[]> {
  if (vendorId) {
    const rows = await db
      .prepare(
        `SELECT COALESCE(w.location, 'Unknown') as location, COUNT(*) as count
         FROM weddings w
         JOIN wedding_members wm ON wm.wedding_id = w.id
         WHERE wm.vendor_profile_id = ? AND w.date >= ? AND w.date < ?
           AND ${SQL_WEDDING_NOT_CANCELLED('w')}
         GROUP BY w.location
         ORDER BY count DESC`
      )
      .bind(vendorId, startDate, endDate)
      .all<{ location: string; count: number }>()
    return rows.results
  }

  const rows = await db
    .prepare(
      `SELECT COALESCE(w.location, 'Unknown') as location, COUNT(*) as count
       FROM weddings w
       WHERE w.date >= ? AND w.date < ?
         AND ${SQL_WEDDING_NOT_CANCELLED('w')}
       GROUP BY w.location
       ORDER BY count DESC`
    )
    .bind(startDate, endDate)
    .all<{ location: string; count: number }>()
  return rows.results
}

// Average paid revenue per wedding. With vendorId, scoped to that vendor. With
// vendorId null, the platform-wide industry figure — optionally narrowed to a
// category so a celebrant is compared to celebrants, not to venues.
export async function getAverageSpendPerWedding(
  db: D1Database,
  vendorId: string | null,
  startDate: string,
  endDate: string,
  opts?: { category?: string }
): Promise<number> {
  const avgExpr = `CASE WHEN COUNT(DISTINCT ip.invoice_id) = 0 THEN 0
             ELSE COALESCE(SUM(ip.amount_cents), 0) / COUNT(DISTINCT i.wedding_id)
        END as avg_spend`
  const params: unknown[] = []
  let query: string

  if (vendorId) {
    query = `SELECT ${avgExpr}
       FROM invoice_payments ip
       JOIN invoices i ON i.id = ip.invoice_id
       WHERE ip.vendor_id = ? AND ip.status = 'paid' AND ip.paid_at >= ? AND ip.paid_at < ?
         AND i.wedding_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM weddings cw WHERE cw.id = i.wedding_id AND cw.status = 'cancelled')`
    params.push(vendorId, startDate, endDate)
  } else if (opts?.category) {
    query = `SELECT ${avgExpr}
       FROM invoice_payments ip
       JOIN invoices i ON i.id = ip.invoice_id
       JOIN vendor_profiles vp ON vp.id = ip.vendor_id
       WHERE ip.status = 'paid' AND ip.paid_at >= ? AND ip.paid_at < ?
         AND i.wedding_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM weddings cw WHERE cw.id = i.wedding_id AND cw.status = 'cancelled') AND vp.category = ?`
    params.push(startDate, endDate, opts.category)
  } else {
    query = `SELECT ${avgExpr}
       FROM invoice_payments ip
       JOIN invoices i ON i.id = ip.invoice_id
       WHERE ip.status = 'paid' AND ip.paid_at >= ? AND ip.paid_at < ?
         AND i.wedding_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM weddings cw WHERE cw.id = i.wedding_id AND cw.status = 'cancelled')`
    params.push(startDate, endDate)
  }

  const row = await db
    .prepare(query)
    .bind(...params)
    .first<{ avg_spend: number }>()
  return row?.avg_spend ?? 0
}

// Active vendor count, optionally within a category — the denominator that
// turns a platform-wide total into a per-vendor average for benchmarks.
export async function countVendors(
  db: D1Database,
  opts?: { category?: string }
): Promise<number> {
  if (opts?.category) {
    const row = await db
      .prepare('SELECT COUNT(*) as count FROM vendor_profiles WHERE category = ?')
      .bind(opts.category)
      .first<{ count: number }>()
    return row?.count ?? 0
  }
  const row = await db
    .prepare('SELECT COUNT(*) as count FROM vendor_profiles')
    .first<{ count: number }>()
  return row?.count ?? 0
}

// Per-contact hours from enquiry to first vendor action, for response-time
// stats. Pairs the earliest enquiry_received with the earliest status_change /
// booking_confirmed for the same contact; durations computed by the caller.
export async function getFirstResponseDurations(
  db: D1Database,
  vendorId: string,
  startDate: string,
  endDate: string
): Promise<number[]> {
  const rows = await db
    .prepare(
      `SELECT contact_id, event_type, MIN(created_at) AS t
       FROM analytics_events
       WHERE vendor_id = ? AND contact_id IS NOT NULL
         AND event_type IN ('enquiry_received', 'status_change', 'booking_confirmed')
         AND created_at >= ? AND created_at < ?
       GROUP BY contact_id, event_type`
    )
    .bind(vendorId, startDate, endDate)
    .all<{ contact_id: string; event_type: string; t: string }>()
    .then((r) => r.results)

  const enquiry = new Map<string, number>()
  const responded = new Map<string, number>()
  for (const row of rows) {
    const ms = Date.parse(row.t.replace(' ', 'T') + 'Z')
    if (Number.isNaN(ms)) continue
    if (row.event_type === 'enquiry_received') {
      enquiry.set(row.contact_id, ms)
    } else {
      const cur = responded.get(row.contact_id)
      if (cur === undefined || ms < cur) responded.set(row.contact_id, ms)
    }
  }

  const hours: number[] = []
  for (const [contactId, enq] of enquiry) {
    const resp = responded.get(contactId)
    if (resp !== undefined && resp > enq) hours.push((resp - enq) / 3600000)
  }
  return hours
}

export async function getMonthlyRevenue(
  db: D1Database,
  vendorId: string,
  months: number
): Promise<{ month: string; total: number }[]> {
  const rows = await db
    .prepare(
      `SELECT strftime('%Y-%m', paid_at) as month, COALESCE(SUM(amount_cents), 0) as total
       FROM invoice_payments
       WHERE vendor_id = ? AND status = 'paid' AND paid_at >= date('now', ? || ' months')
       GROUP BY month
       ORDER BY month`
    )
    .bind(vendorId, -months)
    .all<{ month: string; total: number }>()
  return rows.results
}

export async function getTotalVendors(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) as count FROM vendor_profiles')
    .first<{ count: number }>()
  return row?.count ?? 0
}

export async function getTotalWeddings(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) as count FROM weddings')
    .first<{ count: number }>()
  return row?.count ?? 0
}

export async function getTotalCouples(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT user_id) as count FROM wedding_members WHERE role = 'couple'`
    )
    .first<{ count: number }>()
  return row?.count ?? 0
}

export async function getWinLossSummary(
  db: D1Database,
  vendorId: string,
  startDate: string,
  endDate: string
): Promise<{ won: number; lost: number }> {
  const rows = await db
    .prepare(
      `SELECT status, COUNT(*) as count FROM contacts
       WHERE vendor_id = ? AND status IN ('booked', 'completed', 'lost')
       AND created_at >= ? AND created_at < ?
       GROUP BY status`
    )
    .bind(vendorId, startDate, endDate)
    .all<{ status: string; count: number }>()
  let won = 0,
    lost = 0
  for (const r of rows.results) {
    if (r.status === 'lost') lost += r.count
    else won += r.count
  }
  return { won, lost }
}

export async function getCancellationBreakdown(
  db: D1Database,
  vendorId: string
): Promise<{ reason: string; count: number }[]> {
  const rows = await db
    .prepare(
      `SELECT COALESCE(w.cancellation_reason, 'other') as reason, COUNT(*) as count
       FROM weddings w
       JOIN wedding_members wm ON wm.wedding_id = w.id
       WHERE wm.vendor_profile_id = ? AND w.status = 'cancelled'
       GROUP BY w.cancellation_reason
       ORDER BY count DESC`
    )
    .bind(vendorId)
    .all<{ reason: string; count: number }>()
  return rows.results
}

export async function getLostReasonBreakdown(
  db: D1Database,
  vendorId: string
): Promise<{ reason: string; count: number }[]> {
  const rows = await db
    .prepare(
      `SELECT COALESCE(lost_reason, 'other') as reason, COUNT(*) as count
       FROM contacts
       WHERE vendor_id = ? AND status = 'lost'
       GROUP BY lost_reason
       ORDER BY count DESC`
    )
    .bind(vendorId)
    .all<{ reason: string; count: number }>()
  return rows.results
}

export async function getSignupsByMonth(
  db: D1Database,
  months: number
): Promise<{ month: string; count: number }[]> {
  const rows = await db
    .prepare(
      `SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
       FROM vendor_profiles
       WHERE created_at >= date('now', ? || ' months')
       GROUP BY month
       ORDER BY month`
    )
    .bind(-months)
    .all<{ month: string; count: number }>()
  return rows.results
}
