/**
 * In-memory D1Database mock for testing.
 *
 * Supports a subset of D1 API: prepare/bind/run/first/all/batch.
 * Stores data as rows in a simple Map-based table structure.
 *
 * This does NOT execute real SQL — instead it stores rows keyed
 * by table name and provides helpers to seed/query them. The
 * mock is designed for testing the storage layer which makes
 * predictable queries.
 */

type Row = Record<string, unknown>

/** A single prepared+bound statement */
type MockStatement = {
  sql: string
  params: unknown[]
  run: () => Promise<{ success: boolean; meta: Record<string, unknown> }>
  first: <T = Row>() => Promise<T | null>
  all: <T = Row>() => Promise<{ results: T[]; success: boolean }>
  bind: (...params: unknown[]) => MockStatement
}

export class MockD1Database {
  /** In-memory table storage */
  tables: Map<string, Row[]> = new Map()

  /** Track all SQL executed for assertions */
  queries: { sql: string; params: unknown[] }[] = []

  /** Optional: make specific operations throw */
  throwOnQuery: ((sql: string) => Error | null) | null = null

  /**
   * Seed a table with rows.
   */
  seed(table: string, rows: Row[]): void {
    this.tables.set(table, [...rows])
  }

  /**
   * Get all rows from a table.
   */
  getTable(table: string): Row[] {
    return this.tables.get(table) ?? []
  }

  prepare(sql: string): MockStatement {
    const self = this
    let boundParams: unknown[] = []

    const stmt: MockStatement = {
      sql,
      params: boundParams,
      bind(...params: unknown[]): MockStatement {
        boundParams = params
        stmt.params = params
        return stmt
      },
      async run() {
        self.queries.push({ sql, params: boundParams })
        const err = self.throwOnQuery?.(sql)
        if (err) throw err
        self._execute(sql, boundParams)
        return { success: true, meta: {} }
      },
      async first<T = Row>(): Promise<T | null> {
        self.queries.push({ sql, params: boundParams })
        const err = self.throwOnQuery?.(sql)
        if (err) throw err
        // INSERT ... RETURNING — execute, then hand back the affected row
        const normalised = sql.replace(/\s+/g, ' ').trim().toUpperCase()
        if (normalised.startsWith('INSERT')) {
          self._execute(sql, boundParams)
          if (normalised.includes('RETURNING')) {
            const tableMatch = sql.match(/INSERT INTO\s+(\w+)/i)
            const rows = tableMatch ? self.tables.get(tableMatch[1]) ?? [] : []
            return (rows[rows.length - 1] as T) ?? null
          }
          return null
        }
        const results = self._query(sql, boundParams)
        return (results[0] as T) ?? null
      },
      async all<T = Row>(): Promise<{ results: T[]; success: boolean }> {
        self.queries.push({ sql, params: boundParams })
        const err = self.throwOnQuery?.(sql)
        if (err) throw err
        const results = self._query(sql, boundParams)
        return { results: results as T[], success: true }
      },
    }
    return stmt
  }

  async batch(stmts: MockStatement[]): Promise<unknown[]> {
    const results: unknown[] = []
    for (const stmt of stmts) {
      results.push(await stmt.run())
    }
    return results
  }

  /**
   * Simplified SQL execution — handles INSERT, DELETE, UPDATE
   * by parsing table name and matching on bound params.
   */
  _execute(sql: string, params: unknown[]): void {
    const normalised = sql.replace(/\s+/g, ' ').trim().toUpperCase()

    if (normalised.startsWith('INSERT INTO')) {
      const tableMatch = sql.match(/INSERT INTO\s+(\w+)/i)
      if (!tableMatch) return
      const table = tableMatch[1]
      const rows = this.tables.get(table) ?? []

      // Extract column names
      const colMatch = sql.match(/\(([^)]+)\)\s*VALUES/i)
      if (!colMatch) return
      const cols = colMatch[1].split(',').map((c) => c.trim())

      // Extract VALUES tokens — handles ?, 'literal', and expressions like datetime('now')
      const valuesMatch = sql.match(/VALUES\s*\(([^)]+)\)/i)
      if (!valuesMatch) return
      const valueTokens = valuesMatch[1].split(',').map((v) => v.trim())

      const row: Row = {}
      let paramIdx = 0
      cols.forEach((col, i) => {
        const token = valueTokens[i]
        if (!token) {
          row[col] = null
        } else if (token === '?') {
          row[col] = params[paramIdx++] ?? null
        } else if (token.startsWith("'") && token.endsWith("'")) {
          // String literal like 'contact'
          row[col] = token.slice(1, -1)
        } else {
          // Expression like datetime('now') — use a placeholder
          row[col] = token
        }
      })

