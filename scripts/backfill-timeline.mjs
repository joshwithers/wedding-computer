#!/usr/bin/env node
// Backfill the per-vendor run_sheet_items into the unified timeline_items.
// (The structured headline slots are backfilled by migration 051 directly; this
// handles the freeform run-sheet rows whose free-text times need parsing.)
//
//   node scripts/backfill-timeline.mjs            # local D1
//   node scripts/backfill-timeline.mjs --remote   # production D1
//
// Idempotent: skips a run_sheet row if a matching timeline_items row already
// exists (same wedding_id + owner_vendor_id + title + sort_order).

import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DB = 'wedding-computer-db'
const flag = process.argv.includes('--remote') ? '--remote' : '--local'

const id = () => randomBytes(12).toString('hex')
const esc = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

/** '2:30 PM' / '14:30' / '2.30pm' → 'HH:MM', else the original string (displays as-is). */
function normalizeTime(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  let m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`
  m = s.match(/^(\d{1,2})[:.](\d{2})\s*([ap])\.?m\.?$/i)
  if (m) {
    let h = parseInt(m[1], 10) % 12
    if (/p/i.test(m[3])) h += 12
    return `${String(h).padStart(2, '0')}:${m[2]}`
  }
  m = s.match(/^(\d{1,2})\s*([ap])\.?m\.?$/i)
  if (m) {
    let h = parseInt(m[1], 10) % 12
    if (/p/i.test(m[2])) h += 12
    return `${String(h).padStart(2, '0')}:00`
  }
  return s
}

function query(sql) {
  const out = execSync(`wrangler d1 execute ${DB} ${flag} --json --command ${JSON.stringify(sql)}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return JSON.parse(out)[0].results
}

const rows = query('SELECT * FROM run_sheet_items ORDER BY wedding_id, sort_order')
console.log(`Found ${rows.length} run_sheet_items.`)

const stmts = []
for (const r of rows) {
  const itemId = id()
  const start = normalizeTime(r.time)
  const end = normalizeTime(r.end_time)
  stmts.push(
    `INSERT INTO timeline_items (id, wedding_id, start_time, end_time, title, description, location, category, owner_vendor_id, created_by_user_id, visibility, sort_order)
     SELECT ${esc(itemId)}, ${esc(r.wedding_id)}, ${esc(start)}, ${esc(end)}, ${esc(r.title)}, ${esc(r.description)}, ${esc(r.location)}, ${esc(r.category || 'other')}, ${esc(r.vendor_id)}, NULL, 'vendors', ${Number(r.sort_order) || 0}
     WHERE NOT EXISTS (
       SELECT 1 FROM timeline_items t
       WHERE t.wedding_id = ${esc(r.wedding_id)} AND t.owner_vendor_id IS ${esc(r.vendor_id)}
         AND t.title = ${esc(r.title)} AND t.sort_order = ${Number(r.sort_order) || 0} AND t.slot IS NULL
     );`
  )
  if (r.assigned_to && String(r.assigned_to).trim()) {
    stmts.push(
      `INSERT INTO timeline_item_assignees (timeline_item_id, label)
       SELECT ${esc(itemId)}, ${esc(r.assigned_to)}
       WHERE EXISTS (SELECT 1 FROM timeline_items WHERE id = ${esc(itemId)});`
    )
  }
}

if (stmts.length === 0) {
  console.log('Nothing to backfill.')
  process.exit(0)
}

const file = join(tmpdir(), `backfill-timeline-${Date.now()}.sql`)
writeFileSync(file, stmts.join('\n'))
execSync(`wrangler d1 execute ${DB} ${flag} --file=${file}`, { stdio: 'inherit' })
console.log(`Backfilled ${rows.length} run-sheet rows into timeline_items (${flag}).`)
