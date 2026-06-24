// Couples community routes (/community/*). Couples and vendors both use it, so
// the guard is requireAuth + csrf (NOT requireVendor). Rooms are keyed by
// (country · season · year); the state/province is an in-room filter. Posts are
// markdown stored in D1 and rendered client-side. See db/community.ts +
// views/community.tsx, and lib/season.ts + lib/region.ts for cohort derivation.

import { Hono } from 'hono'
import type { Env, Season } from '../types'
import { requireAuth } from '../middleware/auth'
import { csrf } from '../middleware/csrf'
import { consumeRateLimit } from '../middleware/rate-limit'
import { t } from '../i18n'
import { resolveRegion } from '../lib/region'
import { cohortForWedding } from '../lib/season'
import { getFirstCoupleWedding, getMembership as getWeddingMembership, getWedding } from '../db/weddings'
import { getVendorByUserId } from '../db/vendors'
import { contentToken } from '../db/wedding-docs'
import {
  getOrCreateCohort,
  getCohortByKey,
  getCohortById,
  getMembership,
  listUserCohorts,
  joinCohort,
  leaveCohort,
  listThreads,
  listSubdivisions,
  getThread,
  createThread,
  listPosts,
  getPost,
  addReply,
  editOwnPost,
  deleteOwnPost,
  createReport,
  type AuthorSnapshot,
  type CommunityMember,
} from '../db/community'
import {
  CommunityHub,
  CommunityRoom,
  CommunityThreadView,
  RoomBody,
  PostItem,
  PostEditForm,
  type JoinCardData,
  type VendorJoinData,
} from '../views/community'
import { buildCoupleJoinCard, canUseCommunityPost } from '../services/community'

const community = new Hono<Env>()

community.use('/community', requireAuth, csrf)
community.use('/community/*', requireAuth, csrf)

function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0]
  return first || name.trim() || 'Guest'
}

/** Vendor badge snapshot for a user who helps in the community (else couple). */
async function communityIdentity(c: { env: { DB: D1Database } }, userId: string) {
  const vendor = await getVendorByUserId(c.env.DB, userId).catch(() => null)
  if (vendor) {
    return {
      role: 'vendor' as const,
      vendorProfileId: vendor.id,
      vendorBusinessName: vendor.business_name,
      vendorTypeLabel: null as string | null,
      vendorDirectoryListed: vendor.directory_listed === 1,
    }
  }
  return {
    role: 'couple' as const,
    vendorProfileId: null,
    vendorBusinessName: null,
    vendorTypeLabel: null as string | null,
    vendorDirectoryListed: false,
  }
}

function authorFromMember(userId: string, member: CommunityMember): AuthorSnapshot {
  return {
    userId,
    memberId: member.id,
    displayName: member.display_name,
    role: member.role,
    vendorBusinessName: member.vendor_business_name,
    vendorTypeLabel: member.vendor_type_label,
    vendorProfileId: member.vendor_profile_id,
  }
}

// ─── Hub ───

community.get('/community', async (c) => {
  const user = c.get('user')
  const cohorts = await listUserCohorts(c.env.DB, user.id)

  // Couples get a join card; a member already sees the room in their list.
  let joinCard: JoinCardData | null = null
  const couple = await getFirstCoupleWedding(c.env.DB, user.id)
  if (couple) {
    const wedding = await getWedding(c.env.DB, couple.wedding_id)
    if (wedding) {
      const card = await buildCoupleJoinCard(c.env.DB, user, wedding)
      joinCard = card && card.mode === 'member' ? null : card
    }
  }

  // Vendors get an explicit country + season + year picker to join any room.
  let vendorJoin: VendorJoinData | null = null
  const vendor = await getVendorByUserId(c.env.DB, user.id).catch(() => null)
  if (vendor) {
    const currentYear = new Date().getFullYear()
    vendorJoin = {
      businessName: vendor.business_name,
      years: [currentYear - 1, currentYear, currentYear + 1, currentYear + 2, currentYear + 3],
      defaultYear: currentYear + 1,
    }
  }

  return c.html(
    <CommunityHub
      user={user}
      csrfToken={c.get('csrfToken')}
      cohorts={cohorts}
      joinCard={joinCard}
      vendorJoin={vendorJoin}
    />
  )
})

// ─── Join / leave ───

