import { describe, it, expect } from 'vitest'
import {
  timelineToMarkdown,
  parseTimelineMarkdown,
  diffRunSheetRows,
} from '../run-sheet-md'
import { ParseError } from '../markdown'
import type { RunSheetItem, TimelineChangeRequest } from '../../types'

function makeItem(overrides: Partial<RunSheetItem> = {}): RunSheetItem {
  return {
    id: 'aaaabbbbccccddddeeee0001',
    wedding_id: 'wedding-001',
    vendor_id: 'vendor-abc123',
    time: '14:30',
    end_time: '15:00',
    title: 'Ceremony',
    description: null,
    location: 'Chapel',
    assigned_to: null,
    category: 'ceremony',
    sort_order: 0,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

const WEDDING = { id: 'wedding-001', title: 'Sarah & James' }

describe('timelineToMarkdown', () => {
  it('round-trips own items through parse', () => {
    const items = [
      makeItem(),
      makeItem({
        id: 'aaaabbbbccccddddeeee0002',
        time: '17:00',
        end_time: null,
        title: 'Reception entrance',
        description: 'Grand entrance with sparklers',
        location: 'Ballroom',
        assigned_to: 'DJ',
        category: 'reception',
        sort_order: 1,
      }),
    ]
    const md = timelineToMarkdown({
      wedding: WEDDING,
      ownItems: items,
      otherVendors: [],
      pendingRequests: [],
    })
    const rows = parseTimelineMarkdown(md)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      id: 'aaaabbbbccccddddeeee0001',
      time: '14:30',
      end_time: '15:00',
      title: 'Ceremony',
      location: 'Chapel',
      category: 'ceremony',
    })
    expect(rows[1]).toMatchObject({
      id: 'aaaabbbbccccddddeeee0002',
      title: 'Reception entrance',
      description: 'Grand entrance with sparklers',
      assigned_to: 'DJ',
      category: 'reception',
    })
  })

  it('escapes pipes in cell content and round-trips them', () => {
    const items = [makeItem({ title: 'Photos | family then friends' })]
    const md = timelineToMarkdown({
      wedding: WEDDING,
      ownItems: items,
      otherVendors: [],
      pendingRequests: [],
    })
    const rows = parseTimelineMarkdown(md)
    expect(rows[0].title).toBe('Photos | family then friends')
  })

  it('does not parse other vendors\' read-only items as own rows', () => {
    const md = timelineToMarkdown({
      wedding: WEDDING,
      ownItems: [makeItem()],
      otherVendors: [
        {
          label: 'Fancy Flowers',
          items: [makeItem({ id: 'other-vendor-item-000001', title: 'Bump in florals', category: 'other' })],
        },
      ],
      pendingRequests: [],
    })
    const rows = parseTimelineMarkdown(md)
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Ceremony')
    expect(md).toContain('Fancy Flowers')
    expect(md).toContain('Bump in florals')
  })

  it('renders pending approval requests read-only', () => {
    const pending: TimelineChangeRequest = {
      id: 'req-1',
      wedding_id: WEDDING.id,
      requested_by_user_id: 'user-2',
      requested_by_label: 'Snappy Photos',
      target: 'wedding',
      op: 'update',
      run_sheet_item_id: null,
      vendor_profile_id: null,
      payload: '{"time":"16:00"}',
      summary: 'time: 15:00 → 16:00',
      status: 'pending',
      decided_by_user_id: null,
      decided_at: null,
      created_at: '2026-06-12T01:00:00.000Z',
    }
    const md = timelineToMarkdown({
      wedding: WEDDING,
      ownItems: [makeItem()],
      otherVendors: [],
      pendingRequests: [pending],
    })
    expect(md).toContain('## Pending timeline approvals')
    expect(md).toContain('Snappy Photos')
    expect(md).toContain('time: 15:00 → 16:00')
    // Pending section must not leak into parsed rows
    expect(parseTimelineMarkdown(md)).toHaveLength(1)
  })

  it('writes an empty table that still parses (header preserved)', () => {
    const md = timelineToMarkdown({
      wedding: WEDDING,
      ownItems: [],
      otherVendors: [],
      pendingRequests: [],
    })
    expect(parseTimelineMarkdown(md)).toHaveLength(0)
  })
})

