// Tests for applyWeddingUpdate — the field-shaped writer the vendor + couple
// wedding-edit forms, their approved-change applier, and wedding creation all go
// through. It must route headline TIME fields onto the timeline_items slot rows
// (the source of truth) and never write those slot columns directly (the
// projection would clobber them), while still writing non-slot fields directly.

import { describe, it, expect, beforeEach } from 'vitest'
import { applyWeddingUpdate, deleteItem, projectTimelineToWedding, updateItem } from './timeline'
import { MockD1Database } from '../storage/__tests__/mock-d1'

const WID = 'wedding-1'

function makeWedding(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: WID,
    title: 'Sam & Lee',
    date: '2026-09-01',
    time: null,
    ceremony_location: null,
    getting_ready_time: null,
    getting_ready_location: null,
    getting_ready_1_label: null,
    getting_ready_2_time: null,
    getting_ready_2_location: null,
    getting_ready_2_label: null,
    portrait_time: null,
    portrait_location: null,
    reception_time: null,
    reception_location: null,
    title_was: 'Sam & Lee',
    notes: null,
    ...over,
  }
}

function ceremonyRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'item-ceremony',
    wedding_id: WID,
    start_time: '15:00',
    end_time: null,
    title: 'Ceremony',
    description: null,
    location: null,
    category: 'ceremony',
    owner_vendor_id: null,
    created_by_user_id: 'u1',
    visibility: 'couple',
    slot: 'ceremony',
    sort_order: 30,
    ...over,
  }
}

