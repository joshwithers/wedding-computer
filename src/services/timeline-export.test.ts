import { describe, it, expect } from 'vitest'
import {
  singleSharedLocation,
  selectRunSheetMoments,
  buildRunSheetPages,
  buildWallpaperHtml,
  DEFAULT_PALETTE,
  type RunSheetMoment,
} from './timeline-export'
import type { TimelineItemView } from '../db/timeline'

// Minimal TimelineItemView factory — only the fields the export functions read
// matter; the rest get harmless defaults.
function item(p: Partial<TimelineItemView>): TimelineItemView {
  return {
    id: 'i1',
    wedding_id: 'w1',
    start_time: '10:00',
    end_time: null,
    title: 'Item',
    description: null,
    location: null,
    category: 'other',
    owner_vendor_id: null,
    created_by_user_id: null,
    visibility: 'couple',
    slot: null,
    sort_order: 0,
    duration_minutes: null,
    anchor_type: null,
    anchor_ref: null,
    anchor_offset_minutes: 0,
    pinned: 0,
    actual_start: null,
    marker: null,
    created_at: '',
    updated_at: '',
    assignees: [],
    ...p,
  }
}

describe('singleSharedLocation', () => {
  it('returns the venue when every scheduled item shares it', () => {
    const items = [
      item({ location: 'The Barn' }),
      item({ location: 'The Barn' }),
      item({ location: '  The Barn  ' }), // trimmed
    ]
    expect(singleSharedLocation(items)).toBe('The Barn')
  })

  it('treats blank locations as unspecified, not a second venue', () => {
    const items = [item({ location: 'The Barn' }), item({ location: null }), item({ location: '' })]
    expect(singleSharedLocation(items)).toBe('The Barn')
  })

  it('returns undefined when venues differ', () => {
    const items = [item({ location: 'The Barn' }), item({ location: 'The Chapel' })]
    expect(singleSharedLocation(items)).toBeUndefined()
  })

  it('ignores sun markers and empty sets', () => {
    expect(singleSharedLocation([item({ marker: 'sunset', location: 'Sky' }), item({ location: 'The Barn' })])).toBe('The Barn')
    expect(singleSharedLocation([])).toBeUndefined()
  })
})

describe('selectRunSheetMoments', () => {
  it('carries description and end time, chronological, skipping untimed', () => {
    const moments = selectRunSheetMoments([
      item({ start_time: null, title: 'No time' }),
      item({ start_time: '15:00', end_time: '15:30', title: 'Ceremony', description: '  Vows by the oak  ' }),
      item({ start_time: '10:00', title: 'Hair', description: null }),
    ])
    expect(moments.map((m) => m.title)).toEqual(['Hair', 'Ceremony'])
    expect(moments[1]).toMatchObject({ time: '3pm', endTime: '3:30pm', description: 'Vows by the oak' })
    expect(moments[0].description).toBeUndefined()
  })

  it('truncates a pathologically long description (page-overflow backstop)', () => {
    const long = 'x'.repeat(5000)
    const [m] = selectRunSheetMoments([item({ start_time: '10:00', description: long })])
    expect(m.description!.length).toBeLessThanOrEqual(1500)
    expect(m.description!.endsWith('…')).toBe(true)
  })
})

describe('buildRunSheetPages', () => {
  const moment = (n: number, description?: string): RunSheetMoment => ({
    time: `${n}:00`,
    title: `Moment ${n}`,
    description,
    location: 'Venue',
  })

  it('keeps every row across page breaks (none dropped)', () => {
    const items = Array.from({ length: 40 }, (_, i) => moment(i))
    const pages = buildRunSheetPages({ partners: [{ first: 'A' }], dateLabel: 'today', items, palette: DEFAULT_PALETTE })
    expect(pages.length).toBeGreaterThan(1)
    const all = pages.join('')
    for (let i = 0; i < 40; i++) expect(all).toContain(`Moment ${i}`)
    // Page labels reflect the real page count.
    expect(pages[0]).toContain(`Page 1 / ${pages.length}`)
  })

  it('long descriptions force more pages than the same count of bare rows', () => {
    const bare = Array.from({ length: 12 }, (_, i) => moment(i))
    const verbose = Array.from({ length: 12 }, (_, i) => moment(i, 'A long note. '.repeat(20)))
    const barePages = buildRunSheetPages({ partners: [], dateLabel: '', items: bare, palette: DEFAULT_PALETTE })
    const verbosePages = buildRunSheetPages({ partners: [], dateLabel: '', items: verbose, palette: DEFAULT_PALETTE })
    expect(verbosePages.length).toBeGreaterThan(barePages.length)
  })

  it('always renders a page, even with no items', () => {
    const pages = buildRunSheetPages({ partners: [], dateLabel: '', items: [], palette: DEFAULT_PALETTE })
    expect(pages.length).toBe(1)
  })
})

describe('buildWallpaperHtml', () => {
  const base = {
    partners: [
      { first: 'Olivia', last: 'Martin' },
      { first: 'James', last: 'Wilson' },
    ],
    dateLabel: 'Jul 12, 2026',
    items: [{ time: '3pm', title: 'Ceremony' }],
    palette: DEFAULT_PALETTE,
  }

  it('renders surnames, the address line and the sunset cue', () => {
    const html = buildWallpaperHtml({ ...base, locationLabel: 'The Barn', sunsetLabel: '5:18pm' })
    expect(html).toContain('Olivia')
    expect(html).toContain('Martin')
    expect(html).toContain('Wilson')
    expect(html).toContain('The Barn')
    expect(html).toContain('Sunset 5:18pm')
  })

  it('omits the sunset line when there is no sunset', () => {
    expect(buildWallpaperHtml(base)).not.toContain('Sunset')
  })
})
