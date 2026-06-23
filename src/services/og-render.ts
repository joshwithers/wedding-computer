// Server-side image rendering for timeline exports (PNG wallpaper + the raster
// layer of the PDF). Uses workers-og (satori → SVG → resvg → PNG, all WASM, no
// headless browser) so it runs inside the Worker. Fonts are fetched once from a
// CDN and cached in KV (satori needs TTF/OTF/WOFF — NOT woff2 — so we pull the
// .woff builds from @fontsource).
import { ImageResponse } from 'workers-og'
import { PDFDocument } from 'pdf-lib'
import type { Bindings } from '../types'

type LoadedFont = { name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: 'normal' }

/** The display (heading) font to load, derived from a vendor's brand font.
 * null = the house default (Fraunces). `pkg` is the @fontsource package name. */
export type DisplayFont = { family: string; pkg: string } | null

const FONT_BASE = 'https://cdn.jsdelivr.net/npm/@fontsource'
const fontUrl = (pkg: string, weight: number) => `${FONT_BASE}/${pkg}/files/${pkg}-latin-${weight}-normal.woff`

const INTER_400 = { key: 'font:inter-400', url: fontUrl('inter', 400) }
const INTER_600 = { key: 'font:inter-600', url: fontUrl('inter', 600) }
const FRAUNCES_700 = { key: 'font:fraunces-700', url: fontUrl('fraunces', 700) }

async function fetchFont(env: Bindings, src: { key: string; url: string }): Promise<ArrayBuffer> {
  const cached = await env.KV.get(src.key, 'arrayBuffer')
  if (cached) return cached
  // CDNs reject bare server fetches — send a User-Agent.
  const res = await fetch(src.url, { headers: { 'User-Agent': 'wedding-computer/1.0 (+https://wedding.computer)' } })
  if (!res.ok) throw new Error(`font fetch ${src.url} -> ${res.status}`)
  const buf = await res.arrayBuffer()
  await env.KV.put(src.key, buf, { expirationTtl: 60 * 60 * 24 * 90 }).catch(() => {})
  return buf
}

/**
 * Body face (Inter 400/600) plus the display face at 700. `display` picks the
 * vendor's brand font (fetched from @fontsource); on any failure — or for the
 * house default — we fall back to Fraunces, registered under whatever family
 * name the layout expects so the markup always resolves to a real font.
 */
export async function loadFonts(env: Bindings, display?: DisplayFont): Promise<LoadedFont[]> {
  const [inter400, inter600] = await Promise.all([fetchFont(env, INTER_400), fetchFont(env, INTER_600)])

  let displayName = 'Fraunces'
  let displayData: ArrayBuffer
  if (display && display.pkg && display.pkg !== 'fraunces') {
    displayName = display.family
    try {
      displayData = await fetchFont(env, { key: `font:${display.pkg}-700`, url: fontUrl(display.pkg, 700) })
    } catch {
      displayData = await fetchFont(env, FRAUNCES_700) // fallback glyphs, still under the brand family name
    }
  } else {
    displayData = await fetchFont(env, FRAUNCES_700)
  }

  return [
    { name: 'Inter', data: inter400, weight: 400, style: 'normal' },
    { name: 'Inter', data: inter600, weight: 600, style: 'normal' },
    { name: displayName, data: displayData, weight: 700, style: 'normal' },
  ]
}

/** Render an HTML string to PNG bytes at the given pixel size. */
export async function renderPng(env: Bindings, html: string, width: number, height: number, display?: DisplayFont): Promise<ArrayBuffer> {
  const fonts = await loadFonts(env, display)
  const resp = new ImageResponse(html, { width, height, fonts, format: 'png' })
  return await resp.arrayBuffer()
}

// A4 portrait, in PDF points (1/72").
const A4_PT_W = 595.28
const A4_PT_H = 841.89

/**
 * Render HTML pages (each `width`×`height` px, A4 ratio) to a multi-page PDF:
 * each page → PNG (satori/resvg) → embedded full-bleed into a pdf-lib A4 page.
 * Pages are rendered sequentially — the resvg WASM instance isn't safe to drive
 * concurrently.
 */
export async function renderPdf(env: Bindings, htmlPages: string[], width: number, height: number, display?: DisplayFont): Promise<Uint8Array> {
  const fonts = await loadFonts(env, display)
  const doc = await PDFDocument.create()
  for (const html of htmlPages) {
    const resp = new ImageResponse(html, { width, height, fonts, format: 'png' })
    const png = new Uint8Array(await resp.arrayBuffer())
    const img = await doc.embedPng(png)
    const page = doc.addPage([A4_PT_W, A4_PT_H])
    page.drawImage(img, { x: 0, y: 0, width: A4_PT_W, height: A4_PT_H })
  }
  return await doc.save()
}
