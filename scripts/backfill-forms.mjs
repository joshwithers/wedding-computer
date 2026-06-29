#!/usr/bin/env node
// One-off: migrate each vendor's legacy singleton form blobs
// (vendor_profiles.enquiry_form / booking_form) into rows in the unified `forms`
// table (migration 075), so the new Forms surface + submission anchoring have a
// row to work with. The legacy blobs are LEFT IN PLACE — the resolvers still
// read them (read-both bridge); this just creates the companion rows.
//
//   node scripts/backfill-forms.mjs            # local D1
//   node scripts/backfill-forms.mjs --remote   # production D1
//
// Idempotent: a vendor that already has a forms row for the slug is skipped, so
// it's safe to re-run. enquiry → slug 'enquiry' (kind enquiry); booking →
// slug 'booking' (kind booking). type stays 'custom' (the CHECK is never
// widened — intent lives in `kind`).

import { execSync } from 'node:child_process'

const DB = 'wedding-computer-db'
const flag = process.argv.includes('--remote') ? '--remote' : '--local'

const esc = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

function exec(sql) {
  const out = execSync(`wrangler d1 execute ${DB} ${flag} --json --command ${JSON.stringify(sql)}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return JSON.parse(out)[0].results
}

function titleFromConfig(json, fallback) {
  try {
    const t = JSON.parse(json)?.title
    return typeof t === 'string' && t.trim() ? t.trim() : fallback
  } catch {
    return fallback
  }
}

// A blob is "non-trivial" if it parses to a config with at least one field.
function hasFields(json) {
  try {
    const c = JSON.parse(json)
    const fields = Array.isArray(c?.steps) ? c.steps.flatMap((s) => s.fields ?? []) : c?.fields
    return Array.isArray(fields) && fields.length > 0
  } catch {
    return false
  }
}

const PLAN = [
  { col: 'enquiry_form', slug: 'enquiry', kind: 'enquiry', fallbackTitle: 'Enquiry form' },
  { col: 'booking_form', slug: 'booking', kind: 'booking', fallbackTitle: 'Booking form' },
]

console.log(`Backfilling forms rows on ${flag === '--remote' ? 'PRODUCTION' : 'local'} D1…`)

const vendors = exec('SELECT id, enquiry_form, booking_form FROM vendor_profiles')
console.log(`  ${vendors.length} vendors to scan.`)

let created = 0
let skipped = 0
for (const v of vendors) {
  for (const p of PLAN) {
    const blob = v[p.col]
    if (!blob || !hasFields(blob)) continue

    const exists = exec(`SELECT id FROM forms WHERE vendor_id = ${esc(v.id)} AND slug = ${esc(p.slug)} LIMIT 1`)
    if (exists.length > 0) { skipped++; continue }

    const title = titleFromConfig(blob, p.fallbackTitle)
    exec(
      `INSERT INTO forms (vendor_id, title, slug, type, kind, config)
       VALUES (${esc(v.id)}, ${esc(title)}, ${esc(p.slug)}, 'custom', ${esc(p.kind)}, ${esc(blob)})`
    )
    created++
    console.log(`  + ${v.id} ${p.slug} (“${title}”)`)
  }
}

console.log(`Done. Created ${created}, skipped ${skipped} (already present).`)
