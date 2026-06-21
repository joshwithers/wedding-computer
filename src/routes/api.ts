/**
 * Public JSON API (v1) — programmatic lead intake for webhooks, Zapier, and agents.
 *
 * Auth: Bearer <enquiry intake key> (write-only; from Settings → Enquiry form).
 *       Pro subscription required. The key can ONLY create leads.
 *
 *   POST /api/v1/enquiries   Create a lead.        (auth)
 *   GET  /api/v1/form        Describe the fields.  (auth)
 *   GET  /api/v1             API index.            (public discovery)
 */

import { Hono } from 'hono'
import type { Env, VendorProfile } from '../types'
import { getVendorByEnquiryKey } from '../db/vendors'
import { isProVendor } from '../db/subscriptions'
import { parseFormConfig } from '../lib/form-schema'
import { processJsonSubmission, createEnquiry, type EnquiryJson } from '../services/enquiry'

const api = new Hono<Env>()

const DOCS_URL = 'https://wedding.computer/auth.md'

function bearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  if (!authHeader.startsWith('Bearer ')) return null
  const token = authHeader.slice(7).trim()
  return token || null
}

// Resolve + gate the caller: valid intake key AND active Pro subscription.
// Returns the vendor, or a Response to short-circuit with the right status.
async function authenticate(c: any): Promise<VendorProfile | Response> {
  const key = bearer(c.req.header('Authorization'))
  if (!key) {
    return c.json({ ok: false, error: 'Missing Bearer token. Use your enquiry intake key from Settings → Enquiry form.', docs: DOCS_URL }, 401)
  }
  const vendor = await getVendorByEnquiryKey(c.env.DB, key)
  if (!vendor) {
    return c.json({ ok: false, error: 'Invalid intake key.', docs: DOCS_URL }, 401)
  }
  const pro = await isProVendor(c.env.DB, vendor.id)
  if (!pro) {
    return c.json({ ok: false, error: 'The enquiry API requires a Pro subscription — upgrade at wedding.computer/pricing.' }, 403)
  }
  return vendor
}

// Per-vendor rate limit (server-to-server callers may share IPs, so key on the
// vendor rather than IP). A 120/minute burst limit plus a daily ceiling so a
// leaked write-only enquiry key can't flood a vendor's CRM around the clock.
const API_BURST_LIMIT = 120 // per minute
const API_DAILY_LIMIT = 2000 // per UTC day

async function rateLimited(c: any, vendorId: string): Promise<boolean> {
  const minuteKey = `rl:apienq:${vendorId}`
  const dayKey = `rl:apienq:day:${vendorId}:${new Date().toISOString().slice(0, 10)}`
  const [minuteRaw, dayRaw] = await Promise.all([c.env.KV.get(minuteKey), c.env.KV.get(dayKey)])
  const minute = parseInt(minuteRaw ?? '0', 10)
  const day = parseInt(dayRaw ?? '0', 10)
  if (minute >= API_BURST_LIMIT || day >= API_DAILY_LIMIT) return true
  await Promise.all([
    c.env.KV.put(minuteKey, String(minute + 1), { expirationTtl: 60 }),
    c.env.KV.put(dayKey, String(day + 1), { expirationTtl: 60 * 60 * 25 }),
  ])
  return false
}

// ─── Create a lead ───

api.post('/api/v1/enquiries', async (c) => {
  const auth = await authenticate(c)
  if (auth instanceof Response) return auth
  const vendor = auth

  if (await rateLimited(c, vendor.id)) {
    return c.json({ ok: false, error: 'Rate limit exceeded (120/min or 2000/day). Try again later.' }, 429)
  }

  let payload: EnquiryJson
  try {
    payload = (await c.req.json()) as EnquiryJson
  } catch {
    return c.json({ ok: false, error: 'Request body must be valid JSON.' }, 400)
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return c.json({ ok: false, error: 'Request body must be a JSON object.' }, 400)
  }

  try {
    const { contactData, formData } = processJsonSubmission(payload)
    const contact = await createEnquiry(c.env, vendor, { contactData, formData, source: 'api' })
    return c.json(
      {
        ok: true,
        id: contact.id,
        status: contact.status,
        message: 'Enquiry received',
      },
      201
    )
  } catch (e: any) {
    return c.json({ ok: false, error: e.message ?? 'Could not create enquiry' }, 400)
  }
})

// ─── Describe this vendor's form fields (so integrations know what to send) ───

api.get('/api/v1/form', async (c) => {
  const auth = await authenticate(c)
  if (auth instanceof Response) return auth
  const vendor = auth

  const config = parseFormConfig(vendor.enquiry_form)
  const contactFields: Array<{ key: string; required: boolean; type: string }> = []
  const customFields: Array<{ label: string; type: string; options?: string[] }> = []
  const seen = new Set<string>()

  for (const f of config.fields) {
    if (f.type === 'heading') continue
    if (f.mapTo) {
      if (seen.has(f.mapTo)) continue
      seen.add(f.mapTo)
      contactFields.push({ key: f.mapTo, required: !!f.required, type: f.type })
    } else {
      customFields.push({
        label: f.label,
        type: f.type,
        ...(f.options ? { options: f.options.map((o) => (typeof o === 'string' ? o : o.value)) } : {}),
      })
    }
  }

  return c.json({
    ok: true,
    title: config.title,
    required: ['first_name', 'last_name', 'email'],
    contact_fields: contactFields,
    custom_fields: customFields,
    note: 'POST contact fields as top-level JSON keys. Put custom fields under a "fields" object keyed by label.',
  })
})

// ─── Public discovery index ───

api.get('/api/v1', (c) =>
  c.json({
    name: 'Wedding Computer Enquiry API',
    version: '1',
    description: 'Programmatically send enquiries (leads) into a vendor\'s CRM. For webhooks, Zapier, and AI agents.',
    authentication: {
      type: 'bearer',
      credential: 'enquiry intake key',
      how_to_get: 'Sign in, then Settings → Enquiry form → API & webhooks. Requires a Pro subscription.',
      docs: DOCS_URL,
    },
    endpoints: {
      create_enquiry: {
        method: 'POST',
        url: 'https://wedding.computer/api/v1/enquiries',
        body: {
          first_name: 'string (required)',
          last_name: 'string (required)',
          email: 'string (required)',
          phone: 'string',
          partner_first_name: 'string',
          partner_last_name: 'string',
          wedding_date: 'string (YYYY-MM-DD)',
          wedding_location: 'string',
          notes: 'string',
          fields: 'object of { label: value } for any custom fields',
        },
      },
      form_schema: {
        method: 'GET',
        url: 'https://wedding.computer/api/v1/form',
        description: 'Returns the fields configured on your enquiry form.',
      },
    },
    agent: {
      mcp: 'https://wedding.computer/mcp (tool: submit_enquiry)',
      discovery: 'https://wedding.computer/.well-known/agent',
    },
  })
)

export default api
