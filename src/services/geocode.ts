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
 * Geocode free text to a structured location. The classic Geocoding API runs
 * first (an order of magnitude cheaper per lookup); Places Text Search picks
 * up what it can't resolve — venue names especially. Best-effort: returns
 * null when the key is missing, the address is empty, or neither API finds
 * anything. Genuine not-found results are cached in KV to protect the quota —
 * the same venue name arrives over and over via enquiries. API errors are
 * NOT cached, so transient failures retry.
 */
export async function geocodeAddress(env: Bindings, address: string): Promise<GeocodedLocation | null> {
  const text = address.trim()
  if (!text || !env.GOOGLE_MAPS_API_KEY) return null

  const cacheKey = `geo2:${text.toLowerCase()}`
  try {
    const cached = await env.KV.get(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached) as { found: boolean; location?: GeocodedLocation }
      return parsed.found ? (parsed.location ?? null) : null
    }
  } catch {
    /* cache is best-effort */
  }

  // Classic first, Text Search whenever it comes up empty — including on API
  // errors (e.g. a referer-restricted key, which the Geocoding API rejects
  // for server calls while the Places API accepts it).
  const classic = await classicGeocode(env, text)
  let location = classic.location
  let sawApiError = classic.error
  if (!location) {
    const places = await placesTextSearch(env, text)
    location = places.location
    sawApiError = sawApiError || places.error
  }

  // Cache found results always; cache not-found only when both APIs answered
  // cleanly, so transient/config errors keep retrying.
  if (location || !sawApiError) {
    await env.KV.put(
      cacheKey,
      JSON.stringify(location ? { found: true, location } : { found: false }),
      { expirationTtl: CACHE_TTL_SECONDS }
    ).catch(() => {})
  }
  return location
}

type GeocodeAttempt = { location: GeocodedLocation | null; error: boolean }

