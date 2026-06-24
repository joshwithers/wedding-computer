// Builds the HTML layouts for the timeline exports (phone-lockscreen wallpaper
// PNG + the PDF run sheet). The HTML is rendered to an image by og-render.ts
// (satori → resvg). satori rule: every element with >1 child needs an explicit
// display:flex. All user-supplied text is HTML-escaped (esc) before it lands in
// the string — these are HTML strings, not JSX, so there is no auto-escaping.
//
// Colours + the display font come from an ExportPalette derived from the
// vendor's brand_theme (the same theme that styles their public forms), so a
// vendor's exports match their brand. Couples / unbranded vendors get the
// house palette (DEFAULT_PALETTE).
import type { TimelineItemView } from '../db/timeline'
import type { Bindings } from '../types'
import { resolveBrandTheme, parseBrandTheme, mixHex, type ResolvedTheme } from '../lib/form-theme'

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

// ── Brand palette ─────────────────────────────────────────────────────────

export type ExportPalette = {
  bg: string // page canvas / gradient start
  bgEnd: string // gradient end (wallpaper)
  accent: string // overline, times, ampersand, tagline
  accentDeep: string // couple first names
  accentSoft: string // the visible divider rule on the wallpaper
  secondary: string // date, location
  secondaryDeep: string // surnames, sun markers
  faint: string // wordmark, page numbers
  title: string // run-sheet row titles / wallpaper moment titles
  divider: string // faint hairlines (PDF rows + footer)
  displayFamily: string // serif/display face for names + headings (satori must load it)
  bodyFamily: string // always Inter, for data legibility
}

// House look — the design originally shipped (papaya cream + grapefruit +
// Fraunces). Used verbatim for couples and vendors who haven't branded, so
// their exports are unchanged.
export const DEFAULT_PALETTE: ExportPalette = {
  bg: '#FFFBF5',
  bgEnd: '#FBE3DF',
  accent: '#C53030',
  accentDeep: '#7A1F1F',
  accentSoft: '#E6B0A8',
  secondary: '#9A6A5A',
  secondaryDeep: '#A86F5E',
  faint: '#CAA097',
  title: '#2A1A17',
  divider: '#F1E3DE',
  displayFamily: 'Fraunces',
  bodyFamily: 'Inter',
}

function paletteFromTheme(r: ResolvedTheme, displayFamily: string): ExportPalette {
  return {
    bg: r.bg,
    bgEnd: mixHex(r.bg, r.accent, 0.1),
    accent: r.accent,
    accentDeep: mixHex(r.accent, r.ink, 0.3),
    accentSoft: mixHex(r.accent, r.bg, 0.5),
    secondary: r.inkMuted,
    secondaryDeep: mixHex(r.accent, r.ink, 0.45),
    faint: mixHex(r.ink, r.bg, 0.64),
    title: r.ink,
    divider: mixHex(r.ink, r.bg, 0.9),
    displayFamily,
    bodyFamily: 'Inter',
  }
}

/**
 * Resolve a vendor's brand_theme JSON into the export palette + the display
 * font to load. A null/absent theme → the house palette with Fraunces (no font
 * to fetch). Otherwise the accent/bg/ink + chosen font drive everything; the
 * font's @fontsource package name is derived from its family.
 */
export function resolveExportPalette(brandThemeJson: string | null | undefined): {
  palette: ExportPalette
  display: { family: string; pkg: string } | null
} {
  if (!brandThemeJson) return { palette: DEFAULT_PALETTE, display: null }
  const r = resolveBrandTheme(parseBrandTheme(brandThemeJson))
  const family = r.fontStack.match(/'([^']+)'/)?.[1] || 'Inter'
  const pkg = family.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return { palette: paletteFromTheme(r, family), display: { family, pkg } }
}

// ── Wallpaper ───────────────────────────────────────────────────────────────

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

/** The one venue every scheduled (non-sun) item shares, if they all share it —
 * else undefined. Lets the wallpaper show a single address instead of repeating
 * (or omitting) it. Blank locations are treated as "unspecified", not a second
 * venue, so a mix of "The Barn" and blanks still resolves to "The Barn". */
export function singleSharedLocation(items: TimelineItemView[]): string | undefined {
  const locs = new Set<string>()
  for (const i of items) {
    if (i.marker) continue
    const loc = i.location?.trim()
    if (loc) locs.add(loc)
  }
  return locs.size === 1 ? [...locs][0] : undefined
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
  locationLabel?: string // a single venue/address line (deduped upstream)
  sunsetLabel?: string // compact venue-local sunset, e.g. "5:08pm"
  tagline?: string
  items: ExportMoment[]
  palette: ExportPalette
}

