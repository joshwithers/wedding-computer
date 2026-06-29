export const ASSET_VERSION = '2026-06-25-performance-1'

export const IMMUTABLE_ASSET_CACHE = 'public, max-age=31536000, immutable'

// Self-hosted pdf.js (legacy UMD build) — kept same-origin so the worker loads
// under CSP worker-src 'self' (a cross-origin CDN worker would be blocked).
const PDFJS_VERSION = '3.11.174'

const VERSIONED_ASSETS: Record<string, string> = {
  '/assets/styles.css': '/styles.css',
  '/assets/htmx-2.0.4.min.js': '/htmx-2.0.4.min.js',
  [`/assets/pdfjs-${PDFJS_VERSION}.min.js`]: `/pdfjs-${PDFJS_VERSION}.min.js`,
  [`/assets/pdfjs-${PDFJS_VERSION}.worker.min.js`]: `/pdfjs-${PDFJS_VERSION}.worker.min.js`,
}

export const STYLESHEET_HREF = `/assets/styles.css?v=${ASSET_VERSION}`
export const HTMX_SCRIPT_SRC = `/assets/htmx-2.0.4.min.js?v=${ASSET_VERSION}`
export const PDFJS_SCRIPT_SRC = `/assets/pdfjs-${PDFJS_VERSION}.min.js?v=${ASSET_VERSION}`
export const PDFJS_WORKER_SRC = `/assets/pdfjs-${PDFJS_VERSION}.worker.min.js?v=${ASSET_VERSION}`

export function sourcePathForVersionedAsset(pathname: string): string | null {
  return VERSIONED_ASSETS[pathname] ?? null
}
