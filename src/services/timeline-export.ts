// Builds the HTML layouts for the timeline exports (phone-lockscreen wallpaper
// PNG + the PDF run sheet). The HTML is rendered to an image by og-render.ts
// (satori → resvg). satori rule: every element with >1 child needs an explicit
// display:flex. All user-supplied text is HTML-escaped (esc) before it lands in
// the string — these are HTML strings, not JSX, so there is no auto-escaping.
import type { TimelineItemView } from '../db/timeline'
import type { Bindings } from '../types'

function esc(s: string): string {
  // workers-og's HTML parser does NOT decode entities (it would render "&amp;"
  // literally), so we can't HTML-escape. The only structurally-dangerous chars
  // in text-content position are the tag delimiters — strip them so user text
  // can't open a tag/attribute; everything else (& " ' …) stays literal.
  return String(s).replace(/[<>]/g, '')
}

/** "HH:MM" (24h, as stored) → a compact 12-hour label e.g. "3:30pm". */
export function timeLabel(hhmm: string | null | undefined): string {
  if (!hhmm) return ''
  const [hStr, mStr] = hhmm.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (Number.isNaN(h)) return hhmm
  const ampm = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m ? `${h12}:${String(m).padStart(2, '0')}${ampm}` : `${h12}${ampm}`
}

export type ExportMoment = { time: string; title: string }

/** Pick the concise set of key moments for the wallpaper: timed, non-sun-fact
 * items in chronological order, capped. */
export function selectKeyMoments(items: TimelineItemView[], max = 8): ExportMoment[] {
  return items
    .filter((i) => i.start_time && !i.marker)
    .sort((a, b) => (a.start_time! < b.start_time! ? -1 : a.start_time! > b.start_time! ? 1 : a.sort_order - b.sort_order))
    .slice(0, max)
    .map((i) => ({ time: timeLabel(i.start_time), title: i.title }))
}

/**
 * A warm one-line tagline for the wallpaper, written by Workers AI from the
 * couple/date/place. Cached per-wedding in KV (an empty string is cached as
 * "tried, nothing" so we don't re-call on every download). Best-effort —
 * returns undefined on any failure and the layout simply omits the line.
 */
export async function generateTagline(
  env: Bindings,
  opts: { weddingId: string; names: string; dateLabel: string; locationLabel?: string }
): Promise<string | undefined> {
  const cacheKey = `wallpaper-tagline:${opts.weddingId}`
  try {
    const cached = await env.KV.get(cacheKey)
    if (cached !== null) return cached || undefined
  } catch {
    /* fall through to generate */
  }
  try {
    const prompt =
      `Write ONE short, warm, elegant tagline for a wedding run-sheet card. ` +
      `Couple: ${opts.names}. Date: ${opts.dateLabel}.` +
      (opts.locationLabel ? ` Place: ${opts.locationLabel}.` : '') +
      ` Maximum 8 words. No quotation marks, no emoji, no hashtags, no trailing punctuation. ` +
      `Reply with only the tagline text.`
    const result = (await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 32,
    })) as { response?: string }
    let line = (result?.response ?? '').split('\n')[0].trim()
    line = line.replace(/^["'“”‘’]+|["'“”‘’.]+$/g, '').trim()
    if (line.length > 56) line = '' // too long for the card — skip rather than truncate awkwardly
    await env.KV.put(cacheKey, line, { expirationTtl: 60 * 60 * 24 * 60 }).catch(() => {})
    return line || undefined
  } catch {
    return undefined
  }
}

export type ExportPartner = { first: string; last?: string }

export type WallpaperData = {
  partners: ExportPartner[] // 1–2 partners; first name large, last name small beneath
  dateLabel: string
  locationLabel?: string
  tagline?: string
  items: ExportMoment[]
}

/** The couple's names block: first names large (Fraunces), last names small
 * beneath each, joined by an ampersand. Falls back gracefully to first-only.
 * Sizes are tunable so the PDF header can render a more compact variant. */
type NameSizes = { first: number; last: number; amp: number; pad: number }
const WALLPAPER_NAME_SIZES: NameSizes = { first: 88, last: 33, amp: 64, pad: 32 }

function namesBlock(partners: ExportPartner[], s: NameSizes = WALLPAPER_NAME_SIZES): string {
  const column = (p: ExportPartner): string =>
    `<div style="display:flex;flex-direction:column;align-items:center">
      <div style="display:flex;font-family:Fraunces;font-weight:700;font-size:${s.first}px;color:#7a1f1f;line-height:1.0;text-align:center">${esc(p.first)}</div>
      ${p.last ? `<div style="display:flex;font-family:Inter;font-weight:400;font-size:${s.last}px;letter-spacing:2px;color:#a86f5e;margin-top:${Math.round(s.last * 0.36)}px">${esc(p.last)}</div>` : ''}
    </div>`
  if (partners.length === 0) return ''
  if (partners.length === 1) return `<div style="display:flex">${column(partners[0])}</div>`
  return `<div style="display:flex;align-items:flex-start;justify-content:center">
      ${column(partners[0])}
      <div style="display:flex;font-family:Fraunces;font-weight:700;font-size:${s.amp}px;color:#C53030;padding:0 ${s.pad}px;margin-top:${Math.round((s.first - s.amp) / 2)}px">&</div>
      ${column(partners[1])}
    </div>`
}

