#!/usr/bin/env node
/**
 * Export contacts from TARDIS (forms-project) as import-ready JSON for
 * Wedding Computer's importer (source: "tardis").
 *
 * One file per brand — each brand becomes a separate Wedding Computer
 * vendor account (mbj = Married By Josh, tec = The Elopement Collective).
 *
 * Related TARDIS data (touchpoints, elopement checklist, assigned vendors)
 * is flattened onto each contact as extra columns; the importer keeps any
 * column it doesn't recognise on the contact as extra detail (form_data).
 *
 * Usage:
 *   node scripts/tardis-export.mjs --brand mbj                # local dev DB
 *   node scripts/tardis-export.mjs --brand tec --remote       # production
 *   node scripts/tardis-export.mjs --brand mbj --out mbj.json --tardis-dir ../forms-project
 *
 * Requires: wrangler auth in the TARDIS project dir (for --remote).
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const TARDIS_DB = 'forms-db'
const BRANDS = ['mbj', 'tec']

// timeline_html is large generated display HTML — never useful post-import.
const EXCLUDED_COLUMNS = new Set(['timeline_html'])

function parseArgs(argv) {
  const args = { brand: null, out: null, remote: false, tardisDir: '../forms-project', overlapWith: null }
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--brand': args.brand = argv[++i]; break
      case '--out': args.out = argv[++i]; break
      case '--remote': args.remote = true; break
      case '--tardis-dir': args.tardisDir = argv[++i]; break
      // Path to another brand's export. Contacts matching a couple in that
      // file (by any email) are written to a separate *-overlap.json file so
      // they can be imported WITHOUT wedding creation — the other brand owns
      // the wedding entity and creating it twice would duplicate the event.
      case '--overlap-with': args.overlapWith = argv[++i]; break
      default:
        console.error(`Unknown argument: ${argv[i]}`)
        process.exit(1)
    }
  }
  return args
}

const args = parseArgs(process.argv)

if (!BRANDS.includes(args.brand)) {
  console.error(`--brand is required and must be one of: ${BRANDS.join(', ')}`)
  process.exit(1)
}

const tardisDir = resolve(args.tardisDir)
const outFile = args.out ?? `tardis-${args.brand}${args.remote ? '' : '-local'}.json`
const mode = args.remote ? '--remote' : '--local'

function query(sql) {
  const cmd = `npx wrangler d1 execute ${TARDIS_DB} ${mode} --json --command "${sql.replace(/"/g, '\\"')}"`
  const output = execSync(cmd, { cwd: tardisDir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  // Wrangler may prefix the JSON with log lines — find the JSON payload.
  const jsonStart = output.indexOf('[')
  const parsed = JSON.parse(output.slice(jsonStart))
  // Wrangler's --json output serialises SQL NULL as the string "null".
  return parsed[0].results.map((row) => {
    const clean = {}
    for (const [key, value] of Object.entries(row)) {
      clean[key] = value === 'null' ? null : value
    }
    return clean
  })
}

console.log(`Exporting TARDIS contacts — brand: ${args.brand}, source: ${args.remote ? 'PRODUCTION' : 'local dev DB'}`)

// Sanity: brand exists, and warn about unbranded rows that won't be exported.
const brandRow = query(`SELECT id, name FROM brands WHERE id = '${args.brand}'`)
if (brandRow.length === 0) {
  console.error(`Brand '${args.brand}' not found in TARDIS brands table.`)
  process.exit(1)
}
console.log(`Brand: ${brandRow[0].name}`)

const unbranded = query(`SELECT COUNT(*) AS n FROM contacts WHERE brand_id IS NULL`)
if (Number(unbranded[0].n) > 0) {
  console.warn(`⚠ ${unbranded[0].n} contact(s) have no brand_id and are NOT included in any brand export. Assign them a brand in TARDIS first, or export them manually.`)
}

const contacts = query(`SELECT * FROM contacts WHERE brand_id = '${args.brand}' ORDER BY created_at ASC`)
console.log(`Contacts: ${contacts.length}`)

const touchpoints = query(
  `SELECT ct.contact_id, ct.touchpoint_type, ct.created_at
   FROM contact_touchpoints ct JOIN contacts c ON c.id = ct.contact_id
   WHERE c.brand_id = '${args.brand}' ORDER BY ct.created_at ASC`
)

const checklist = query(
  `SELECT ec.contact_id, ec.flag_key, ec.flag_value, ec.note
   FROM elopement_checklist ec JOIN contacts c ON c.id = ec.contact_id
   WHERE c.brand_id = '${args.brand}'`
)

const assignedVendors = query(
  `SELECT ev.contact_id, ev.role, ev.confirmed, ev.cost,
          v.name AS vendor_name, v.business_name, v.category, v.email AS vendor_email, v.instagram AS vendor_instagram
   FROM elopement_vendors ev
   JOIN vendors v ON v.id = ev.vendor_id
   JOIN contacts c ON c.id = ev.contact_id
   WHERE c.brand_id = '${args.brand}'`
)

const images = query(
  `SELECT ei.contact_id, COUNT(*) AS n
   FROM elopement_images ei JOIN contacts c ON c.id = ei.contact_id
   WHERE c.brand_id = '${args.brand}' GROUP BY ei.contact_id`
)

function groupBy(rows, key) {
  const map = new Map()
  for (const row of rows) {
    const group = map.get(row[key]) ?? []
    group.push(row)
    map.set(row[key], group)
  }
  return map
}

const touchpointsByContact = groupBy(touchpoints, 'contact_id')
const checklistByContact = groupBy(checklist, 'contact_id')
const vendorsByContact = groupBy(assignedVendors, 'contact_id')
const imagesByContact = new Map(images.map((r) => [r.contact_id, r.n]))

const rows = contacts.map((contact) => {
  const row = {}
  for (const [key, value] of Object.entries(contact)) {
    if (EXCLUDED_COLUMNS.has(key)) continue
    if (value === null || value === undefined || value === '') continue
    row[key] = String(value)
  }

  const tp = touchpointsByContact.get(contact.id)
  if (tp?.length) {
    row.touchpoints = tp.map((t) => `${t.touchpoint_type} (${String(t.created_at).slice(0, 10)})`).join('; ')
  }

  const cl = checklistByContact.get(contact.id)
  if (cl?.length) {
    row.checklist = cl
      .map((item) => `${item.flag_key}: ${Number(item.flag_value) ? 'yes' : 'no'}${item.note ? ` — ${item.note}` : ''}`)
      .join('; ')
  }

  const av = vendorsByContact.get(contact.id)
  if (av?.length) {
    row.assigned_vendors = av
      .map((v) => {
        const name = v.business_name || v.vendor_name
        const bits = [v.role || v.category, Number(v.confirmed) ? 'confirmed' : 'unconfirmed']
        if (v.cost) bits.push(`$${v.cost}`)
        if (v.vendor_email) bits.push(v.vendor_email)
        if (v.vendor_instagram) bits.push(`@${String(v.vendor_instagram).replace(/^@/, '')}`)
        return `${name} (${bits.join(', ')})`
      })
      .join('; ')
  }

  const imageCount = imagesByContact.get(contact.id)
  if (imageCount) {
    row.tardis_images = `${imageCount} image(s) in TARDIS R2 — migrate separately`
  }

  return row
})

// Stats so the runbook verification step has expected numbers to check against.
const byStatus = {}
for (const c of contacts) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1
const withDates = contacts.filter((c) => c.ceremony_date).map((c) => c.ceremony_date).sort()

let mainRows = rows
if (args.overlapWith) {
  const otherEmails = new Set(
    JSON.parse(readFileSync(resolve(args.overlapWith), 'utf8'))
      .flatMap((r) => [r.email, r.partner_email])
      .filter(Boolean)
      .map((e) => e.toLowerCase().trim())
  )
  const isOverlap = (row) =>
    [row.email, row.partner_email].filter(Boolean).some((e) => otherEmails.has(e.toLowerCase().trim()))
  const overlap = rows.filter(isOverlap)
  mainRows = rows.filter((r) => !isOverlap(r))
  const overlapFile = outFile.replace(/\.json$/, '') + '-overlap.json'
  writeFileSync(overlapFile, JSON.stringify(overlap, null, 2))
  console.log(`\nOverlap with ${args.overlapWith}: ${overlap.length} contact(s) → ${overlapFile}`)
  console.log(`Import the overlap file WITHOUT "Create weddings" — the other brand owns those weddings.`)
}

writeFileSync(outFile, JSON.stringify(mainRows, null, 2))

console.log(`\nWrote ${mainRows.length} contacts to ${outFile}`)
console.log(`Status breakdown: ${JSON.stringify(byStatus)}`)
console.log(`Bookable for wedding creation (status booked/completed with ceremony_date): ${contacts.filter((c) => ['booked', 'completed'].includes(c.status) && c.ceremony_date).length}`)
if (withDates.length) console.log(`Ceremony dates: ${withDates[0]} → ${withDates[withDates.length - 1]}`)
console.log(`\nImport at: /app/import/upload?source=tardis (tick "Create weddings for booked contacts")`)
