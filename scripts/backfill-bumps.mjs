#!/usr/bin/env node
// Backfill per-vendor bump in/out (wedding_members.bump_in_time/out) into the
// unified timeline as PRIVATE, calendar-opted-in timeline sections, then retire
// the old wc:bump_* calendar events and clear the member columns.
//
//   node scripts/backfill-bumps.mjs            # local D1
//   node scripts/backfill-bumps.mjs --remote   # production D1
//
// Each bump time becomes one private timeline_items row owned by the vendor and
// assigned to that vendor's membership with added_to_calendar=1, so it shows up
// in the run sheet AND rides along in their /cal feed (iCal + CalDAV). The old
// wc:bump_in / wc:bump_out calendar_events are deleted (they're being retired)
// and the member bump columns are nulled.
//
// Idempotent: skips a member if a private 'Bump in'/'Bump out' section already
// exists for that wedding + vendor; reruns find nothing once columns are nulled.

import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DB = 'wedding-computer-db'
const flag = process.argv.includes('--remote') ? '--remote' : '--local'

const id = () => randomBytes(12).toString('hex')
const esc = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

/** '14:30' → 'HH:MM' (already normalised by the old <input type=time>); else as-is. */
function normalizeTime(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  const m = s.match(/^(\d{1,2}):(\d{2})$/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s
}

function query(sql) {
  const out = execSync(`wrangler d1 execute ${DB} ${flag} --json --command ${JSON.stringify(sql)}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return JSON.parse(out)[0].results
}

// Per-vendor bumps only: owner_vendor_id requires a vendor_profile. (Any stray
// bump values on couple rows are simply nulled in the cleanup below.)
const members = query(
  `SELECT id AS member_id, wedding_id, user_id, vendor_profile_id, bump_in_time, bump_out_time FROM wedding_members WHERE vendor_profile_id IS NOT NULL AND (bump_in_time IS NOT NULL OR bump_out_time IS NOT NULL)`
)
console.log(`Found ${members.length} vendor membership(s) with bump times.`)

const stmts = []
let sectionCount = 0
for (const m of members) {
  const bumps = [
    { title: 'Bump in', time: normalizeTime(m.bump_in_time) },
    { title: 'Bump out', time: normalizeTime(m.bump_out_time) },
  ]
  for (const b of bumps) {
    if (!b.time) continue
    sectionCount++
    const itemId = id()
    // Create the private section unless one already exists (idempotent).
    stmts.push(
      `INSERT INTO timeline_items
         (id, wedding_id, start_time, end_time, title, category, owner_vendor_id, created_by_user_id, visibility, sort_order)
       SELECT ${esc(itemId)}, ${esc(m.wedding_id)}, ${esc(b.time)}, NULL, ${esc(b.title)}, 'other',
              ${esc(m.vendor_profile_id)}, ${esc(m.user_id)}, 'private', 0
       WHERE NOT EXISTS (
         SELECT 1 FROM timeline_items t
         WHERE t.wedding_id = ${esc(m.wedding_id)} AND t.owner_vendor_id = ${esc(m.vendor_profile_id)}
           AND t.visibility = 'private' AND t.title = ${esc(b.title)}
       );`
    )
    // Assign it to this vendor's membership + opt into their calendar — but only
    // if we actually just inserted it (so reruns don't double-assign).
    stmts.push(
      `INSERT INTO timeline_item_assignees (timeline_item_id, wedding_member_id, added_to_calendar)
       SELECT ${esc(itemId)}, ${esc(m.member_id)}, 1
       WHERE EXISTS (SELECT 1 FROM timeline_items WHERE id = ${esc(itemId)});`
    )
  }
}

// Retire the old fan-out: delete the bump calendar events and clear the columns.
stmts.push(`DELETE FROM calendar_events WHERE notes IN ('wc:bump_in', 'wc:bump_out');`)
stmts.push(
  `UPDATE wedding_members SET bump_in_time = NULL, bump_out_time = NULL
   WHERE bump_in_time IS NOT NULL OR bump_out_time IS NOT NULL;`
)

const file = join(tmpdir(), `backfill-bumps-${Date.now()}.sql`)
writeFileSync(file, stmts.join('\n'))
execSync(`wrangler d1 execute ${DB} ${flag} --file=${file}`, { stdio: 'inherit' })
console.log(`Backfilled ${sectionCount} bump section(s) from ${members.length} membership(s); retired wc:bump_* events + cleared columns (${flag}).`)
