import { describe, expect, it } from 'vitest'
import type { CommunityMember, CommunityPost } from '../db/community'
import { canUseCommunityPost } from './community'

function member(overrides: Partial<CommunityMember> = {}): CommunityMember {
  return {
    id: 'member-1',
    cohort_id: 'cohort-1',
    user_id: 'user-1',
    role: 'couple',
    display_name: 'Alex',
    subdivision_code: null,
    subdivision_label: null,
    vendor_profile_id: null,
    vendor_business_name: null,
    vendor_type_label: null,
    vendor_directory_listed: 0,
    wedding_id: 'wedding-1',
    status: 'active',
    joined_at: '2026-06-24T00:00:00.000Z',
    left_at: null,
    ...overrides,
  }
}

function post(overrides: Partial<CommunityPost> = {}): CommunityPost {
  return {
    id: 'post-1',
    thread_id: 'thread-1',
    cohort_id: 'cohort-1',
    reply_to_post_id: null,
    author_user_id: 'user-1',
    author_member_id: 'member-1',
    author_display_name: 'Alex',
    author_role: 'couple',
    author_vendor_business_name: null,
    author_vendor_type_label: null,
    author_vendor_profile_id: null,
    body: 'Hello',
    version: 1,
    is_removed: 0,
    edited_at: null,
    created_at: '2026-06-24T00:00:00.000Z',
    ...overrides,
  }
}

describe('canUseCommunityPost', () => {
  it('requires active membership in the post cohort for every post-level endpoint', () => {
    const p = post()

    expect(canUseCommunityPost('user-1', null, p, 'view')).toBe(false)
    expect(canUseCommunityPost('user-1', member({ status: 'left' }), p, 'view')).toBe(false)
    expect(canUseCommunityPost('user-1', member({ cohort_id: 'other-cohort' }), p, 'view')).toBe(false)
    expect(canUseCommunityPost('user-1', member(), p, 'view')).toBe(true)
  })

  it('allows edits and deletes only for the author while they remain a member', () => {
    const p = post()

    expect(canUseCommunityPost('user-1', member(), p, 'edit')).toBe(true)
    expect(canUseCommunityPost('user-1', member(), p, 'delete')).toBe(true)
    expect(canUseCommunityPost('user-2', member({ user_id: 'user-2', id: 'member-2' }), p, 'edit')).toBe(false)
    expect(canUseCommunityPost('user-1', member({ status: 'left' }), p, 'delete')).toBe(false)
  })

  it('allows reports from other active members but never from the post author', () => {
    const p = post()

    expect(canUseCommunityPost('user-2', member({ user_id: 'user-2', id: 'member-2' }), p, 'report')).toBe(true)
    expect(canUseCommunityPost('user-1', member(), p, 'report')).toBe(false)
    expect(canUseCommunityPost('user-2', member({ user_id: 'user-2', id: 'member-2', status: 'left' }), p, 'report')).toBe(false)
  })
})