// Phone lockscreen target. Tall portrait; phones scale a wallpaper to fit, so a
// single high-res canvas works across devices. Content is kept inside a middle
// band so it clears the OS clock (top) and the controls/home-indicator (bottom).
export const WALLPAPER_W = 1170
export const WALLPAPER_H = 2532
const CLOCK_CLEARANCE = 560 // top band the iOS/Android clock overlays
const CONTROLS_CLEARANCE = 300 // bottom band for the home indicator + controls

export function buildWallpaperHtml(d: WallpaperData): string {
  const rows = d.items
    .map(
      (it) => `<div style="display:flex;align-items:baseline;width:100%;margin-bottom:30px">
        <div style="display:flex;justify-content:flex-end;width:215px;flex-shrink:0;font-family:Inter;font-weight:600;font-size:42px;color:#C53030">${esc(it.time)}</div>
        <div style="display:flex;width:56px;flex-shrink:0"></div>
        <div style="display:flex;font-family:Inter;font-weight:400;font-size:42px;color:#3a2420;line-height:1.15">${esc(it.title)}</div>
      </div>`,
    )
    .join('')

  const location = d.locationLabel
    ? `<div style="display:flex;font-family:Inter;font-weight:400;font-size:32px;color:#b58a7a;margin-top:8px">${esc(d.locationLabel)}</div>`
    : ''
  const tagline = d.tagline
    ? `<div style="display:flex;font-family:Fraunces;font-weight:700;font-size:34px;color:#C53030;margin-top:28px;padding:0 40px;text-align:center;line-height:1.25">${esc(d.tagline)}</div>`
    : ''

  return `<div style="display:flex;flex-direction:column;width:${WALLPAPER_W}px;height:${WALLPAPER_H}px;background:linear-gradient(160deg,#FFFBF5 0%,#FFF0F0 58%,#FBE3DF 100%);font-family:Inter">
    <div style="display:flex;height:${CLOCK_CLEARANCE}px;flex-shrink:0"></div>
    <div style="display:flex;flex-direction:column;align-items:center;padding:0 90px">
      <div style="display:flex;font-family:Inter;font-weight:600;font-size:28px;letter-spacing:8px;color:#C53030">RUN SHEET</div>
      <div style="display:flex;margin-top:20px">${namesBlock(d.partners)}</div>
      <div style="display:flex;font-family:Inter;font-weight:400;font-size:38px;color:#9a6a5a;margin-top:26px">${esc(d.dateLabel)}</div>
      ${location}
      ${tagline}
    </div>
    <div style="display:flex;justify-content:center;margin-top:54px;margin-bottom:54px">
      <div style="display:flex;width:150px;height:3px;background:#e6b0a8"></div>
    </div>
    <div style="display:flex;flex-direction:column;padding:0 110px">${rows}</div>
    <div style="display:flex;flex-grow:1"></div>
    <div style="display:flex;justify-content:center;font-family:Inter;font-weight:600;font-size:26px;letter-spacing:3px;color:#caa097;margin-bottom:${CONTROLS_CLEARANCE}px">wedding.computer</div>
  </div>`
}

// ── PDF run sheet ─────────────────────────────────────────────────────────
// A full printable document: the WHOLE run sheet (every timed item + sun
// markers) with location and assigned people, paginated across A4 pages so a
// row never splits. Rendered the same way (satori → PNG) then embedded one
// PNG per page into a pdf-lib document by og-render.renderPdf.

export type RunSheetMoment = { time: string; title: string; location?: string; people?: string; isMarker?: boolean }

export type RunSheetData = {
  partners: ExportPartner[]
  dateLabel: string
  locationLabel?: string
  tagline?: string
  items: RunSheetMoment[]
}

/** All timed items + sun markers, chronological, with location + people. */
export function selectRunSheetMoments(items: TimelineItemView[]): RunSheetMoment[] {
  return items
    .filter((i) => i.start_time)
    .sort((a, b) => (a.start_time! < b.start_time! ? -1 : a.start_time! > b.start_time! ? 1 : a.sort_order - b.sort_order))
    .map((i) => ({
      time: timeLabel(i.start_time),
      title: i.title,
      location: i.location || undefined,
      people: i.assignees?.length ? i.assignees.map((a) => a.displayName).filter(Boolean).join(', ') : undefined,
      isMarker: !!i.marker,
    }))
}

