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
import { getVendorByIcalToken, getVendorById } from '../db/vendors'
import { isOAuthAccessToken, accessTokenKey, grantRevokedKey, type AccessTokenRecord } from '../lib/oauth'
import { isProVendor } from '../db/subscriptions'
import { processJsonSubmission, createEnquiry } from '../services/enquiry'
import { clientIp, isAuthThrottled, recordAuthFailure, consumeRateLimit } from '../middleware/rate-limit'
import { getMembership } from '../db/weddings'
import { isDocScope, canReadDoc, canWriteDoc } from '../services/doc-permissions'
import { getDoc, appendToDoc } from '../db/wedding-docs'
import { McpDocsPage } from '../views/mcp-docs'

const mcp = new Hono<Env>()

// ─── Auth helper ───

async function authenticateMcp(env: Bindings, authHeader: string | undefined): Promise<VendorProfile | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  const token = authHeader.slice(7).trim()
  if (!token || token.length < 32) return null

  // OAuth 2.1 access token (issued via /oauth/token) → resolves to one vendor,
  // exactly like the sync token. Validated against KV (fast, short TTL).
  if (isOAuthAccessToken(token)) {
    const raw = await env.KV.get(await accessTokenKey(token))
    if (!raw) return null
    let rec: AccessTokenRecord
    try {
      rec = JSON.parse(raw)
    } catch {
      return null
    }
    if (!rec?.vendor_id) return null
    // Reject immediately if the grant behind this token was revoked (the
    // revoke handler drops a short-lived tombstone so we don't wait out the TTL).
    if (rec.grant_id && (await env.KV.get(grantRevokedKey(rec.grant_id)))) return null
    return getVendorById(env.DB, rec.vendor_id)
  }

  // Legacy bearer sync token (CalDAV/vault/Obsidian/iOS share it).
  return getVendorByIcalToken(env.DB, token)
}

/**
 * Is the authenticated vendor an active member of this wedding? The by-id
 * wedding tools must check this — the weddings table is shared across all
 * tenants, so a valid token alone must not expose another couple's wedding,
 * its activity log, or its members' contact details. A vendor removed from
 * a wedding loses access here too.
 */
