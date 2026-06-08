/**
 * MCP (Model Context Protocol) server endpoint.
 *
 * Exposes vendor's plain text files (contacts, weddings, checklists, logs)
 * to AI agents via the MCP Streamable HTTP transport.
 *
 * Auth: Bearer token using the vendor's ical_token.
 * Endpoint: POST /mcp
 *
 * Usage in Claude Desktop / MCP clients:
 *   {
 *     "mcpServers": {
 *       "wedding-computer": {
 *         "url": "https://wedding.computer/mcp",
 *         "headers": { "Authorization": "Bearer {your-token}" }
 *       }
 *     }
 *   }
 */

import { Hono } from 'hono'
import type { Env, Bindings, VendorProfile } from '../types'
import { getVendorByIcalToken } from '../db/vendors'
import { isProVendor } from '../db/subscriptions'
import { processJsonSubmission, createEnquiry } from '../services/enquiry'

const mcp = new Hono<Env>()

// ─── Auth helper ───

async function authenticateMcp(db: D1Database, authHeader: string | undefined): Promise<VendorProfile | null> {
  if (!authHeader) return null
  // Accept "Bearer {token}"
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim()
    if (!token || token.length < 32) return null
    return getVendorByIcalToken(db, token)
  }
  return null
}

// ─── JSON-RPC types ───

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: Record<string, unknown>
}

type JsonRpcResponse = {
  jsonrpc: '2.0'
  id?: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

function rpcResult(id: string | number | undefined | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function rpcError(id: string | number | undefined | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

// ─── Tool definitions ───

const TOOLS = [
  {
    name: 'list_contacts',
    description: 'List all contacts with their name, email, status, and wedding date.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_contact',
    description: 'Get a contact\'s full markdown file by their ID.',
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'string', description: 'Contact ID' } },
      required: ['id'],
    },
  },
  {
    name: 'list_weddings',
    description: 'List all weddings with title, date, location, and status.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_wedding',
    description: 'Get a wedding\'s full details as a markdown file by ID.',
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'string', description: 'Wedding ID' } },
      required: ['id'],
    },
  },
  {
    name: 'get_wedding_todo',
    description: 'Get the checklist/to-do list for a wedding.',
    inputSchema: {
      type: 'object' as const,
      properties: { wedding_id: { type: 'string', description: 'Wedding ID' } },
      required: ['wedding_id'],
    },
  },
  {
    name: 'get_wedding_log',
    description: 'Get the changelog/activity log for a wedding.',
    inputSchema: {
      type: 'object' as const,
      properties: { wedding_id: { type: 'string', description: 'Wedding ID' } },
      required: ['wedding_id'],
    },
  },
  {
    name: 'get_wedding_credits',
    description: 'Get the vendor credits list for a wedding (for Instagram or blog).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        wedding_id: { type: 'string', description: 'Wedding ID' },
        format: { type: 'string', enum: ['instagram', 'markdown', 'html'], description: 'Output format (default: markdown)' },
      },
      required: ['wedding_id'],
    },
  },
  {
    name: 'search_contacts',
    description: 'Search contacts by name, email, or status.',
    inputSchema: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
  },
  {
    name: 'get_upcoming_events',
    description: 'Get upcoming calendar events for the next N days.',
    inputSchema: {
      type: 'object' as const,
      properties: { days: { type: 'number', description: 'Number of days ahead (default: 30)' } },
    },
  },
  {
    name: 'submit_enquiry',
    description: 'Create a new lead/enquiry in the CRM — e.g. when entering an enquiry on the vendor\'s behalf or capturing one from a conversation. Requires first_name, last_name, and a valid email.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        first_name: { type: 'string', description: 'Lead\'s first name (required)' },
        last_name: { type: 'string', description: 'Lead\'s last name (required)' },
        email: { type: 'string', description: 'Lead\'s email address (required)' },
        phone: { type: 'string', description: 'Phone number' },
        partner_first_name: { type: 'string', description: 'Partner\'s first name' },
        partner_last_name: { type: 'string', description: 'Partner\'s last name' },
        wedding_date: { type: 'string', description: 'Wedding date, YYYY-MM-DD' },
        wedding_location: { type: 'string', description: 'City or venue' },
        notes: { type: 'string', description: 'Message or notes about the enquiry' },
      },
      required: ['first_name', 'last_name', 'email'],
    },
  },
]