describe('parseTimelineMarkdown', () => {
  it('throws ParseError when the run sheet section is missing', () => {
    expect(() => parseTimelineMarkdown('---\nwedding_id: w1\n---\n\n# Nothing here\n')).toThrow(ParseError)
  })

  it('throws ParseError when the table is gone entirely', () => {
    expect(() =>
      parseTimelineMarkdown('---\nwedding_id: w1\n---\n\n## Run sheet\n\nNo table any more\n')
    ).toThrow(ParseError)
  })

  it('throws ParseError when the title column was removed', () => {
    const md = [
      '## Run sheet', '',
      '| Start | End |',
      '| --- | --- |',
      '| 14:00 | 15:00 |',
    ].join('\n')
    expect(() => parseTimelineMarkdown(md)).toThrow(ParseError)
  })

  it('skips rows without a title and maps unknown categories to other', () => {
    const md = [
      '## Run sheet', '',
      '| Start | End | What | Details | Location | Who | Category | id |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| 14:00 |  |  |  |  |  | ceremony |  |',
      '| 15:00 |  | Cake cutting |  |  |  | Dessert time |  |',
      '| 16:00 |  | First dance |  |  |  | Getting Ready |  |',
    ].join('\n')
    const rows = parseTimelineMarkdown(md)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ title: 'Cake cutting', category: 'other' })
    expect(rows[1]).toMatchObject({ title: 'First dance', category: 'getting_ready' })
  })

  it('tolerates human header variations (Title/Description/Assigned to)', () => {
    const md = [
      '## Run sheet', '',
      '| Time | Title | Description | Assigned to | id |',
      '| --- | --- | --- | --- | --- |',
      '| 09:00 | Hair and makeup | Two artists | Bridal party | abc123 |',
    ].join('\n')
    const rows = parseTimelineMarkdown(md)
    expect(rows[0]).toMatchObject({
      time: '09:00',
      title: 'Hair and makeup',
      description: 'Two artists',
      assigned_to: 'Bridal party',
      id: 'abc123',
    })
  })
})

describe('diffRunSheetRows', () => {
  const existing = [
    makeItem({ id: 'id-1', title: 'Ceremony', sort_order: 0 }),
    makeItem({ id: 'id-2', title: 'Portraits', category: 'portraits', time: '15:30', sort_order: 1 }),
  ]

  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: null as string | null,
      time: null as string | null,
      end_time: null as string | null,
      title: 'New item',
      description: null as string | null,
      location: null as string | null,
      assigned_to: null as string | null,
      category: 'other' as const,
      ...overrides,
    }
  }

  it('creates rows without ids, preserving position', () => {
    const diff = diffRunSheetRows(existing, [
      row({ id: 'id-1', title: 'Ceremony', time: '14:30', end_time: '15:00', location: 'Chapel', category: 'ceremony' }),
      row({ title: 'Speeches', category: 'reception' }),
      row({ id: 'id-2', title: 'Portraits', time: '15:30', end_time: '15:00', location: 'Chapel', category: 'portraits' }),
    ])
    expect(diff.creates).toHaveLength(1)
    expect(diff.creates[0]).toMatchObject({ title: 'Speeches', sort_order: 1 })
    expect(diff.deletes).toHaveLength(0)
  })

  it('updates changed fields and reorders', () => {
    const diff = diffRunSheetRows(existing, [
      row({ id: 'id-2', title: 'Portraits', time: '16:00', end_time: '15:00', location: 'Chapel', category: 'portraits' }),
      row({ id: 'id-1', title: 'Ceremony', time: '14:30', end_time: '15:00', location: 'Chapel', category: 'ceremony' }),
    ])
    expect(diff.creates).toHaveLength(0)
    expect(diff.deletes).toHaveLength(0)
    const byId = new Map(diff.updates.map((u) => [u.id, u.changes]))
    expect(byId.get('id-2')).toMatchObject({ time: '16:00', sort_order: 0 })
    expect(byId.get('id-1')).toMatchObject({ sort_order: 1 })
  })

  it('deletes rows missing from the file', () => {
    const diff = diffRunSheetRows(existing, [
      row({ id: 'id-1', title: 'Ceremony', time: '14:30', end_time: '15:00', location: 'Chapel', category: 'ceremony' }),
    ])
    expect(diff.deletes).toEqual(['id-2'])
  })

  it('treats unknown ids as creates, never touching foreign rows', () => {
    const diff = diffRunSheetRows(existing, [
      row({ id: 'someone-elses-id', title: 'Sneaky edit' }),
      row({ id: 'id-1', title: 'Ceremony', time: '14:30', end_time: '15:00', location: 'Chapel', category: 'ceremony' }),
      row({ id: 'id-2', title: 'Portraits', time: '15:30', end_time: '15:00', location: 'Chapel', category: 'portraits' }),
    ])
    expect(diff.creates).toHaveLength(1)
    expect(diff.creates[0].title).toBe('Sneaky edit')
    expect(diff.deletes).toHaveLength(0)
  })

  it('treats a duplicated id as one update plus one create', () => {
    const diff = diffRunSheetRows(existing, [
      row({ id: 'id-1', title: 'Ceremony', time: '14:30', end_time: '15:00', location: 'Chapel', category: 'ceremony' }),
      row({ id: 'id-1', title: 'Ceremony copy', time: '14:30', end_time: '15:00', location: 'Chapel', category: 'ceremony' }),
      row({ id: 'id-2', title: 'Portraits', time: '15:30', end_time: '15:00', location: 'Chapel', category: 'portraits' }),
    ])
    expect(diff.creates).toHaveLength(1)
    expect(diff.creates[0].title).toBe('Ceremony copy')
    expect(diff.deletes).toHaveLength(0)
  })

  it('empty file rows deletes everything', () => {
    const diff = diffRunSheetRows(existing, [])
    expect(diff.deletes).toEqual(['id-1', 'id-2'])
  })
})
