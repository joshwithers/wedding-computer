export const ASSET_VERSION = '2026-06-25-performance-1'

export const IMMUTABLE_ASSET_CACHE = 'public, max-age=31536000, immutable'

const VERSIONED_ASSETS: Record<string, string> = {
  '/assets/styles.css': '/styles.css',
  '/assets/htmx-2.0.4.min.js': '/htmx-2.0.4.min.js',
}

export const STYLESHEET_HREF = `/assets/styles.css?v=${ASSET_VERSION}`
export const HTMX_SCRIPT_SRC = `/assets/htmx-2.0.4.min.js?v=${ASSET_VERSION}`

export function sourcePathForVersionedAsset(pathname: string): string | null {
  return VERSIONED_ASSETS[pathname] ?? null
}