async function classicGeocode(env: Bindings, text: string): Promise<GeocodeAttempt> {
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(text)}&key=${env.GOOGLE_MAPS_API_KEY}`
  )
  if (!res.ok) {
    console.error('[geocode] Geocoding API HTTP error', res.status)
    return { location: null, error: true }
  }

  // The Geocoding API reports problems in the body with HTTP 200 —
  // REQUEST_DENIED must read as an error, not as "this address is nowhere".
  const data = (await res.json()) as {
    status?: string
    error_message?: string
    results?: Array<{
      address_components?: Array<{ long_name: string; types: string[] }>
      geometry?: { location?: { lat: number; lng: number } }
      place_id?: string
      formatted_address?: string
    }>
  }
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.error('[geocode] Geocoding API error', data.status, data.error_message ?? '')
    return { location: null, error: true }
  }

  const result = data.results?.[0]
  if (!result) return { location: null, error: false }

  const components = result.address_components ?? []
  const find = (type: string) => components.find((c) => c.types.includes(type))?.long_name ?? null

  return {
    error: false,
    location: {
      city: find('locality') ?? find('administrative_area_level_2'),
      state: find('administrative_area_level_1'),
      country: find('country'),
      lat: result.geometry?.location?.lat ?? null,
      lng: result.geometry?.location?.lng ?? null,
      place_id: result.place_id ?? null,
      formatted: result.formatted_address ?? text,
    },
  }
}

async function placesTextSearch(env: Bindings, text: string): Promise<GeocodeAttempt> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY!,
      'X-Goog-FieldMask': 'places.id,places.formattedAddress,places.location,places.addressComponents',
      // Referer-restricted keys are accepted by the Places API when the
      // request carries an allowlisted referer — ours, since the worker
      // calls Google on the site's behalf.
      Referer: `${env.APP_URL}/`,
    },
    body: JSON.stringify({ textQuery: text, languageCode: 'en', pageSize: 1 }),
  })
  if (!res.ok) {
    console.error('[geocode] Places searchText error', res.status, (await res.text()).slice(0, 300))
    return { location: null, error: true }
  }

  const data = (await res.json()) as {
    places?: Array<{
      id?: string
      formattedAddress?: string
      location?: { latitude?: number; longitude?: number }
      addressComponents?: Array<{ longText?: string; types?: string[] }>
    }>
  }

  const place = data.places?.[0]
  if (!place) return { location: null, error: false }

  const components = place.addressComponents ?? []
  const find = (type: string) => components.find((c) => c.types?.includes(type))?.longText ?? null

  return {
    error: false,
    location: {
      city: find('locality') ?? find('administrative_area_level_2'),
      state: find('administrative_area_level_1'),
      country: find('country'),
      lat: place.location?.latitude ?? null,
      lng: place.location?.longitude ?? null,
      place_id: place.id ?? null,
      formatted: place.formattedAddress ?? text,
    },
  }
}

/** Geocode a contact's wedding location into its structured region columns. */
export async function geocodeContactLocation(env: Bindings, contactId: string): Promise<void> {
  const row = await env.DB.prepare(
    'SELECT wedding_location, wedding_location_geocoded_from FROM contacts WHERE id = ?'
  )
    .bind(contactId)
    .first<{ wedding_location: string | null; wedding_location_geocoded_from: string | null }>()
  if (!row?.wedding_location || row.wedding_location === row.wedding_location_geocoded_from) return

  // geocoded_from is only stamped on success: failed lookups stay pending so
  // the nightly pass retries them, and the KV not-found cache keeps those
  // retries off the API.
  const location = await geocodeAddress(env, row.wedding_location)
  if (!location) return
  await env.DB.prepare(
    `UPDATE contacts SET wedding_location_city = ?, wedding_location_state = ?,
       wedding_location_country = ?, wedding_location_geocoded_from = ?
     WHERE id = ?`
  )
    .bind(location.city, location.state, location.country, row.wedding_location, contactId)
    .run()
}

/** Geocode a wedding's location into its structured region columns + coords. */
export async function geocodeWeddingLocation(env: Bindings, weddingId: string): Promise<void> {
  const row = await env.DB.prepare('SELECT location, location_geocoded_from, location_lat FROM weddings WHERE id = ?')
    .bind(weddingId)
    .first<{ location: string | null; location_geocoded_from: string | null; location_lat: number | null }>()
  if (!row?.location) return
  // Skip only when already geocoded AND coordinates are present — rows geocoded
  // before we stored lat/lng (used by the timeline's sunrise/sunset) re-run to
  // backfill the coordinates.
  if (row.location === row.location_geocoded_from && row.location_lat != null) return

  const location = await geocodeAddress(env, row.location)
  if (!location) return
  await env.DB.prepare(
    `UPDATE weddings SET location_city = ?, location_state = ?, location_country = ?,
       location_lat = ?, location_lng = ?, location_geocoded_from = ?
     WHERE id = ?`
  )
    .bind(location.city, location.state, location.country, location.lat, location.lng, row.location, weddingId)
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

  // Weddings FIRST + on their own budget. They drive the user-facing timeline
  // sun strip, so they must never be starved by a large contact backlog — a
  // 600-row contact queue used to consume the whole shared limit, leaving every
  // wedding forever un-geocoded. Each entity type now gets its own `limit`.
  const weddings = await env.DB.prepare(
    `SELECT id FROM weddings
     WHERE location IS NOT NULL AND location != ''
       AND (location_geocoded_from IS NULL OR location_geocoded_from != location OR location_lat IS NULL)
     LIMIT ?`
  )
    .bind(limit)
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

  // Vendors who set a free-text location before settings started geocoding.
  const vendors = await env.DB.prepare(
    `SELECT id, location FROM vendor_profiles
     WHERE location IS NOT NULL AND location != '' AND location_country IS NULL
     LIMIT ?`
  )
    .bind(limit)
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