community.post('/community/join', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const cohortKeyIn = String(body.cohort_key ?? '').trim()
  const weddingId = String(body.wedding_id ?? '').trim()

  if (!(await consumeRateLimit(c.env.KV, `community:join:${user.id}`, 10, 3600))) {
    return c.redirect('/community')
  }

  // Vendor picking a room explicitly from the hub form (country + season + year).
  if (String(body.vendor_join ?? '') === '1') {
    const vendor = await getVendorByUserId(c.env.DB, user.id).catch(() => null)
    if (!vendor) return c.redirect('/community')

    const countryIn = String(body.country ?? '').trim()
    const seasonIn = String(body.season ?? '').trim()
    const yearIn = parseInt(String(body.year ?? ''), 10)
    const VALID_SEASONS: Season[] = ['summer', 'autumn', 'winter', 'spring']

    if (!countryIn || !VALID_SEASONS.includes(seasonIn as Season) || !yearIn || yearIn < 2020 || yearIn > 2040) {
      return c.redirect('/community')
    }

    const region = resolveRegion({ country: countryIn })
    if (!region.countryCode) return c.redirect('/community')

    const season = seasonIn as Season
    const cohortKey = `${yearIn}-${season}-${region.countryCode}`
    const cohortRow = await getOrCreateCohort(c.env.DB, {
      year: yearIn,
      season,
      countryCode: region.countryCode,
      countryName: region.countryName,
      cohortKey,
    })

    const displayName =
      String(body.display_name ?? '').trim().slice(0, 40) || vendor.business_name || firstName(user.name)

    await joinCohort(c.env.DB, {
      cohortId: cohortRow.id,
      userId: user.id,
      role: 'vendor',
      displayName,
      subdivisionCode: null,
      subdivisionLabel: null,
      weddingId: null,
      vendorProfileId: vendor.id,
      vendorBusinessName: vendor.business_name,
      vendorTypeLabel: null,
      vendorDirectoryListed: vendor.directory_listed === 1,
    })
    return c.redirect(`/community/c/${cohortKey}`)
  }

  // Quick-join an existing room from its "join to post" banner.
  if (cohortKeyIn) {
    const cohort = await getCohortByKey(c.env.DB, cohortKeyIn)
    if (!cohort) return c.redirect('/community')
    const id = await communityIdentity(c, user.id)
    await joinCohort(c.env.DB, {
      cohortId: cohort.id,
      userId: user.id,
      role: id.role,
      displayName: firstName(user.name),
      subdivisionCode: null,
      subdivisionLabel: null,
      weddingId: null,
      vendorProfileId: id.vendorProfileId,
      vendorBusinessName: id.vendorBusinessName,
      vendorTypeLabel: id.vendorTypeLabel,
      vendorDirectoryListed: id.vendorDirectoryListed,
    })
    return c.redirect(`/community/c/${cohort.cohort_key}`)
  }

  // Couple join from their wedding: date comes from the wedding, place is the
  // form's country/state (defaulting to the wedding's), corrected if needed.
  if (!weddingId) return c.redirect('/community')
  const membership = await getWeddingMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.redirect('/community')
  const wedding = await getWedding(c.env.DB, weddingId)
  if (!wedding) return c.redirect('/community')
  if (!wedding.date) return c.redirect(`/wedding/${weddingId}/edit`)

  const countryIn = String(body.country ?? '').trim() || wedding.location_country || ''
  const stateIn = body.state != null ? String(body.state).trim() : wedding.location_state || ''
  const region = resolveRegion({ country: countryIn, state: stateIn, lat: wedding.location_lat, locale: user.locale })
  const cohort = cohortForWedding(wedding.date, region)
  if (!cohort) return c.redirect(`/wedding/${weddingId}`)

  const displayName = String(body.display_name ?? '').trim().slice(0, 40) || firstName(user.name)
  const cohortRow = await getOrCreateCohort(c.env.DB, {
    year: cohort.year,
    season: cohort.season,
    countryCode: region.countryCode,
    countryName: region.countryName,
    cohortKey: cohort.cohortKey,
  })
  await joinCohort(c.env.DB, {
    cohortId: cohortRow.id,
    userId: user.id,
    role: 'couple',
    displayName,
    subdivisionCode: region.subdivisionCode,
    subdivisionLabel: region.subdivisionLabel,
    weddingId,
  })
  return c.redirect(`/community/c/${cohort.cohortKey}`)
})

