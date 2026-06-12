import { describe, it, expect } from 'vitest'
import {
  TIMELINE_FIELDS,
  changedTimelineFields,
  summarizeTimelineChanges,
  partitionVendorWeddingUpdate,
} from './timeline-edit'
import type { Wedding } from '../types'

function makeWedding(overrides: Partial<Wedding> = {}): Wedding {
  return {
    id: 'wedding-001',
    title: 'Sarah & James',
    date: '2026-12-15',
    time: '15:00',
    duration_hours: 1,
    location: 'Sydney',
    location_lat: null,
    location_lng: null,
    status: 'planning',
    ceremony_type: 'wedding',
    vendor_visibility: 'visible',
    ceremony_location: 'Chapel',
    reception_location: null,
    reception_time: null,
    getting_ready_location: null,
    getting_ready_time: null,
    getting_ready_1_label: null,
    getting_ready_2_location: null,
    getting_ready_2_label: null,
    getting_ready_2_time: null,
    portrait_location: null,
    portrait_time: null,
    emoji: null,
    bump_in_time: null,
    bump_out_time: null,
    reception_duration_hours: null,
    timeline_notes: null,
    dress_code: null,
    guest_count: null,
    notes: 'Shared notes from the couple',
    created_by_user_id: 'user-couple',
    created_at: '2025-06-01T00:00:00.000Z',
    updated_at: '2025-06-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('changedTimelineFields', () => {
  it('detects only genuinely changed timeline fields', () => {
    const current = makeWedding()
    const incoming = makeWedding({ time: '16:00', title: 'Renamed', notes: 'different' })
    expect(changedTimelineFields(current, incoming)).toEqual(['time'])
  })

  it('treats null and empty consistently', () => {
    const current = makeWedding({ reception_time: null })
    expect(changedTimelineFields(current, makeWedding({ reception_time: null }))).toEqual([])
  })
})

describe('partitionVendorWeddingUpdate', () => {
  it('strips timeline changes for a non-controller when controllers exist', () => {
    const current = makeWedding()
    const incoming = makeWedding({ time: '16:00', date: '2026-12-16', title: 'New title' })
    const { direct, pendingFields, pendingPayload } = partitionVendorWeddingUpdate(
      current, incoming, { hasControllers: true, isController: false }
    )
    expect(pendingFields.sort()).toEqual(['date', 'time'])
    expect(pendingPayload).toEqual({ date: '2026-12-16', time: '16:00' })
    // Timeline values reverted to current; non-timeline edits flow through
    expect(direct.time).toBe('15:00')
    expect(direct.date).toBe('2026-12-15')
    expect(direct.title).toBe('New title')
  })

  it('lets a controller write timeline fields directly', () => {
    const current = makeWedding()
    const incoming = makeWedding({ time: '16:00' })
    const { direct, pendingFields } = partitionVendorWeddingUpdate(
      current, incoming, { hasControllers: true, isController: true }
    )
    expect(pendingFields).toEqual([])
    expect(direct.time).toBe('16:00')
  })

  it('lets anyone write timeline fields when no controllers exist', () => {
    const current = makeWedding()
    const incoming = makeWedding({ time: '16:00' })
    const { direct, pendingFields } = partitionVendorWeddingUpdate(
      current, incoming, { hasControllers: false, isController: false }
    )
    expect(pendingFields).toEqual([])
    expect(direct.time).toBe('16:00')
  })

  it('always protects couple-only and provenance fields', () => {
    const current = makeWedding({ vendor_visibility: 'visible' })
    const incoming = makeWedding({
      vendor_visibility: 'private',
      created_by_user_id: 'attacker',
      created_at: '2020-01-01T00:00:00.000Z',
    })
    const { direct } = partitionVendorWeddingUpdate(
      current, incoming, { hasControllers: false, isController: false }
    )
    expect(direct.vendor_visibility).toBe('visible')
    expect(direct.created_by_user_id).toBe('user-couple')
    expect(direct.created_at).toBe('2025-06-01T00:00:00.000Z')
  })
})

describe('summarizeTimelineChanges', () => {
  it('reads like a human diff', () => {
    const current = makeWedding()
    const incoming = makeWedding({ time: '16:00', reception_location: 'Ballroom' })
    const fields = changedTimelineFields(current, incoming)
    const summary = summarizeTimelineChanges(current, incoming, fields)
    expect(summary).toContain('time: 15:00 → 16:00')
    expect(summary).toContain('reception_location: — → Ballroom')
  })
})

describe('TIMELINE_FIELDS', () => {
  it('matches the approval surface the app routes enforce', () => {
    expect(TIMELINE_FIELDS).toContain('date')
    expect(TIMELINE_FIELDS).toContain('reception_time')
    expect(TIMELINE_FIELDS).not.toContain('notes')
    expect(TIMELINE_FIELDS).not.toContain('title')
    expect(TIMELINE_FIELDS).not.toContain('status')
  })
})
