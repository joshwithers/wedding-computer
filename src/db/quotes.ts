import type { QuoteCalculator } from '../types'

export async function listQuoteCalculators(
  db: D1Database,
  vendorId: string
): Promise<QuoteCalculator[]> {
  return db
    .prepare(
      'SELECT * FROM quote_calculators WHERE vendor_id = ? ORDER BY created_at DESC'
    )
    .bind(vendorId)
    .all<QuoteCalculator>()
    .then((r) => r.results)
}

export async function getQuoteCalculator(
  db: D1Database,
  id: string,
  vendorId: string
): Promise<QuoteCalculator | null> {
  return db
    .prepare('SELECT * FROM quote_calculators WHERE id = ? AND vendor_id = ?')
    .bind(id, vendorId)
    .first<QuoteCalculator>()
}

export async function getQuoteCalculatorByToken(
  db: D1Database,
  token: string
): Promise<QuoteCalculator | null> {
  return db
    .prepare(
      'SELECT * FROM quote_calculators WHERE public_token = ? AND is_active = 1'
    )
    .bind(token)
    .first<QuoteCalculator>()
}

export async function createQuoteCalculator(
  db: D1Database,
  data: {
    vendor_id: string
    title: string
    description?: string | null
    config: string
    is_active?: number
  }
): Promise<QuoteCalculator> {
  const result = await db
    .prepare(
      `INSERT INTO quote_calculators (vendor_id, title, description, config, is_active, public_token)
       VALUES (?, ?, ?, ?, ?, lower(hex(randomblob(8))))
       RETURNING *`
    )
    .bind(
      data.vendor_id,
      data.title,
      data.description ?? null,
      data.config,
      data.is_active ?? 1
    )
    .first<QuoteCalculator>()
  return result!
}

export async function updateQuoteCalculator(
  db: D1Database,
  id: string,
  vendorId: string,
  updates: Partial<Pick<QuoteCalculator, 'title' | 'description' | 'config' | 'is_active'>>
): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`)
      values.push(val)
    }
  }
  if (sets.length === 0) return
  sets.push("updated_at = datetime('now')")
  values.push(id, vendorId)
  await db
    .prepare(
      `UPDATE quote_calculators SET ${sets.join(', ')} WHERE id = ? AND vendor_id = ?`
    )
    .bind(...values)
    .run()
}

export async function deleteQuoteCalculator(
  db: D1Database,
  id: string,
  vendorId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM quote_calculators WHERE id = ? AND vendor_id = ?')
    .bind(id, vendorId)
    .run()
}
