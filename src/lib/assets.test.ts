import { describe, expect, it } from 'vitest'
import { HTMX_SCRIPT_SRC, IMMUTABLE_ASSET_CACHE, STYLESHEET_HREF, sourcePathForVersionedAsset } from './assets'

describe('versioned assets', () => {
  it('uses versioned app URLs for render-blocking assets', () => {
    expect(STYLESHEET_HREF).toMatch(/^\/assets\/styles\.css\?v=/)
    expect(HTMX_SCRIPT_SRC).toMatch(/^\/assets\/htmx-2\.0\.4\.min\.js\?v=/)
  })

  it('maps only known versioned assets back to public assets', () => {
    expect(sourcePathForVersionedAsset('/assets/styles.css')).toBe('/styles.css')
    expect(sourcePathForVersionedAsset('/assets/htmx-2.0.4.min.js')).toBe('/htmx-2.0.4.min.js')
    expect(sourcePathForVersionedAsset('/assets/nope.js')).toBeNull()
  })

  it('marks versioned assets immutable', () => {
    expect(IMMUTABLE_ASSET_CACHE).toContain('immutable')
    expect(IMMUTABLE_ASSET_CACHE).toContain('max-age=31536000')
  })
})