// A4 portrait at ~150 dpi (matches the 595.28 × 841.89 pt PDF page 0.707 ratio).
export const RUNSHEET_W = 1240
export const RUNSHEET_H = 1754
const PAGE1_ITEMS = 13 // page 1 carries the full header, so fewer rows
const PAGEN_ITEMS = 18

function runSheetRow(m: RunSheetMoment): string {
  const sub = [m.location, m.people].filter(Boolean).join('   ·   ')
  const titleColor = m.isMarker ? '#b08968' : '#2a1a17'
  return `<div style="display:flex;align-items:flex-start;width:100%;border-bottom:1px solid #f2e5e0;padding-top:17px;padding-bottom:17px">
    <div style="display:flex;justify-content:flex-end;width:195px;flex-shrink:0;font-family:Inter;font-weight:600;font-size:30px;color:#C53030">${esc(m.time)}</div>
    <div style="display:flex;width:46px;flex-shrink:0"></div>
    <div style="display:flex;flex-direction:column;flex-grow:1">
      <div style="display:flex;font-family:Inter;font-weight:600;font-size:31px;color:${titleColor};line-height:1.2">${esc(m.title)}</div>
      ${sub ? `<div style="display:flex;font-family:Inter;font-weight:400;font-size:23px;color:#9a8378;margin-top:5px;line-height:1.25">${esc(sub)}</div>` : ''}
    </div>
  </div>`
}

function pageShell(inner: string, pageNum: number, totalPages: number): string {
  const pageLabel = totalPages > 1 ? `<div style="display:flex;font-family:Inter;font-weight:400;font-size:20px;color:#c9a59a">Page ${pageNum} / ${totalPages}</div>` : ''
  return `<div style="display:flex;flex-direction:column;width:${RUNSHEET_W}px;height:${RUNSHEET_H}px;background:#FFFDFB;font-family:Inter;padding:72px 92px 0 92px">
    ${inner}
    <div style="display:flex;flex-grow:1"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid #f2e5e0;padding-top:20px;padding-bottom:24px;margin-top:18px">
      <div style="display:flex;font-family:Inter;font-weight:600;font-size:20px;letter-spacing:2px;color:#c9a59a">wedding.computer</div>
      ${pageLabel}
    </div>
  </div>`
}

export function buildRunSheetPages(d: RunSheetData): string[] {
  const chunks: RunSheetMoment[][] = []
  let idx = 0
  while (idx < d.items.length) {
    const size = chunks.length === 0 ? PAGE1_ITEMS : PAGEN_ITEMS
    chunks.push(d.items.slice(idx, idx + size))
    idx += size
  }
  if (chunks.length === 0) chunks.push([])
  const total = chunks.length
  const namesLine = d.partners.map((p) => p.first).filter(Boolean).join(' & ')

  const fullHeader = `<div style="display:flex;flex-direction:column;align-items:center;margin-bottom:28px">
      <div style="display:flex;font-family:Inter;font-weight:600;font-size:24px;letter-spacing:8px;color:#C53030">RUN SHEET</div>
      <div style="display:flex;margin-top:18px">${namesBlock(d.partners, { first: 64, last: 26, amp: 46, pad: 24 })}</div>
      <div style="display:flex;font-family:Inter;font-weight:400;font-size:30px;color:#9a6a5a;margin-top:18px">${esc(d.dateLabel)}${d.locationLabel ? `   ·   ${esc(d.locationLabel)}` : ''}</div>
      ${d.tagline ? `<div style="display:flex;font-family:Fraunces;font-weight:700;font-size:28px;color:#C53030;margin-top:16px;text-align:center;padding:0 40px">${esc(d.tagline)}</div>` : ''}
    </div>`

  const slimHeader = `<div style="display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid #efe0db;padding-bottom:16px;margin-bottom:12px">
      <div style="display:flex;font-family:Fraunces;font-weight:700;font-size:34px;color:#7a1f1f">${esc(namesLine)}</div>
      <div style="display:flex;font-family:Inter;font-weight:600;font-size:22px;letter-spacing:3px;color:#C53030">RUN SHEET${d.dateLabel ? `   ·   ${esc(d.dateLabel)}` : ''}</div>
    </div>`

  return chunks.map((chunk, i) => {
    const header = i === 0 ? fullHeader : slimHeader
    const rows = chunk.length
      ? chunk.map(runSheetRow).join('')
      : `<div style="display:flex;font-family:Inter;font-weight:400;font-size:26px;color:#9a8378;padding-top:40px">No scheduled items yet.</div>`
    return pageShell(`${header}<div style="display:flex;flex-direction:column">${rows}</div>`, i + 1, total)
  })
}
