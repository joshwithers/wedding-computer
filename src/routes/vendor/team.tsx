import { Hono } from 'hono'
import type { Env } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import {
  listTeamMembers,
  getTeamMember,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
  getTeamMemberSchedule,
  listWeddingTeamAssignments,
  assignTeamMember,
  unassignTeamMember,
} from '../../db/team-members'
import { getMembership } from '../../db/weddings'
import { requireString, trimOrNull } from '../../lib/validation'
import { formatDate } from '../../lib/date'

const team = new Hono<Env>()

team.use('/app/*', requireAuth, csrf, requireVendor)

// ─── Team roster ───

team.get('/app/team', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const saved = c.req.query('saved')
  const error = c.req.query('error')

  const members = await listTeamMembers(c.env.DB, vendor.id, false)

  return c.html(
    <AppLayout title="Team" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-2xl">
        {saved && (
          <div class="bg-horizon-50 border border-horizon-600/20 text-horizon-700 text-sm font-bold rounded-xl p-3 mb-6">
            {saved === 'added' && 'Team member added.'}
            {saved === 'updated' && 'Team member updated.'}
            {saved === 'removed' && 'Team member removed.'}
          </div>
        )}
        {error && (
          <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-3 mb-6">
            {decodeURIComponent(error)}
          </div>
        )}

        {!vendor.is_agency && (
          <div class="bg-papaya-100 rounded-xl p-5 mb-6">
            <h2 class="text-sm font-bold text-gray-900 mb-1">Enable team management</h2>
            <p class="text-sm text-gray-600 mb-3">
              If you run an agency or have team members you assign to weddings, enable agency mode to manage your roster.
            </p>
            <form method="post" action="/app/team/enable-agency">
              <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
              <button
                type="submit"
                class="bg-horizon-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
              >
                Enable agency mode
              </button>
            </form>
          </div>
        )}

        {vendor.is_agency === 1 && (
          <>
            <div class="flex items-center justify-between mb-6">
              <div>
                <p class="text-sm text-gray-500">
                  {members.filter((m) => m.is_active).length} active team member{members.filter((m) => m.is_active).length !== 1 ? 's' : ''}
                </p>
              </div>
              <a
                href="/app/team/new"
                class="bg-horizon-600 text-white py-2.5 px-5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
              >
                Add member
              </a>
            </div>

            {members.length === 0 ? (
              <div class="text-center py-12">
                <p class="text-sm text-gray-500 mb-4">No team members yet. Add your first team member to start assigning them to weddings.</p>
              </div>
            ) : (
              <div class="space-y-2">
                {members.map((member) => (
                  <a
                    href={`/app/team/${member.id}`}
                    class="flex items-center gap-4 bg-white border border-papaya-300/30 rounded-xl p-4 hover:border-horizon-600/30 transition-colors"
                  >
                    <div class="w-10 h-10 bg-grapefruit-100 rounded-full flex items-center justify-center text-sm font-bold text-grapefruit-700 shrink-0">
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-bold text-gray-900 truncate">{member.name}</p>
                      <p class="text-xs text-gray-500 truncate">
                        {member.title ?? 'Team member'}
                        {member.email && ` · ${member.email}`}
                      </p>
                    </div>
                    {!member.is_active && (
                      <span class="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-1 rounded-lg">Inactive</span>
                    )}
                  </a>
                ))}
              </div>
            )}

            <div class="mt-10 pt-8 border-t border-gray-200">
              <form method="post" action="/app/team/disable-agency">
                <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                <button type="submit" class="text-sm text-gray-400 hover:text-grapefruit-600 transition-colors">
                  Disable agency mode
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  )
})

// ─── Add team member ───

team.get('/app/team/new', (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!

  return c.html(
    <AppLayout title="Add team member" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        <a href="/app/team" class="text-sm text-horizon-600 hover:text-horizon-700 mb-4 inline-block">&larr; Back to team</a>
        <form method="post" action="/app/team/new" class="space-y-4">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
          <TeamMemberForm />
          <button
            type="submit"
            class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            Add team member
          </button>
        </form>
      </div>
    </AppLayout>
  )
})

team.post('/app/team/new', async (c) => {
  const vendor = c.get('vendor')!
  const form = await c.req.formData()

  try {
    const name = requireString(form, 'name')
    await createTeamMember(c.env.DB, vendor.id, {
      name,
      email: trimOrNull(form.get('email') as string),
      phone: trimOrNull(form.get('phone') as string),
      title: trimOrNull(form.get('title') as string),
      notes: trimOrNull(form.get('notes') as string),
    })
    return c.redirect('/app/team?saved=added')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add team member'
    return c.redirect(`/app/team?error=${encodeURIComponent(message)}`)
  }
})

// ─── Edit team member ───

team.get('/app/team/:id', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const member = await getTeamMember(c.env.DB, vendor.id, c.req.param('id'))
  if (!member) return c.redirect('/app/team')

  const schedule = await getTeamMemberSchedule(c.env.DB, vendor.id, member.id)

  return c.html(
    <AppLayout title={`${member.name}`} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-xl">
        <a href="/app/team" class="text-sm text-horizon-600 hover:text-horizon-700 mb-4 inline-block">&larr; Back to team</a>
        <form method="post" action={`/app/team/${member.id}`} class="space-y-4">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
          <TeamMemberForm member={member} />
          <div class="flex items-center gap-3">
            <button
              type="submit"
              class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Save changes
            </button>
            <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" name="is_active" value="1" checked={member.is_active === 1} class="rounded" />
              Active
            </label>
          </div>
        </form>

        {schedule.length > 0 && (
          <section class="mt-8 pt-6 border-t border-gray-200">
            <h3 class="text-sm font-bold text-gray-900 mb-3">Assigned weddings</h3>
            <div class="space-y-2">
              {schedule.map((s) => (
                <a
                  href={`/app/weddings/${s.wedding_id}`}
                  class="flex items-center justify-between bg-white border border-papaya-300/30 rounded-xl p-3 hover:border-horizon-600/30 transition-colors"
                >
                  <div>
                    <p class="text-sm font-medium text-gray-900">{s.wedding_title}</p>
                    {s.role && <p class="text-xs text-gray-500">{s.role}</p>}
                  </div>
                  {s.wedding_date && (
                    <span class="text-xs text-gray-400">{formatDate(s.wedding_date)}</span>
                  )}
                </a>
              ))}
            </div>
          </section>
        )}

        <section class="mt-8 pt-6 border-t border-gray-200">
          <form method="post" action={`/app/team/${member.id}/delete`}>
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <button
              type="submit"
              class="text-sm text-grapefruit-600 hover:text-grapefruit-700 transition-colors"
              onclick="return confirm('Remove this team member? They will be unassigned from all weddings.')"
            >
              Remove team member
            </button>
          </form>
        </section>
      </div>
    </AppLayout>
  )
})