describe('applyWeddingUpdate', () => {
  let db: MockD1Database
  beforeEach(() => {
    db = new MockD1Database()
    db.seed('timeline_items', [])
    db.seed('weddings', [makeWedding()])
  })

  it('seeds a ceremony slot row from a headline time (creation, no current)', async () => {
    await applyWeddingUpdate(db as any, WID, { time: '15:00' }, 'u1')

    const items = db.getTable('timeline_items')
    expect(items).toHaveLength(1)
    const cer = items[0]
    expect(cer.slot).toBe('ceremony')
    expect(cer.start_time).toBe('15:00')
    expect(cer.category).toBe('ceremony')
    expect(cer.visibility).toBe('couple') // shared headline row, not vendor-private
    expect(cer.owner_vendor_id).toBeNull()

    // The derived column reflects the row.
    expect(db.getTable('weddings')[0].time).toBe('15:00')
  })

  it('routes a changed headline time onto the slot ROW (not just the column)', async () => {
    db.seed('timeline_items', [ceremonyRow({ start_time: '15:00' })])
    db.seed('weddings', [makeWedding({ time: '15:00' })])

    await applyWeddingUpdate(
      db as any,
      WID,
      { time: '16:00', title: 'New title', notes: 'hello' },
      'u1',
      makeWedding({ time: '15:00' })
    )

    // The slot ROW is the source of truth that changed (pre-consolidation only the
    // column would have moved).
    const cer = db.getTable('timeline_items').find((i) => i.slot === 'ceremony')!
    expect(cer.start_time).toBe('16:00')
    // No second ceremony row was created.
    expect(db.getTable('timeline_items').filter((i) => i.slot === 'ceremony')).toHaveLength(1)

    // The derived column reflects the row, and non-slot fields applied too.
    expect(db.getTable('weddings')[0].time).toBe('16:00')
    expect(db.getTable('weddings')[0].title).toBe('New title')
    expect(db.getTable('weddings')[0].notes).toBe('hello')
  })

  it('skips an unchanged slot field — no blank/duplicate rows, no needless row write', async () => {
    db.seed('timeline_items', [ceremonyRow({ start_time: '15:00' })])
    db.seed('weddings', [makeWedding({ time: '15:00' })])

    await applyWeddingUpdate(
      db as any,
      WID,
      { time: '15:00', title: 'Renamed' },
      'u1',
      makeWedding({ time: '15:00' })
    )

    // Still exactly one ceremony row, untouched start_time.
    const ceremonies = db.getTable('timeline_items').filter((i) => i.slot === 'ceremony')
    expect(ceremonies).toHaveLength(1)
    expect(ceremonies[0].start_time).toBe('15:00')

    // The unchanged slot was not re-inserted.
    const inserts = db.queries.filter((q) => /INSERT INTO\s+timeline_items/i.test(q.sql))
    expect(inserts).toHaveLength(0)

    // Non-slot field still applied.
    expect(db.getTable('weddings')[0].title).toBe('Renamed')
  })

  // ── Regression: a headline location/label can exist WITHOUT a time, so its slot
  // has no row. Earlier the projection blanked any row-less slot on every save. ──

  it('does NOT blank a row-less location/label when an unrelated field is edited', async () => {
    // ceremony_location set, no time => no ceremony slot row (051 only backfills time-bearing slots).
    db.seed('timeline_items', [])
    db.seed('weddings', [makeWedding({ time: null, ceremony_location: "St Mary's Church" })])

    // Edit only a non-slot field; updateData still carries the unchanged ceremony_location.
    await applyWeddingUpdate(
      db as any, WID,
      { title: 'Sam & Lee', notes: 'park out back', time: null, ceremony_location: "St Mary's Church" },
      'u1',
      makeWedding({ time: null, ceremony_location: "St Mary's Church" })
    )

    // The venue survives — no ceremony row was created, projection left it alone.
    expect(db.getTable('timeline_items').filter((i) => i.slot === 'ceremony')).toHaveLength(0)
    expect(db.getTable('weddings')[0].ceremony_location).toBe("St Mary's Church")
    expect(db.getTable('weddings')[0].notes).toBe('park out back')
  })

  it('setting a time materialises a COMPLETE slot row, preserving an existing column-only location', async () => {
    db.seed('timeline_items', [])
    db.seed('weddings', [makeWedding({ time: null, ceremony_location: "St Mary's Church" })])

    // Vendor form sets the ceremony time; ceremony_location is resubmitted unchanged.
    await applyWeddingUpdate(
      db as any, WID,
      { time: '15:00', ceremony_location: "St Mary's Church", title: 'Sam & Lee' },
      'u1',
      makeWedding({ time: null, ceremony_location: "St Mary's Church" })
    )

    const cer = db.getTable('timeline_items').find((i) => i.slot === 'ceremony')!
    expect(cer.start_time).toBe('15:00')
    expect(cer.location).toBe("St Mary's Church") // not dropped
    expect(db.getTable('weddings')[0].ceremony_location).toBe("St Mary's Church")
    expect(db.getTable('weddings')[0].time).toBe('15:00')
  })

  it('couple form (omits ceremony_location) setting the time keeps the vendor-entered venue via current', async () => {
    db.seed('timeline_items', [])
    db.seed('weddings', [makeWedding({ time: null, ceremony_location: 'Garden Pavilion' })])

    // Couple weddingUpdates has time but NOT ceremony_location — sourced from current.
    await applyWeddingUpdate(
      db as any, WID,
      { time: '16:00', title: 'Sam & Lee', dress_code: 'black tie' },
      'u1',
      makeWedding({ time: null, ceremony_location: 'Garden Pavilion' })
    )

    const cer = db.getTable('timeline_items').find((i) => i.slot === 'ceremony')!
    expect(cer.location).toBe('Garden Pavilion')
    expect(db.getTable('weddings')[0].ceremony_location).toBe('Garden Pavilion')
  })

  it('deleting a slot row clears its derived columns (delete → clear under non-destructive projection)', async () => {
    db.seed('timeline_items', [ceremonyRow({ start_time: '15:00', location: 'Chapel' })])
    db.seed('weddings', [makeWedding({ time: '15:00', ceremony_location: 'Chapel' })])

    await deleteItem(db as any, WID, 'item-ceremony')

    expect(db.getTable('timeline_items').filter((i) => i.slot === 'ceremony')).toHaveLength(0)
    expect(db.getTable('weddings')[0].time).toBeNull()
    expect(db.getTable('weddings')[0].ceremony_location).toBeNull()
  })

  // ── Attr-level non-destructive projection: a slot ROW whose own attr is null
  // must not blank a column populated by another writer (e.g. the Obsidian
  // wedding.md sync writes ceremony_location straight to the column). ──

  it('projectTimelineToWedding preserves a column when the row attr is null', async () => {
    // Row exists with a time but null location; the column holds a venue from another writer.
    db.seed('timeline_items', [ceremonyRow({ start_time: '15:00', location: null })])
    db.seed('weddings', [makeWedding({ time: '12:00', ceremony_location: 'Synced Venue' })])

    await projectTimelineToWedding(db as any, WID)

    // The row's time wins; the row's null location does NOT clobber the column.
    expect(db.getTable('weddings')[0].time).toBe('15:00')
    expect(db.getTable('weddings')[0].ceremony_location).toBe('Synced Venue')
  })

  it('clearing a headline time via the form nulls the column but keeps the venue (partial clear)', async () => {
    db.seed('timeline_items', [ceremonyRow({ start_time: '15:00', location: 'Chapel' })])
    db.seed('weddings', [makeWedding({ time: '15:00', ceremony_location: 'Chapel' })])

    // Form clears the time, resubmits the location.
    await applyWeddingUpdate(
      db as any, WID,
      { time: null, ceremony_location: 'Chapel', title: 'Sam & Lee' },
      'u1',
      makeWedding({ time: '15:00', ceremony_location: 'Chapel' })
    )

    // The explicit clear lands on the column even though the projection won't write a null.
    expect(db.getTable('weddings')[0].time).toBeNull()
    // The venue survives, and the row persists (it still carries the location).
    expect(db.getTable('weddings')[0].ceremony_location).toBe('Chapel')
    const cer = db.getTable('timeline_items').find((i) => i.slot === 'ceremony')!
    expect(cer.start_time).toBeNull()
    expect(cer.location).toBe('Chapel')
  })

  it('emptying a slot (clear time AND location) removes the row — no ghost entry', async () => {
    db.seed('timeline_items', [ceremonyRow({ start_time: '15:00', location: 'Chapel' })])
    db.seed('weddings', [makeWedding({ time: '15:00', ceremony_location: 'Chapel' })])

    await applyWeddingUpdate(
      db as any, WID,
      { time: null, ceremony_location: null, title: 'Sam & Lee' },
      'u1',
      makeWedding({ time: '15:00', ceremony_location: 'Chapel' })
    )

    // No lingering all-null "Ceremony — —" row, and both columns cleared.
    expect(db.getTable('timeline_items').filter((i) => i.slot === 'ceremony')).toHaveLength(0)
    expect(db.getTable('weddings')[0].time).toBeNull()
    expect(db.getTable('weddings')[0].ceremony_location).toBeNull()
  })

  // ── Direct row edits (timeline UI / approved proposals) go through updateItem,
  // NOT applyWeddingUpdate. updateItem must reconcile the slot's columns too. ──

  it('updateItem clearing a slot time (timeline UI / approval path) nulls the column, not just the row', async () => {
    db.seed('timeline_items', [ceremonyRow({ start_time: '15:00', location: 'Chapel' })])
    db.seed('weddings', [makeWedding({ time: '15:00', ceremony_location: 'Chapel' })])

    await updateItem(db as any, WID, 'item-ceremony', { start_time: null })

    // The derived column reflects the clear (it would otherwise broadcast a stale
    // ceremony time to iCal/CalDAV/NOIM).
    expect(db.getTable('weddings')[0].time).toBeNull()
    // Location untouched on both row and column.
    expect(db.getTable('weddings')[0].ceremony_location).toBe('Chapel')
    const cer = db.getTable('timeline_items').find((i) => i.slot === 'ceremony')!
    expect(cer.start_time).toBeNull()
    expect(cer.location).toBe('Chapel')
  })

  it('updateItem emptying a slot (clear time + location) drops the row and clears columns — no ghost', async () => {
    db.seed('timeline_items', [ceremonyRow({ start_time: '15:00', location: 'Chapel' })])
    db.seed('weddings', [makeWedding({ time: '15:00', ceremony_location: 'Chapel' })])

    await updateItem(db as any, WID, 'item-ceremony', { start_time: null, location: null })

    expect(db.getTable('timeline_items').filter((i) => i.slot === 'ceremony')).toHaveLength(0)
    expect(db.getTable('weddings')[0].time).toBeNull()
    expect(db.getTable('weddings')[0].ceremony_location).toBeNull()
  })

  it('updateItem on a freeform (non-slot) row does not touch any wedding column', async () => {
    db.seed('timeline_items', [{
      id: 'free-1', wedding_id: WID, start_time: '17:00', end_time: null, title: 'Cake', description: null,
      location: 'Hall', category: 'reception', owner_vendor_id: 'v1', created_by_user_id: 'u1',
      visibility: 'vendors', slot: null, sort_order: 5,
    }])
    db.seed('weddings', [makeWedding({ time: '15:00', ceremony_location: 'Chapel' })])

    await updateItem(db as any, WID, 'free-1', { start_time: '18:00' })

    // Freeform edit changes only the row; headline columns are untouched.
    expect(db.getTable('weddings')[0].time).toBe('15:00')
    expect(db.getTable('weddings')[0].ceremony_location).toBe('Chapel')
    expect(db.getTable('timeline_items').find((i) => i.id === 'free-1')!.start_time).toBe('18:00')
  })
})
