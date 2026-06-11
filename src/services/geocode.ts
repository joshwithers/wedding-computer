// Google geocoding for canonical locations.
//
// Two location vectors feed the demand data: the vendor's home region
// (vendor_profiles.location_*, geocoded on settings save) and the wedding's
// region (weddings.location_* / contacts.wedding_location_*, geocoded here).
// Free text stays the source of truth the user sees; the structured
// city/state/country columns are derived, with *_geocoded_from recording the
// text they came from so edits (including external vault edits) get
// re-geocoded by the nightly catch-up pass.

import type { Bindings } from '../types'

export type GeocodedLocation = {
  city: string | null
  state: string | null
  country: string | null
  lat: number | null
  lng: number | null
  place_id: string | null
  formatted: string
}

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

/**
 * Geocode free text to a structured location. Best-effort: returns null when
 * the key is missing, the address is empty, or Google finds nothing.
 * Results (including not-found) are cached in KV to protect the API quota —
 * the same venue name arrives over and over via enquiries.
 */
export async function geocodeAddress(env: Bindings, address: string): Promise<GeocodedLocation | null> {
  const text = address.trim()
  if (!text || !env.GOOGLE_MAPS_API_KEY) return null

  const cacheKey = `geo:${text.toLowerCase()}`
  try {
    const cached = await env.KV.get(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached) as { found: boolean; location?: GeocodedLocation }
      return parsed.found ? (parsed.location ?? null) : null
    }
  } catch {
    /* cache is best-effort */
  }

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(text)}&key=${env.GOOGLE_MAPS_API_KEY}`
  )
  if (!res.ok) return null

  const data = (await res.json()) as {
    results?: Array<{
      address_components?: Array<{ long_name: string; types: string[] }>
      geometry?: { location?: { lat: number; lng: number } }
      place_id?: string
      formatted_address?: string
    }>
  }

  const result = data.results?.[0]
  if (!result) {
    await env.KV.put(cacheKey, JSON.stringify({ found: false }), { expirationTtl: CACHE_TTL_SECONDS }).catch(() => {})
    return null
  }

  const components = result.address_components ?? []
  const find = (type: string) => components.find((c) => c.types.includes(type))?.long_name ?? null

  const location: GeocodedLocation = {
    city: find('locality') ?? find('administrative_area_level_2'),
    state: find('administrative_area_level_1'),
    country: find('country'),
    lat: result.geometry?.location?.lat ?? null,
    lng: result.geometry?.location?.lng ?? null,
    place_id: result.place_id ?? null,
    formatted: result.formatted_address ?? text,
  }

  await env.KV.put(cacheKey, JSON.stringify({ found: true, location }), { expirationTtl: CACHE_TTL_SECONDS }).catch(
    () => {}
  )
  return location
}

/** Geocode a contact's wedding location into its structured region columns. */
export async function geocodeContactLocation(env: Bindings, contactId: string): Promise<void> {
  const row = await env.DB.prepare(
    'SELECT wedding_location, wedding_location_geocoded_from FROM contacts WHERE id = ?'
  )
    .bind(contactId)
    .first<{ wedding_location: string | null; wedding_location_geocoded_from: string | null }>()
  if (!row?.wedding_location || row.wedding_location === row.wedding_location_geocoded_from) return

  const location = await geocodeAddress(env, row.wedding_location)
  await env.DB.prepare(
    `UPDATE contacts SET wedding_location_city = ?, wedding_location_state = ?,
       wedding_location_country = ?, wedding_location_geocoded_from = ?
     WHERE id = ?`
  )
    .bind(location?.city ?? null, location?.state ?? null, location?.country ?? null, row.wedding_location, contactId)
    .run()
}

/** Geocode a wedding's location into its structured region columns. */
export async function geocodeWeddingLocation(env: Bindings, weddingId: string): Promise<void> {
  const row = await env.DB.prepare('SELECT location, location_geocoded_from FROM weddings WHERE id = ?')
    .bind(weddingId)
    .first<{ location: string | null; location_geocoded_from: string | null }>()
  if (!row?.location || row.location === row.location_geocoded_from) return

  const location = await geocodeAddress(env, row.location)
  await env.DB.prepare(
    `UPDATE weddings SET location_city = ?, location_state = ?, location_country = ?, location_geocoded_from = ?
     WHERE id = ?`
  )
    .bind(location?.city ?? null, location?.state ?? null, location?.country ?? null, row.location, weddingId)
    .run()
}

/**
 * Nightly catch-up: geocode rows whose free-text location is new or has
 * changed since it was last geocoded (covers vault edits, imports, and rows
 * predating the structured columns). Bounded per run to protect API quota;
 * the KV cache absorbs repeats.
 */
export async function geocodePendingLocations(env: Bindings, limit = 25): Promise<number> {
  if (!env.GOOGLE_MAPS_API_KEY) return 0
  let processed = 0

  const contacts = await env.DB.prepare(
    `SELECT id FROM contacts
     WHERE wedding_location IS NOT NULL AND wedding_location != ''
       AND (wedding_location_geocoded_from IS NULL OR wedding_location_geocoded_from != wedding_location)
     LIMIT ?`
  )
    .bind(limit)
    .all<{ id: string }>()
    .then((r) => r.results)
  for (const { id } of contacts) {
    try {
      await geocodeContactLocation(env, id)
      processed++
    } catch (err: any) {
      console.error('[geocode] contact', id, err.message)
    }
  }

  const weddings = await env.DB.prepare(
    `SELECT id FROM weddings
     WHERE location IS NOT NULL AND location != ''
       AND (location_geocoded_from IS NULL OR location_geocoded_from != location)
     LIMIT ?`
  )
    .bind(Math.max(0, limit - processed))
    .all<{ id: string }>()
    .then((r) => r.results)
  for (const { id } of weddings) {
    try {
      await geocodeWeddingLocation(env, id)
      processed++
    } catch (err: any) {
      console.error('[geocode] wedding', id, err.message)
    }
  }

  // Vendors who set a free-text location before settings started geocoding.
  const vendors = await env.DB.prepare(
    `SELECT id, location FROM vendor_profiles
     WHERE location IS NOT NULL AND location != '' AND location_country IS NULL
     LIMIT ?`
  )
    .bind(Math.max(0, limit - processed))
    .all<{ id: string; location: string }>()
    .then((r) => r.results)
  for (const { id, location } of vendors) {
    try {
      const geo = await geocodeAddress(env, location)
      if (!geo) continue
      await env.DB.prepare(
        `UPDATE vendor_profiles SET location_city = ?, location_state = ?, location_country = ?,
           location_lat = ?, location_lng = ?, location_place_id = ?
         WHERE id = ?`
      )
        .bind(geo.city, geo.state, geo.country, geo.lat, geo.lng, geo.place_id, id)
        .run()
      processed++
    } catch (err: any) {
      console.error('[geocode] vendor', id, err.message)
    }
  }

  return processed
}