team.post('/app/team/:id', async (c) => {
  const vendor = c.get('vendor')!
  const memberId = c.req.param('id')
  const form = await c.req.formData()

  try {
    const name = requireString(form, 'name')
    await updateTeamMember(c.env.DB, vendor.id, memberId, {
      name,
      email: trimOrNull(form.get('email') as string),
      phone: trimOrNull(form.get('phone') as string),
      title: trimOrNull(form.get('title') as string),
      notes: trimOrNull(form.get('notes') as string),
      is_active: form.get('is_active') === '1' ? 1 : 0,
    })
    return c.redirect('/app/team?saved=updated')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update'
    return c.redirect(`/app/team?error=${encodeURIComponent(message)}`)
  }
})

team.post('/app/team/:id/delete', async (c) => {
  const vendor = c.get('vendor')!
  await deleteTeamMember(c.env.DB, vendor.id, c.req.param('id'))
  return c.redirect('/app/team?saved=removed')
})

// ─── Agency toggle ───

team.post('/app/team/enable-agency', async (c) => {
  const vendor = c.get('vendor')!
  const { updateVendor } = await import('../../db/vendors')
  await updateVendor(c.env.DB, vendor.id, { is_agency: 1 })
  return c.redirect('/app/team')
})

team.post('/app/team/disable-agency', async (c) => {
  const vendor = c.get('vendor')!
  const { updateVendor } = await import('../../db/vendors')
  await updateVendor(c.env.DB, vendor.id, { is_agency: 0 })
  return c.redirect('/app/team')
})

