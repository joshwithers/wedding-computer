import type { AnalyticsEvent } from '../types'

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
  db: D1Database,
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
       GROUP BY w.location
       ORDER BY count DESC`
    )
    .bind(startDate, endDate)
    .all<{ location: string; count: number }>()
  return rows.results
}

export async function getAverageSpendPerWedding(
  db: D1Database,
  vendorId: string | null,
  startDate: string,
  endDate: string
): Promise<number> {
  let query: string
  const params: unknown[] = []

  if (vendorId) {
    query = `SELECT
        CASE WHEN COUNT(DISTINCT ip.invoice_id) = 0 THEN 0
             ELSE COALESCE(SUM(ip.amount_cents), 0) / COUNT(DISTINCT i.wedding_id)
        END as avg_spend
       FROM invoice_payments ip
       JOIN invoices i ON i.id = ip.invoice_id
       WHERE ip.vendor_id = ? AND ip.status = 'paid' AND ip.paid_at >= ? AND ip.paid_at < ?
         AND i.wedding_id IS NOT NULL`
    params.push(vendorId, startDate, endDate)
  } else {
    query = `SELECT
        CASE WHEN COUNT(DISTINCT ip.invoice_id) = 0 THEN 0
             ELSE COALESCE(SUM(ip.amount_cents), 0) / COUNT(DISTINCT i.wedding_id)
        END as avg_spend
       FROM invoice_payments ip
       JOIN invoices i ON i.id = ip.invoice_id
       WHERE ip.status = 'paid' AND ip.paid_at >= ? AND ip.paid_at < ?
         AND i.wedding_id IS NOT NULL`
    params.push(startDate, endDate)
  }

  const row = await db
    .prepare(query)
    .bind(...params)
    .first<{ avg_spend: number }>()
  return row?.avg_spend ?? 0
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
