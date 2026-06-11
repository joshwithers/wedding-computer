import type { BusynessScore } from '../types'
import { seasonOf, weekendBucketOf } from '../lib/busyness'

export async function getScoresForDateRange(
  db: D1Database,
  startDate: string,
  endDate: string,
  level: BusynessScore['level'],
  levelValue: string
): Promise<BusynessScore[]> {
  return db
    .prepare(
      `SELECT * FROM busyness_scores
       WHERE date >= ? AND date <= ? AND level = ? AND level_value = ?
       ORDER BY date`
    )
    .bind(startDate, endDate, level, levelValue)
    .all<BusynessScore>()
    .then((r) => r.results)
}

export async function getScoreForDate(
  db: D1Database,
  date: string,
  level: BusynessScore['level'],
  levelValue: string
): Promise<BusynessScore | null> {
  return db
    .prepare(
      `SELECT * FROM busyness_scores
       WHERE date = ? AND level = ? AND level_value = ?`
    )
    .bind(date, level, levelValue)
    .first<BusynessScore>()
}

// Resolve the most location-specific score available for a date, given a
// vendor's location: try city, then state, then country, then global. Returns
// the matched score plus which level it came from (so the UI can show scope),
// or null if no aggregation row exists for that date at any level.
export async function getBestScoreForDate(
  db: D1Database,
  date: string,
  vendor: { location_city: string | null; location_state: string | null; location_country: string | null }
): Promise<{ score: number; level: BusynessScore['level']; levelValue: string; enquiry_count: number; booking_count: number } | null> {
  const tries: Array<[BusynessScore['level'], string | null]> = [
    ['city', vendor.location_city],
    ['state', vendor.location_state],
    ['country', vendor.location_country],
    ['global', 'global'],
  ]

  for (const [level, value] of tries) {
    if (!value) continue
    const row = await getScoreForDate(db, date, level, value)
    if (row) {
      return {
        score: row.score,
        level,
        levelValue: value,
        enquiry_count: row.enquiry_count,
        booking_count: row.booking_count,
      }
    }
  }

  return null
}