/** The couple's names block: first names large (display face), surnames small
 * beneath each, joined by an ampersand. Falls back gracefully to first-only.
 * Sizes are tunable so the PDF header can render a more compact variant. */
type NameSizes = { first: number; last: number; amp: number; pad: number }
const WALLPAPER_NAME_SIZES: NameSizes = { first: 88, last: 33, amp: 64, pad: 32 }

function namesBlock(partners: ExportPartner[], pal: ExportPalette, s: NameSizes = WALLPAPER_NAME_SIZES): string {
  const column = (p: ExportPartner): string =>
    `<div style="display:flex;flex-direction:column;align-items:center">
      <div style="display:flex;font-family:${pal.displayFamily};font-weight:700;font-size:${s.first}px;color:${pal.accentDeep};line-height:1.0;text-align:center">${esc(p.first)}</div>
      ${p.last ? `<div style="display:flex;font-family:${pal.bodyFamily};font-weight:400;font-size:${s.last}px;letter-spacing:2px;color:${pal.secondaryDeep};margin-top:${Math.round(s.last * 0.36)}px">${esc(p.last)}</div>` : ''}
    </div>`
  if (partners.length === 0) return ''
  if (partners.length === 1) return `<div style="display:flex">${column(partners[0])}</div>`
  return `<div style="display:flex;align-items:flex-start;justify-content:center">
      ${column(partners[0])}
      <div style="display:flex;font-family:${pal.displayFamily};font-weight:700;font-size:${s.amp}px;color:${pal.accent};padding:0 ${s.pad}px;margin-top:${Math.round((s.first - s.amp) / 2)}px">&</div>
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
  const pal = d.palette
  const rows = d.items
    .map(
      (it) => `<div style="display:flex;align-items:baseline;width:100%;margin-bottom:30px">
        <div style="display:flex;justify-content:flex-end;width:215px;flex-shrink:0;font-family:${pal.bodyFamily};font-weight:600;font-size:42px;color:${pal.accent}">${esc(it.time)}</div>
        <div style="display:flex;width:56px;flex-shrink:0"></div>
        <div style="display:flex;font-family:${pal.bodyFamily};font-weight:400;font-size:42px;color:${pal.title};line-height:1.15">${esc(it.title)}</div>
      </div>`,
    )
    .join('')

  const location = d.locationLabel
    ? `<div style="display:flex;font-family:${pal.bodyFamily};font-weight:400;font-size:32px;color:${pal.secondary};margin-top:8px;text-align:center">${esc(d.locationLabel)}</div>`
    : ''
  // Sunset cue — useful on a run-sheet wallpaper for golden hour. "Sunset" is
  // kept in English to match the rest of this English-only card (the satori
  // fonts are Latin-only, so it isn't localized like the in-app UI).
  const sunset = d.sunsetLabel
    ? `<div style="display:flex;font-family:${pal.bodyFamily};font-weight:600;font-size:30px;letter-spacing:1px;color:${pal.secondaryDeep};margin-top:14px">Sunset ${esc(d.sunsetLabel)}</div>`
    : ''
  const tagline = d.tagline
    ? `<div style="display:flex;font-family:${pal.displayFamily};font-weight:700;font-size:34px;color:${pal.accent};margin-top:28px;padding:0 40px;text-align:center;line-height:1.25">${esc(d.tagline)}</div>`
    : ''

  return `<div style="display:flex;flex-direction:column;width:${WALLPAPER_W}px;height:${WALLPAPER_H}px;background:linear-gradient(160deg,${pal.bg} 0%,${pal.bgEnd} 100%);font-family:${pal.bodyFamily}">
    <div style="display:flex;height:${CLOCK_CLEARANCE}px;flex-shrink:0"></div>
    <div style="display:flex;flex-direction:column;align-items:center;padding:0 90px">
      <div style="display:flex;font-family:${pal.bodyFamily};font-weight:600;font-size:28px;letter-spacing:8px;color:${pal.accent}">RUN SHEET</div>
      <div style="display:flex;margin-top:20px">${namesBlock(d.partners, pal)}</div>
      <div style="display:flex;font-family:${pal.bodyFamily};font-weight:400;font-size:38px;color:${pal.secondary};margin-top:26px">${esc(d.dateLabel)}</div>
      ${location}
      ${sunset}
      ${tagline}
    </div>
    <div style="display:flex;justify-content:center;margin-top:54px;margin-bottom:54px">
      <div style="display:flex;width:150px;height:3px;background:${pal.accentSoft}"></div>
    </div>
    <div style="display:flex;flex-direction:column;padding:0 110px">${rows}</div>
    <div style="display:flex;flex-grow:1"></div>
    <div style="display:flex;justify-content:center;font-family:${pal.bodyFamily};font-weight:600;font-size:26px;letter-spacing:3px;color:${pal.faint};margin-bottom:${CONTROLS_CLEARANCE}px">wedding.computer</div>
  </div>`
}

// ── PDF run sheet ─────────────────────────────────────────────────────────
// A full printable document: the WHOLE run sheet (every timed item + sun
// markers) with location and assigned people, paginated across A4 pages so a
// row never splits. Rendered the same way (satori → PNG) then embedded one
// PNG per page into a pdf-lib document by og-render.renderPdf.

export type RunSheetMoment = {
  time: string
  endTime?: string
  title: string
  description?: string
  location?: string
  people?: string
  isMarker?: boolean
}

// A run-sheet note over this many chars is truncated — a backstop so a single
// pathological description can't out-grow one page (pagination is height-based).
const MAX_DESC = 1500
function clampDesc(s: string | null | undefined): string | undefined {
  const t = s?.trim()
  if (!t) return undefined
  return t.length > MAX_DESC ? t.slice(0, MAX_DESC - 1).trimEnd() + '…' : t
}

export type RunSheetData = {
  partners: ExportPartner[]
  dateLabel: string
  locationLabel?: string
  tagline?: string
  items: RunSheetMoment[]
  palette: ExportPalette
}

/** All timed items + sun markers, chronological, with location + people. */
export function selectRunSheetMoments(items: TimelineItemView[]): RunSheetMoment[] {
  return items
    .filter((i) => i.start_time)
    .sort((a, b) => (a.start_time! < b.start_time! ? -1 : a.start_time! > b.start_time! ? 1 : a.sort_order - b.sort_order))
    .map((i) => ({
      time: timeLabel(i.start_time),
      endTime: i.end_time ? timeLabel(i.end_time) : undefined,
      title: i.title,
      description: clampDesc(i.description),
      location: i.location || undefined,
      people: i.assignees?.length ? i.assignees.map((a) => a.displayName).filter(Boolean).join(', ') : undefined,
      isMarker: !!i.marker,
    }))
}

// A4 portrait at ~150 dpi (matches the 595.28 × 841.89 pt PDF page 0.707 ratio).
export const RUNSHEET_W = 1240
export const RUNSHEET_H = 1754

function runSheetRow(m: RunSheetMoment, pal: ExportPalette): string {
  const meta = [m.location, m.people].filter(Boolean).join('   ·   ')
  const titleColor = m.isMarker ? pal.secondaryDeep : pal.title
  const endTime =
    m.endTime && m.endTime !== m.time
      ? `<div style="display:flex;font-family:${pal.bodyFamily};font-weight:400;font-size:21px;color:${pal.secondary};margin-top:3px">– ${esc(m.endTime)}</div>`
      : ''
  const description = m.description
    ? `<div style="display:flex;font-family:${pal.bodyFamily};font-weight:400;font-size:24px;color:${pal.secondaryDeep};margin-top:7px;line-height:1.35">${esc(m.description)}</div>`
    : ''
  const metaLine = meta
    ? `<div style="display:flex;font-family:${pal.bodyFamily};font-weight:400;font-size:23px;color:${pal.secondary};margin-top:6px;line-height:1.25">${esc(meta)}</div>`
    : ''
  return `<div style="display:flex;align-items:flex-start;width:100%;border-bottom:1px solid ${pal.divider};padding-top:17px;padding-bottom:17px">
    <div style="display:flex;flex-direction:column;align-items:flex-end;width:195px;flex-shrink:0">
      <div style="display:flex;font-family:${pal.bodyFamily};font-weight:600;font-size:30px;color:${pal.accent}">${esc(m.time)}</div>
      ${endTime}
    </div>
    <div style="display:flex;width:46px;flex-shrink:0"></div>
    <div style="display:flex;flex-direction:column;flex-grow:1">
      <div style="display:flex;font-family:${pal.bodyFamily};font-weight:600;font-size:31px;color:${titleColor};line-height:1.2">${esc(m.title)}</div>
      ${description}
      ${metaLine}
    </div>
  </div>`
}

// Conservative per-row height estimate (px) used only to paginate. Biased to
// OVER-estimate: overshooting just starts a new page a row early, while
// under-estimating would clip a row off the bottom of an A4 page. Char-per-line
// counts assume the ~815px content column at each font size.
function estimateRowHeight(m: RunSheetMoment): number {
  const titleLines = Math.max(1, Math.ceil(esc(m.title).length / 44))
  const meta = [m.location, m.people].filter(Boolean).join('   ·   ')
  const contentH =
    titleLines * 38 +
    (m.description ? 7 + Math.max(1, Math.ceil(m.description.length / 60)) * 33 : 0) +
    (meta ? 6 + Math.max(1, Math.ceil(meta.length / 64)) * 29 : 0)
  const timeH = 36 + (m.endTime && m.endTime !== m.time ? 3 + 24 : 0)
  return 35 /* padding + border */ + Math.max(contentH, timeH)
}

function pageShell(inner: string, pageNum: number, totalPages: number, pal: ExportPalette): string {
  const pageLabel = totalPages > 1 ? `<div style="display:flex;font-family:${pal.bodyFamily};font-weight:400;font-size:20px;color:${pal.faint}">Page ${pageNum} / ${totalPages}</div>` : ''
  return `<div style="display:flex;flex-direction:column;width:${RUNSHEET_W}px;height:${RUNSHEET_H}px;background:${pal.bg};font-family:${pal.bodyFamily};padding:72px 92px 0 92px">
    ${inner}
    <div style="display:flex;flex-grow:1"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid ${pal.divider};padding-top:20px;padding-bottom:24px;margin-top:18px">
      <div style="display:flex;font-family:${pal.bodyFamily};font-weight:600;font-size:20px;letter-spacing:2px;color:${pal.faint}">wedding.computer</div>
      ${pageLabel}
    </div>
  </div>`
}

export function buildRunSheetPages(d: RunSheetData): string[] {
  const pal = d.palette
  // Paginate by estimated height (not a fixed row count) so rows with
  // descriptions — which vary in height — never overflow the page. Page 1 carries
  // the full header, so it gets a smaller row budget than later pages.
  const contentH = RUNSHEET_H - 72 /* page padding-top */ - 95 /* footer block */
  const page1Budget = contentH - 290 /* full header */
  const pageNBudget = contentH - 80 /* slim header */
  const chunks: RunSheetMoment[][] = []
  let cur: RunSheetMoment[] = []
  let curH = 0
  for (const m of d.items) {
    const h = estimateRowHeight(m)
    const budget = chunks.length === 0 ? page1Budget : pageNBudget
    // Always keep at least one row per page (a lone over-budget row is rare and
    // capped by MAX_DESC) — otherwise start a fresh page.
    if (cur.length > 0 && curH + h > budget) {
      chunks.push(cur)
      cur = []
      curH = 0
    }
    cur.push(m)
    curH += h
  }
  if (cur.length > 0) chunks.push(cur)
  if (chunks.length === 0) chunks.push([])
  const total = chunks.length
  const namesLine = d.partners.map((p) => p.first).filter(Boolean).join(' & ')

  const fullHeader = `<div style="display:flex;flex-direction:column;align-items:center;margin-bottom:28px">
      <div style="display:flex;font-family:${pal.bodyFamily};font-weight:600;font-size:24px;letter-spacing:8px;color:${pal.accent}">RUN SHEET</div>
      <div style="display:flex;margin-top:18px">${namesBlock(d.partners, pal, { first: 64, last: 26, amp: 46, pad: 24 })}</div>
      <div style="display:flex;font-family:${pal.bodyFamily};font-weight:400;font-size:30px;color:${pal.secondary};margin-top:18px">${esc(d.dateLabel)}${d.locationLabel ? `   ·   ${esc(d.locationLabel)}` : ''}</div>
      ${d.tagline ? `<div style="display:flex;font-family:${pal.displayFamily};font-weight:700;font-size:28px;color:${pal.accent};margin-top:16px;text-align:center;padding:0 40px">${esc(d.tagline)}</div>` : ''}
    </div>`

  const slimHeader = `<div style="display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid ${pal.divider};padding-bottom:16px;margin-bottom:12px">
      <div style="display:flex;font-family:${pal.displayFamily};font-weight:700;font-size:34px;color:${pal.accentDeep}">${esc(namesLine)}</div>
      <div style="display:flex;font-family:${pal.bodyFamily};font-weight:600;font-size:22px;letter-spacing:3px;color:${pal.accent}">RUN SHEET${d.dateLabel ? `   ·   ${esc(d.dateLabel)}` : ''}</div>
    </div>`

  return chunks.map((chunk, i) => {
    const header = i === 0 ? fullHeader : slimHeader
    const rows = chunk.length
      ? chunk.map((m) => runSheetRow(m, pal)).join('')
      : `<div style="display:flex;font-family:${pal.bodyFamily};font-weight:400;font-size:26px;color:${pal.secondary};padding-top:40px">No scheduled items yet.</div>`
    return pageShell(`${header}<div style="display:flex;flex-direction:column">${rows}</div>`, i + 1, total, pal)
  })
}
