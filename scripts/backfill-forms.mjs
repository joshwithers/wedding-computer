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
//
// INSERTs are written to a temp .sql file and applied with --file (NOT
// --command) so config JSON containing quotes/backslashes can't break shell
// escaping.

import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DB = 'wedding-computer-db'
const flag = process.argv.includes('--remote') ? '--remote' : '--local'

// SQLite string-literal escaping: double single quotes. Backslashes are literal
// in SQLite, so no other escaping is needed when applied via --file.
const esc = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

function query(sql) {
  const out = execSync(`wrangler d1 execute ${DB} ${flag} --json --command ${JSON.stringify(sql)}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(out)[0].results
}

function execFile(sql) {
  const path = join(tmpdir(), `wc-backfill-forms-${Date.now()}.sql`)
  writeFileSync(path, sql)
  try {
    execSync(`wrangler d1 execute ${DB} ${flag} --file=${JSON.stringify(path)}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
  } finally {
    try { unlinkSync(path) } catch { /* ignore */ }
  }
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

const vendors = query('SELECT id, enquiry_form, booking_form FROM vendor_profiles')
console.log(`  ${vendors.length} vendors to scan.`)

// One query for all existing singleton rows → a Set of "vendorId:slug".
const existing = new Set(
  query("SELECT vendor_id, slug FROM forms WHERE slug IN ('enquiry','booking')").map((r) => `${r.vendor_id}:${r.slug}`)
)

const inserts = []
let skipped = 0
for (const v of vendors) {
  for (const p of PLAN) {
    const blob = v[p.col]
    if (!blob || !hasFields(blob)) continue
    if (existing.has(`${v.id}:${p.slug}`)) { skipped++; continue }
    const title = titleFromConfig(blob, p.fallbackTitle)
    inserts.push(
      `INSERT INTO forms (vendor_id, title, slug, type, kind, config) VALUES (${esc(v.id)}, ${esc(title)}, ${esc(p.slug)}, 'custom', ${esc(p.kind)}, ${esc(blob)});`
    )
  }
}

if (inserts.length === 0) {
  console.log(`Done. Created 0, skipped ${skipped} (already present).`)
} else {
  execFile(inserts.join('\n'))
  console.log(`Done. Created ${inserts.length}, skipped ${skipped} (already present).`)
}