      // Handle ON CONFLICT ... DO UPDATE
      if (normalised.includes('ON CONFLICT')) {
        // Find existing row by matching on the conflicting column
        const conflictMatch = sql.match(/ON CONFLICT\s*\(([^)]+)\)/i)
        if (conflictMatch) {
          const conflictCols = conflictMatch[1].split(',').map((c) => c.trim())
          const existingIdx = rows.findIndex((r) =>
            conflictCols.every((c) => r[c] === row[c])
          )
          if (existingIdx >= 0) {
            // Update the existing row with new values
            Object.assign(rows[existingIdx], row)
            return
          }
        }
      }

      rows.push(row)
      this.tables.set(table, rows)
    } else if (normalised.startsWith('DELETE FROM')) {
      const tableMatch = sql.match(/DELETE FROM\s+(\w+)/i)
      if (!tableMatch) return
      const table = tableMatch[1]
      const rows = this.tables.get(table) ?? []

      // Parse WHERE clause to find match columns
      const whereMatch = sql.match(/WHERE\s+(.+)/i)
      if (!whereMatch) {
        // Delete all
        this.tables.set(table, [])
        return
      }

      // Simple WHERE parsing: col = ? AND col = ?
      const conditions = whereMatch[1].split(/\s+AND\s+/i)
      let paramIdx = 0
      const filters: { col: string; val: unknown }[] = []
      for (const cond of conditions) {
        const m = cond.match(/(\w+)\s*=\s*\?/i)
        if (m) {
          filters.push({ col: m[1], val: params[paramIdx++] })
        }
      }

      this.tables.set(
        table,
        rows.filter(
          (r) => !filters.every((f) => r[f.col] === f.val)
        )
      )
    } else if (normalised.startsWith('UPDATE')) {
      const tableMatch = sql.match(/UPDATE\s+(\w+)/i)
      if (!tableMatch) return
      const table = tableMatch[1]
      const rows = this.tables.get(table) ?? []

      // Extract SET columns
      const setMatch = sql.match(/SET\s+(.+?)(?:\s+WHERE|$)/i)
      if (!setMatch) return
      const setParts = setMatch[1].split(',').map((s) => s.trim())
      const sets: { col: string; isParam: boolean }[] = setParts.map((s) => {
        const m = s.match(/(\w+)\s*=\s*\?/)
        if (m) return { col: m[1], isParam: true }
        const m2 = s.match(/(\w+)\s*=\s*(.+)/)
        return { col: m2?.[1] ?? '', isParam: false }
      })

      // Parse WHERE
      const whereMatch = sql.match(/WHERE\s+(.+)/i)
      let paramIdx = sets.filter((s) => s.isParam).length
      const filters: { col: string; val: unknown }[] = []
      if (whereMatch) {
        const conditions = whereMatch[1].split(/\s+AND\s+/i)
        for (const cond of conditions) {
          const m = cond.match(/(\w+)\s*=\s*\?/i)
          if (m) {
            filters.push({ col: m[1], val: params[paramIdx++] })
          }
        }
      }

      let setParamIdx = 0
      for (const row of rows) {
        if (filters.every((f) => row[f.col] === f.val)) {
          for (const s of sets) {
            if (s.isParam) {
              row[s.col] = params[setParamIdx++]
            }
          }
        }
      }
    }
  }

  /**
   * Simplified query — returns matching rows based on WHERE clause.
   */
  _query(sql: string, params: unknown[]): Row[] {
    const normalised = sql.replace(/\s+/g, ' ').trim().toUpperCase()

    if (!normalised.startsWith('SELECT')) return []

    const tableMatch = sql.match(/FROM\s+(\w+)/i)
    if (!tableMatch) return []
    const table = tableMatch[1]
    const rows = this.tables.get(table) ?? []

    // Parse WHERE clause
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+GROUP|\s+LIMIT|$)/is)
    if (!whereMatch) return [...rows]

    const whereClause = whereMatch[1]

    // Handle simple column = ? conditions
    const conditions = whereClause.split(/\s+AND\s+/i)
    let paramIdx = 0
    const filters: { col: string; val: unknown }[] = []

    for (const cond of conditions) {
      const trimCond = cond.trim()
      // json_extract(cached_data, '$.status') = ?
      const jsonMatch = trimCond.match(/json_extract\s*\(\s*(\w+)\s*,\s*'\$\.(\w+)'\s*\)\s*=\s*\?/i)
      if (jsonMatch) {
        filters.push({ col: `__json__${jsonMatch[1]}__${jsonMatch[2]}`, val: params[paramIdx++] })
        continue
      }
      // LIKE conditions — skip for now, just consume the param
      if (trimCond.includes('LIKE')) {
        paramIdx++
        continue
      }
      // col = 'literal' (string literal in SQL)
      const litMatch = trimCond.match(/(\w+)\s*=\s*'([^']*)'/i)
      if (litMatch) {
        filters.push({ col: litMatch[1], val: litMatch[2] })
        continue
      }
      // col = 123 (numeric literal, e.g. can_manage = 1)
      const numMatch = trimCond.match(/^(?:\w+\.)?(\w+)\s*=\s*(\d+(?:\.\d+)?)$/)
      if (numMatch) {
        filters.push({ col: numMatch[1], val: Number(numMatch[2]) })
        continue
      }
      // Simple col = ?
      const m = trimCond.match(/(\w+)\s*=\s*\?/)
      if (m) {
        filters.push({ col: m[1], val: params[paramIdx++] })
      }
    }

    return rows.filter((r) => {
      return filters.every((f) => {
        if (f.col.startsWith('__json__')) {
          const [, dataCol, field] = f.col.match(/__json__(\w+)__(\w+)/) ?? []
          if (dataCol && field && typeof r[dataCol] === 'string') {
            try {
              const parsed = JSON.parse(r[dataCol] as string)
              return parsed[field] === f.val
            } catch {
              return false
            }
          }
          return false
        }
        return r[f.col] === f.val
      })
    })
  }

  reset(): void {
    this.tables.clear()
    this.queries = []
    this.throwOnQuery = null
  }
}