export async function vendorCanAccessWedding(
  db: D1Database,
  vendorId: string,
  weddingId: string
): Promise<boolean> {
  if (!weddingId) return false
  const vendor = await db
    .prepare('SELECT user_id FROM vendor_profiles WHERE id = ?')
    .bind(vendorId)
    .first<{ user_id: string }>()
  if (!vendor?.user_id) return false
  const row = await db
    .prepare(
      "SELECT id FROM wedding_members WHERE wedding_id = ? AND user_id = ? AND status = 'active' LIMIT 1"
    )
    .bind(weddingId, vendor.user_id)
    .first()
  return !!row
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
      properties: { contact_id: { type: 'string', description: 'Contact ID' } },
      required: ['contact_id'],
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
      properties: { wedding_id: { type: 'string', description: 'Wedding ID' } },
      required: ['wedding_id'],
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
    name: 'update_wedding_todo',
    description: 'Replace the wedding checklist with new markdown content (GitHub-flavoured checklist: "- [ ] item" / "- [x] done").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        wedding_id: { type: 'string', description: 'Wedding ID' },
        content: { type: 'string', description: 'Full checklist markdown' },
      },
      required: ['wedding_id', 'content'],
    },
  },
  {
    name: 'get_wedding_timeline',
    description: 'Get the wedding day timeline (run sheet) as markdown: your own editable items, other vendors\' items when visible, and pending approval requests.',
    inputSchema: {
      type: 'object' as const,
      properties: { wedding_id: { type: 'string', description: 'Wedding ID' } },
      required: ['wedding_id'],
    },
  },
  {
    name: 'update_run_sheet',
    description: 'Replace your run sheet for a wedding. Items with an id update the existing row; items without an id are created; your existing items missing from the list are deleted. Array order becomes the display order.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        wedding_id: { type: 'string', description: 'Wedding ID' },
        items: {
          type: 'array',
          description: 'The full run sheet, in display order',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Existing item id (omit for new items)' },
              time: { type: 'string', description: 'Start time, e.g. "14:30"' },
              end_time: { type: 'string', description: 'End time' },
              title: { type: 'string', description: 'What happens (required)' },
              description: { type: 'string', description: 'Details' },
              location: { type: 'string', description: 'Where' },
              assigned_to: { type: 'string', description: 'Who' },
              category: { type: 'string', enum: ['getting_ready', 'ceremony', 'portraits', 'reception', 'other'] },
            },
            required: ['title'],
          },
        },
      },
      required: ['wedding_id', 'items'],
    },
  },
  {
    name: 'propose_timeline_change',
    description: 'Change wedding timeline fields (date, time, ceremony/reception/getting-ready/portrait locations and times). Applies immediately when allowed; when a managing planner or venue controls the timeline, the change is queued for their approval instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        wedding_id: { type: 'string', description: 'Wedding ID' },
        changes: {
          type: 'object',
          description: 'Field → new value. Allowed fields: date, time, duration_hours, ceremony_location, reception_location, reception_time, getting_ready_location, getting_ready_time, getting_ready_1_label, getting_ready_2_location, getting_ready_2_label, getting_ready_2_time, portrait_location, portrait_time, reception_duration_hours. Use null to clear a field.',
        },
      },
      required: ['wedding_id', 'changes'],
    },
  },
  {
    name: 'get_wedding_weather',
    description: 'Weather outlook for a wedding: sunrise, golden hour and sunset times for the day, plus the live forecast (run-up days + an hour-by-hour view once the wedding is within ~10 days). Read-only.',
    inputSchema: {
      type: 'object' as const,
      properties: { wedding_id: { type: 'string', description: 'Wedding ID' } },
      required: ['wedding_id'],
    },
  },
  {
    name: 'add_sun_times',
    description: 'Add Sunrise and Sunset markers to the wedding timeline at their real local times (point-in-time facts). Idempotent — skips any already present. Needs the wedding date + a location.',
    inputSchema: {
      type: 'object' as const,
      properties: { wedding_id: { type: 'string', description: 'Wedding ID' } },
      required: ['wedding_id'],
    },
  },
  {
    name: 'save_timeline_item',
    description: 'Add ONE timeline item (omit id) or edit one of YOUR items (with id). Granular alternative to update_run_sheet. Fields: title (required when adding), time ("14:30"), end_time, location, assigned_to (who), category (getting_ready|ceremony|portraits|reception|other), description, visibility (couple=everyone, vendors=vendors only, private=just you; default couple). Relative timing: set relative_to + relation + gap_minutes to time this item relative to another item or the sun (its clock is then computed). duration_minutes/pinned supported. You can only edit items you own.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        wedding_id: { type: 'string', description: 'Wedding ID' },
        id: { type: 'string', description: 'Existing item id to edit (omit to add a new item)' },
        title: { type: 'string', description: 'What happens (required when adding)' },
        time: { type: 'string', description: 'Absolute start time, e.g. "14:30" (ignored when relative_to is set)' },
        end_time: { type: 'string' },
        location: { type: 'string' },
        assigned_to: { type: 'string', description: 'Who is on it (name or role)' },
        category: { type: 'string', enum: ['getting_ready', 'ceremony', 'portraits', 'reception', 'other'] },
        description: { type: 'string' },
        visibility: { type: 'string', enum: ['couple', 'vendors', 'private'] },
        duration_minutes: { type: 'number', description: 'How long it runs, in minutes (0 clears it)' },
        pinned: { type: 'boolean', description: 'Fixed time that won’t shift when the timeline reflows' },
        relative_to: { type: 'string', description: 'Time this item relative to another item\'s id, OR a sun event: "sunrise", "sunset", "golden_hour". Empty string clears relative timing and uses `time`.' },
        relation: { type: 'string', enum: ['before', 'after'], description: 'Start before or after relative_to (default after)' },
        gap_minutes: { type: 'number', description: 'Minutes of gap from relative_to, e.g. 30 with relation=before + relative_to=sunset → "30 min before sunset"' },
      },
      required: ['wedding_id'],
    },
  },
  {
    name: 'remove_timeline_item',
    description: 'Delete one of YOUR timeline items by id.',
    inputSchema: {
      type: 'object' as const,
      properties: { wedding_id: { type: 'string', description: 'Wedding ID' }, id: { type: 'string', description: 'Timeline item id' } },
      required: ['wedding_id', 'id'],
    },
  },
  {
    name: 'set_timeline_item_started',
    description: 'Live mode (on the wedding day): mark a timeline item as started right now (stamps the venue-local time and drives the running-ahead/behind status), or clear it with started=false. The timeline lead can mark any item; otherwise you can mark your own.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        wedding_id: { type: 'string', description: 'Wedding ID' },
        id: { type: 'string', description: 'Timeline item id' },
        started: { type: 'boolean', description: 'true = started now (default), false = clear the recorded start' },
      },
      required: ['wedding_id', 'id'],
    },
  },
  {
    name: 'end_live_timeline',
    description: 'End live mode for the day — clears every recorded start time on the timeline. Timeline lead only.',
    inputSchema: {
      type: 'object' as const,
      properties: { wedding_id: { type: 'string', description: 'Wedding ID' } },
      required: ['wedding_id'],
    },
  },
  {
    name: 'get_wedding_vendors',
    description: 'Get the wedding team — couple, vendor members, and the couple\'s vendor list — as markdown.',
    inputSchema: {
      type: 'object' as const,
      properties: { wedding_id: { type: 'string', description: 'Wedding ID' } },
      required: ['wedding_id'],
    },
  },
  {
    name: 'get_private_notes',
    description: 'Get your private notes for a wedding (visible only to you, never to the couple or other vendors).',
    inputSchema: {
      type: 'object' as const,
      properties: { wedding_id: { type: 'string', description: 'Wedding ID' } },
      required: ['wedding_id'],
    },
  },
  {
    name: 'update_private_notes',
    description: 'Replace your private notes for a wedding (markdown).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        wedding_id: { type: 'string', description: 'Wedding ID' },
        content: { type: 'string', description: 'Full notes markdown (empty string clears)' },
      },
      required: ['wedding_id', 'content'],
    },
  },
  {
    name: 'read_wedding_notes',
    description: 'Read a wedding\'s collaborative notes for a scope: "shared" (everyone — vendors + couple), "vendors" (vendors only) or "private" (your own note). Returns markdown.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        wedding_id: { type: 'string', description: 'Wedding ID' },
        scope: { type: 'string', enum: ['shared', 'vendors', 'private'], description: 'Which note to read (default: shared)' },
      },
      required: ['wedding_id'],
    },
  },
  {
    name: 'append_wedding_note',
    description: 'Append text to the BOTTOM of a wedding note (markdown). scope: "shared", "vendors" or "private". Existing content is kept; your text is added below and synced to your files. Shared edits require manage rights (planner/venue).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        wedding_id: { type: 'string', description: 'Wedding ID' },
        scope: { type: 'string', enum: ['shared', 'vendors', 'private'], description: 'Which note to append to (default: shared)' },
        text: { type: 'string', description: 'Markdown text to add at the bottom' },
      },
      required: ['wedding_id', 'text'],
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

/** The slice of ExecutionContext we need (Hono and workers-types disagree on the full shape). */
type WaitUntilContext = { waitUntil(promise: Promise<unknown>): void }

/** Vault refresh after an MCP write — keeps files, app, and AI in step. */
async function pushVault(
  env: Bindings,
  vendor: VendorProfile,
  weddingId: string,
  ctx?: WaitUntilContext
): Promise<void> {
  const { pushAllWeddingFiles } = await import('../services/storage-push')
  const push = pushAllWeddingFiles(env, vendor, weddingId)
  if (ctx) ctx.waitUntil(push)
  else await push.catch(() => {})
}

