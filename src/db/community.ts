// Data layer for the couples community (migration 068).
//
// Cohorts are rooms keyed by (year, season, country); membership is opt-in;
// threads + posts are markdown stored in D1. Edits reuse the wedding-docs
// content token for optimistic concurrency. Author identity is snapshotted onto
// each post so a renamed / departed / purged member still renders. Denormalised
// counters (member_count, thread_count, reply_count, last_activity_at) are kept
// in step with each write — D1 has no triggers.

import type { Season } from '../types'
import { contentToken } from './wedding-docs'

export type CommunityRole = 'couple' | 'vendor'

export type CommunityCohort = {
  id: string
  cohort_key: string
  year: number
  season: Season
  country: string
  country_name: string
  member_count: number
  thread_count: number
  last_activity_at: string | null
  created_at: string
}

export type CommunityMember = {
  id: string
  cohort_id: string
  user_id: string
  role: CommunityRole
  display_name: string
  subdivision_code: string | null
  subdivision_label: string | null
  vendor_profile_id: string | null
  vendor_business_name: string | null
  vendor_type_label: string | null
  vendor_directory_listed: number
  wedding_id: string | null
  status: 'active' | 'left' | 'banned'
  joined_at: string
  left_at: string | null
}

export type CommunityThread = {
  id: string
  cohort_id: string
  subdivision_code: string | null
  subdivision_label: string | null
  author_user_id: string | null
  author_member_id: string | null
  title: string
  reply_count: number
  last_reply_at: string | null
  is_locked: number
  is_removed: number
  created_at: string
  updated_at: string
}

/** A thread row enriched with its (current) author display for the list view. */
export type CommunityThreadRow = CommunityThread & {
  author_display_name: string | null
  author_role: CommunityRole | null
  author_vendor_business_name: string | null
}

export type CommunityPost = {
  id: string
  thread_id: string
  cohort_id: string
  reply_to_post_id: string | null
  author_user_id: string | null
  author_member_id: string | null
  author_display_name: string
  author_role: CommunityRole
  author_vendor_business_name: string | null
  author_vendor_type_label: string | null
  author_vendor_profile_id: string | null
  body: string
  version: number
  is_removed: number
  edited_at: string | null
  created_at: string
}

// ─── Cohorts ───

/** Get a cohort by its key, creating it on first use so empty rooms never exist. */
export async function getOrCreateCohort(
  db: D1Database,
  c: { year: number; season: Season; countryCode: string; countryName: string; cohortKey: string }
): Promise<CommunityCohort> {
  return db
    .prepare(
      `INSERT INTO community_cohorts (cohort_key, year, season, country, country_name)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(cohort_key) DO UPDATE SET country_name = excluded.country_name
       RETURNING *`
    )
    .bind(c.cohortKey, c.year, c.season, c.countryCode, c.countryName)
    .first<CommunityCohort>()
    .then((r) => r!)
}

export async function getCohortByKey(db: D1Database, cohortKey: string): Promise<CommunityCohort | null> {
  return db.prepare('SELECT * FROM community_cohorts WHERE cohort_key = ?').bind(cohortKey).first<CommunityCohort>()
}

export async function getCohortById(db: D1Database, id: string): Promise<CommunityCohort | null> {
  return db.prepare('SELECT * FROM community_cohorts WHERE id = ?').bind(id).first<CommunityCohort>()
}

/** Active cohorts the user belongs to, newest activity first (hub + nav). */
export async function listUserCohorts(db: D1Database, userId: string): Promise<CommunityCohort[]> {
  return db
    .prepare(
      `SELECT co.* FROM community_cohorts co
       JOIN community_members m ON m.cohort_id = co.id
       WHERE m.user_id = ? AND m.status = 'active'
       ORDER BY co.last_activity_at DESC, co.created_at DESC`
    )
    .bind(userId)
    .all<CommunityCohort>()
    .then((r) => r.results)
}