community.post('/community/leave/:cohortId', async (c) => {
  const user = c.get('user')
  await leaveCohort(c.env.DB, c.req.param('cohortId'), user.id)
  return c.redirect('/community')
})

// ─── Room ───

async function loadActiveMember(
  c: { env: { DB: D1Database } },
  cohortId: string,
  userId: string
): Promise<CommunityMember | null> {
  const member = await getMembership(c.env.DB, cohortId, userId)
  return member && member.status === 'active' ? member : null
}

community.get('/community/c/:cohortKey', async (c) => {
  const user = c.get('user')
  const cohort = await getCohortByKey(c.env.DB, c.req.param('cohortKey'))
  if (!cohort) return c.redirect('/community')

  const member = await loadActiveMember(c, cohort.id, user.id)
  const subdivisions = await listSubdivisions(c.env.DB, cohort.id)
  const stateParam = c.req.query('state') || null
  const activeState = stateParam ? subdivisions.find((s) => s.code === stateParam) ?? null : null
  const threads = await listThreads(c.env.DB, cohort.id, { subdivisionCode: activeState?.code })

  return c.html(
    <CommunityRoom
      user={user}
      csrfToken={c.get('csrfToken')}
      cohort={cohort}
      member={member}
      threads={threads}
      subdivisions={subdivisions}
      activeState={activeState}
    />
  )
})

community.post('/community/c/:cohortKey/threads', async (c) => {
  const user = c.get('user')
  const cohort = await getCohortByKey(c.env.DB, c.req.param('cohortKey'))
  if (!cohort) return c.redirect('/community')
  const member = await loadActiveMember(c, cohort.id, user.id)

  const body = await c.req.parseBody()
  const title = String(body.title ?? '').trim().slice(0, 140)
  const text = String(body.body ?? '').trim()

  const respond = (error?: string) =>
    listThreads(c.env.DB, cohort.id).then((threads) =>
      c.html(
        <RoomBody
          cohort={cohort}
          isMember={!!member}
          csrfToken={c.get('csrfToken')}
          threads={threads}
          activeState={null}
          error={error}
          draftTitle={error ? title : undefined}
          draftBody={error ? text : undefined}
        />
      )
    )

  if (!member) return respond(t('community.error.notMember'))
  if (!(await consumeRateLimit(c.env.KV, `community:thread:${user.id}`, 5, 3600))) return respond(t('community.rateLimited'))
  if (!title) return respond(t('community.error.titleRequired'))
  if (!text) return respond(t('community.error.bodyRequired'))

  await createThread(c.env.DB, {
    cohort,
    author: authorFromMember(user.id, member),
    title,
    body: text,
    subdivisionCode: member.subdivision_code,
    subdivisionLabel: member.subdivision_label,
  })
  return respond()
})

// ─── Thread + posts ───

community.get('/community/t/:threadId', async (c) => {
  const user = c.get('user')
  const thread = await getThread(c.env.DB, c.req.param('threadId'))
  if (!thread || thread.is_removed === 1) return c.redirect('/community')
  const cohort = await getCohortById(c.env.DB, thread.cohort_id)
  if (!cohort) return c.redirect('/community')
  const member = await loadActiveMember(c, cohort.id, user.id)
  const posts = await listPosts(c.env.DB, thread.id)

  return c.html(
    <CommunityThreadView
      user={user}
      csrfToken={c.get('csrfToken')}
      cohort={cohort}
      thread={thread}
      posts={posts}
      isMember={!!member}
      currentUserId={user.id}
    />
  )
})

community.post('/community/t/:threadId/replies', async (c) => {
  const user = c.get('user')
  const thread = await getThread(c.env.DB, c.req.param('threadId'))
  if (!thread || thread.is_removed === 1 || thread.is_locked === 1) return c.text('', 403)
  const member = await loadActiveMember(c, thread.cohort_id, user.id)
  if (!member) return c.text('', 403)
  if (!(await consumeRateLimit(c.env.KV, `community:reply:${user.id}`, 30, 3600))) return c.text('', 429)

  const body = await c.req.parseBody()
  const text = String(body.body ?? '').trim()
  if (!text) return c.text('', 400)

  const post = await addReply(c.env.DB, { thread, author: authorFromMember(user.id, member), body: text })
  return c.html(<PostItem post={post} canEdit={true} canReport={false} csrfToken={c.get('csrfToken')} />)
})