// ─── Wedding team assignments (htmx partials) ───

team.get('/app/weddings/:weddingId/team-assignments', async (c) => {
  const vendor = c.get('vendor')!
  const user = c.get('user')
  const weddingId = c.req.param('weddingId')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.text('Not a member', 403)

  const assignments = await listWeddingTeamAssignments(c.env.DB, weddingId, membership.id)
  const allMembers = await listTeamMembers(c.env.DB, vendor.id, true)
  const assignedIds = new Set(assignments.map((a) => a.team_member_id))
  const available = allMembers.filter((m) => !assignedIds.has(m.id))

  return c.html(
    <div id="team-assignments">
      {assignments.length > 0 && (
        <div class="space-y-2 mb-4">
          {assignments.map((a) => (
            <div class="flex items-center justify-between bg-white border border-papaya-300/30 rounded-xl p-3">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 bg-grapefruit-100 rounded-full flex items-center justify-center text-xs font-bold text-grapefruit-700">
                  {a.member_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-900">{a.member_name}</p>
                  <p class="text-xs text-gray-500">{a.role ?? a.member_title ?? 'Team member'}</p>
                </div>
              </div>
              <button
                hx-delete={`/app/weddings/${weddingId}/team-assignments/${a.id}`}
                hx-target="#team-assignments"
                hx-swap="outerHTML"
                class="text-xs text-gray-400 hover:text-grapefruit-600 transition-colors"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {available.length > 0 && (
        <form
          hx-post={`/app/weddings/${weddingId}/team-assignments`}
          hx-target="#team-assignments"
          hx-swap="outerHTML"
          class="flex gap-2"
        >
          <select
            name="team_member_id"
            required
            class="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          >
            <option value="">Assign team member...</option>
            {available.map((m) => (
              <option value={m.id}>
                {m.name}{m.title ? ` (${m.title})` : ''}
              </option>
            ))}
          </select>
          <input
            type="text"
            name="role"
            placeholder="Role (optional)"
            class="w-32 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          />
          <button
            type="submit"
            class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors shrink-0"
          >
            Assign
          </button>
        </form>
      )}

      {available.length === 0 && assignments.length === 0 && (
        <p class="text-sm text-gray-500">
          <a href="/app/team" class="text-horizon-600 hover:text-horizon-700">Add team members</a> to start assigning them to weddings.
        </p>
      )}
    </div>
  )
})

team.post('/app/weddings/:weddingId/team-assignments', async (c) => {
  const vendor = c.get('vendor')!
  const user = c.get('user')
  const weddingId = c.req.param('weddingId')
  const form = await c.req.formData()

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.text('Not a member', 403)

  const teamMemberId = form.get('team_member_id') as string
  const role = trimOrNull(form.get('role') as string)

  if (teamMemberId) {
    const member = await getTeamMember(c.env.DB, vendor.id, teamMemberId)
    if (!member) return c.text('Team member not found', 404)

    await assignTeamMember(c.env.DB, {
      wedding_id: weddingId,
      wedding_member_id: membership.id,
      team_member_id: teamMemberId,
      role,
    })
  }

  const assignments = await listWeddingTeamAssignments(c.env.DB, weddingId, membership.id)
  const allMembers = await listTeamMembers(c.env.DB, vendor.id, true)
  const assignedIds = new Set(assignments.map((a) => a.team_member_id))
  const available = allMembers.filter((m) => !assignedIds.has(m.id))

  return c.html(
    <div id="team-assignments">
      {assignments.length > 0 && (
        <div class="space-y-2 mb-4">
          {assignments.map((a) => (
            <div class="flex items-center justify-between bg-white border border-papaya-300/30 rounded-xl p-3">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 bg-grapefruit-100 rounded-full flex items-center justify-center text-xs font-bold text-grapefruit-700">
                  {a.member_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-900">{a.member_name}</p>
                  <p class="text-xs text-gray-500">{a.role ?? a.member_title ?? 'Team member'}</p>
                </div>
              </div>
              <button
                hx-delete={`/app/weddings/${weddingId}/team-assignments/${a.id}`}
                hx-target="#team-assignments"
                hx-swap="outerHTML"
                class="text-xs text-gray-400 hover:text-grapefruit-600 transition-colors"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <form
          hx-post={`/app/weddings/${weddingId}/team-assignments`}
          hx-target="#team-assignments"
          hx-swap="outerHTML"
          class="flex gap-2"
        >
          <select
            name="team_member_id"
            required
            class="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          >
            <option value="">Assign team member...</option>
            {available.map((m) => (
              <option value={m.id}>
                {m.name}{m.title ? ` (${m.title})` : ''}
              </option>
            ))}
          </select>
          <input
            type="text"
            name="role"
            placeholder="Role (optional)"
            class="w-32 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          />
          <button
            type="submit"
            class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors shrink-0"
          >
            Assign
          </button>
        </form>
      )}
    </div>
  )
})

team.delete('/app/weddings/:weddingId/team-assignments/:assignmentId', async (c) => {
  const vendor = c.get('vendor')!
  const user = c.get('user')
  const weddingId = c.req.param('weddingId')
  const assignmentId = c.req.param('assignmentId')

  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.text('Not a member', 403)

  await unassignTeamMember(c.env.DB, weddingId, assignmentId, vendor.id)

  const assignments = await listWeddingTeamAssignments(c.env.DB, weddingId, membership.id)
  const allMembers = await listTeamMembers(c.env.DB, vendor.id, true)
  const assignedIds = new Set(assignments.map((a) => a.team_member_id))
  const available = allMembers.filter((m) => !assignedIds.has(m.id))

  return c.html(
    <div id="team-assignments">
      {assignments.length > 0 && (
        <div class="space-y-2 mb-4">
          {assignments.map((a) => (
            <div class="flex items-center justify-between bg-white border border-papaya-300/30 rounded-xl p-3">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 bg-grapefruit-100 rounded-full flex items-center justify-center text-xs font-bold text-grapefruit-700">
                  {a.member_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-900">{a.member_name}</p>
                  <p class="text-xs text-gray-500">{a.role ?? a.member_title ?? 'Team member'}</p>
                </div>
              </div>
              <button
                hx-delete={`/app/weddings/${weddingId}/team-assignments/${a.id}`}
                hx-target="#team-assignments"
                hx-swap="outerHTML"
                class="text-xs text-gray-400 hover:text-grapefruit-600 transition-colors"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <form
          hx-post={`/app/weddings/${weddingId}/team-assignments`}
          hx-target="#team-assignments"
          hx-swap="outerHTML"
          class="flex gap-2"
        >
          <select
            name="team_member_id"
            required
            class="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          >
            <option value="">Assign team member...</option>
            {available.map((m) => (
              <option value={m.id}>
                {m.name}{m.title ? ` (${m.title})` : ''}
              </option>
            ))}
          </select>
          <input
            type="text"
            name="role"
            placeholder="Role (optional)"
            class="w-32 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
          />
          <button
            type="submit"
            class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors shrink-0"
          >
            Assign
          </button>
        </form>
      )}
    </div>
  )
})

// ─── Shared form component ───

function TeamMemberForm({ member }: { member?: { name: string; email: string | null; phone: string | null; title: string | null; notes: string | null } }) {
  return (
    <>
      <div>
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="name">Name</label>
        <input
          type="text"
          id="name"
          name="name"
          value={member?.name ?? ''}
          required
          class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
        />
      </div>
      <div>
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="title">Title / Role</label>
        <input
          type="text"
          id="title"
          name="title"
          value={member?.title ?? ''}
          placeholder="e.g. Lead photographer, Second shooter"
          class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
        />
      </div>
      <div>
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="email">Email</label>
        <input
          type="email"
          id="email"
          name="email"
          value={member?.email ?? ''}
          class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
        />
      </div>
      <div>
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="phone">Phone</label>
        <input
          type="tel"
          id="phone"
          name="phone"
          value={member?.phone ?? ''}
          class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
        />
      </div>
      <div>
        <label class="block text-sm font-bold text-gray-700 mb-1.5" for="notes">Notes</label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
        >{member?.notes ?? ''}</textarea>
      </div>
    </>
  )
}

export default team
