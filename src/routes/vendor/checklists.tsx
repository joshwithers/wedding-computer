import { Hono } from 'hono'
import type { Env, TodoTemplate, WeddingTodo } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { requireString } from '../../lib/validation'
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  setDefaultTemplate,
  deleteTemplate,
  getWeddingTodo,
  upsertWeddingTodo,
  updateWeddingTodoContent,
} from '../../db/todos'
import {
  parseTodoMarkdown,
  toggleTodoItem,
  addTodoItem,
  removeTodoItem,
  todoStats,
  sectionStats,
} from '../../lib/todo-parser'
import type { ParsedTodoSection } from '../../lib/todo-parser'

const checklists = new Hono<Env>()

checklists.use('/app/*', requireAuth, csrf, requireVendor)

import { pushAllWeddingFiles } from './weddings'

// ─── Template list ───

checklists.get('/app/checklists', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const templates = await listTemplates(c.env.DB, vendor.id)

  return c.html(
    <AppLayout title="Checklists" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-3xl">
        <div class="flex items-center justify-between gap-4 mb-6">
          <div>
            <p class="text-sm text-gray-500">
              Checklist templates deployed to weddings when booked.
            </p>
          </div>
          <a
            href="/app/checklists/new"
            class="bg-horizon-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors whitespace-nowrap"
          >
            New template
          </a>
        </div>

        {templates.length === 0 ? (
          <div class="text-center py-12 bg-white border border-papaya-300/30 rounded-2xl">
            <p class="text-gray-500 text-sm mb-2">No checklist templates yet</p>
            <p class="text-xs text-gray-400 mb-4">
              Create a template to automatically deploy a to-do list when weddings are booked.
            </p>
            <a
              href="/app/checklists/new"
              class="inline-block bg-horizon-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-horizon-700"
            >
              Create your first template
            </a>
          </div>
        ) : (
          <div class="space-y-3">
            {templates.map((t) => {
              const stats = todoStats(t.content)
              return (
                <a
                  href={`/app/checklists/${t.id}`}
                  class="block bg-white border border-papaya-300/30 rounded-2xl p-4 hover:shadow-sm transition-shadow"
                >
                  <div class="flex items-center justify-between">
                    <div>
                      <div class="flex items-center gap-2">
                        <h3 class="font-medium text-gray-900">{t.name}</h3>
                        {t.is_default === 1 && (
                          <span class="text-[10px] font-bold bg-horizon-50 text-horizon-700 px-2 py-0.5 rounded-full">
                            Default
                          </span>
                        )}
                      </div>
                      <p class="text-xs text-gray-500 mt-0.5">
                        {stats.total} item{stats.total !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </div>
    </AppLayout>
  )
})

// ─── New template ───

const DEFAULT_CONTENT = `## Initial Booking
- [ ] Send service contract
- [ ] Collect signed contract
- [ ] Send invoice with booking fee
- [ ] Confirm booking fee received
- [ ] Add wedding to calendar

## 3 Months Before
- [ ] Confirm ceremony details with couple
- [ ] Discuss ceremony preferences
- [ ] Share questionnaire or planning form

## 1 Month Before
- [ ] Final meeting with couple
- [ ] Confirm ceremony location and time
- [ ] Review ceremony details
- [ ] Send final invoice / balance due

## 1 Week Before
- [ ] Confirm all details with couple
- [ ] Check weather forecast
- [ ] Prepare equipment and materials
- [ ] Send day-of timeline

## Wedding Day
- [ ] Arrive at venue early
- [ ] Final check with couple
- [ ] Perform service
- [ ] Pack up equipment

## After the Wedding
- [ ] Send thank you message
- [ ] Request review or testimonial
- [ ] Send final files or deliverables
- [ ] Archive wedding records`

checklists.get('/app/checklists/new', (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!

  return c.html(
    <AppLayout title="New Checklist Template" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-3xl">
        <p class="text-sm text-gray-500 mb-1">
          <a href="/app/checklists" class="hover:text-gray-900">Checklists</a> /
        </p>
        <TemplateForm
          action="/app/checklists"
          csrfToken={c.get('csrfToken')}
          name=""
          content={DEFAULT_CONTENT}
          isDefault={false}
          isNew
        />
      </div>
    </AppLayout>
  )
})

checklists.post('/app/checklists', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()

  try {
    const name = requireString(body.name, 'Name')
    const content = String(body.content ?? '')
    const isDefault = body.is_default === '1' || body.is_default === 'on'

    const template = await createTemplate(c.env.DB, vendor.id, name, content, isDefault)
    return c.redirect(`/app/checklists/${template.id}`)
  } catch (e: any) {
    return c.redirect(`/app/checklists/new?error=${encodeURIComponent(e.message)}`)
  }
})

// ─── Edit template ───

checklists.get('/app/checklists/:id', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const templateId = c.req.param('id')

  const template = await getTemplate(c.env.DB, vendor.id, templateId)
  if (!template) return c.text('Not found', 404)

  return c.html(
    <AppLayout title={template.name} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-3xl">
        <p class="text-sm text-gray-500 mb-1">
          <a href="/app/checklists" class="hover:text-gray-900">Checklists</a> /
        </p>
        <TemplateForm
          action={`/app/checklists/${template.id}`}
          csrfToken={c.get('csrfToken')}
          name={template.name}
          content={template.content}
          isDefault={template.is_default === 1}
          templateId={template.id}
        />
      </div>
    </AppLayout>
  )
})

checklists.post('/app/checklists/:id', async (c) => {
  const vendor = c.get('vendor')!
  const templateId = c.req.param('id')
  const body = await c.req.parseBody()

  const name = String(body.name || '').trim()
  const content = String(body.content ?? '')
  const isDefault = body.is_default === '1' || body.is_default === 'on'

  if (isDefault) {
    await setDefaultTemplate(c.env.DB, vendor.id, templateId)
  }
  await updateTemplate(c.env.DB, vendor.id, templateId, {
    ...(name ? { name } : {}),
    content,
    is_default: isDefault ? 1 : 0,
  })

  return c.redirect(`/app/checklists/${templateId}?saved=1`)
})

checklists.post('/app/checklists/:id/delete', async (c) => {
  const vendor = c.get('vendor')!
  const templateId = c.req.param('id')
  await deleteTemplate(c.env.DB, vendor.id, templateId)
  return c.redirect('/app/checklists')
})

checklists.post('/app/checklists/:id/default', async (c) => {
  const vendor = c.get('vendor')!
  const templateId = c.req.param('id')
  await setDefaultTemplate(c.env.DB, vendor.id, templateId)
  return c.redirect(`/app/checklists/${templateId}`)
})

// ─── Wedding todo htmx endpoints ───

/** Deploy a template to a wedding. */
checklists.post('/app/weddings/:weddingId/todos/deploy', async (c) => {
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('weddingId')
  const body = await c.req.parseBody()
  const templateId = String(body.template_id ?? '')

  let content = ''
  if (templateId) {
    const template = await getTemplate(c.env.DB, vendor.id, templateId)
    if (template) content = template.content
  }

  const { getWedding } = await import('../../db/weddings')
  const wedding = await getWedding(c.env.DB, weddingId)
  if (!wedding) return c.text('Not found', 404)

  await upsertWeddingTodo(c.env.DB, vendor.id, weddingId, content, templateId || null)

  // Push to storage (best-effort)
  pushAllWeddingFiles(c.env, vendor, weddingId).catch(() => {})

  // Return the full updated todo section
  const todo = await getWeddingTodo(c.env.DB, vendor.id, weddingId)
  const templates = await listTemplates(c.env.DB, vendor.id)
  return c.html(
    <TodoSection
      weddingId={weddingId}
      todo={todo}
      templates={templates}
      csrfToken={c.get('csrfToken')}
    />
  )
})

/** Toggle a todo item checkbox. */
checklists.post('/app/weddings/:weddingId/todos/toggle', async (c) => {
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('weddingId')
  const body = await c.req.parseBody()
  const lineNumber = parseInt(String(body.line ?? ''), 10)
  if (isNaN(lineNumber)) return c.text('Invalid line', 400)

  const todo = await getWeddingTodo(c.env.DB, vendor.id, weddingId)
  if (!todo) return c.text('No todo list', 404)

  const updated = toggleTodoItem(todo.content, lineNumber)
  await updateWeddingTodoContent(c.env.DB, vendor.id, weddingId, updated)

  // Push to storage (best-effort)
  const { getWedding } = await import('../../db/weddings')
  const wedding = await getWedding(c.env.DB, weddingId)
  if (wedding) pushAllWeddingFiles(c.env, vendor, weddingId).catch(() => {})

  // Return updated todo section
  const refreshed = await getWeddingTodo(c.env.DB, vendor.id, weddingId)
  const templates = await listTemplates(c.env.DB, vendor.id)
  return c.html(
    <TodoSection
      weddingId={weddingId}
      todo={refreshed}
      templates={templates}
      csrfToken={c.get('csrfToken')}
    />
  )
})

/** Add a new todo item. */
checklists.post('/app/weddings/:weddingId/todos/add', async (c) => {
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('weddingId')
  const body = await c.req.parseBody()
  const text = String(body.text ?? '').trim()
  const section = String(body.section ?? '') || null

  if (!text) return c.text('Text required', 400)

  const todo = await getWeddingTodo(c.env.DB, vendor.id, weddingId)
  if (!todo) return c.text('No todo list', 404)

  const updated = addTodoItem(todo.content, text, section)
  await updateWeddingTodoContent(c.env.DB, vendor.id, weddingId, updated)

  const { getWedding } = await import('../../db/weddings')
  const wedding = await getWedding(c.env.DB, weddingId)
  if (wedding) pushAllWeddingFiles(c.env, vendor, weddingId).catch(() => {})

  const refreshed = await getWeddingTodo(c.env.DB, vendor.id, weddingId)
  const templates = await listTemplates(c.env.DB, vendor.id)
  return c.html(
    <TodoSection
      weddingId={weddingId}
      todo={refreshed}
      templates={templates}
      csrfToken={c.get('csrfToken')}
    />
  )
})

/** Remove a todo item. */
checklists.post('/app/weddings/:weddingId/todos/remove', async (c) => {
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('weddingId')
  const body = await c.req.parseBody()
  const lineNumber = parseInt(String(body.line ?? ''), 10)
  if (isNaN(lineNumber)) return c.text('Invalid line', 400)

  const todo = await getWeddingTodo(c.env.DB, vendor.id, weddingId)
  if (!todo) return c.text('No todo list', 404)

  const updated = removeTodoItem(todo.content, lineNumber)
  await updateWeddingTodoContent(c.env.DB, vendor.id, weddingId, updated)

  const { getWedding } = await import('../../db/weddings')
  const wedding = await getWedding(c.env.DB, weddingId)
  if (wedding) pushAllWeddingFiles(c.env, vendor, weddingId).catch(() => {})

  const refreshed = await getWeddingTodo(c.env.DB, vendor.id, weddingId)
  const templates = await listTemplates(c.env.DB, vendor.id)
  return c.html(
    <TodoSection
      weddingId={weddingId}
      todo={refreshed}
      templates={templates}
      csrfToken={c.get('csrfToken')}
    />
  )
})

/** Save raw markdown content. */
checklists.post('/app/weddings/:weddingId/todos/save', async (c) => {
  const vendor = c.get('vendor')!
  const weddingId = c.req.param('weddingId')
  const body = await c.req.parseBody()
  const content = String(body.content ?? '')

  await upsertWeddingTodo(c.env.DB, vendor.id, weddingId, content)

  const { getWedding } = await import('../../db/weddings')
  const wedding = await getWedding(c.env.DB, weddingId)
  if (wedding) pushAllWeddingFiles(c.env, vendor, weddingId).catch(() => {})

  const refreshed = await getWeddingTodo(c.env.DB, vendor.id, weddingId)
  const templates = await listTemplates(c.env.DB, vendor.id)
  return c.html(
    <TodoSection
      weddingId={weddingId}
      todo={refreshed}
      templates={templates}
      csrfToken={c.get('csrfToken')}
    />
  )
})

// ─── Template form component ───

const TemplateForm = ({
  action,
  csrfToken,
  name,
  content,
  isDefault,
  templateId,
  isNew,
}: {
  action: string
  csrfToken: string
  name: string
  content: string
  isDefault: boolean
  templateId?: string
  isNew?: boolean
}) => {
  const sections = parseTodoMarkdown(content)
  const stats = todoStats(content)

  return (
    <div>
      <form method="post" action={action} class="space-y-6">
        <input type="hidden" name="_csrf" value={csrfToken} />

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Template name</label>
          <input
            type="text"
            name="name"
            value={name}
            required
            placeholder="e.g. Default Checklist"
            class="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          />
        </div>

        <div class="flex items-center gap-3">
          <input
            type="checkbox"
            name="is_default"
            value="1"
            checked={isDefault}
            id="is_default"
            class="rounded border-gray-300 text-horizon-600 focus:ring-horizon-500"
          />
          <label for="is_default" class="text-sm text-gray-700">
            Deploy automatically when a new wedding is created
          </label>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="block text-sm font-medium text-gray-700">Checklist content</label>
            <span class="text-xs text-gray-400">{stats.total} items</span>
          </div>
          <p class="text-xs text-gray-400 mb-2">
            Use markdown task lists: <code class="bg-gray-100 px-1 rounded">- [ ] item</code> and
            {' '}<code class="bg-gray-100 px-1 rounded">## Section</code> headings
          </p>
          <textarea
            name="content"
            rows={20}
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          >{content}</textarea>
        </div>

        {/* Preview */}
        {sections.length > 0 && (
          <div>
            <h3 class="text-sm font-medium text-gray-700 mb-2">Preview</h3>
            <div class="bg-white border border-papaya-300/30 rounded-2xl p-4">
              <TodoPreview sections={sections} />
            </div>
          </div>
        )}

        <div class="flex items-center gap-3">
          <button
            type="submit"
            class="bg-horizon-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            {isNew ? 'Create template' : 'Save template'}
          </button>
          <a href="/app/checklists" class="text-sm text-gray-500 hover:text-gray-700">
            Cancel
          </a>
          {templateId && (
            <form method="post" action={`/app/checklists/${templateId}/delete`} class="ml-auto">
              <input type="hidden" name="_csrf" value={csrfToken} />
              <button
                type="submit"
                onclick="return confirm('Delete this template?')"
                class="text-sm text-red-500 hover:text-red-700"
              >
                Delete
              </button>
            </form>
          )}
        </div>
      </form>
    </div>
  )
}

// ─── Todo preview (read-only, used in template editor) ───

const TodoPreview = ({ sections }: { sections: ParsedTodoSection[] }) => (
  <div class="space-y-4">
    {sections.map((section) => {
      const stats = sectionStats(section)
      return (
        <div>
          {section.heading && (
            <div class="flex items-center justify-between mb-1.5">
              <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wide">
                {section.heading}
              </h4>
              <span class="text-xs text-gray-400">
                {stats.checked}/{stats.total}
              </span>
            </div>
          )}
          <div class="space-y-1">
            {section.items.map((item) => (
              <div
                class={`flex items-start gap-2 text-sm ${item.indent > 0 ? `pl-${item.indent * 4}` : ''}`}
              >
                <span class={`mt-0.5 ${item.checked ? 'text-horizon-600' : 'text-gray-300'}`}>
                  {item.checked ? '☑' : '☐'}
                </span>
                <span class={item.checked ? 'text-gray-400 line-through' : 'text-gray-700'}>
                  {item.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )
    })}
  </div>
)

// ─── Interactive todo section (used on wedding detail page) ───

export const TodoSection = ({
  weddingId,
  todo,
  templates,
  csrfToken,
}: {
  weddingId: string
  todo: WeddingTodo | null
  templates: TodoTemplate[]
  csrfToken: string
}) => {
  if (!todo) {
    // No todo list yet — show deploy options
    return (
      <div id="wedding-todos" class="mt-6">
        <h3 class="text-sm font-bold text-gray-500 mb-3">Checklist</h3>
        <div class="bg-white border border-papaya-300/30 rounded-2xl p-6 text-center">
          <p class="text-sm text-gray-500 mb-4">No checklist for this wedding yet</p>
          {templates.length > 0 ? (
            <form
              hx-post={`/app/weddings/${weddingId}/todos/deploy`}
              hx-target="#wedding-todos"
              hx-swap="outerHTML"
              class="flex items-center justify-center gap-2"
            >
              <input type="hidden" name="_csrf" value={csrfToken} />
              <select
                name="template_id"
                class="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600"
              >
                {templates.map((t) => (
                  <option value={t.id} selected={t.is_default === 1}>
                    {t.name}{t.is_default === 1 ? ' (default)' : ''}
                  </option>
                ))}
                <option value="">Start blank</option>
              </select>
              <button
                type="submit"
                class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
              >
                Deploy
              </button>
            </form>
          ) : (
            <div class="flex items-center justify-center gap-3">
              <a
                href="/app/checklists/new"
                class="inline-flex items-center bg-horizon-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
              >
                Create a template
              </a>
              <span class="text-xs text-gray-400">or</span>
              <form
                hx-post={`/app/weddings/${weddingId}/todos/deploy`}
                hx-target="#wedding-todos"
                hx-swap="outerHTML"
                class="inline-flex"
              >
                <input type="hidden" name="_csrf" value={csrfToken} />
                <input type="hidden" name="template_id" value="" />
                <button
                  type="submit"
                  class="inline-flex items-center border border-gray-200 px-4 py-2 rounded-xl text-sm font-medium hover:bg-papaya-50 transition-colors"
                >
                  Start blank
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    )
  }

  const sections = parseTodoMarkdown(todo.content)
  const stats = todoStats(todo.content)
  const progress = stats.total > 0 ? Math.round((stats.checked / stats.total) * 100) : 0

  return (
    <div id="wedding-todos" class="mt-6">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-bold text-gray-500">Checklist</h3>
        <div class="flex items-center gap-3">
          <span class="text-xs text-gray-400">
            {stats.checked} of {stats.total} done
          </span>
          {stats.total > 0 && (
            <div class="w-24 bg-gray-100 rounded-full h-1.5">
              <div
                class={`h-1.5 rounded-full transition-all ${progress === 100 ? 'bg-green-500' : 'bg-horizon-600'}`}
                style={`width: ${progress}%`}
              />
            </div>
          )}
        </div>
      </div>

      <div class="bg-white border border-papaya-300/30 rounded-2xl p-4">
        {sections.length === 0 && !todo.content.trim() ? (
          <p class="text-sm text-gray-400 text-center py-4">Empty checklist — add items below or edit the markdown</p>
        ) : (
          <div class="space-y-5">
            {sections.map((section) => {
              const ss = sectionStats(section)
              return (
                <div>
                  {section.heading && (
                    <div class="flex items-center justify-between mb-2">
                      <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wide">
                        {section.heading}
                      </h4>
                      <span class="text-xs text-gray-400">{ss.checked}/{ss.total}</span>
                    </div>
                  )}
                  <div class="space-y-0.5">
                    {section.items.map((item) => (
                      <div
                        class={`group flex items-start gap-2 py-1 ${item.indent > 0 ? 'ml-5' : ''}`}
                      >
                        <button
                          type="button"
                          hx-post={`/app/weddings/${weddingId}/todos/toggle`}
                          hx-vals={JSON.stringify({ line: item.line, _csrf: csrfToken })}
                          hx-target="#wedding-todos"
                          hx-swap="outerHTML"
                          class={`mt-0.5 text-lg leading-none cursor-pointer hover:opacity-70 transition-opacity ${item.checked ? 'text-horizon-600' : 'text-gray-300 hover:text-gray-400'}`}
                        >
                          {item.checked ? '☑' : '☐'}
                        </button>
                        <span class={`text-sm flex-1 ${item.checked ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                          {item.text}
                        </span>
                        <button
                          type="button"
                          hx-post={`/app/weddings/${weddingId}/todos/remove`}
                          hx-vals={JSON.stringify({ line: item.line, _csrf: csrfToken })}
                          hx-target="#wedding-todos"
                          hx-swap="outerHTML"
                          hx-confirm="Remove this item?"
                          class="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all text-xs"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add item to this section */}
                  <form
                    hx-post={`/app/weddings/${weddingId}/todos/add`}
                    hx-target="#wedding-todos"
                    hx-swap="outerHTML"
                    class="group/add flex items-center gap-2 mt-1.5 pl-6"
                  >
                    <input type="hidden" name="_csrf" value={csrfToken} />
                    <input type="hidden" name="section" value={section.heading ?? ''} />
                    <input
                      type="text"
                      name="text"
                      placeholder="Add item..."
                      class="flex-1 border-0 border-b border-transparent focus:border-gray-200 px-0 py-1 text-sm text-gray-500 placeholder-gray-300 focus:outline-none focus:ring-0 bg-transparent"
                    />
                    <button
                      type="submit"
                      class="text-xs text-horizon-600 hover:text-horizon-700 font-medium opacity-0 group-focus-within/add:opacity-100"
                    >
                      Add
                    </button>
                  </form>
                </div>
              )
            })}
          </div>
        )}

        {/* Add item (when no sections) */}
        {sections.length === 0 && (
          <form
            hx-post={`/app/weddings/${weddingId}/todos/add`}
            hx-target="#wedding-todos"
            hx-swap="outerHTML"
            class="flex items-center gap-2 mt-2"
          >
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input type="hidden" name="section" value="" />
            <input
              type="text"
              name="text"
              placeholder="Add an item..."
              class="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600"
            />
            <button
              type="submit"
              class="bg-horizon-600 text-white px-3 py-2 rounded-lg text-xs font-bold hover:bg-horizon-700"
            >
              Add
            </button>
          </form>
        )}

        {/* Markdown editor toggle */}
        <details class="mt-4 border-t border-gray-100 pt-3">
          <summary class="text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none">
            Edit raw markdown
          </summary>
          <form
            hx-post={`/app/weddings/${weddingId}/todos/save`}
            hx-target="#wedding-todos"
            hx-swap="outerHTML"
            class="mt-2 space-y-2"
          >
            <input type="hidden" name="_csrf" value={csrfToken} />
            <textarea
              name="content"
              rows={12}
              class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-horizon-600"
            >{todo.content}</textarea>
            <div class="flex items-center gap-2">
              <button
                type="submit"
                class="bg-horizon-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-horizon-700"
              >
                Save
              </button>
              <span class="text-xs text-gray-400">
                Uses markdown task lists: <code class="bg-gray-100 px-1 rounded">- [ ] item</code>
              </span>
            </div>
          </form>
        </details>

        {/* Re-deploy template */}
        {templates.length > 0 && (
          <details class="mt-2 border-t border-gray-100 pt-3">
            <summary class="text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none">
              Replace with a template
            </summary>
            <form
              hx-post={`/app/weddings/${weddingId}/todos/deploy`}
              hx-target="#wedding-todos"
              hx-swap="outerHTML"
              hx-confirm="This will replace the current checklist. Continue?"
              class="mt-2 flex items-center gap-2"
            >
              <input type="hidden" name="_csrf" value={csrfToken} />
              <select
                name="template_id"
                class="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600"
              >
                {templates.map((t) => (
                  <option value={t.id}>
                    {t.name}{t.is_default === 1 ? ' (default)' : ''}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                class="border border-gray-200 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-papaya-50"
              >
                Replace
              </button>
            </form>
          </details>
        )}
      </div>
    </div>
  )
}

export default checklists