export async function upsertScore(
  db: D1Database,
  date: string,
  level: BusynessScore['level'],
  levelValue: string,
  enquiryCount: number,
  bookingCount: number,
  score: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO busyness_scores (date, level, level_value, enquiry_count, booking_count, score)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (date, level, level_value)
       DO UPDATE SET enquiry_count = excluded.enquiry_count,
                     booking_count = excluded.booking_count,
                     score = excluded.score`
    )
    .bind(date, level, levelValue, enquiryCount, bookingCount, score)
    .run()
}

type DateLocationCounts = {
  date: string
  location_city: string | null
  location_state: string | null
  location_country: string | null
  enquiry_count: number
  booking_count: number
}

// D1 batch limit is 100 statements per batch call
const BATCH_SIZE = 100

export async function aggregateBusynessScores(db: D1Database): Promise<void> {
  // Two independent aggregations merged in JS. The previous single query
  // LEFT JOIN'd contacts and calendar_events on the same date, producing a
  // |contacts| × |events| cross-product per date (millions of rows on popular
  // Saturdays) before COUNT(DISTINCT), and mis-attributed booking events to
  // contact-vendor locations via COALESCE. Splitting removes the cross-product
  // and attributes each count to its own vendor's location.
  const enquiryRows = await db
    .prepare(
      `SELECT c.wedding_date AS date, vp.location_city, vp.location_state, vp.location_country,
              COUNT(*) AS enquiry_count, 0 AS booking_count
       FROM contacts c
       JOIN vendor_profiles vp ON vp.id = c.vendor_id
       WHERE c.wedding_date >= date('now') AND c.wedding_date <= date('now', '+365 days')
       GROUP BY c.wedding_date, vp.location_city, vp.location_state, vp.location_country`
    )
    .all<DateLocationCounts>()
    .then((r) => r.results)

  const bookingRows = await db
    .prepare(
      `SELECT ce.date AS date, vp.location_city, vp.location_state, vp.location_country,
              0 AS enquiry_count, COUNT(*) AS booking_count
       FROM calendar_events ce
       JOIN vendor_profiles vp ON vp.id = ce.vendor_id
       WHERE ce.type = 'booking' AND ce.date >= date('now') AND ce.date <= date('now', '+365 days')
       GROUP BY ce.date, vp.location_city, vp.location_state, vp.location_country`
    )
    .all<DateLocationCounts>()
    .then((r) => r.results)

  const rows = [...enquiryRows, ...bookingRows]

  // Build per-level aggregations from the raw rows
  type LevelKey = string
  type Counts = { enquiry_count: number; booking_count: number }
  const aggregated = new Map<LevelKey, Counts>()

  function addCounts(
    date: string,
    level: string,
    levelValue: string,
    enquiry: number,
    booking: number
  ) {
    const key = `${date}|${level}|${levelValue}`
    const existing = aggregated.get(key)
    if (existing) {
      existing.enquiry_count += enquiry
      existing.booking_count += booking
    } else {
      aggregated.set(key, { enquiry_count: enquiry, booking_count: booking })
    }
  }

  for (const row of rows) {
    if (row.location_city) {
      addCounts(row.date, 'city', row.location_city, row.enquiry_count, row.booking_count)
    }
    if (row.location_state) {
      addCounts(row.date, 'state', row.location_state, row.enquiry_count, row.booking_count)
    }
    if (row.location_country) {
      addCounts(row.date, 'country', row.location_country, row.enquiry_count, row.booking_count)
    }
    addCounts(row.date, 'global', 'global', row.enquiry_count, row.booking_count)
  }

  // Compute averages per level+level_value for normalization
  const levelTotals = new Map<string, { sum: number; count: number }>()
  for (const [key, counts] of aggregated) {
    const [, level, levelValue] = key.split('|')
    const normKey = `${level}|${levelValue}`
    const raw = counts.enquiry_count * 1 + counts.booking_count * 3
    const existing = levelTotals.get(normKey)
    if (existing) {
      existing.sum += raw
      existing.count += 1
    } else {
      levelTotals.set(normKey, { sum: raw, count: 1 })
    }
  }

  const levelAverages = new Map<string, number>()
  for (const [normKey, totals] of levelTotals) {
    levelAverages.set(normKey, totals.sum / Math.max(1, totals.count))
  }

  // Build upsert statements
  const statements: D1PreparedStatement[] = []
  for (const [key, counts] of aggregated) {
    const [date, level, levelValue] = key.split('|')
    const normKey = `${level}|${levelValue}`
    const avg = levelAverages.get(normKey) ?? 1
    const raw = counts.enquiry_count * 1 + counts.booking_count * 3
    const score = raw / Math.max(1, avg)

    statements.push(
      db
        .prepare(
          `INSERT INTO busyness_scores (date, level, level_value, enquiry_count, booking_count, score)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (date, level, level_value)
           DO UPDATE SET enquiry_count = excluded.enquiry_count,
                         booking_count = excluded.booking_count,
                         score = excluded.score`
        )
        .bind(date, level, levelValue, counts.enquiry_count, counts.booking_count, score)
    )
  }

  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await db.batch(statements.slice(i, i + BATCH_SIZE))
  }
}

// ─── Historical demand patterns ───
//
// Exact dates don't recur, but months, seasons, and "the Nth weekend of a
// month" do. aggregateDemandHistory rebuilds per-year counts for those
// buckets from everything that has already happened, so a date's demand can
// be read against the matching weekend/month/season of previous years — and
// the comparison gets better every year more data accumulates.

export async function aggregateDemandHistory(db: D1Database): Promise<void> {
  const enquiryRows = await db
    .prepare(
      `SELECT c.wedding_date AS date, vp.location_city, vp.location_state, vp.location_country,
              COUNT(*) AS enquiry_count, 0 AS booking_count
       FROM contacts c
       JOIN vendor_profiles vp ON vp.id = c.vendor_id
       WHERE c.wedding_date IS NOT NULL AND c.wedding_date < date('now')
       GROUP BY c.wedding_date, vp.location_city, vp.location_state, vp.location_country`
    )
    .all<DateLocationCounts>()
    .then((r) => r.results)

  const bookingRows = await db
    .prepare(
      `SELECT ce.date AS date, vp.location_city, vp.location_state, vp.location_country,
              0 AS enquiry_count, COUNT(*) AS booking_count
       FROM calendar_events ce
       JOIN vendor_profiles vp ON vp.id = ce.vendor_id
       WHERE ce.type = 'booking' AND ce.date < date('now')
       GROUP BY ce.date, vp.location_city, vp.location_state, vp.location_country`
    )
    .all<DateLocationCounts>()
    .then((r) => r.results)

  type Counts = { enquiry_count: number; booking_count: number }
  const aggregated = new Map<string, Counts>()

  function addBucket(
    level: string,
    levelValue: string,
    bucketType: string,
    bucketValue: string,
    year: number,
    enquiry: number,
    booking: number
  ) {
    const key = `${level}|${levelValue}|${bucketType}|${bucketValue}|${year}`
    const existing = aggregated.get(key)
    if (existing) {
      existing.enquiry_count += enquiry
      existing.booking_count += booking
    } else {
      aggregated.set(key, { enquiry_count: enquiry, booking_count: booking })
    }
  }

  for (const row of [...enquiryRows, ...bookingRows]) {
    const m = /^(\d{4})-(\d{2})/.exec(row.date)
    if (!m) continue
    const year = Number(m[1])
    const month = Number(m[2])
    const weekend = weekendBucketOf(row.date)

    const levels: Array<[string, string | null]> = [
      ['city', row.location_city],
      ['state', row.location_state],
      ['country', row.location_country],
      ['global', 'global'],
    ]
    for (const [level, value] of levels) {
      if (!value) continue
      addBucket(level, value, 'month', m[2], year, row.enquiry_count, row.booking_count)
      addBucket(level, value, 'season', seasonOf(month), year, row.enquiry_count, row.booking_count)
      if (weekend) {
        const bucketValue = `${String(weekend.month).padStart(2, '0')}-w${weekend.index}`
        addBucket(level, value, 'weekend', bucketValue, weekend.year, row.enquiry_count, row.booking_count)
      }
    }
  }

  const statements: D1PreparedStatement[] = []
  for (const [key, counts] of aggregated) {
    const [level, levelValue, bucketType, bucketValue, year] = key.split('|')
    statements.push(
      db
        .prepare(
          `INSERT INTO demand_history (level, level_value, bucket_type, bucket_value, year, enquiry_count, booking_count)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (level, level_value, bucket_type, bucket_value, year)
           DO UPDATE SET enquiry_count = excluded.enquiry_count,
                         booking_count = excluded.booking_count,
                         updated_at = datetime('now')`
        )
        .bind(level, levelValue, bucketType, bucketValue, year, counts.enquiry_count, counts.booking_count)
    )
  }

  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await db.batch(statements.slice(i, i + BATCH_SIZE))
  }
}

// The counts in demand_history are cross-vendor aggregates, so they are never
// surfaced directly — readers convert each bucket-year into a ratio against
// the average same-type window of that year (1.0 = average), matching the
// busyness-score semantics. Slots per year for the averages:
const BUCKET_SLOTS: Record<string, number> = { month: 12, season: 4, weekend: 52 }

export type DemandHistoryYear = { year: string; ratio: number }

export type DemandHistoryContext = {
  level: BusynessScore['level']
  levelValue: string
  weekend: { month: number; index: number; years: DemandHistoryYear[] } | null
  month: { month: number; years: DemandHistoryYear[] }
  season: { season: string; years: DemandHistoryYear[] }
}

const HISTORY_YEARS_SHOWN = 3

// Year-on-year history for the buckets a date falls into. With levelOverride,
// reads exactly that level; otherwise falls back through the most
// location-specific level that has any data (city → state → country → global).
// Returns null when no history exists.
export async function getDemandHistoryContext(
  db: D1Database,
  date: string,
  vendor: { location_city: string | null; location_state: string | null; location_country: string | null },
  levelOverride?: BusynessScore['level']
): Promise<DemandHistoryContext | null> {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  const month = Number(m[2])
  const monthBucket = m[2]
  const seasonBucket = seasonOf(month)
  const weekend = weekendBucketOf(date)
  const weekendBucket = weekend ? `${String(weekend.month).padStart(2, '0')}-w${weekend.index}` : ''

  let tries: Array<[BusynessScore['level'], string | null]> = [
    ['city', vendor.location_city],
    ['state', vendor.location_state],
    ['country', vendor.location_country],
    ['global', 'global'],
  ]
  if (levelOverride) tries = tries.filter(([level]) => level === levelOverride)

  for (const [level, value] of tries) {
    if (!value) continue
    const [rows, totals] = await Promise.all([
      db
        .prepare(
          `SELECT bucket_type, year, enquiry_count, booking_count
           FROM demand_history
           WHERE level = ? AND level_value = ?
             AND ((bucket_type = 'month' AND bucket_value = ?)
               OR (bucket_type = 'season' AND bucket_value = ?)
               OR (bucket_type = 'weekend' AND bucket_value = ?))
           ORDER BY year DESC`
        )
        .bind(level, value, monthBucket, seasonBucket, weekendBucket)
        .all<{ bucket_type: string; year: string; enquiry_count: number; booking_count: number }>()
        .then((r) => r.results),
      db
        .prepare(
          `SELECT bucket_type, year, SUM(enquiry_count) AS enquiry_total, SUM(booking_count) AS booking_total
           FROM demand_history
           WHERE level = ? AND level_value = ?
           GROUP BY bucket_type, year`
        )
        .bind(level, value)
        .all<{ bucket_type: string; year: string; enquiry_total: number; booking_total: number }>()
        .then((r) => r.results),
    ])
    if (rows.length === 0) continue

    // Same weighting as the busyness score: enquiries + 3×bookings.
    const weighted = (e: number, b: number) => e + b * 3
    const totalsByKey = new Map(
      totals.map((t) => [`${t.bucket_type}|${t.year}`, weighted(t.enquiry_total, t.booking_total)])
    )

    const byType = (type: string): DemandHistoryYear[] =>
      rows
        .filter((r) => r.bucket_type === type)
        .slice(0, HISTORY_YEARS_SHOWN)
        .flatMap(({ year, enquiry_count, booking_count }) => {
          const yearTotal = totalsByKey.get(`${type}|${year}`) ?? 0
          if (yearTotal <= 0) return []
          const average = yearTotal / BUCKET_SLOTS[type]
          return [{ year, ratio: weighted(enquiry_count, booking_count) / average }]
        })

    return {
      level,
      levelValue: value,
      weekend: weekend ? { month: weekend.month, index: weekend.index, years: byType('weekend') } : null,
      month: { month, years: byType('month') },
      season: { season: seasonBucket, years: byType('season') },
    }
  }

  return null
}

// ─── Demand view resolution (card + level filter) ───

export type DemandLevelOption = { level: BusynessScore['level']; levelValue: string }

export type DemandView = {
  level: BusynessScore['level']
  levelValue: string
  score: number | null
  history: DemandHistoryContext | null
  availableLevels: DemandLevelOption[]
}

/**
 * Resolve everything the Date demand card needs at one locality level.
 * With requestedLevel, pins the card to that level (empty data shows as
 * neutral). Without it, auto-picks the most location-specific level that has
 * a score or history, falling back to global.
 */
export async function resolveDemandView(
  db: D1Database,
  date: string,
  vendor: { location_city: string | null; location_state: string | null; location_country: string | null },
  requestedLevel?: BusynessScore['level']
): Promise<DemandView> {
  const availableLevels: DemandLevelOption[] = []
  if (vendor.location_city) availableLevels.push({ level: 'city', levelValue: vendor.location_city })
  if (vendor.location_state) availableLevels.push({ level: 'state', levelValue: vendor.location_state })
  if (vendor.location_country) availableLevels.push({ level: 'country', levelValue: vendor.location_country })
  availableLevels.push({ level: 'global', levelValue: 'global' })

  const requested = availableLevels.find((o) => o.level === requestedLevel)
  const candidates = requested ? [requested] : availableLevels

  let chosen = requested ?? availableLevels[availableLevels.length - 1]
  let score: number | null = null
  let history: DemandHistoryContext | null = null

  for (const option of candidates) {
    const [row, hist] = await Promise.all([
      getScoreForDate(db, date, option.level, option.levelValue),
      getDemandHistoryContext(db, date, vendor, option.level),
    ])
    if (row || hist) {
      chosen = option
      score = row?.score ?? null
      history = hist
      break
    }
  }

  return { level: chosen.level, levelValue: chosen.levelValue, score, history, availableLevels }
}

export async function getDateHeatmap(
  db: D1Database,
  startDate: string,
  endDate: string,
  level: BusynessScore['level'],
  levelValue: string
): Promise<{ date: string; score: number; enquiry_count: number; booking_count: number }[]> {
  return db
    .prepare(
      `SELECT date, score, enquiry_count, booking_count
       FROM busyness_scores
       WHERE date >= ? AND date <= ? AND level = ? AND level_value = ?
       ORDER BY date`
    )
    .bind(startDate, endDate, level, levelValue)
    .all<{ date: string; score: number; enquiry_count: number; booking_count: number }>()
    .then((r) => r.results)
}