async function recountCohortMembers(db: D1Database, cohortId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE community_cohorts
       SET member_count = (SELECT COUNT(*) FROM community_members WHERE cohort_id = ? AND status = 'active')
       WHERE id = ?`
    )
    .bind(cohortId, cohortId)
    .run()
}

async function touchCohortActivity(db: D1Database, cohortId: string): Promise<void> {
  await db
    .prepare(`UPDATE community_cohorts SET last_activity_at = datetime('now') WHERE id = ?`)
    .bind(cohortId)
    .run()
}

// ─── Membership ───

export async function getMembership(
  db: D1Database,
  cohortId: string,
  userId: string
): Promise<CommunityMember | null> {
  return db
    .prepare('SELECT * FROM community_members WHERE cohort_id = ? AND user_id = ?')
    .bind(cohortId, userId)
    .first<CommunityMember>()
}

export type JoinInput = {
  cohortId: string
  userId: string
  role: CommunityRole
  displayName: string
  subdivisionCode: string | null
  subdivisionLabel: string | null
  weddingId: string | null
  vendorProfileId?: string | null
  vendorBusinessName?: string | null
  vendorTypeLabel?: string | null
  vendorDirectoryListed?: boolean
}

/** Opt in (or re-activate a previously-left membership) and refresh the count. */
export async function joinCohort(db: D1Database, input: JoinInput): Promise<CommunityMember> {
  const member = await db
    .prepare(
      `INSERT INTO community_members
         (cohort_id, user_id, role, display_name, subdivision_code, subdivision_label,
          vendor_profile_id, vendor_business_name, vendor_type_label, vendor_directory_listed, wedding_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cohort_id, user_id) DO UPDATE SET
         status = 'active', left_at = NULL,
         display_name = excluded.display_name,
         subdivision_code = excluded.subdivision_code,
         subdivision_label = excluded.subdivision_label,
         vendor_profile_id = excluded.vendor_profile_id,
         vendor_business_name = excluded.vendor_business_name,
         vendor_type_label = excluded.vendor_type_label,
         vendor_directory_listed = excluded.vendor_directory_listed,
         wedding_id = excluded.wedding_id
       RETURNING *`
    )
    .bind(
      input.cohortId,
      input.userId,
      input.role,
      input.displayName,
      input.subdivisionCode,
      input.subdivisionLabel,
      input.vendorProfileId ?? null,
      input.vendorBusinessName ?? null,
      input.vendorTypeLabel ?? null,
      input.vendorDirectoryListed ? 1 : 0,
      input.weddingId
    )
    .first<CommunityMember>()
  await recountCohortMembers(db, input.cohortId)
  return member!
}

export async function leaveCohort(db: D1Database, cohortId: string, userId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE community_members SET status = 'left', left_at = datetime('now')
       WHERE cohort_id = ? AND user_id = ? AND status = 'active'`
    )
    .bind(cohortId, userId)
    .run()
  await recountCohortMembers(db, cohortId)
}

// ─── Threads ───

/** Threads in a cohort, newest activity first, optionally filtered by state tag. */
export async function listThreads(
  db: D1Database,
  cohortId: string,
  opts: { subdivisionCode?: string | null } = {}
): Promise<CommunityThreadRow[]> {
  const filter = opts.subdivisionCode ? 'AND t.subdivision_code = ?' : ''
  const binds = opts.subdivisionCode ? [cohortId, opts.subdivisionCode] : [cohortId]
  return db
    .prepare(
      `SELECT t.*, m.display_name AS author_display_name, m.role AS author_role,
              m.vendor_business_name AS author_vendor_business_name
       FROM community_threads t
       LEFT JOIN community_members m ON m.id = t.author_member_id
       WHERE t.cohort_id = ? AND t.is_removed = 0 ${filter}
       ORDER BY t.last_reply_at DESC, t.created_at DESC`
    )
    .bind(...binds)
    .all<CommunityThreadRow>()
    .then((r) => r.results)
}