async function vendorUserId(db: D1Database, vendorId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT user_id FROM vendor_profiles WHERE id = ?')
    .bind(vendorId)
    .first<{ user_id: string }>()
  return row?.user_id ?? null
}

/**
 * Require a string arg. Rejects non-strings (object/array/number) that would
 * otherwise coerce to "[object Object]" etc. and be persisted as garbage.
 * Treats null/undefined as the empty string so optional bodies still clear.
 */
function reqStr(v: unknown, name: string): string {
  if (v === null || v === undefined) return ''
  if (typeof v !== 'string') throw new Error(`${name} must be a string`)
  return v
}

/** Mutating tools (each pushes the vault) and AI/geocode-heavy tools — tighter budgets. */
const MCP_WRITE_TOOLS = new Set([
  'update_wedding_todo', 'update_run_sheet', 'propose_timeline_change',
  'update_private_notes', 'append_wedding_note',
])
const MCP_AI_TOOLS = new Set(['submit_enquiry'])

async function handleTool(
  db: D1Database,
  env: Bindings,
  vendor: VendorProfile,
  name: string,
  args: Record<string, unknown>,
  ctx?: WaitUntilContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'list_contacts': {
      const rows = await db
        .prepare(
          `SELECT id, first_name, last_name, email, phone,
                  partner_first_name, partner_last_name, partner_email, partner_phone,
                  status, wedding_date, wedding_location
           FROM contacts WHERE vendor_id = ? ORDER BY created_at DESC LIMIT 200`
        )
        .bind(vendor.id)
        .all()
      return { content: [{ type: 'text', text: JSON.stringify(rows.results, null, 2) }] }
    }

    case 'get_contact': {
      // contact_id is the canonical name; `id` kept as a backward-compatible fallback.
      const id = String(args.contact_id ?? args.id ?? '')
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
      if (c.partner_email) lines.push(`- **Partner email:** ${c.partner_email}`)
      if (c.partner_phone) lines.push(`- **Partner phone:** ${c.partner_phone}`)
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
      // Accept wedding_id (consistent with every other wedding-scoped tool) and
      // keep `id` as a backward-compatible fallback for older clients.
      const id = String(args.wedding_id ?? args.id ?? '')
      if (!(await vendorCanAccessWedding(db, vendor.id, id))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
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
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      const { getWeddingTodo } = await import('../db/todos')
      const todo = await getWeddingTodo(db, vendor.id, weddingId)
      if (!todo) return { content: [{ type: 'text', text: 'No checklist for this wedding' }] }
      return { content: [{ type: 'text', text: todo.content }] }
    }

    case 'update_wedding_todo': {
      const weddingId = String(args.wedding_id ?? '')
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      const content = reqStr(args.content, 'content').trim()
      await db
        .prepare(
          `INSERT INTO wedding_todos (vendor_id, wedding_id, content)
           VALUES (?, ?, ?)
           ON CONFLICT(vendor_id, wedding_id) DO UPDATE SET
             content = excluded.content,
             updated_at = datetime('now')`
        )
        .bind(vendor.id, weddingId, content)
        .run()
      await pushVault(env, vendor, weddingId, ctx)
      return { content: [{ type: 'text', text: 'Checklist updated.' }] }
    }

    case 'get_wedding_timeline': {
      const weddingId = String(args.wedding_id ?? '')
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      const wedding = await db
        .prepare('SELECT * FROM weddings WHERE id = ?')
        .bind(weddingId)
        .first()
      if (!wedding) return { content: [{ type: 'text', text: 'Wedding not found' }] }
      const { listOwnedItemsAsRows, listVisibleOtherItemRows } = await import('../db/timeline')
      const { listPendingTimelineRequests } = await import('../db/timeline-requests')
      const { timelineToMarkdown } = await import('../storage/run-sheet-md')
      const md = timelineToMarkdown({
        wedding: wedding as any,
        ownItems: await listOwnedItemsAsRows(db, weddingId, vendor.id),
        otherVendors: await listVisibleOtherItemRows(db, weddingId, vendor.id),
        pendingRequests: await listPendingTimelineRequests(db, weddingId),
      })
      // Live status (on the day): any recorded starts + the running drift, so a
      // client can show "running N behind" and drive set_timeline_item_started.
      const startedRows = await db
        .prepare("SELECT title, start_time, actual_start FROM timeline_items WHERE wedding_id = ? AND actual_start IS NOT NULL ORDER BY actual_start")
        .bind(weddingId)
        .all<{ title: string; start_time: string | null; actual_start: string }>()
        .then((r) => r.results)
      let out = md
      if (startedRows.length > 0) {
        const { hhmmToMin } = await import('../lib/timeline-solver')
        const latest = startedRows[startedRows.length - 1]
        const drift = (hhmmToMin(latest.actual_start) ?? 0) - (hhmmToMin(latest.start_time) ?? hhmmToMin(latest.actual_start) ?? 0)
        const status = drift > 0 ? `running ${drift} min behind schedule` : drift < 0 ? `running ${-drift} min ahead of schedule` : 'on schedule'
        out += `\n\n## Live status\nLIVE — ${status}.\n\nStarted:\n` +
          startedRows.map((s) => `- ${s.actual_start} ${s.title}${s.start_time ? ` (planned ${s.start_time})` : ''}`).join('\n')
      }
      // Relative timing: items anchored to another item or the sun (clock computed),
      // so a client can see + re-edit them via save_timeline_item's relative_to.
      const anchoredRows = await db
        .prepare("SELECT id, title, anchor_type, anchor_ref, anchor_offset_minutes FROM timeline_items WHERE wedding_id = ? AND anchor_type IS NOT NULL AND marker IS NULL")
        .bind(weddingId)
        .all<{ id: string; title: string; anchor_type: string; anchor_ref: string | null; anchor_offset_minutes: number }>()
        .then((r) => r.results)
      if (anchoredRows.length > 0) {
        const allTitles = await db
          .prepare('SELECT id, title FROM timeline_items WHERE wedding_id = ?')
          .bind(weddingId)
          .all<{ id: string; title: string }>()
          .then((r) => r.results)
        const titleById = new Map(allTitles.map((a) => [a.id, a.title]))
        const describe = (a: { anchor_type: string; anchor_ref: string | null; anchor_offset_minutes: number }) => {
          const mag = Math.abs(a.anchor_offset_minutes || 0)
          if (a.anchor_type === 'sun') {
            const ev = a.anchor_ref === 'golden_hour' ? 'golden hour' : a.anchor_ref ?? 'sun'
            return mag === 0 ? `at ${ev}` : `${mag} min ${a.anchor_offset_minutes < 0 ? 'before' : 'after'} ${ev}`
          }
          const refName = (a.anchor_ref && titleById.get(a.anchor_ref)) || 'another item'
          return mag === 0 ? `right ${a.anchor_type} "${refName}"` : `${mag} min ${a.anchor_type} "${refName}"`
        }
        out += `\n\n## Relative timing\nThese items are timed relative to another item or the sun (clock auto-computed):\n` +
          anchoredRows.map((a) => `- "${a.title}" (id ${a.id}): ${describe(a)}`).join('\n')
      }
      return { content: [{ type: 'text', text: out }] }
    }

    case 'update_run_sheet': {
      const weddingId = String(args.wedding_id ?? '')
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      if (!Array.isArray(args.items)) {
        throw new Error('items must be an array')
      }
      const { RUN_SHEET_CATEGORIES } = await import('../types')
      const rows = (args.items as unknown[]).map((raw, i) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new Error(`items[${i}] must be an object`)
        }
        const item = raw as Record<string, unknown>
        const title = String(item.title ?? '').trim()
        if (!title) throw new Error(`items[${i}] is missing a title`)
        const rawCategory = String(item.category ?? 'other')
        return {
          id: item.id ? String(item.id) : null,
          time: item.time ? String(item.time) : null,
          end_time: item.end_time ? String(item.end_time) : null,
          title,
          description: item.description ? String(item.description) : null,
          location: item.location ? String(item.location) : null,
          assigned_to: item.assigned_to ? String(item.assigned_to) : null,
          category: (RUN_SHEET_CATEGORIES as readonly string[]).includes(rawCategory)
            ? (rawCategory as (typeof RUN_SHEET_CATEGORIES)[number])
            : ('other' as const),
        }
      })
      const { listOwnedItemsAsRows, applyTimelineRowDiff } = await import('../db/timeline')
      const { diffRunSheetRows } = await import('../storage/run-sheet-md')
      const existing = await listOwnedItemsAsRows(db, weddingId, vendor.id)
      const diff = diffRunSheetRows(existing, rows)
      const uid = await vendorUserId(db, vendor.id)
      await applyTimelineRowDiff(db, weddingId, vendor.id, uid, diff)
      await pushVault(env, vendor, weddingId, ctx)
      return {
        content: [{
          type: 'text',
          text: `Run sheet updated: ${diff.creates.length} added, ${diff.updates.length} changed, ${diff.deletes.length} removed.`,
        }],
      }
    }

    case 'propose_timeline_change': {
      const weddingId = String(args.wedding_id ?? '')
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      const changes = args.changes as Record<string, unknown> | undefined
      if (!changes || typeof changes !== 'object') {
        throw new Error('changes must be an object of field → value')
      }
      const {
        TIMELINE_FIELDS, changedTimelineFields, summarizeTimelineChanges,
        getTimelineControl, queueTimelineChangeRequest,
      } = await import('../services/timeline-edit')
      const incoming: Record<string, string | number | null> = {}
      for (const [key, value] of Object.entries(changes)) {
        if (!(TIMELINE_FIELDS as readonly string[]).includes(key)) {
          throw new Error(`"${key}" is not a timeline field. Allowed: ${TIMELINE_FIELDS.join(', ')}`)
        }
        if (key === 'duration_hours' || key === 'reception_duration_hours') {
          if (value === null || value === '') {
            incoming[key] = null
          } else {
            const n = Number(value)
            if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a non-negative number`)
            incoming[key] = n
          }
        } else {
          incoming[key] = value === null ? null : String(value)
        }
      }
      const current = await db
        .prepare('SELECT * FROM weddings WHERE id = ?')
        .bind(weddingId)
        .first()
      if (!current) return { content: [{ type: 'text', text: 'Wedding not found' }] }
      const changed = changedTimelineFields(current as any, incoming as any)
      if (changed.length === 0) {
        return { content: [{ type: 'text', text: 'No changes — the wedding already has those values.' }] }
      }
      const userId = await vendorUserId(db, vendor.id)
      if (!userId) return { content: [{ type: 'text', text: 'Wedding not found' }] }
      const control = await getTimelineControl(db, weddingId, userId)
      const summary = summarizeTimelineChanges(current as any, incoming as any, changed)

      if (control.hasControllers && !control.isController) {
        const payload: Record<string, unknown> = {}
        for (const f of changed) payload[f] = incoming[f] ?? null
        await queueTimelineChangeRequest(db, {
          wedding: current as any,
          requestedByUserId: userId,
          requestedByLabel: vendor.business_name,
          payload,
          summary,
          controllerUserIds: control.controllerUserIds,
          queue: env.EMAIL_QUEUE,
        })
        await pushVault(env, vendor, weddingId, ctx)
        return {
          content: [{
            type: 'text',
            text: `A managing planner/venue controls this timeline — your change was sent for approval: ${summary}`,
          }],
        }
      }

      const applied: Record<string, string | number | null> = {}
      for (const f of changed) applied[f] = incoming[f] ?? null
      // Headline times are timeline sections (the source of truth): route the
      // slot fields onto the named slot rows, write date/durations directly, then
      // refresh the derived columns. (No direct column writes that projection
      // would later clobber.) applyWeddingUpdate sources each touched slot's
      // unchanged siblings from `current`, so setting one field never drops the
      // slot's existing location/label.
      const { applyWeddingUpdate } = await import('../db/timeline')
      await applyWeddingUpdate(db, weddingId, applied, userId, current as any)
      const { appendWeddingLog } = await import('../db/wedding-log')
      await appendWeddingLog(db, weddingId, userId, 'Wedding updated', summary).catch(() => {})
      const { resyncWeddingCalendars } = await import('../services/wedding-calendar')
      try {
        await resyncWeddingCalendars(db, weddingId, vendor.id)
      } catch (err) {
        console.error(`[mcp] calendar resync failed for wedding ${weddingId}:`, err)
      }
      await pushVault(env, vendor, weddingId, ctx)
      return { content: [{ type: 'text', text: `Applied: ${summary}` }] }
    }

    case 'get_wedding_weather': {
      const weddingId = String(args.wedding_id ?? '')
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      const wedding = await db.prepare('SELECT * FROM weddings WHERE id = ?').bind(weddingId).first<any>()
      if (!wedding) return { content: [{ type: 'text', text: 'Wedding not found' }] }

      const { daylightStrip } = await import('../lib/sun')
      const sun = daylightStrip({
        lat: wedding.location_lat, lng: wedding.location_lng, dateStr: wedding.date,
        location: wedding.location, city: wedding.location_city, country: wedding.location_country,
        state: wedding.location_state, fallbackTimezone: 'Australia/Sydney', locale: 'en-AU',
      })

      const lines: string[] = [
        `# Weather — ${wedding.title ?? 'wedding'}${wedding.date ? ` (${wedding.date})` : ''}${wedding.location ? ` · ${wedding.location}` : ''}`,
      ]
      if (sun && (sun.sunrise || sun.sunset || sun.goldenHourStart)) {
        lines.push('', '## Daylight')
        if (sun.sunrise) lines.push(`- Sunrise: ${sun.sunrise}`)
        if (sun.goldenHourStart) lines.push(`- Golden hour: ${sun.goldenHourStart}`)
        if (sun.sunset) lines.push(`- Sunset: ${sun.sunset}`)
        if (sun.approx) lines.push('- _(approximate — set a precise venue address for exact times)_')
      } else {
        lines.push('', '_Add the wedding date and a location to compute sun times._')
      }

      if (wedding.location_lat != null && wedding.location_lng != null && wedding.date) {
        const { getVenueForecast, wmoCondition, displayTemp } = await import('../services/weather')
        const forecast = await getVenueForecast(env, { lat: wedding.location_lat, lng: wedding.location_lng })
        const hasWeddingDay = forecast?.daily?.some((d) => d.date === wedding.date)
        if (forecast && hasWeddingDay) {
          lines.push('', '## Forecast')
          const days = forecast.daily.filter((d) => d.date <= wedding.date).slice(-3)
          for (const d of days) {
            const cond = wmoCondition(d.code, true)
            const hi = displayTemp(d.tempMax, 'c'); const lo = displayTemp(d.tempMin, 'c')
            const label = d.date === wedding.date ? 'Wedding day' : d.date
            const rain = d.precipProb != null && d.precipProb > 0 ? `, ${d.precipProb}% rain` : ''
            lines.push(`- ${label}: ${cond.icon} ${hi ? hi.value + hi.unit : '—'} / ${lo ? lo.value + lo.unit : '—'}${rain}`)
          }
          const hours = forecast.hourly.filter((h) => h.time.slice(0, 10) === wedding.date && h.hour >= 6 && h.hour <= 22)
          if (hours.length > 0) {
            lines.push('', '### On the day, hour by hour')
            for (const h of hours) {
              const cond = wmoCondition(h.code, h.isDay)
              const t2 = displayTemp(h.temp, 'c')
              lines.push(`- ${String(h.hour).padStart(2, '0')}:00 ${cond.icon} ${t2 ? t2.value + t2.unit : '—'}`)
            }
          }
        } else if (forecast) {
          lines.push('', '_Live forecast appears within ~10 days of the wedding._')
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    }

    case 'add_sun_times': {
      const weddingId = String(args.wedding_id ?? '')
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      const userId = await vendorUserId(db, vendor.id)
      if (!userId) return { content: [{ type: 'text', text: 'Wedding not found' }] }
      const { addSunMarkers } = await import('./timeline-handlers')
      const { available, created } = await addSunMarkers(db, weddingId, vendor.id, userId)
      if (!available) {
        return { content: [{ type: 'text', text: 'Add the wedding date and a location first to compute sun times.' }] }
      }
      if (created.length === 0) {
        return { content: [{ type: 'text', text: 'Sunrise and sunset are already on the timeline.' }] }
      }
      await pushVault(env, vendor, weddingId, ctx)
      return { content: [{ type: 'text', text: `Added ${created.join(' and ')} to the timeline.` }] }
    }

    case 'save_timeline_item': {
      const weddingId = String(args.wedding_id ?? '')
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      const userId = await vendorUserId(db, vendor.id)
      if (!userId) return { content: [{ type: 'text', text: 'Wedding not found' }] }
      const { getItem, createItem, updateItem, addAssignee, resolveAndMaterialize, weddingSunMinutes } = await import('../db/timeline')
      const { RUN_SHEET_CATEGORIES } = await import('../types')

      const id = args.id ? String(args.id) : null
      const catRaw = args.category != null ? String(args.category) : undefined
      const category = catRaw && (RUN_SHEET_CATEGORIES as readonly string[]).includes(catRaw) ? (catRaw as (typeof RUN_SHEET_CATEGORIES)[number]) : undefined
      const visRaw = args.visibility != null ? String(args.visibility) : undefined
      const visibility = visRaw && (['couple', 'vendors', 'private'] as const).includes(visRaw as any) ? (visRaw as 'couple' | 'vendors' | 'private') : undefined
      const str = (v: unknown) => (v != null ? String(v).trim() || null : undefined)
      const nonNegInt = (v: unknown): number | null => {
        const n = parseInt(String(v ?? ''), 10)
        return Number.isFinite(n) && n > 0 ? n : null
      }

      // Relative timing → anchor fields. `anchor` undefined = leave as-is; a value
      // (possibly all-null) = set/clear it. Sun before = negative offset; item
      // after/before carry a positive magnitude (the solver applies the sign).
      const SUN_REFS = ['sunrise', 'sunset', 'golden_hour']
      let anchor: { anchor_type: 'after' | 'before' | 'sun' | null; anchor_ref: string | null; anchor_offset_minutes: number } | undefined
      if (args.relative_to !== undefined) {
        const relTo = String(args.relative_to ?? '').trim()
        if (!relTo) {
          anchor = { anchor_type: null, anchor_ref: null, anchor_offset_minutes: 0 }
        } else {
          const relation = String(args.relation ?? 'after') === 'before' ? 'before' : 'after'
          const gap = nonNegInt(args.gap_minutes) ?? 0
          if (SUN_REFS.includes(relTo)) {
            anchor = { anchor_type: 'sun', anchor_ref: relTo, anchor_offset_minutes: relation === 'before' ? -gap : gap }
          } else {
            const ref = await getItem(db, weddingId, relTo)
            if (!ref) return { content: [{ type: 'text', text: `relative_to "${relTo}" isn't an item in this wedding (or use sunrise / sunset / golden_hour).` }] }
            if (id && relTo === id) return { content: [{ type: 'text', text: "An item can't be timed relative to itself." }] }
            anchor = { anchor_type: relation, anchor_ref: relTo, anchor_offset_minutes: gap }
          }
        }
      }
      const anchored = !!anchor && anchor.anchor_type != null
      const duration = args.duration_minutes !== undefined ? nonNegInt(args.duration_minutes) : undefined
      const pinned = args.pinned !== undefined ? (args.pinned ? 1 : 0) : undefined

      let itemId: string
      let action: string
      if (id) {
        const item = await getItem(db, weddingId, id)
        if (!item || item.owner_vendor_id !== vendor.id) {
          return { content: [{ type: 'text', text: "That item doesn't exist or isn't yours to edit." }] }
        }
        const patch: Record<string, unknown> = {}
        if (args.title != null) patch.title = String(args.title).trim()
        if (args.time !== undefined) patch.start_time = str(args.time)
        if (args.end_time !== undefined) patch.end_time = str(args.end_time)
        if (args.location !== undefined) patch.location = str(args.location)
        if (args.description !== undefined) patch.description = str(args.description)
        if (category !== undefined) patch.category = category
        if (visibility !== undefined) patch.visibility = visibility
        if (duration !== undefined) patch.duration_minutes = duration
        if (pinned !== undefined) patch.pinned = pinned
        if (anchor !== undefined) {
          patch.anchor_type = anchor.anchor_type
          patch.anchor_ref = anchor.anchor_ref
          patch.anchor_offset_minutes = anchor.anchor_offset_minutes
          if (anchored) patch.start_time = null // anchor governs the clock
        }
        if (Object.keys(patch).length > 0) await updateItem(db, weddingId, id, patch as any)
        itemId = id
        action = 'Updated'
      } else {
        const title = args.title != null ? String(args.title).trim() : ''
        if (!title) return { content: [{ type: 'text', text: 'A title is required to add a timeline item.' }] }
        const created = await createItem(db, {
          wedding_id: weddingId,
          title,
          start_time: anchored ? null : (str(args.time) ?? null),
          end_time: str(args.end_time) ?? null,
          location: str(args.location) ?? null,
          description: str(args.description) ?? null,
          category: category ?? 'other',
          visibility: visibility ?? 'couple',
          owner_vendor_id: vendor.id,
          created_by_user_id: userId,
          duration_minutes: duration ?? null,
          anchor_type: anchor?.anchor_type ?? null,
          anchor_ref: anchor?.anchor_ref ?? null,
          anchor_offset_minutes: anchor?.anchor_offset_minutes ?? 0,
          pinned: pinned ?? 0,
        })
        itemId = created.id
        action = 'Added'
      }
      // 'who' → a single label assignee (replace any existing on the item).
      if (args.assigned_to !== undefined) {
        const who = String(args.assigned_to ?? '').trim()
        await db.prepare('DELETE FROM timeline_item_assignees WHERE timeline_item_id = ?').bind(itemId).run()
        if (who) await addAssignee(db, itemId, { label: who })
      }
      await resolveAndMaterialize(db, weddingId, await weddingSunMinutes(db, weddingId))
      await pushVault(env, vendor, weddingId, ctx)
      return { content: [{ type: 'text', text: `${action} timeline item (id ${itemId}).` }] }
    }

    case 'remove_timeline_item': {
      const weddingId = String(args.wedding_id ?? '')
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      const id = String(args.id ?? '')
      const { getItem, deleteItem, resolveAndMaterialize, weddingSunMinutes } = await import('../db/timeline')
      const item = await getItem(db, weddingId, id)
      if (!item || item.owner_vendor_id !== vendor.id) {
        return { content: [{ type: 'text', text: "That item doesn't exist or isn't yours to remove." }] }
      }
      await deleteItem(db, weddingId, id)
      await resolveAndMaterialize(db, weddingId, await weddingSunMinutes(db, weddingId))
      await pushVault(env, vendor, weddingId, ctx)
      return { content: [{ type: 'text', text: `Removed "${item.title}".` }] }
    }

    case 'set_timeline_item_started': {
      const weddingId = String(args.wedding_id ?? '')
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      const id = String(args.id ?? '')
      const { getItem, setActualStart } = await import('../db/timeline')
      const item = await getItem(db, weddingId, id)
      if (!item) return { content: [{ type: 'text', text: 'Timeline item not found.' }] }
      const userId = await vendorUserId(db, vendor.id)
      const { getTimelineLead, isTimelineLead } = await import('../services/timeline-permissions')
      const lead = await getTimelineLead(db, weddingId)
      const isLead = !!userId && isTimelineLead(lead, userId)
      if (!isLead && item.owner_vendor_id !== vendor.id) {
        return { content: [{ type: 'text', text: 'Only the timeline lead can mark shared items started — you can mark your own.' }] }
      }
      const started = args.started !== false
      let stamp: string | null = null
      if (started) {
        const w = await db.prepare('SELECT location_country, location_state FROM weddings WHERE id = ?').bind(weddingId).first<{ location_country: string | null; location_state: string | null }>()
        const { resolveLocationTimezone } = await import('../lib/sun')
        const { nowTimeString } = await import('../lib/date')
        const tz = resolveLocationTimezone(w?.location_country, w?.location_state, 'Australia/Sydney')
        stamp = nowTimeString(tz)
      }
      await setActualStart(db, weddingId, id, stamp)
      return { content: [{ type: 'text', text: started ? `Marked "${item.title}" started at ${stamp}.` : `Cleared the start time on "${item.title}".` }] }
    }

    case 'end_live_timeline': {
      const weddingId = String(args.wedding_id ?? '')
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      const userId = await vendorUserId(db, vendor.id)
      const { getTimelineLead, isTimelineLead } = await import('../services/timeline-permissions')
      const lead = await getTimelineLead(db, weddingId)
      if (!userId || !isTimelineLead(lead, userId)) {
        return { content: [{ type: 'text', text: 'Only the timeline lead can end live mode.' }] }
      }
      const { clearAllActuals } = await import('../db/timeline')
      await clearAllActuals(db, weddingId)
      return { content: [{ type: 'text', text: 'Ended live mode — cleared all recorded start times.' }] }
    }

    case 'get_wedding_vendors': {
      const weddingId = String(args.wedding_id ?? '')
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      const wedding = await db
        .prepare('SELECT id, title, vendor_visibility FROM weddings WHERE id = ?')
        .bind(weddingId)
        .first<{ id: string; title: string; vendor_visibility: 'private' | 'visible' }>()
      if (!wedding) return { content: [{ type: 'text', text: 'Wedding not found' }] }
      const { exportWeddingVendorsMarkdown } = await import('../db/wedding-vendors-export')
      const md = await exportWeddingVendorsMarkdown(db, wedding, vendor.id)
      return { content: [{ type: 'text', text: md }] }
    }

    case 'get_private_notes': {
      const weddingId = String(args.wedding_id ?? '')
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      const userId = await vendorUserId(db, vendor.id)
      const row = userId
        ? await db
            .prepare('SELECT vendor_notes FROM wedding_members WHERE wedding_id = ? AND user_id = ?')
            .bind(weddingId, userId)
            .first<{ vendor_notes: string | null }>()
        : null
      return {
        content: [{ type: 'text', text: row?.vendor_notes || 'No private notes for this wedding yet.' }],
      }
    }

    case 'update_private_notes': {
      const weddingId = String(args.wedding_id ?? '')
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      const userId = await vendorUserId(db, vendor.id)
      if (!userId) return { content: [{ type: 'text', text: 'Wedding not found' }] }
      const content = reqStr(args.content, 'content').trim()
      await db
        .prepare('UPDATE wedding_members SET vendor_notes = ? WHERE wedding_id = ? AND user_id = ?')
        .bind(content || null, weddingId, userId)
        .run()
      await pushVault(env, vendor, weddingId, ctx)
      return { content: [{ type: 'text', text: content ? 'Private notes updated.' : 'Private notes cleared.' }] }
    }

    case 'read_wedding_notes': {
      const weddingId = String(args.wedding_id ?? '')
      const scope = String(args.scope ?? 'shared')
      if (!isDocScope(scope) || scope === 'couple') {
        return { content: [{ type: 'text', text: 'Invalid scope. Use shared, vendors, or private.' }] }
      }
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      const userId = await vendorUserId(db, vendor.id)
      const membership = userId ? await getMembership(db, weddingId, userId) : null
      if (!userId || !membership || !canReadDoc(membership, scope)) {
        return { content: [{ type: 'text', text: 'You don\'t have access to that note.' }] }
      }
      const { content } = await getDoc(db, weddingId, scope, userId)
      return { content: [{ type: 'text', text: content || 'No notes yet for this scope.' }] }
    }

    case 'append_wedding_note': {
      const weddingId = String(args.wedding_id ?? '')
      const scope = String(args.scope ?? 'shared')
      const text = reqStr(args.text, 'text')
      if (!isDocScope(scope) || scope === 'couple') {
        return { content: [{ type: 'text', text: 'Invalid scope. Use shared, vendors, or private.' }] }
      }
      if (!text.trim()) return { content: [{ type: 'text', text: 'Nothing to append.' }] }
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      const userId = await vendorUserId(db, vendor.id)
      const membership = userId ? await getMembership(db, weddingId, userId) : null
      if (!userId || !membership || !canWriteDoc(membership, scope)) {
        return {
          content: [{ type: 'text', text: scope === 'shared'
            ? 'Only a managing vendor (planner/venue) can edit the shared note.'
            : 'You don\'t have permission to edit that note.' }],
        }
      }
      await appendToDoc(db, weddingId, scope, userId, text)
      await pushVault(env, vendor, weddingId, ctx)
      return { content: [{ type: 'text', text: 'Appended to the ' + scope + ' note.' }] }
    }

    case 'get_wedding_log': {
      const weddingId = String(args.wedding_id ?? '')
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
      const { exportWeddingLogMarkdown } = await import('../db/wedding-log')
      const wedding = await db.prepare('SELECT title FROM weddings WHERE id = ?').bind(weddingId).first<{ title: string }>()
      const md = await exportWeddingLogMarkdown(db, weddingId, wedding?.title ?? 'Wedding')
      return { content: [{ type: 'text', text: md }] }
    }

    case 'get_wedding_credits': {
      const weddingId = String(args.wedding_id ?? '')
      if (!(await vendorCanAccessWedding(db, vendor.id, weddingId))) {
        return { content: [{ type: 'text', text: 'Wedding not found' }] }
      }
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
          `SELECT id, first_name, last_name, email, phone,
                  partner_first_name, partner_last_name, partner_email, partner_phone,
                  status, wedding_date, wedding_location
           FROM contacts
           WHERE vendor_id = ? AND (
             first_name LIKE ? OR last_name LIKE ? OR email LIKE ?
             OR partner_first_name LIKE ? OR partner_last_name LIKE ? OR partner_email LIKE ?
             OR status = ?
           )
           ORDER BY created_at DESC LIMIT 50`
        )
        .bind(vendor.id, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, q)
        .all()
      return { content: [{ type: 'text', text: JSON.stringify(rows.results, null, 2) }] }
    }

    case 'get_upcoming_events': {
      // Clamp to a sane range so a NaN/Infinity/huge/negative `days` can't feed an
      // invalid time value into the Date constructor (RangeError) or scan absurd ranges.
      const rawDays = Number(args.days ?? 30)
      const days = Number.isFinite(rawDays) ? Math.min(365, Math.max(1, Math.floor(rawDays))) : 30
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

// CORS so browser-based MCP clients / inspectors can call the endpoint and read
// the 401 WWW-Authenticate that kicks off OAuth discovery. Bearer-authed (no
// cookies), so a wildcard origin is safe.
mcp.use('/mcp', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version')
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  c.header('Access-Control-Expose-Headers', 'WWW-Authenticate')
  await next()
})
mcp.options('/mcp', (c) => c.body(null, 204))

mcp.post('/mcp', async (c) => {
  const ip = clientIp(c)
  if (await isAuthThrottled(c.env.KV, ip)) {
    return c.json(rpcError(null, -32000, 'Too many failed attempts. Try again later.'), 429)
  }

  const vendor = await authenticateMcp(c.env, c.req.header('Authorization'))
  if (!vendor) {
    if (c.req.header('Authorization')) await recordAuthFailure(c.env.KV, ip)
    // Point OAuth-capable clients at the protected-resource metadata so they can
    // start the authorization flow (RFC 9728 §5.1).
    c.header('WWW-Authenticate', `Bearer resource_metadata="${c.env.APP_URL}/.well-known/oauth-protected-resource"`)
    return c.json(rpcError(null, -32000, 'Unauthorized — connect via OAuth (wedding.computer/mcp) or use a Bearer sync token from Settings > Calendar & Sync'), 401)
  }

  const pro = await isProVendor(c.env.DB, vendor.id)
  if (!pro) {
    return c.json(rpcError(null, -32001, 'MCP access requires a Pro subscription — upgrade at wedding.computer/pricing'), 403)
  }

  // Per-vendor call budget so a valid token can't hammer D1/AI.
  if (!(await consumeRateLimit(c.env.KV, `mcp:${vendor.id}`, 120, 60))) {
    return c.json(rpcError(null, -32002, 'Rate limit exceeded — slow down.'), 429)
  }

  let body: JsonRpcRequest | JsonRpcRequest[]
  try {
    body = await c.req.json()
  } catch {
    return c.json(rpcError(null, -32700, 'Parse error'), 400)
  }

  // One JSON-RPC request per POST. Reject batches explicitly rather than silently
  // processing only the first element and dropping the rest (a data-loss footgun on
  // a write surface); modern MCP revisions removed JSON-RPC batching anyway.
  if (Array.isArray(body)) {
    return c.json(rpcError(null, -32600, 'Batch requests are not supported — send one JSON-RPC request per POST.'), 400)
  }
  const req = body
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
      // Cost-tiered budgets on top of the flat per-vendor cap: every write tool
      // re-serialises + pushes the whole wedding vault (GitHub/R2), and AI tools
      // run Workers-AI/geocode — so a valid token can't drive thousands of heavy
      // ops/hour within the generous 120/min ceiling.
      if (MCP_AI_TOOLS.has(params.name) && !(await consumeRateLimit(c.env.KV, `mcp-ai:${vendor.id}`, 10, 60))) {
        return c.json(rpcError(req.id, -32002, 'Rate limit exceeded for AI-backed tools — slow down.'), 429)
      }
      if (MCP_WRITE_TOOLS.has(params.name) && !(await consumeRateLimit(c.env.KV, `mcp-write:${vendor.id}`, 30, 60))) {
        return c.json(rpcError(req.id, -32002, 'Rate limit exceeded for write tools — slow down.'), 429)
      }
      try {
        const result = await handleTool(c.env.DB, c.env, vendor, params.name, params.arguments ?? {}, c.executionCtx)
        return c.json(rpcResult(req.id, result))
      } catch (err: any) {
        // Log the full error server-side (with context) for observability, but
        // return only a single-line, length-capped message so stack traces or DB
        // internals never leak to the client. Intentional validation messages
        // (single-line `new Error('…')`) pass through unchanged.
        console.error(`[mcp] tool '${params.name}' failed for vendor ${vendor.id}:`, err)
        let msg = typeof err?.message === 'string' && err.message
          ? err.message.split('\n')[0].slice(0, 300)
          : 'Tool execution failed'
        // Never echo storage/driver internals (schema, constraints, hostnames).
        if (/\b(D1_ERROR|SQLITE|R2|KV|fetch failed|ECONN|getaddrinfo|TypeError|ReferenceError)\b/i.test(msg)) {
          msg = 'Tool execution failed'
        }
        return c.json(rpcError(req.id, -32000, msg))
      }
    }

    case 'ping':
      return c.json(rpcResult(req.id, {}))

    default:
      return c.json(rpcError(req.id, -32601, `Method not found: ${req.method}`))
  }
})

// GET /mcp — content-negotiated. Browsers (Accept: text/html) get the human
// setup guide; MCP clients / curl get the JSON server descriptor the spec
// expects for session init.
mcp.get('/mcp', (c) => {
  if ((c.req.header('Accept') ?? '').includes('text/html')) {
    return c.html(<McpDocsPage />)
  }
  return c.json({
    name: 'wedding-computer',
    version: '1.0.0',
    description: 'Read and update your Wedding Computer contacts, weddings, run sheets, checklists, private notes, and calendar via MCP.',
    instructions: 'Authenticate with Bearer token from Settings > Calendar & Sync. Setup guide: https://wedding.computer/mcp',
  })
})

export default mcp
