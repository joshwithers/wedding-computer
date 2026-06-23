// Server-side image rendering for timeline exports (PNG wallpaper + the raster
// layer of the PDF). Uses workers-og (satori → SVG → resvg → PNG, all WASM, no
// headless browser) so it runs inside the Worker. Fonts are fetched once from a
// CDN and cached in KV (satori needs TTF/OTF/WOFF — NOT woff2 — so we pull the
// .woff builds from @fontsource).
import { ImageResponse } from 'workers-og'
import type { Bindings } from '../types'

type LoadedFont = { name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: 'normal' }

// @fontsource .woff files (satori-compatible). Pinned family: Fraunces (an
// elegant display serif) for headings + Inter for body/data legibility.
const FONT_SOURCES: { key: string; url: string; name: string; weight: 400 | 600 | 700 }[] = [
  { key: 'font:inter-400', name: 'Inter', weight: 400, url: 'https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-400-normal.woff' },
  { key: 'font:inter-600', name: 'Inter', weight: 600, url: 'https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-600-normal.woff' },
  { key: 'font:fraunces-700', name: 'Fraunces', weight: 700, url: 'https://cdn.jsdelivr.net/npm/@fontsource/fraunces/files/fraunces-latin-700-normal.woff' },
]

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

export async function loadFonts(env: Bindings): Promise<LoadedFont[]> {
  const datas = await Promise.all(FONT_SOURCES.map((s) => fetchFont(env, s)))
  return FONT_SOURCES.map((s, i) => ({ name: s.name, data: datas[i], weight: s.weight, style: 'normal' as const }))
}

/** Render an HTML string to PNG bytes at the given pixel size. */
export async function renderPng(env: Bindings, html: string, width: number, height: number): Promise<ArrayBuffer> {
  const fonts = await loadFonts(env)
  const resp = new ImageResponse(html, { width, height, fonts, format: 'png' })
  return await resp.arrayBuffer()
}
