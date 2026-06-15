/**
 * Ingestion tests for the vault companion files (timeline.md, notes.md,
 * vendors.md) and the permission routing on wedding.md — the guarantee
 * that a file edit can never do more than the same edit in the web app.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { applyPulledFile, validatePulledFile, classifyWeddingPath } from '../sync'
import { weddingToMarkdown } from '../weddings'
import { serializeMarkdown } from '../markdown'
import { MockD1Database } from './mock-d1'
import type { Wedding } from '../../types'

const VENDOR_ID = 'vendor-photog'
const VENDOR_USER = 'user-photog'
const PLANNER_USER = 'user-planner'
const WEDDING_ID = 'wedding-001'
const FOLDER = 'weddings/2026-12-15-sarah-james/'

function makeWedding(overrides: Partial<Wedding> = {}): Wedding {
  return {
    id: WEDDING_ID,
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
    notes: 'Shared notes',
    created_by_user_id: 'user-couple',
    created_at: '2025-06-01T00:00:00.000Z',
    updated_at: '2025-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function weddingFileContent(wedding: Wedding): string {
  return serializeMarkdown(weddingToMarkdown(wedding))
}

function seedBase(db: MockD1Database, opts: { editorCanManage?: number; withPlanner?: boolean } = {}) {
  db.seed('file_index', [])
  db.seed('weddings', [makeWedding() as unknown as Record<string, unknown>])
  db.seed('vendor_profiles', [
    { id: VENDOR_ID, user_id: VENDOR_USER, business_name: 'Snappy Photos', category: 'photographer' },
    { id: 'vendor-planner', user_id: PLANNER_USER, business_name: 'Perfect Plans', category: 'planner' },
  ])
  const members: Record<string, unknown>[] = [
    {
      id: 'wm-editor', wedding_id: WEDDING_ID, user_id: VENDOR_USER, role: 'vendor',
      vendor_profile_id: VENDOR_ID, status: 'active', can_manage: opts.editorCanManage ?? 0,
      vendor_notes: null,
    },
  ]
  if (opts.withPlanner) {
    members.push({
      id: 'wm-planner', wedding_id: WEDDING_ID, user_id: PLANNER_USER, role: 'vendor',
      vendor_profile_id: 'vendor-planner', status: 'active', can_manage: 1,
      vendor_notes: null,
    })
  }
  db.seed('wedding_members', members)
  db.seed('timeline_change_requests', [])
  db.seed('wedding_log', [])
  db.seed('run_sheet_items', [])
}

describe('wedding.md ingestion permission routing', () => {
  let db: MockD1Database

  beforeEach(() => {
    db = new MockD1Database()
  })

  it('routes timeline changes from a non-controller to a change request', async () => {
    seedBase(db, { withPlanner: true })
    const content = weddingFileContent(
      makeWedding({ time: '16:00', title: 'Renamed wedding' })
    )

    const outcome = await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'wedding.md', content, 'etag-1'
    )

    expect(outcome).toMatchObject({
      applied: 'wedding',
      pendingApproval: ['time'],
      needsRepush: true,
    })

    // The timeline change waits as a request; nothing touched the field
    const requests = db.getTable('timeline_change_requests')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0].payload as string)).toEqual({ time: '16:00' })

    const wedding = db.getTable('weddings')[0]
    expect(wedding.time).toBe('15:00')
    // Non-timeline edits still flow through
    expect(wedding.title).toBe('Renamed wedding')

    // And the routing is visible in the wedding log
    expect(db.getTable('wedding_log').some((l) => l.action === 'Timeline change requested')).toBe(true)
  })

  it('lets a managing planner/venue write timeline fields straight through', async () => {
    seedBase(db, { editorCanManage: 1 })
    // Editor is themselves a planner-category controller? No — category is
    // photographer; but with no other controllers the write applies anyway.
    const content = weddingFileContent(makeWedding({ time: '16:00' }))

    const outcome = await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'wedding.md', content, 'etag-1'
    )

    expect(outcome.applied).toBe('wedding')
    expect((outcome as { pendingApproval?: string[] }).pendingApproval).toBeUndefined()
    expect(db.getTable('weddings')[0].time).toBe('16:00')
    expect(db.getTable('timeline_change_requests')).toHaveLength(0)
  })

  it('applies timeline fields directly when no controllers exist', async () => {
    seedBase(db)
    const content = weddingFileContent(makeWedding({ date: '2026-12-16' }))

    await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'wedding.md', content, 'etag-1'
    )

    expect(db.getTable('weddings')[0].date).toBe('2026-12-16')
    expect(db.getTable('timeline_change_requests')).toHaveLength(0)
  })

  it('persists emoji and reception duration from a file edit', async () => {
    seedBase(db)
    const content = weddingFileContent(
      makeWedding({ emoji: '🌸', reception_duration_hours: 5 })
    )

    await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'wedding.md', content, 'etag-1'
    )

    const wedding = db.getTable('weddings')[0]
    expect(wedding.emoji).toBe('🌸')
    expect(wedding.reception_duration_hours).toBe(5)
  })

  it('routes reception duration to approval under a controller, but emoji applies', async () => {
    seedBase(db, { withPlanner: true })
    const content = weddingFileContent(
      makeWedding({ emoji: '🌸', reception_duration_hours: 5 })
    )

    const outcome = await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'wedding.md', content, 'etag-1'
    )

    expect(outcome).toMatchObject({
      applied: 'wedding',
      pendingApproval: ['reception_duration_hours'],
    })

    const wedding = db.getTable('weddings')[0]
    // Emoji is vendor-editable and not timeline-controlled — direct write
    expect(wedding.emoji).toBe('🌸')
    // Reception duration waits for the controller's approval
    expect(wedding.reception_duration_hours).toBeNull()

    const requests = db.getTable('timeline_change_requests')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0].payload as string)).toEqual({ reception_duration_hours: 5 })
  })

  it('never lets a vendor file flip couple-only fields', async () => {
    seedBase(db)
    const content = weddingFileContent(
      makeWedding({ vendor_visibility: 'private', created_by_user_id: 'attacker' })
    )

    await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'wedding.md', content, 'etag-1'
    )

    const wedding = db.getTable('weddings')[0]
    expect(wedding.vendor_visibility).toBe('visible')
    expect(wedding.created_by_user_id).toBe('user-couple')
  })

  it('still rejects weddings the vendor is not a member of', async () => {
    seedBase(db)
    db.seed('wedding_members', []) // membership revoked
    const content = weddingFileContent(makeWedding({ time: '16:00' }))

    const outcome = await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'wedding.md', content, 'etag-1'
    )

    expect(outcome).toMatchObject({ applied: 'ignored', reason: 'wedding belongs to another account' })
    expect(db.getTable('weddings')[0].time).toBe('15:00')
  })
})

describe('timeline.md ingestion', () => {
  let db: MockD1Database

  beforeEach(() => {
    db = new MockD1Database()
    seedBase(db)
    // timeline.md now drives the unified timeline_items (the vendor's OWN rows).
    db.seed('timeline_items', [
      {
        id: 'rs-1', wedding_id: WEDDING_ID, owner_vendor_id: VENDOR_ID, created_by_user_id: null,
        start_time: '14:30', end_time: null, title: 'Ceremony', description: null,
        location: 'Chapel', category: 'ceremony', visibility: 'vendors', slot: null, sort_order: 0,
        created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
      },
      {
        id: 'rs-2', wedding_id: WEDDING_ID, owner_vendor_id: VENDOR_ID, created_by_user_id: null,
        start_time: '17:00', end_time: null, title: 'Speeches', description: null,
        location: null, category: 'reception', visibility: 'vendors', slot: null, sort_order: 1,
        created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
      },
    ])
  })

  function timelineContent(rows: string[]): string {
    return [
      '---',
      `wedding_id: ${WEDDING_ID}`,
      '---',
      '',
      '## Run sheet',
      '',
      '| Start | End | What | Details | Location | Who | Category | id |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...rows,
      '',
    ].join('\n')
  }

  it('updates, creates, and deletes own rows from the table', async () => {
    const content = timelineContent([
      '| 15:00 |  | Ceremony |  | Chapel |  | Ceremony | rs-1 |', // time changed
      '| 18:00 |  | First dance |  |  | DJ | Reception |  |',     // new row
      // rs-2 omitted → delete
    ])

    const outcome = await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'timeline.md', content, 'etag-t1'
    )

    expect(outcome).toMatchObject({ applied: 'timeline', entityId: WEDDING_ID, needsRepush: true })

    const items = db.getTable('timeline_items')
    const ceremony = items.find((i) => i.id === 'rs-1')
    expect(ceremony?.start_time).toBe('15:00')
    expect(items.find((i) => i.title === 'First dance')).toBeTruthy()
    expect(items.find((i) => i.id === 'rs-2')).toBeUndefined()
  })

  it('does not flag a repush for pure updates (ids all known)', async () => {
    const content = timelineContent([
      '| 14:30 |  | Ceremony |  | Chapel |  | Ceremony | rs-1 |',
      '| 17:30 |  | Speeches |  |  |  | Reception | rs-2 |',
    ])

    const outcome = await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'timeline.md', content, 'etag-t2'
    )

    expect(outcome.applied).toBe('timeline')
    expect((outcome as { needsRepush?: boolean }).needsRepush).toBeUndefined()
  })

  it('ignores timeline.md from a non-member', async () => {
    db.seed('wedding_members', [])
    const content = timelineContent(['|  |  | Sneaky |  |  |  | Other |  |'])

    const outcome = await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'timeline.md', content, 'etag-t3'
    )

    expect(outcome).toMatchObject({ applied: 'ignored' })
    expect(db.getTable('timeline_items')).toHaveLength(2)
  })
})

describe('notes.md ingestion', () => {
  let db: MockD1Database

  beforeEach(() => {
    db = new MockD1Database()
    seedBase(db)
  })

  it('writes the body into the vendor\'s private membership notes', async () => {
    const content = [
      '---',
      `wedding_id: ${WEDDING_ID}`,
      'private: true',
      '---',
      '',
      'Remember the side gate code is 4321.',
      '',
    ].join('\n')

    const outcome = await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'notes.md', content, 'etag-n1'
    )

    expect(outcome).toMatchObject({ applied: 'notes', entityId: WEDDING_ID })
    const member = db.getTable('wedding_members').find((m) => m.user_id === VENDOR_USER)
    expect(member?.vendor_notes).toBe('Remember the side gate code is 4321.')
  })

  it('ignores notes.md from a non-member', async () => {
    db.seed('wedding_members', [])
    const content = `---\nwedding_id: ${WEDDING_ID}\n---\n\nSneaky note\n`

    const outcome = await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'notes.md', content, 'etag-n2'
    )

    expect(outcome).toMatchObject({ applied: 'ignored' })
  })
})

describe('calendar resync after wedding.md ingestion', () => {
  let db: MockD1Database

  const SECOND_VENDOR = 'vendor-florist'

  function ceremonyEvent(vendorId: string, id: string): Record<string, unknown> {
    return {
      id, vendor_id: vendorId, wedding_id: WEDDING_ID,
      title: 'Sarah & James — Ceremony', date: '2026-12-15',
      start_time: '15:00', end_time: '16:00', all_day: 0,
      type: 'booking', notes: 'wc:ceremony',
    }
  }

  beforeEach(() => {
    db = new MockD1Database()
    seedBase(db)
    // A second, non-controlling vendor member with their own calendar copy
    db.seed('vendor_profiles', [
      ...db.getTable('vendor_profiles'),
      { id: SECOND_VENDOR, user_id: 'user-florist', business_name: 'Blooms', category: 'florist' },
    ])
    db.seed('wedding_members', [
      ...db.getTable('wedding_members'),
      {
        id: 'wm-florist', wedding_id: WEDDING_ID, user_id: 'user-florist', role: 'vendor',
        vendor_profile_id: SECOND_VENDOR, status: 'active', can_manage: 0, vendor_notes: null,
      },
    ])
    db.seed('calendar_events', [
      ceremonyEvent(VENDOR_ID, 'ce-photog'),
      ceremonyEvent(SECOND_VENDOR, 'ce-florist'),
    ])
  })

  it('moves every member vendor\'s events when a timeline change applies directly', async () => {
    const content = weddingFileContent(makeWedding({ time: '16:00' }))

    await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'wedding.md', content, 'etag-c1'
    )

    const events = db.getTable('calendar_events')
    const photog = events.find((e) => e.id === 'ce-photog')
    const florist = events.find((e) => e.id === 'ce-florist')
    expect(photog?.start_time).toBe('16:00')
    expect(photog?.end_time).toBe('17:00') // duration_hours = 1
    expect(florist?.start_time).toBe('16:00')
  })

  it('leaves calendar events alone when the change routes to approval', async () => {
    db.seed('wedding_members', [
      ...db.getTable('wedding_members'),
      {
        id: 'wm-planner', wedding_id: WEDDING_ID, user_id: PLANNER_USER, role: 'vendor',
        vendor_profile_id: 'vendor-planner', status: 'active', can_manage: 1, vendor_notes: null,
      },
    ])
    const content = weddingFileContent(makeWedding({ time: '16:00' }))

    const outcome = await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'wedding.md', content, 'etag-c2'
    )

    expect(outcome).toMatchObject({ pendingApproval: ['time'] })
    const events = db.getTable('calendar_events')
    expect(events.find((e) => e.id === 'ce-photog')?.start_time).toBe('15:00')
    // No prep/companion events were derived either
    expect(events).toHaveLength(2)
  })

  it('skips the resync when nothing calendar-relevant changed', async () => {
    const content = weddingFileContent(makeWedding({ notes: 'Updated shared notes' }))

    await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'wedding.md', content, 'etag-c3'
    )

    // Notes flowed through to the wedding, but the calendar was untouched —
    // a resync would have derived extra companion events (ceremony prep).
    expect(db.getTable('weddings')[0].notes).toBe('Updated shared notes')
    const events = db.getTable('calendar_events')
    expect(events).toHaveLength(2)
    expect(events[0].title).toBe('Sarah & James — Ceremony')
  })

  it('retitles every member vendor\'s events when only title/emoji changed', async () => {
    // Title and emoji are not timeline fields, but every derived event
    // title embeds them — a file rename must fan out like the web form.
    const content = weddingFileContent(
      makeWedding({ title: 'Renamed wedding', emoji: '💍' })
    )

    await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'wedding.md', content, 'etag-c4'
    )

    const events = db.getTable('calendar_events')
    const photog = events.find((e) => e.id === 'ce-photog')
    const florist = events.find((e) => e.id === 'ce-florist')
    expect(photog?.title).toBe('💍 Renamed wedding — Ceremony')
    expect(florist?.title).toBe('💍 Renamed wedding — Ceremony')
    // Times were untouched — only the derived titles changed
    expect(photog?.start_time).toBe('15:00')
  })

  it('applies file-set emoji and reception duration to reception events', async () => {
    db.seed('weddings', [
      makeWedding({ reception_time: '18:00', reception_location: 'Hall' }) as unknown as Record<string, unknown>,
    ])
    db.seed('calendar_events', [
      ...db.getTable('calendar_events'),
      {
        id: 'ce-reception', vendor_id: VENDOR_ID, wedding_id: WEDDING_ID,
        title: 'Sarah & James — Reception', date: '2026-12-15',
        start_time: '18:00', end_time: '21:00', all_day: 0,
        type: 'booking', notes: 'wc:reception',
      },
    ])
    const content = weddingFileContent(
      makeWedding({
        reception_time: '18:00', reception_location: 'Hall',
        emoji: '🌸', reception_duration_hours: 5,
      })
    )

    await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'wedding.md', content, 'etag-c5'
    )

    const reception = db.getTable('calendar_events').find((e) => e.id === 'ce-reception')
    expect(reception?.end_time).toBe('23:00')
    expect(reception?.title).toBe('🌸 Sarah & James — Reception')
  })

  it('removes events for a timeline slot the file cleared', async () => {
    db.seed('weddings', [
      makeWedding({ portrait_time: '17:30', portrait_location: 'Beach' }) as unknown as Record<string, unknown>,
    ])
    db.seed('calendar_events', [
      ...db.getTable('calendar_events'),
      {
        id: 'ce-portraits', vendor_id: VENDOR_ID, wedding_id: WEDDING_ID,
        title: 'Sarah & James — Portraits', date: '2026-12-15',
        start_time: '17:30', end_time: '18:30', all_day: 0,
        type: 'booking', notes: 'wc:portraits',
      },
    ])
    const content = weddingFileContent(makeWedding()) // portraits cleared

    await applyPulledFile(
      db as unknown as D1Database, VENDOR_ID, FOLDER + 'wedding.md', content, 'etag-c4'
    )

    expect(db.getTable('calendar_events').find((e) => e.id === 'ce-portraits')).toBeUndefined()
  })
})

describe('generated files stay read-only', () => {
  it('ignores vendors.md and log.md on ingest', async () => {
    const db = new MockD1Database()
    seedBase(db)

    for (const file of ['vendors.md', 'log.md']) {
      const outcome = await applyPulledFile(
        db as unknown as D1Database, VENDOR_ID, FOLDER + file, '# Edited by hand', 'etag-x'
      )
      expect(outcome.applied).toBe('ignored')
    }
  })
})

describe('classifyWeddingPath + validatePulledFile for companions', () => {
  it('classifies the new companion files', () => {
    expect(classifyWeddingPath(FOLDER + 'timeline.md')).toBe('timeline')
    expect(classifyWeddingPath(FOLDER + 'notes.md')).toBe('notes')
    expect(classifyWeddingPath(FOLDER + 'vendors.md')).toBe('vendors')
  })

  it('validates timeline.md structure before storage', () => {
    expect(validatePulledFile(FOLDER + 'timeline.md', '# No run sheet section').ok).toBe(false)
    const good = [
      '## Run sheet', '',
      '| Start | End | What | Details | Location | Who | Category | id |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ].join('\n')
    expect(validatePulledFile(FOLDER + 'timeline.md', good).ok).toBe(true)
  })

  it('rejects writes to generated files with a helpful error', () => {
    const vendors = validatePulledFile(FOLDER + 'vendors.md', 'anything')
    expect(vendors.ok).toBe(false)
    if (!vendors.ok) expect(vendors.error).toContain('read-only')
    expect(validatePulledFile(FOLDER + 'log.md', 'anything').ok).toBe(false)
  })

  it('accepts notes.md', () => {
    expect(validatePulledFile(FOLDER + 'notes.md', 'Some notes').ok).toBe(true)
  })
})