// ─── Tool handlers ───

async function handleTool(
  db: D1Database,
  env: Bindings,
  vendor: VendorProfile,
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'list_contacts': {
      const rows = await db
        .prepare(
          `SELECT id, first_name, last_name, email, phone, status, wedding_date, wedding_location
           FROM contacts WHERE vendor_id = ? ORDER BY created_at DESC LIMIT 200`
        )
        .bind(vendor.id)
        .all()
      return { content: [{ type: 'text', text: JSON.stringify(rows.results, null, 2) }] }
    }

    case 'get_contact': {
      const id = String(args.id ?? '')
      const contact = await db
        .prepare('SELECT * FROM contacts WHERE id = ? AND vendor_id = ?')
        .bind(id, vendor.id)
        .first()
      if (!contact) return { content: [{ type: 'text', text: 'Contact not found' }] }
      // Build markdown representation
      const c = contact as Record<string, unknown>
      const lines = [
        `# ${c.first_name} ${c.last_name}`,
        '',
        `- **Email:** ${c.email ?? 'N/A'}`,
        `- **Phone:** ${c.phone ?? 'N/A'}`,
        `- **Status:** ${c.status}`,
        `- **Source:** ${c.source ?? 'N/A'}`,
      ]
      if (c.partner_first_name) lines.push(`- **Partner:** ${c.partner_first_name} ${c.partner_last_name ?? ''}`)
      if (c.wedding_date) lines.push(`- **Wedding date:** ${c.wedding_date}`)
      if (c.wedding_location) lines.push(`- **Wedding location:** ${c.wedding_location}`)
      if (c.notes) lines.push('', '## Notes', '', String(c.notes))
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    }

    case 'list_weddings': {
      const rows = await db
        .prepare(
          `SELECT w.id, w.title, w.date, w.time, w.location, w.status, w.ceremony_type,
                  w.ceremony_location, w.reception_location, w.emoji
           FROM weddings w
           JOIN wedding_members wm ON wm.wedding_id = w.id
           WHERE wm.user_id = (SELECT user_id FROM vendor_profiles WHERE id = ?)
             AND wm.status = 'active'
           ORDER BY w.date ASC NULLS LAST`
        )
        .bind(vendor.id)
        .all()
      return { content: [{ type: 'text', text: JSON.stringify(rows.results, null, 2) }] }
    }

    case 'get_wedding': {
      const id = String(args.id ?? '')
      const wedding = await db
        .prepare('SELECT * FROM weddings WHERE id = ?')
        .bind(id)
        .first()
      if (!wedding) return { content: [{ type: 'text', text: 'Wedding not found' }] }
      const { weddingToMarkdown } = await import('../storage/weddings')
      const { serializeMarkdown } = await import('../storage/markdown')
      const doc = weddingToMarkdown(wedding as any)
      return { content: [{ type: 'text', text: serializeMarkdown(doc) }] }
    }

    case 'get_wedding_todo': {
      const weddingId = String(args.wedding_id ?? '')
      const { getWeddingTodo } = await import('../db/todos')
      const todo = await getWeddingTodo(db, vendor.id, weddingId)
      if (!todo) return { content: [{ type: 'text', text: 'No checklist for this wedding' }] }
      return { content: [{ type: 'text', text: todo.content }] }
    }

    case 'get_wedding_log': {
      const weddingId = String(args.wedding_id ?? '')
      const { exportWeddingLogMarkdown } = await import('../db/wedding-log')
      const wedding = await db.prepare('SELECT title FROM weddings WHERE id = ?').bind(weddingId).first<{ title: string }>()
      const md = await exportWeddingLogMarkdown(db, weddingId, wedding?.title ?? 'Wedding')
      return { content: [{ type: 'text', text: md }] }
    }

    case 'get_wedding_credits': {
      const weddingId = String(args.wedding_id ?? '')
      const format = String(args.format ?? 'markdown')
      const { getWeddingMembers } = await import('../db/weddings')
      const { listCoupleVendors } = await import('../db/couple-vendors')
      const { buildCredits, formatInstagramCredits, formatWebCredits, formatHtmlCredits } = await import('../services/wedding-credits')
      const members = await getWeddingMembers(db, weddingId)
      const coupleVendors = await listCoupleVendors(db, weddingId)
      const credits = buildCredits(members, coupleVendors)
      const text = format === 'instagram' ? formatInstagramCredits(credits)
        : format === 'html' ? formatHtmlCredits(credits)
        : formatWebCredits(credits)
      return { content: [{ type: 'text', text }] }
    }

    case 'search_contacts': {
      const q = String(args.query ?? '')
      const rows = await db
        .prepare(
          `SELECT id, first_name, last_name, email, status, wedding_date
           FROM contacts
           WHERE vendor_id = ? AND (
             first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR status = ?
           )
           ORDER BY created_at DESC LIMIT 50`
        )
        .bind(vendor.id, `%${q}%`, `%${q}%`, `%${q}%`, q)
        .all()
      return { content: [{ type: 'text', text: JSON.stringify(rows.results, null, 2) }] }
    }

    case 'get_upcoming_events': {
      const days = Number(args.days ?? 30)
      const today = new Date().toISOString().slice(0, 10)
      const future = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
      const rows = await db
        .prepare(
          `SELECT id, title, date, start_time, end_time, type, notes
           FROM calendar_events
           WHERE vendor_id = ? AND date >= ? AND date <= ?
           ORDER BY date, start_time`
        )
        .bind(vendor.id, today, future)
        .all()
      return { content: [{ type: 'text', text: JSON.stringify(rows.results, null, 2) }] }
    }

    case 'submit_enquiry': {
      const { contactData, formData } = processJsonSubmission(args as Record<string, unknown>)
      const contact = await createEnquiry(env, vendor, { contactData, formData, source: 'agent' })
      return {
        content: [{
          type: 'text',
          text: `Created enquiry ${contact.id} for ${contact.first_name} ${contact.last_name} (${contact.email}). Status: ${contact.status}.`,
        }],
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ─── MCP endpoint ───

mcp.post('/mcp', async (c) => {
  const vendor = await authenticateMcp(c.env.DB, c.req.header('Authorization'))
  if (!vendor) {
    return c.json(rpcError(null, -32000, 'Unauthorized — use Bearer token from Settings > Calendar & Sync'), 401)
  }

  const pro = await isProVendor(c.env.DB, vendor.id)
  if (!pro) {
    return c.json(rpcError(null, -32001, 'MCP access requires a Pro subscription — upgrade at wedding.computer/pricing'), 403)
  }

  let body: JsonRpcRequest | JsonRpcRequest[]
  try {
    body = await c.req.json()
  } catch {
    return c.json(rpcError(null, -32700, 'Parse error'), 400)
  }

  // Handle single request
  const req = Array.isArray(body) ? body[0] : body
  if (!req || req.jsonrpc !== '2.0' || !req.method) {
    return c.json(rpcError(req?.id, -32600, 'Invalid Request'), 400)
  }

  switch (req.method) {
    case 'initialize':
      return c.json(rpcResult(req.id, {
        protocolVersion: '2025-03-26',
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: 'wedding-computer',
          version: '1.0.0',
        },
      }))

    case 'notifications/initialized':
      return c.json(rpcResult(req.id, {}))

    case 'tools/list':
      return c.json(rpcResult(req.id, { tools: TOOLS }))

    case 'tools/call': {
      const params = req.params as { name: string; arguments?: Record<string, unknown> } | undefined
      if (!params?.name) {
        return c.json(rpcError(req.id, -32602, 'Missing tool name'))
      }
      try {
        const result = await handleTool(c.env.DB, c.env, vendor, params.name, params.arguments ?? {})
        return c.json(rpcResult(req.id, result))
      } catch (err: any) {
        return c.json(rpcError(req.id, -32000, err.message))
      }
    }

    case 'ping':
      return c.json(rpcResult(req.id, {}))

    default:
      return c.json(rpcError(req.id, -32601, `Method not found: ${req.method}`))
  }
})

// GET for MCP SSE endpoint (required by spec for session init)
mcp.get('/mcp', (c) => {
  return c.json({
    name: 'wedding-computer',
    version: '1.0.0',
    description: 'Access your Wedding Computer contacts, weddings, checklists, and calendar via MCP.',
    instructions: 'Authenticate with Bearer token from Settings > Calendar & Sync.',
  })
})

export default mcp
