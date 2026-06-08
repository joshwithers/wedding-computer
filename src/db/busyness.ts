import type { BusynessScore } from '../types'

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
  const rows = await db
    .prepare(
      `SELECT
         dates.date,
         vp.location_city,
         vp.location_state,
         vp.location_country,
         COUNT(DISTINCT c.id) as enquiry_count,
         COUNT(DISTINCT ce.id) as booking_count
       FROM (
         SELECT DISTINCT wedding_date as date FROM contacts
         WHERE wedding_date IS NOT NULL
           AND wedding_date >= date('now')
           AND wedding_date <= date('now', '+365 days')
         UNION
         SELECT DISTINCT date FROM calendar_events
         WHERE date >= date('now')
           AND date <= date('now', '+365 days')
       ) dates
       LEFT JOIN contacts c
         ON c.wedding_date = dates.date
       LEFT JOIN vendor_profiles vp_c ON vp_c.id = c.vendor_id
       LEFT JOIN calendar_events ce
         ON ce.date = dates.date AND ce.type = 'booking'
       LEFT JOIN vendor_profiles vp_e ON vp_e.id = ce.vendor_id
       LEFT JOIN vendor_profiles vp
         ON vp.id = COALESCE(vp_c.id, vp_e.id)
       GROUP BY dates.date, vp.location_city, vp.location_state, vp.location_country
       ORDER BY dates.date`
    )
    .all<DateLocationCounts>()
    .then((r) => r.results)

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
