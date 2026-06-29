import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { toUserSpace, burnStrokes } from './burn'

const W = 600
const H = 800
const near = (a: number, b: number) => Math.abs(a - b) < 0.001

// Visible top-left origin (y-down) → PDF user space (bottom-left, y-up).
describe('toUserSpace coordinate mapping', () => {
  it('maps the four corners correctly at rotation 0', () => {
    expect(toUserSpace(0, 0, W, H, 0)).toMatchObject({ x: 0, y: H })       // visible TL → user TL
    expect(toUserSpace(1, 0, W, H, 0)).toMatchObject({ x: W, y: H })       // visible TR → user TR
    expect(toUserSpace(0, 1, W, H, 0)).toMatchObject({ x: 0, y: 0 })       // visible BL → user BL
    expect(toUserSpace(1, 1, W, H, 0)).toMatchObject({ x: W, y: 0 })       // visible BR → user BR
  })

  it('maps the visible top-left to the correct user-space corner per rotation', () => {
    // Rotating the displayed page sends its visible top-left to a different
    // user-space corner: 90°CW → user BL, 180° → user BR, 270°CW → user TR.
    expect(toUserSpace(0, 0, W, H, 90)).toMatchObject({ x: 0, y: 0 })   // bottom-left
    expect(toUserSpace(0, 0, W, H, 180)).toMatchObject({ x: W, y: 0 })  // bottom-right
    expect(toUserSpace(0, 0, W, H, 270)).toMatchObject({ x: W, y: H })  // top-right
  })

  it('clamps out-of-range normalized input', () => {
    expect(toUserSpace(-1, 2, W, H, 0)).toMatchObject({ x: 0, y: 0 })
  })

  it('normalizes negative/large angles', () => {
    expect(toUserSpace(0, 0, W, H, -270)).toMatchObject(toUserSpace(0, 0, W, H, 90))
    expect(toUserSpace(0.3, 0.7, W, H, 450)).toMatchObject(toUserSpace(0.3, 0.7, W, H, 90))
  })
})

describe('burnStrokes', () => {
  it('returns a valid, larger PDF after burning a stroke', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([W, H])
    const base = await doc.save()

    const out = await burnStrokes(base, { 0: [{ color: '#1a1a2e', width: 0.005, pts: [[0.2, 0.3], [0.5, 0.4], [0.8, 0.35]] }] })
    expect(out.length).toBeGreaterThan(base.length)
    // Re-loads cleanly = still a valid PDF.
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPageCount()).toBe(1)
  })

  it('ignores out-of-range pages and single-point strokes', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([W, H])
    const base = await doc.save()
    const out = await burnStrokes(base, { 5: [{ pts: [[0, 0], [1, 1]] }], 0: [{ pts: [[0.5, 0.5]] }] })
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPageCount()).toBe(1)
  })
})