/** Distinct state/province tags present on a cohort's threads, for the filter chips. */
export async function listSubdivisions(
  db: D1Database,
  cohortId: string
): Promise<{ code: string; label: string }[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT subdivision_code AS code, subdivision_label AS label
       FROM community_threads
       WHERE cohort_id = ? AND is_removed = 0 AND subdivision_code IS NOT NULL AND subdivision_code != ''
       ORDER BY subdivision_label`
    )
    .bind(cohortId)
    .all<{ code: string; label: string | null }>()
    .then((r) => r.results)
  return rows.map((r) => ({ code: r.code, label: r.label || r.code }))
}

export async function getThread(db: D1Database, threadId: string): Promise<CommunityThread | null> {
  return db.prepare('SELECT * FROM community_threads WHERE id = ?').bind(threadId).first<CommunityThread>()
}

export type AuthorSnapshot = {
  userId: string
  memberId: string
  displayName: string
  role: CommunityRole
  vendorBusinessName?: string | null
  vendorTypeLabel?: string | null
  vendorProfileId?: string | null
}

/** Create a thread and its opening post (reply_to_post_id NULL). */
export async function createThread(
  db: D1Database,
  input: {
    cohort: CommunityCohort
    author: AuthorSnapshot
    title: string
    body: string
    subdivisionCode: string | null
    subdivisionLabel: string | null
  }
): Promise<{ thread: CommunityThread; post: CommunityPost }> {
  const thread = await db
    .prepare(
      `INSERT INTO community_threads
         (cohort_id, subdivision_code, subdivision_label, author_user_id, author_member_id, title, last_reply_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       RETURNING *`
    )
    .bind(
      input.cohort.id,
      input.subdivisionCode,
      input.subdivisionLabel,
      input.author.userId,
      input.author.memberId,
      input.title
    )
    .first<CommunityThread>()
  const post = await insertPost(db, thread!.id, input.cohort.id, null, input.author, input.body)
  await db
    .prepare(
      `UPDATE community_cohorts SET thread_count = thread_count + 1, last_activity_at = datetime('now') WHERE id = ?`
    )
    .bind(input.cohort.id)
    .run()
  return { thread: thread!, post }
}

// ─── Posts ───

async function insertPost(
  db: D1Database,
  threadId: string,
  cohortId: string,
  replyToPostId: string | null,
  author: AuthorSnapshot,
  body: string
): Promise<CommunityPost> {
  return db
    .prepare(
      `INSERT INTO community_posts
         (thread_id, cohort_id, reply_to_post_id, author_user_id, author_member_id,
          author_display_name, author_role, author_vendor_business_name, author_vendor_type_label,
          author_vendor_profile_id, body)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      threadId,
      cohortId,
      replyToPostId,
      author.userId,
      author.memberId,
      author.displayName,
      author.role,
      author.vendorBusinessName ?? null,
      author.vendorTypeLabel ?? null,
      author.vendorProfileId ?? null,
      body
    )
    .first<CommunityPost>()
    .then((r) => r!)
}

export async function listPosts(db: D1Database, threadId: string): Promise<CommunityPost[]> {
  return db
    .prepare(
      `SELECT * FROM community_posts
       WHERE thread_id = ? AND is_removed = 0
       ORDER BY created_at ASC`
    )
    .bind(threadId)
    .all<CommunityPost>()
    .then((r) => r.results)
}

export async function getPost(db: D1Database, postId: string): Promise<CommunityPost | null> {
  return db.prepare('SELECT * FROM community_posts WHERE id = ?').bind(postId).first<CommunityPost>()
}

