import { Hono } from 'hono'
import type { Env, RunSheetItem } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { weddingDisplayTitle } from '../../lib/wedding-display'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { requireString, trimOrNull } from '../../lib/validation'
import { getWedding, getMembership } from '../../db/weddings'
import { generateRunSheet } from '../../services/ai'
import { resolveSecret } from '../../services/secrets'
import {
  listRunSheetItems,
  getRunSheetItem,
  createRunSheetItem,
  updateRunSheetItem,
  deleteRunSheetItem,
  reorderRunSheetItems,
} from '../../db/run-sheet'

const runSheet = new Hono<Env>()

runSheet.use('/app/*', requireAuth, csrf, requireVendor)

const CATEGORY_CONFIG: Record<
  RunSheetItem['category'],
  { label: string; bg: string; text: string; dot: string }
> = {
  getting_ready: { label: 'Getting Ready', bg: 'bg-papaya-100', text: 'text-papaya-700', dot: 'bg-papaya-400' },
  ceremony: { label: 'Ceremony', bg: 'bg-horizon-50', text: 'text-horizon-700', dot: 'bg-horizon-500' },
  portraits: { label: 'Portraits', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  reception: { label: 'Reception', bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
  other: { label: 'Other', bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
}

function CategoryBadge({ category }: { category: RunSheetItem['category'] }) {
  const cfg = CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.other
  return (
    <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${cfg.bg} ${cfg.text}`}>
      <span class={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function ItemCard({
  item,
  weddingId,
  csrfToken,
}: {
  item: RunSheetItem
  weddingId: string
  csrfToken: string
}) {
  const timeDisplay = item.time
    ? item.end_time
      ? `${item.time} - ${item.end_time}`
      : item.time
    : null

  return (
    <div
      id={`item-${item.id}`}
      class="relative pl-8 pb-6 last:pb-0"
    >
      <div class="absolute left-[11px] top-2 bottom-0 w-px bg-papaya-300/40 last:hidden" />
      <div class={`absolute left-1.5 top-2 w-3 h-3 rounded-full border-2 border-white ${CATEGORY_CONFIG[item.category]?.dot ?? 'bg-gray-400'}`} />
      <div class="bg-white border border-papaya-300/30 rounded-2xl p-4 hover:shadow-sm transition-shadow">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              {timeDisplay && (
                <span class="text-xs font-mono font-bold text-horizon-700">{timeDisplay}</span>
              )}
              <CategoryBadge category={item.category} />
            </div>
            <h3 class="font-medium text-gray-900">{item.title}</h3>
            {item.description && (
              <p class="text-sm text-gray-500 mt-0.5">{item.description}</p>
            )}
            <div class="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
              {item.location && (
                <span class="flex items-center gap-1">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {item.location}
                </span>
              )}
              {item.assigned_to && (
                <span class="flex items-center gap-1">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  {item.assigned_to}
                </span>
              )}
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button
              type="button"
              hx-get={`/app/weddings/${weddingId}/run-sheet/${item.id}/edit`}
              hx-target={`#item-${item.id}`}
              hx-swap="outerHTML"
              class="p-1.5 text-gray-400 hover:text-horizon-600 rounded-lg hover:bg-horizon-50 transition-colors"
              aria-label="Edit"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <form
              method="post"
              action={`/app/weddings/${weddingId}/run-sheet/${item.id}/delete`}
              hx-post={`/app/weddings/${weddingId}/run-sheet/${item.id}/delete`}
              hx-target="#run-sheet-list"
              hx-swap="outerHTML"
              hx-confirm="Delete this item?"
            >
              <input type="hidden" name="_csrf" value={csrfToken} />
              <button
                type="submit"
                class="p-1.5 text-gray-400 hover:text-grapefruit-600 rounded-lg hover:bg-grapefruit-50 transition-colors"
                aria-label="Delete"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

function ItemForm({
  weddingId,
  csrfToken,
  item,
}: {
  weddingId: string
  csrfToken: string
  item?: RunSheetItem
}) {
  const isEdit = !!item
  const action = isEdit
    ? `/app/weddings/${weddingId}/run-sheet/${item.id}`
    : `/app/weddings/${weddingId}/run-sheet`

  return (
    <div id={isEdit ? `item-${item.id}` : 'add-form'} class={isEdit ? 'relative pl-8 pb-6' : ''}>
      {isEdit && (
        <>
          <div class="absolute left-[11px] top-2 bottom-0 w-px bg-papaya-300/40" />
          <div class={`absolute left-1.5 top-2 w-3 h-3 rounded-full border-2 border-white ${CATEGORY_CONFIG[item.category]?.dot ?? 'bg-gray-400'}`} />
        </>
      )}
      <form
        method="post"
        action={action}
        hx-post={action}
        hx-target={isEdit ? `#item-${item.id}` : '#run-sheet-list'}
        hx-swap={isEdit ? 'outerHTML' : 'outerHTML'}
        class="bg-white border border-papaya-300/30 rounded-2xl p-4 space-y-3"
      >
        <input type="hidden" name="_csrf" value={csrfToken} />
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">Start time</label>
            <input
              type="text"
              name="time"
              value={item?.time ?? ''}
              placeholder="2:30 PM"
              class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-horizon-500 focus:border-transparent"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">End time</label>
            <input
              type="text"
              name="end_time"
              value={item?.end_time ?? ''}
              placeholder="3:00 PM"
              class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-horizon-500 focus:border-transparent"
            />
          </div>
          <div class="col-span-2">
            <label class="block text-xs font-medium text-gray-600 mb-1">Category</label>
            <select
              name="category"
              class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-horizon-500 focus:border-transparent"
            >
              {Object.entries(CATEGORY_CONFIG).map(([value, cfg]) => (
                <option value={value} selected={item?.category === value}>
                  {cfg.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Title *</label>
          <input
            type="text"
            name="title"
            value={item?.title ?? ''}
            required
            class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-horizon-500 focus:border-transparent"
            placeholder="Bride arrives at ceremony"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Description</label>
          <input
            type="text"
            name="description"
            value={item?.description ?? ''}
            class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-horizon-500 focus:border-transparent"
            placeholder="Optional details"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">Location</label>
            <input
              type="text"
              name="location"
              value={item?.location ?? ''}
              class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-horizon-500 focus:border-transparent"
              placeholder="Chapel, garden, etc."
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">Assigned to</label>
            <input
              type="text"
              name="assigned_to"
              value={item?.assigned_to ?? ''}
              class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-horizon-500 focus:border-transparent"
              placeholder="Photographer, DJ, etc."
            />
          </div>
        </div>
        <div class="flex items-center gap-2 pt-1">
          <button
            type="submit"
            class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            {isEdit ? 'Save' : 'Add item'}
          </button>
          {isEdit ? (
            <button
              type="button"
              hx-get={`/app/weddings/${weddingId}/run-sheet/${item.id}/card`}
              hx-target={`#item-${item.id}`}
              hx-swap="outerHTML"
              class="px-4 py-2 rounded-xl text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onclick="this.closest('#add-form').classList.add('hidden')"
              class="px-4 py-2 rounded-xl text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

function RunSheetList({
  items,
  weddingId,
  csrfToken,
}: {
  items: RunSheetItem[]
  weddingId: string
  csrfToken: string
}) {
  return (
    <div id="run-sheet-list">
      {items.length === 0 ? (
        <div class="text-center py-12 bg-white border border-papaya-300/30 rounded-2xl">
          <p class="text-gray-500 text-sm mb-2">No run sheet items yet</p>
          <p class="text-xs text-gray-400">
            Add items to build the day-of timeline for this wedding.
          </p>
        </div>
      ) : (
        <div class="py-2">
          {items.map((item) => (
            <ItemCard item={item} weddingId={weddingId} csrfToken={csrfToken} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main page ───

runSheet.get('/app/weddings/:weddingId/run-sheet', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('weddingId')
  const csrfToken = c.get('csrfToken')

  const wedding = await getWedding(c.env.DB, weddingId)
  if (!wedding) return c.text('Wedding not found', 404)

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.text('Not authorised', 403)

  const items = await listRunSheetItems(c.env.DB, weddingId, vendor.id)
  const generated = c.req.query('generated')
  const error = c.req.query('error')

  return c.html(
    <AppLayout title={`Run Sheet — ${weddingDisplayTitle(wedding)}`} user={user} vendor={vendor} csrfToken={csrfToken}>
      <div class="max-w-3xl">
        {generated && (
          <div class="bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl p-3 mb-4">
            Added {generated} run-sheet item{generated === '1' ? '' : 's'} with AI. Review and tweak as needed.
          </div>
        )}
        {error && (
          <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-3 mb-4">
            {decodeURIComponent(error)}
          </div>
        )}
        <div class="mb-6">
          <p class="text-sm text-gray-500 mb-1">
            <a href={`/app/weddings/${weddingId}`} class="hover:text-gray-900">{weddingDisplayTitle(wedding)}</a> /
          </p>
          <div class="flex items-center justify-between gap-4">
            <div>
              <h1 class="text-lg font-bold text-gray-900">Run Sheet</h1>
              <p class="text-sm text-gray-500">
                {items.length} item{items.length !== 1 ? 's' : ''}
                {wedding.date ? ` for ${wedding.date}` : ''}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <form
                method="post"
                action={`/app/weddings/${weddingId}/run-sheet/generate`}
                onsubmit="var b=this.querySelector('button'); b.disabled=true; b.innerHTML='Generating…'; b.classList.add('opacity-60','cursor-wait')"
              >
                <input type="hidden" name="_csrf" value={csrfToken} />
                <button
                  type="submit"
                  class="flex items-center gap-1.5 border border-horizon-200 text-horizon-700 px-3 py-2 rounded-xl text-sm font-medium hover:bg-horizon-50 transition-colors disabled:opacity-60"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate with AI
                </button>
              </form>
              <button
                type="button"
                onclick="document.getElementById('add-form').classList.remove('hidden')"
                class="bg-horizon-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors whitespace-nowrap"
              >
                Add item
              </button>
            </div>
          </div>
        </div>

        <div id="add-form" class="hidden mb-4">
          <ItemForm weddingId={weddingId} csrfToken={csrfToken} />
        </div>

        <RunSheetList items={items} weddingId={weddingId} csrfToken={csrfToken} />
      </div>
    </AppLayout>
  )
})

// ─── htmx: edit form for a single item ───

runSheet.get('/app/weddings/:weddingId/run-sheet/:itemId/edit', async (c) => {
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('weddingId')
  const itemId = c.req.param('itemId')

  const item = await getRunSheetItem(c.env.DB, itemId, vendor.id)
  if (!item) return c.text('Not found', 404)

  return c.html(
    <ItemForm weddingId={weddingId} csrfToken={c.get('csrfToken')} item={item} />
  )
})

// ─── htmx: render a single item card (cancel edit) ───

runSheet.get('/app/weddings/:weddingId/run-sheet/:itemId/card', async (c) => {
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('weddingId')
  const itemId = c.req.param('itemId')

  const item = await getRunSheetItem(c.env.DB, itemId, vendor.id)
  if (!item) return c.text('Not found', 404)

  return c.html(
    <ItemCard item={item} weddingId={weddingId} csrfToken={c.get('csrfToken')} />
  )
})

// ─── Create ───

runSheet.post('/app/weddings/:weddingId/run-sheet', async (c) => {
  const vendor = c.get('vendor')!
  const user = c.get('user')
  const weddingId = c.req.param('weddingId')
  const csrfToken = c.get('csrfToken')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.text('Not found', 404)

  const body = await c.req.parseBody()

  try {
    const title = requireString(body.title, 'Title')
    const existing = await listRunSheetItems(c.env.DB, weddingId, vendor.id)
    const maxOrder = existing.reduce((max, i) => Math.max(max, i.sort_order), -1)

    await createRunSheetItem(c.env.DB, {
      wedding_id: weddingId,
      vendor_id: vendor.id,
      time: trimOrNull(body.time),
      end_time: trimOrNull(body.end_time),
      title,
      description: trimOrNull(body.description),
      location: trimOrNull(body.location),
      assigned_to: trimOrNull(body.assigned_to),
      category: (trimOrNull(body.category) as RunSheetItem['category']) ?? 'other',
      sort_order: maxOrder + 1,
    })
  } catch {
    // fall through and re-render
  }

  const items = await listRunSheetItems(c.env.DB, weddingId, vendor.id)

  if (c.req.header('hx-request')) {
    return c.html(<RunSheetList items={items} weddingId={weddingId} csrfToken={csrfToken} />)
  }
  return c.redirect(`/app/weddings/${weddingId}/run-sheet`)
})

// ─── Reorder ───
// NOTE: static routes (/reorder, /generate) must be registered BEFORE the
// /:itemId route below, or Hono captures "reorder"/"generate" as an item id.

runSheet.post('/app/weddings/:weddingId/run-sheet/reorder', async (c) => {
  const vendor = c.get('vendor')!
  const user = c.get('user')
  const weddingId = c.req.param('weddingId')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.json({ error: 'Not found' }, 404)

  const { ids } = await c.req.json<{ ids: string[] }>()
  if (!Array.isArray(ids)) return c.json({ error: 'ids must be an array' }, 400)

  await reorderRunSheetItems(c.env.DB, weddingId, vendor.id, ids)

  return c.json({ ok: true })
})

// ─── AI generate ───

runSheet.post('/app/weddings/:weddingId/run-sheet/generate', async (c) => {
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('weddingId')

  const wedding = await getWedding(c.env.DB, weddingId)
  if (!wedding) return c.redirect('/app/weddings')

  const membership = await getMembership(c.env.DB, weddingId, c.get('user').id)
  if (!membership) return c.redirect('/app/weddings')

  const base = `/app/weddings/${weddingId}/run-sheet`

  try {
    const anthropicKey = await resolveSecret(c.env.KV, vendor.anthropic_api_key)

    const items = await generateRunSheet(c.env.AI, {
      weddingDate: wedding.date,
      weddingTime: wedding.time,
      location: wedding.location,
      ceremonyLocation: wedding.ceremony_location,
      ceremonyType: wedding.ceremony_type,
      receptionLocation: wedding.reception_location,
      receptionTime: wedding.reception_time,
      gettingReadyLocation: wedding.getting_ready_location,
      gettingReadyTime: wedding.getting_ready_time,
      gettingReady2Location: wedding.getting_ready_2_location,
      gettingReady2Time: wedding.getting_ready_2_time,
      portraitLocation: wedding.portrait_location,
      portraitTime: wedding.portrait_time,
      durationHours: wedding.duration_hours,
      vendorCategory: vendor.category,
      vendorName: vendor.business_name,
      notes: wedding.notes,
    }, anthropicKey)

    if (items.length === 0) {
      return c.redirect(
        `${base}?error=${encodeURIComponent(
          "The AI couldn't generate a run sheet this time. Add a few wedding details (ceremony time, locations) and try again — or add your own Anthropic API key in Settings for more reliable results."
        )}`
      )
    }

    const existing = await listRunSheetItems(c.env.DB, weddingId, vendor.id)
    let sortOrder = existing.length

    for (const item of items) {
      const validCategories = ['getting_ready', 'ceremony', 'portraits', 'reception', 'other'] as const
      const category = validCategories.includes(item.category as any)
        ? item.category as typeof validCategories[number]
        : 'other'
      await createRunSheetItem(c.env.DB, {
        wedding_id: weddingId,
        vendor_id: vendor.id,
        time: item.time || null,
        end_time: item.end_time || null,
        title: item.title || 'Untitled',
        description: item.description || null,
        location: item.location || null,
        assigned_to: null,
        category,
        sort_order: sortOrder++,
      })
    }

    return c.redirect(`${base}?generated=${items.length}`)
  } catch (e: any) {
    console.error('[run-sheet] AI generation failed', e?.message ?? e)
    return c.redirect(
      `${base}?error=${encodeURIComponent('AI generation failed. Please try again in a moment.')}`
    )
  }
})

// ─── Update ───

runSheet.post('/app/weddings/:weddingId/run-sheet/:itemId', async (c) => {
  const vendor = c.get('vendor')!
  const user = c.get('user')
  const weddingId = c.req.param('weddingId')
  const itemId = c.req.param('itemId')
  const csrfToken = c.get('csrfToken')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.text('Not found', 404)

  const body = await c.req.parseBody()

  try {
    const title = requireString(body.title, 'Title')
    await updateRunSheetItem(c.env.DB, itemId, vendor.id, {
      time: trimOrNull(body.time),
      end_time: trimOrNull(body.end_time),
      title,
      description: trimOrNull(body.description),
      location: trimOrNull(body.location),
      assigned_to: trimOrNull(body.assigned_to),
      category: (trimOrNull(body.category) as RunSheetItem['category']) ?? 'other',
    })
  } catch {
    // fall through
  }

  const item = await getRunSheetItem(c.env.DB, itemId, vendor.id)
  if (!item) return c.text('Not found', 404)

  if (c.req.header('hx-request')) {
    return c.html(
      <ItemCard item={item} weddingId={weddingId} csrfToken={csrfToken} />
    )
  }
  return c.redirect(`/app/weddings/${weddingId}/run-sheet`)
})

// ─── Delete ───

runSheet.post('/app/weddings/:weddingId/run-sheet/:itemId/delete', async (c) => {
  const vendor = c.get('vendor')!
  const user = c.get('user')
  const weddingId = c.req.param('weddingId')
  const itemId = c.req.param('itemId')
  const csrfToken = c.get('csrfToken')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.text('Not found', 404)

  await deleteRunSheetItem(c.env.DB, itemId, vendor.id)

  const items = await listRunSheetItems(c.env.DB, weddingId, vendor.id)

  if (c.req.header('hx-request')) {
    return c.html(<RunSheetList items={items} weddingId={weddingId} csrfToken={csrfToken} />)
  }
  return c.redirect(`/app/weddings/${weddingId}/run-sheet`)
})

export default runSheet
