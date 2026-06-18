// AI "expected weather" note for a wedding's location + time of year.
//
// Grounded on the town/city/region's Wikipedia climate section, summarised by
// the AI into a couple of practical sentences about the weather to expect for a
// wedding in that month. Cached globally by (location_key, month) — climate is
// seasonal, so it's generated once per location/month and reused; changing the
// wedding's location or month lazily regenerates against the new key.

import type { Bindings } from '../types'
import { generateWithAI } from './ai'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Normalised cache key for a place. Includes the country so same-named cities in
 * different countries (and hemispheres — e.g. Córdoba ES vs AR) don't collide on
 * one cached note. Lookup and insert both go through this, so they stay in sync.
 */
export function climateLocationKey(opts: { location?: string | null; city?: string | null; country?: string | null }): string | null {
  const place = (opts.city || opts.location || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!place) return null
  const country = (opts.country || '').trim().toLowerCase().replace(/\s+/g, ' ')
  return country ? `${place}|${country}` : place
}

// Trailing Australian state token in free-text place names ("Byron Bay NSW").
const AU_STATE_SUFFIX =
  /\s+(NSW|QLD|VIC|SA|WA|TAS|ACT|NT|New South Wales|Queensland|Victoria|South Australia|Western Australia|Tasmania|Australian Capital Territory|Northern Territory)$/i

/** Best Wikipedia article title for the place — the city, or the location's first part. */
function wikiTitle(opts: { city?: string | null; location?: string | null }): string | null {
  let t = (opts.city && opts.city.trim()) || (opts.location ? opts.location.split(',')[0].trim() : '')
  if (!t) return null
  // "Byron Bay NSW" → "Byron Bay" so the article lookup hits the place, not a miss.
  t = t.replace(AU_STATE_SUFFIX, '').trim()
  return t || null
}

/** Pull the text of the first matching == Section == out of a wiki-format extract. */
function extractSection(extract: string, names: string[]): string | null {
  const lines = extract.split('\n')
  const headingRe = /^(==+)\s*(.+?)\s*==+\s*$/
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe)
    if (m && names.some((n) => m[2].toLowerCase() === n.toLowerCase())) {
      const level = m[1].length
      const body: string[] = []
      for (let j = i + 1; j < lines.length; j++) {
        const h = lines[j].match(headingRe)
        if (h && h[1].length <= level) break // next section of the same/higher level ends it
        body.push(lines[j])
      }
      const t = body.join('\n').trim()
      if (t) return t
    }
  }
  return null
}

/** Fetch the Climate (or Weather) section of an English Wikipedia article. */
async function fetchWikipediaClimate(title: string): Promise<{ title: string; text: string } | null> {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts' +
    `&explaintext=1&exsectionformat=wiki&redirects=1&titles=${encodeURIComponent(title)}`
  let data: any
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WeddingComputer/1.0 (https://wedding.computer; climate notes)' },
      // Bound the upstream so a hang can't stall the (synchronous) htmx request;
      // an abort is caught below → null → the AI runs without Wikipedia grounding.
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    data = await res.json()
  } catch {
    return null
  }
  const pages = data?.query?.pages
  if (!pages) return null
  const page: any = Object.values(pages)[0]
  if (!page || page.missing !== undefined || typeof page.extract !== 'string' || !page.extract) return null
  const climate = extractSection(page.extract, ['Climate', 'Weather', 'Geography and climate', 'Climate and weather'])
  // Climate section if we found one; otherwise the article intro as weak grounding.
  const text = (climate || page.extract.slice(0, 1500)).slice(0, 3500)
  return { title: page.title || title, text }
}

function buildPrompt(o: {
  place: string
  monthName: string
  climateText: string | null
}): string {
  return [
    `Write a short, practical "expected weather" note for a wedding at ${o.place} in ${o.monthName}.`,
    o.climateText
      ? `\nClimate reference (from an encyclopaedia article — use the relevant specifics, ignore the rest):\n"""\n${o.climateText}\n"""\n`
      : '',
    `In 2-3 sentences, tell the couple and their vendors what weather to typically expect for a wedding here in ${o.monthName}: the usual temperature range in °C, how likely rain is, and one practical planning tip (shade, layers, a wet-weather backup, or the best light). Use specific numbers where the reference gives them, and reason about the correct season for this place's hemisphere. Write warmly and concretely in British English; don't hedge or pad, and do not mention sources, encyclopaedias, Wikipedia, or this instruction. Plain text only — no headings or bullet points.`,
  ].join('\n')
}

export type ClimateResult = { note: string; month: number; locationKey: string }

/**
 * Get the cached note for this location + month, or generate + cache it.
 * Returns null when there's no usable location/date or generation fails.
 */
export async function getOrGenerateClimateNote(
  env: Bindings,
  opts: { location?: string | null; city?: string | null; country?: string | null; dateStr: string | null }
): Promise<ClimateResult | null> {
  const locationKey = climateLocationKey(opts)
  if (!locationKey || !opts.dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(opts.dateStr)) return null
  const month = Number(opts.dateStr.slice(5, 7))
  if (!(month >= 1 && month <= 12)) return null

  const cached = await env.DB.prepare('SELECT note FROM climate_notes WHERE location_key = ? AND month = ?')
    .bind(locationKey, month)
    .first<{ note: string }>()
  if (cached?.note) return { note: cached.note, month, locationKey }

  const title = wikiTitle(opts)
  const wiki = title ? await fetchWikipediaClimate(title) : null
  const placeName = (opts.city || (opts.location ? opts.location.split(',')[0].trim() : '') || title || 'this area').trim()
  const place = opts.country ? `${placeName}, ${opts.country}` : placeName

  let note = ''
  try {
    note = (await generateWithAI(env.AI, env.ANTHROPIC_API_KEY, buildPrompt({ place, monthName: MONTHS[month - 1], climateText: wiki?.text ?? null }), 400)).trim()
  } catch (err: any) {
    console.error('[climate] generation failed for', locationKey, month, '-', err?.message ?? err)
    return null
  }
  if (!note) return null

  // Best-effort global cache; INSERT OR IGNORE absorbs concurrent generations.
  try {
    await env.DB.prepare('INSERT OR IGNORE INTO climate_notes (location_key, month, note, source) VALUES (?, ?, ?, ?)')
      .bind(locationKey, month, note, wiki?.title ?? null)
      .run()
  } catch {
    /* cache write is best-effort */
  }
  return { note, month, locationKey }
}