/** Add a reply and advance the thread + cohort activity markers. */
export async function addReply(
  db: D1Database,
  input: { thread: CommunityThread; author: AuthorSnapshot; body: string; replyToPostId?: string | null }
): Promise<CommunityPost> {
  // Replies point at the thread's opening post (reply_to_post_id IS NULL marks
  // the opener), so deletion can tell an opening post from a reply.
  let parentId = input.replyToPostId ?? null
  if (!parentId) {
    const opening = await db
      .prepare(
        `SELECT id FROM community_posts WHERE thread_id = ? AND reply_to_post_id IS NULL ORDER BY created_at ASC LIMIT 1`
      )
      .bind(input.thread.id)
      .first<{ id: string }>()
    parentId = opening?.id ?? null
  }
  const post = await insertPost(db, input.thread.id, input.thread.cohort_id, parentId, input.author, input.body)
  await db
    .prepare(
      `UPDATE community_threads
       SET reply_count = reply_count + 1, last_reply_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(input.thread.id)
    .run()
  await touchCohortActivity(db, input.thread.cohort_id)
  return post
}

export type PostSaveResult =
  | { ok: true; token: string; body: string }
  | { ok: false; conflict: true; content: string; token: string }

/**
 * Edit own post with the optimistic content-token guard (same model as
 * saveDoc): rejects with the latest content when the post moved underneath.
 */
export async function editOwnPost(
  db: D1Database,
  postId: string,
  userId: string,
  body: string,
  baseToken: string
): Promise<PostSaveResult | null> {
  const post = await getPost(db, postId)
  if (!post || post.is_removed === 1) return null
  if (post.author_user_id !== userId) return null
  const currentToken = contentToken(post.body)
  if (baseToken !== currentToken) {
    return { ok: false, conflict: true, content: post.body, token: currentToken }
  }
  await db
    .prepare(
      `UPDATE community_posts SET body = ?, version = version + 1, edited_at = datetime('now') WHERE id = ?`
    )
    .bind(body, postId)
    .run()
  return { ok: true, token: contentToken(body), body }
}

/**
 * Delete the caller's own post. Deleting an opening post (reply_to_post_id NULL)
 * removes the whole thread (cascade) and decrements thread_count; deleting a
 * reply decrements the thread's reply_count. Returns what was removed.
 */
export async function deleteOwnPost(
  db: D1Database,
  postId: string,
  userId: string
): Promise<{ deleted: 'thread' | 'post'; threadId: string } | null> {
  const post = await getPost(db, postId)
  if (!post || post.author_user_id !== userId) return null

  if (post.reply_to_post_id === null) {
    await db.prepare('DELETE FROM community_threads WHERE id = ?').bind(post.thread_id).run()
    await db
      .prepare(`UPDATE community_cohorts SET thread_count = MAX(thread_count - 1, 0) WHERE id = ?`)
      .bind(post.cohort_id)
      .run()
    return { deleted: 'thread', threadId: post.thread_id }
  }

  await db.prepare('DELETE FROM community_posts WHERE id = ?').bind(postId).run()
  await db
    .prepare(`UPDATE community_threads SET reply_count = MAX(reply_count - 1, 0) WHERE id = ?`)
    .bind(post.thread_id)
    .run()
  return { deleted: 'post', threadId: post.thread_id }
}

// ─── Reports ───

export async function createReport(
  db: D1Database,
  input: {
    postId: string
    threadId: string
    cohortId: string
    reporterUserId: string
    reason: 'spam' | 'harassment' | 'inappropriate' | 'other'
    detail?: string | null
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO community_reports (post_id, thread_id, cohort_id, reporter_user_id, reason, detail)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(reporter_user_id, post_id) DO NOTHING`
    )
    .bind(input.postId, input.threadId, input.cohortId, input.reporterUserId, input.reason, input.detail ?? null)
    .run()
}

// ─── Account deletion (called from services/account.ts) ───

/** Anonymise a user's community footprint before the account is purged. */
export async function anonymiseCommunityForUser(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE community_posts
       SET author_display_name = '[deleted]',
           author_vendor_business_name = NULL,
           author_vendor_type_label = NULL,
           author_vendor_profile_id = NULL
       WHERE author_user_id = ?`
    )
    .bind(userId)
    .run()
  await db
    .prepare(`UPDATE community_members SET display_name = '[deleted]', status = 'left' WHERE user_id = ?`)
    .bind(userId)
    .run()
}
