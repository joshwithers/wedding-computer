import { Hono } from 'hono'
import type { Env } from '../../types'
import { vendorCategories } from '../../lib/categories'

const directory = new Hono<Env>()

// ─── CORS middleware for all directory routes ───

directory.use('/api/directory/*', async (c, next) => {
  // Handle OPTIONS preflight
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  await next()

  c.res.headers.set('Access-Control-Allow-Origin', '*')
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
})

// ─── GET /api/directory/vendors — List directory vendors ───

directory.get('/api/directory/vendors', async (c) => {
  const category = c.req.query('category') || null
  const city = c.req.query('city') || null
  const state = c.req.query('state') || null
  const country = c.req.query('country') || null
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10)))
  const offset = (page - 1) * limit

  // Build query dynamically. Exclude vendors whose account is soft-deleted
  // (subquery form works in both the count and the JOINed list query).
  const conditions: string[] = [
    'vp.directory_listed = 1',
    'vp.user_id NOT IN (SELECT id FROM users WHERE deleted_at IS NOT NULL)',
  ]
  const binds: (string | number)[] = []

  if (category) {
    // Match any of the vendor's types, not just the primary.
    conditions.push(
      `EXISTS (SELECT 1 FROM json_each(COALESCE(vp.categories, json_array(vp.category))) j WHERE j.value = ?)`
    )
    binds.push(category)
  }
  if (city) {
    conditions.push('vp.location_city = ?')
    binds.push(city)
  }
  if (state) {
    conditions.push('vp.location_state = ?')
    binds.push(state)
  }
  if (country) {
    conditions.push('vp.location_country = ?')
    binds.push(country)
  }

  const where = conditions.join(' AND ')

  // Count total
  const countResult = await c.env.DB
    .prepare(`SELECT COUNT(*) as total FROM vendor_profiles vp WHERE ${where}`)
    .bind(...binds)
    .first<{ total: number }>()
  const total = countResult?.total ?? 0

  // Fetch page
  const result = await c.env.DB
    .prepare(
      `SELECT vp.id, vp.business_name, vp.category, vp.categories, vp.location_city, vp.location_state, vp.location_country, vp.bio, vp.website, vp.instagram, vp.logo_r2_key, u.avatar_url
       FROM vendor_profiles vp
       JOIN users u ON u.id = vp.user_id
       WHERE ${where}
       ORDER BY vp.business_name ASC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, limit, offset)
    .all<{
      id: string
      business_name: string
      category: string
      categories: string | null
      location_city: string | null
      location_state: string | null
      location_country: string | null
      bio: string | null
      website: string | null
      instagram: string | null
      logo_r2_key: string | null
      avatar_url: string | null
    }>()

  const appUrl = c.env.APP_URL
  // `category` stays a single string (consumers depend on the shape);
  // `categories` is additive — every type the vendor works as.
  const vendors = result.results.map(({ logo_r2_key, categories, ...v }) => ({
    ...v,
    categories: vendorCategories({ category: v.category, categories }),
    logo_url: logo_r2_key ? `${appUrl}/vendor-logo/${v.id}` : null,
  }))

  return c.json({
    vendors,
    total,
    page,
    limit,
  })
})

// ─── GET /api/directory/vendors/:id — Single vendor profile ───

directory.get('/api/directory/vendors/:id', async (c) => {
  const id = c.req.param('id')

  const row = await c.env.DB
    .prepare(
      `SELECT vp.id, vp.business_name, vp.category, vp.categories, vp.location_city, vp.location_state, vp.location_country, vp.bio, vp.website, vp.instagram, vp.phone, vp.ceremony_types, vp.logo_r2_key, u.avatar_url
       FROM vendor_profiles vp
       JOIN users u ON u.id = vp.user_id
       WHERE vp.id = ? AND vp.directory_listed = 1 AND u.deleted_at IS NULL`
    )
    .bind(id)
    .first<{
      id: string
      business_name: string
      category: string
      categories: string | null
      location_city: string | null
      location_state: string | null
      location_country: string | null
      bio: string | null
      website: string | null
      instagram: string | null
      phone: string | null
      ceremony_types: string | null
      logo_r2_key: string | null
      avatar_url: string | null
    }>()

  if (!row) {
    return c.json({ error: 'Vendor not found' }, 404)
  }

  const { logo_r2_key, categories, ...vendor } = row
  return c.json({
    vendor: {
      ...vendor,
      categories: vendorCategories({ category: vendor.category, categories }),
      logo_url: logo_r2_key ? `${c.env.APP_URL}/vendor-logo/${vendor.id}` : null,
    },
  })
})

// ─── GET /api/directory/categories — Category counts ───

directory.get('/api/directory/categories', async (c) => {
  // A multi-type vendor counts towards each of their categories.
  const result = await c.env.DB
    .prepare(
      `SELECT j.value AS category, COUNT(*) as count
       FROM vendor_profiles vp, json_each(COALESCE(vp.categories, json_array(vp.category))) j
       WHERE vp.directory_listed = 1
       GROUP BY j.value
       ORDER BY count DESC`
    )
    .all<{ category: string; count: number }>()

  return c.json({ categories: result.results })
})

// ─── GET /api/directory/locations — Location counts ───

directory.get('/api/directory/locations', async (c) => {
  const result = await c.env.DB
    .prepare(
      `SELECT location_country, location_state, location_city, COUNT(*) as count
       FROM vendor_profiles
       WHERE directory_listed = 1 AND location_country IS NOT NULL
       GROUP BY location_country, location_state, location_city
       ORDER BY count DESC`
    )
    .all<{
      location_country: string
      location_state: string | null
      location_city: string | null
      count: number
    }>()

  return c.json({
    locations: result.results.map((r) => ({
      country: r.location_country,
      state: r.location_state,
      city: r.location_city,
      count: r.count,
    })),
  })
})

// ─── GET /vendor-logo/:id — public square logo/icon (used by the app and the
// wedding.institute directory). Served like /avatar/:id: public, by id, no auth. ───

directory.get('/vendor-logo/:id', async (c) => {
  const id = c.req.param('id')
  if (!c.env.STORAGE) return c.notFound()
  const row = await c.env.DB
    .prepare('SELECT logo_r2_key FROM vendor_profiles WHERE id = ?')
    .bind(id)
    .first<{ logo_r2_key: string | null }>()
  if (!row?.logo_r2_key) return c.notFound()
  const object = await c.env.STORAGE.get(row.logo_r2_key)
  if (!object) return c.notFound()
  const headers = new Headers()
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'image/png')
  headers.set('Cache-Control', 'public, max-age=3600')
  return new Response(object.body, { headers })
})

export default directory
