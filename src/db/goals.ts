import type { BusinessGoal } from '../types'

export async function listGoals(
  db: D1Database,
  vendorId: string
): Promise<BusinessGoal[]> {
  return db
    .prepare('SELECT * FROM business_goals WHERE vendor_id = ? ORDER BY period_value DESC')
    .bind(vendorId)
    .all<BusinessGoal>()
    .then((r) => r.results)
}

export async function getGoal(
  db: D1Database,
  vendorId: string,
  periodType: string,
  periodValue: string,
  goalType: string
): Promise<BusinessGoal | null> {
  return db
    .prepare(
      'SELECT * FROM business_goals WHERE vendor_id = ? AND period_type = ? AND period_value = ? AND goal_type = ?'
    )
    .bind(vendorId, periodType, periodValue, goalType)
    .first<BusinessGoal>()
}

export async function upsertGoal(
  db: D1Database,
  data: {
    vendor_id: string
    period_type: string
    period_value: string
    goal_type: string
    target: number
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO business_goals (vendor_id, period_type, period_value, goal_type, target)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(vendor_id, period_type, period_value, goal_type)
       DO UPDATE SET target = excluded.target, updated_at = datetime('now')`
    )
    .bind(
      data.vendor_id,
      data.period_type,
      data.period_value,
      data.goal_type,
      data.target
    )
    .run()
}

export async function deleteGoal(
  db: D1Database,
  id: string,
  vendorId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM business_goals WHERE id = ? AND vendor_id = ?')
    .bind(id, vendorId)
    .run()
}

export async function getCurrentYearGoals(
  db: D1Database,
  vendorId: string
): Promise<BusinessGoal[]> {
  const year = new Date().getFullYear().toString()
  return db
    .prepare(
      `SELECT * FROM business_goals
       WHERE vendor_id = ? AND (
         (period_type = 'year' AND period_value = ?) OR
         (period_type = 'month' AND period_value LIKE ?) OR
         (period_type = 'season' AND period_value LIKE ?)
       )
       ORDER BY period_type, period_value`
    )
    .bind(vendorId, year, `${year}-%`, `${year}-%`)
    .all<BusinessGoal>()
    .then((r) => r.results)
}