// Re-render a single post (used by the edit form's Cancel).
community.get('/community/p/:postId', async (c) => {
  const user = c.get('user')
  const post = await getPost(c.env.DB, c.req.param('postId'))
  if (!post || post.is_removed === 1) return c.text('', 404)
  const member = await loadActiveMember(c, post.cohort_id, user.id)
  if (!canUseCommunityPost(user.id, member, post, 'view')) return c.text('', 403)
  return c.html(
    <PostItem
      post={post}
      canEdit={post.author_user_id === user.id}
      canReport={post.author_user_id !== user.id}
      csrfToken={c.get('csrfToken')}
    />
  )
})

community.get('/community/p/:postId/edit', async (c) => {
  const user = c.get('user')
  const post = await getPost(c.env.DB, c.req.param('postId'))
  if (!post || post.is_removed === 1) return c.text('', 404)
  const member = await loadActiveMember(c, post.cohort_id, user.id)
  if (!canUseCommunityPost(user.id, member, post, 'edit')) return c.text('', 403)
  return c.html(<PostEditForm post={post} token={contentToken(post.body)} csrfToken={c.get('csrfToken')} />)
})

community.post('/community/p/:postId/edit', async (c) => {
  const user = c.get('user')
  const postId = c.req.param('postId')
  const body = await c.req.parseBody()
  const text = String(body.body ?? '').trim()
  const token = String(body.token ?? '')

  const existing = await getPost(c.env.DB, postId)
  if (!existing || existing.is_removed === 1) return c.text('', 404)
  const member = await loadActiveMember(c, existing.cohort_id, user.id)
  if (!canUseCommunityPost(user.id, member, existing, 'edit')) return c.text('', 403)
  if (!text) return c.text('', 400)

  const result = await editOwnPost(c.env.DB, postId, user.id, text, token)
  if (!result) return c.text('', 403)

  const post = await getPost(c.env.DB, postId)
  if (!post) return c.text('', 404)

  if (!result.ok) {
    // Conflict: re-show the editor with the latest content + a notice.
    return c.html(
      <PostEditForm
        post={{ ...post, body: result.content }}
        token={result.token}
        notice={t('community.post.conflict')}
        csrfToken={c.get('csrfToken')}
      />
    )
  }
  return c.html(<PostItem post={post} canEdit={true} canReport={false} csrfToken={c.get('csrfToken')} />)
})

community.post('/community/p/:postId/delete', async (c) => {
  const user = c.get('user')
  const post = await getPost(c.env.DB, c.req.param('postId'))
  if (!post || post.is_removed === 1) return c.text('', 404)
  const member = await loadActiveMember(c, post.cohort_id, user.id)
  if (!canUseCommunityPost(user.id, member, post, 'delete')) return c.text('', 403)

  const result = await deleteOwnPost(c.env.DB, post.id, user.id)
  if (!result) return c.text('', 403)

  if (result.deleted === 'thread') {
    const cohort = await getCohortById(c.env.DB, post.cohort_id)
    c.header('HX-Redirect', cohort ? `/community/c/${cohort.cohort_key}` : '/community')
    return c.body(null)
  }
  return c.html('') // reply removed — outerHTML swap with empty deletes the node
})

community.post('/community/p/:postId/report', async (c) => {
  const user = c.get('user')
  const post = await getPost(c.env.DB, c.req.param('postId'))
  if (!post || post.is_removed === 1) return c.text('', 404)
  const member = await loadActiveMember(c, post.cohort_id, user.id)
  if (!canUseCommunityPost(user.id, member, post, 'report')) return c.text('', 403)
  if (!(await consumeRateLimit(c.env.KV, `community:report:${user.id}`, 20, 3600))) {
    return c.html(<span class="text-[11px] text-gray-400">{t('community.rateLimited')}</span>)
  }
  const reasonRaw = String((await c.req.parseBody()).reason ?? 'other')
  const allowed = ['spam', 'harassment', 'inappropriate', 'other']
  const reason = (allowed.includes(reasonRaw) ? reasonRaw : 'other') as
    | 'spam'
    | 'harassment'
    | 'inappropriate'
    | 'other'
  await createReport(c.env.DB, {
    postId: post.id,
    threadId: post.thread_id,
    cohortId: post.cohort_id,
    reporterUserId: user.id,
    reason,
  })
  return c.html(<span class="text-[11px] text-gray-400">{t('community.post.reportDone')}</span>)
})

export default community
