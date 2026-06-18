#!/usr/bin/env node
// One-off: backfill weddings.location_lat/lng (+ city/state/country) for rows
// that have a free-text `location` but no coordinates, using the Google Places
// API (New) Text Search — the same call src/services/geocode.ts makes, but run
// standalone so we can backfill without touching the Worker secret.
//
//   GMAPS_KEY=... node scripts/backfill-geocode.mjs            # local D1
//   GMAPS_KEY=... node scripts/backfill-geocode.mjs --remote   # production D1
//
// The key comes ONLY from the GMAPS_KEY env var (never hardcoded/committed).
// REFERER defaults to https://wedding.computer/ so a referrer-restricted key is
// accepted. Idempotent: only rows with location_lat IS NULL are processed, and
// each distinct location string is geocoded once (results are reused).

import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DB = 'wedding-computer-db'
const flag = process.argv.includes('--remote') ? '--remote' : '--local'
const KEY = process.env.GMAPS_KEY
const REFERER = process.env.REFERER || 'https://wedding.computer/'
if (!KEY) {
  console.error('Set GMAPS_KEY=<api key> in the environment.')
  process.exit(1)
}

const esc = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function query(sql) {
  const out = execSync(`wrangler d1 execute ${DB} ${flag} --json --command ${JSON.stringify(sql)}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return JSON.parse(out)[0].results
}

async function geocode(text) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.formattedAddress,places.location,places.addressComponents',
      Referer: REFERER,
    },
    body: JSON.stringify({ textQuery: text, languageCode: 'en', pageSize: 1 }),
  })
  if (!res.ok) {
    console.error(`  ! ${text} → HTTP ${res.status} ${(await res.text()).slice(0, 120)}`)
    return null
  }
  const data = await res.json()
  const p = data.places?.[0]
  if (!p?.location) return null
  const comp = p.addressComponents ?? []
  const find = (type) => comp.find((c) => c.types?.includes(type))?.longText ?? null
  return {
    lat: p.location.latitude,
    lng: p.location.longitude,
    city: find('locality') ?? find('administrative_area_level_2'),
    state: find('administrative_area_level_1'),
    country: find('country'),
  }
}

const rows = query(
  `SELECT id, location FROM weddings WHERE location IS NOT NULL AND location <> '' AND location_lat IS NULL`
)
console.log(`${rows.length} wedding(s) need coordinates.`)

// Geocode each DISTINCT location once.
const byLocation = new Map()
for (const r of rows) {
  if (!byLocation.has(r.location)) byLocation.set(r.location, [])
  byLocation.get(r.location).push(r.id)
}
console.log(`${byLocation.size} distinct location string(s).`)

const stmts = []
let ok = 0
let miss = 0
for (const [location, ids] of byLocation) {
  const g = await geocode(location)
  await sleep(120) // stay well under the Places QPS ceiling
  if (!g) {
    miss++
    continue
  }
  ok++
  for (const id of ids) {
    stmts.push(
      `UPDATE weddings SET location_lat = ${g.lat}, location_lng = ${g.lng}, location_city = ${esc(g.city)}, location_state = ${esc(g.state)}, location_country = ${esc(g.country)}, location_geocoded_from = ${esc(location)} WHERE id = ${esc(id)};`
    )
  }
  if ((ok + miss) % 25 === 0) console.log(`  …${ok + miss}/${byLocation.size} processed`)
}

if (stmts.length === 0) {
  console.log('Nothing to write.')
  process.exit(0)
}

const file = join(tmpdir(), `backfill-geocode-${stmts.length}.sql`)
writeFileSync(file, stmts.join('\n'))
execSync(`wrangler d1 execute ${DB} ${flag} --file=${file}`, { stdio: 'inherit' })
console.log(`Geocoded ${ok}/${byLocation.size} distinct locations → updated ${stmts.length} wedding row(s). ${miss} unresolved (${flag}).`)
