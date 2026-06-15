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
import { clientIp, isAuthThrottled, recordAuthFailure, consumeRateLimit } from '../middleware/rate-limit'
import { getMembership } from '../db/weddings'
import { isDocScope, canReadDoc, canWriteDoc } from '../services/doc-permissions'
import { getDoc, appendToDoc } from '../db/wedding-docs'

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
      const id = String(args.id ?? '')
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
      const content = String(args.content ?? '').trim()
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
      return { content: [{ type: 'text', text: md }] }
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
      const rows = (args.items as Record<string, unknown>[]).map((item, i) => {
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
          incoming[key] = value === null || value === '' ? null : Number(value)
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
      // would later clobber.)
      const { applyHeadlineFieldsToTimeline, projectTimelineToWedding } = await import('../db/timeline')
      const directFields = await applyHeadlineFieldsToTimeline(db, weddingId, applied, userId)
      if (Object.keys(directFields).length > 0) {
        const { updateWedding } = await import('../db/weddings')
        await updateWedding(db, weddingId, directFields as any)
      }
      await projectTimelineToWedding(db, weddingId)
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
      const content = String(args.content ?? '').trim()
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
      const text = String(args.text ?? '')
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
  const ip = clientIp(c)
  if (await isAuthThrottled(c.env.KV, ip)) {
    return c.json(rpcError(null, -32000, 'Too many failed attempts. Try again later.'), 429)
  }

  const vendor = await authenticateMcp(c.env.DB, c.req.header('Authorization'))
  if (!vendor) {
    if (c.req.header('Authorization')) await recordAuthFailure(c.env.KV, ip)
    return c.json(rpcError(null, -32000, 'Unauthorized — use Bearer token from Settings > Calendar & Sync'), 401)
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
        const result = await handleTool(c.env.DB, c.env, vendor, params.name, params.arguments ?? {}, c.executionCtx)
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
    description: 'Read and update your Wedding Computer contacts, weddings, run sheets, checklists, private notes, and calendar via MCP.',
    instructions: 'Authenticate with Bearer token from Settings > Calendar & Sync.',
  })
})

export default mcp
