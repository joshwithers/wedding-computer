// Server-side stroke burn-in for collaborative PDF signing. Takes the normalized
// strokes captured by src/views/sign-pdf.tsx and draws them onto the PDF with pdf-lib.
// See SIGNING.md (repo root) for the coordinate model and rotation handling.
import { PDFDocument, rgb, LineCapStyle } from 'pdf-lib'

// A freehand stroke captured in the browser. `pts` are normalized [0..1]
// coordinates relative to the VISIBLE (pdf.js-rendered, rotation-aware) page,
// top-left origin, y-down. `width` is the pen width normalized to the visible
// page width (penPx / cssPageWidth) so it scales with the page. `color` is a hex
// string (#rrggbb).
export type Stroke = { color?: string; width?: number; pts: [number, number][] }
export type StrokesByPage = Record<number, Stroke[]>

const MAX_TOTAL_POINTS = 60_000 // bound Worker CPU/memory across a session
const DEFAULT_WIDTH_NORM = 0.004 // ~fallback pen width as a fraction of page width

function hexToRgb(hex?: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim())
  if (!m) return { r: 0.06, g: 0.09, b: 0.16 } // near-black ink default
  const n = parseInt(m[1], 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

// Map a normalized visible-page point (0..1, top-left origin, y-down) to PDF user
// space (origin bottom-left, y-up), accounting for the page's /Rotate. W,H are the
// UNROTATED page size (getSize); the visible page is H×W when rotated 90/270. The four
// cases are derived and verified against all corners for each angle (see burn.test.ts) —
// do NOT "simplify" without re-checking a rotated PDF.
export function toUserSpace(nx: number, ny: number, W: number, H: number, angle: number): { x: number; y: number } {
  const x = clamp01(nx)
  const y = clamp01(ny)
  switch (((angle % 360) + 360) % 360) {
    case 90: return { x: y * W, y: x * H }
    case 180: return { x: (1 - x) * W, y: y * H }
    case 270: return { x: (1 - y) * W, y: (1 - x) * H }
    default: return { x: x * W, y: (1 - y) * H } // 0
  }
}

// Burn the captured strokes onto the PDF as vector polylines (one segment per
// consecutive point pair). Returns the new PDF bytes. Pages/points out of range
// or beyond the safety cap are skipped.
export async function burnStrokes(pdfBytes: ArrayBuffer | Uint8Array, strokesByPage: StrokesByPage): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes)
  const pages = doc.getPages()
  let budget = MAX_TOTAL_POINTS

  for (const [pageKey, strokes] of Object.entries(strokesByPage)) {
    const pageIndex = Number(pageKey)
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) continue
    const page = pages[pageIndex]
    const { width: W, height: H } = page.getSize()
    const angle = page.getRotation().angle
    const visibleW = angle === 90 || angle === 270 ? H : W

    for (const stroke of strokes ?? []) {
      const pts = stroke?.pts
      if (!Array.isArray(pts) || pts.length < 2) continue
      const { r, g, b } = hexToRgb(stroke.color)
      const thickness = Math.max(0.5, (stroke.width ?? DEFAULT_WIDTH_NORM) * visibleW)
      let prev = toUserSpace(pts[0][0], pts[0][1], W, H, angle)
      for (let i = 1; i < pts.length; i++) {
        if (budget-- <= 0) return doc.save()
        const cur = toUserSpace(pts[i][0], pts[i][1], W, H, angle)
        page.drawLine({ start: prev, end: cur, thickness, color: rgb(r, g, b), lineCap: LineCapStyle.Round })
        prev = cur
      }
    }
  }

  return doc.save()
}
