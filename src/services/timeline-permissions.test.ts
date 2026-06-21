import { describe, it, expect } from 'vitest'
import {
  canSeeItem,
  canEditDirect,
  canPropose,
  canManageAssignees,
  canCreateDirect,
  creatableVisibilities,
  isTimelineLead,
  type TimelineViewer,
  type TimelineLead,
} from './timeline-permissions'

const vendorLead: TimelineViewer = { userId: 'v1', role: 'vendor', vendorProfileId: 'vp1' }
const vendorOther: TimelineViewer = { userId: 'v2', role: 'vendor', vendorProfileId: 'vp2' }
const couple: TimelineViewer = { userId: 'c1', role: 'couple', vendorProfileId: null }

const lead: TimelineLead = { leadUserIds: ['v1'], source: 'planner_venue' }

const coupleItem = { visibility: 'couple' as const, owner_vendor_id: null }
const vendorsItem = { visibility: 'vendors' as const, owner_vendor_id: 'vp2' }
const privateItem = { visibility: 'private' as const, owner_vendor_id: 'vp2' }

describe('canSeeItem', () => {
  it('couple-visible rows are seen by everyone', () => {
    expect(canSeeItem(coupleItem, vendorLead)).toBe(true)
    expect(canSeeItem(coupleItem, vendorOther)).toBe(true)
    expect(canSeeItem(coupleItem, couple)).toBe(true)
  })
  it('vendors-only rows hide from the couple', () => {
    expect(canSeeItem(vendorsItem, vendorLead)).toBe(true)
    expect(canSeeItem(vendorsItem, vendorOther)).toBe(true)
    expect(canSeeItem(vendorsItem, couple)).toBe(false)
  })
  it('private rows are seen only by the owning vendor', () => {
    expect(canSeeItem(privateItem, vendorOther)).toBe(true) // vp2 owns
    expect(canSeeItem(privateItem, vendorLead)).toBe(false)
    expect(canSeeItem(privateItem, couple)).toBe(false)
  })
})

describe('canEditDirect', () => {
  it('private rows: only the owner', () => {
    expect(canEditDirect(privateItem, vendorOther, lead)).toBe(true)
    expect(canEditDirect(privateItem, vendorLead, lead)).toBe(false)
  })
  it('shared rows: ONLY the lead edits directly', () => {
    expect(canEditDirect(coupleItem, vendorLead, lead)).toBe(true)
    expect(canEditDirect(vendorsItem, vendorLead, lead)).toBe(true)
    expect(canEditDirect(coupleItem, vendorOther, lead)).toBe(false)
    expect(canEditDirect(vendorsItem, vendorOther, lead)).toBe(false) // owner but not lead
    expect(canEditDirect(coupleItem, couple, lead)).toBe(false) // not lead
  })
})

describe('canPropose', () => {
  it('non-lead members can propose changes to shared rows they can see', () => {
    expect(canPropose(coupleItem, vendorOther, lead)).toBe(true)
    expect(canPropose(coupleItem, couple, lead)).toBe(true)
    expect(canPropose(vendorsItem, vendorOther, lead)).toBe(true)
  })
  it('the lead does not propose (they edit directly)', () => {
    expect(canPropose(coupleItem, vendorLead, lead)).toBe(false)
  })
  it('no proposals for private rows, or rows you cannot see', () => {
    expect(canPropose(privateItem, vendorOther, lead)).toBe(false)
    expect(canPropose(vendorsItem, couple, lead)).toBe(false) // couple can't see vendors row
  })
})

describe('canManageAssignees', () => {
  it('anyone who can see a shared row may manage its assignees', () => {
    expect(canManageAssignees(coupleItem, vendorOther, lead)).toBe(true)
    expect(canManageAssignees(coupleItem, couple, lead)).toBe(true)
    expect(canManageAssignees(vendorsItem, vendorOther, lead)).toBe(true)
    expect(canManageAssignees(vendorsItem, couple, lead)).toBe(false) // can't see it
  })
  it('private rows: owner only', () => {
    expect(canManageAssignees(privateItem, vendorOther, lead)).toBe(true)
    expect(canManageAssignees(privateItem, vendorLead, lead)).toBe(false)
  })
  it('sun markers are facts — nobody is "on" a sunrise', () => {
    const marker = { visibility: 'couple' as const, owner_vendor_id: null, marker: 'sunrise' as const }
    expect(canManageAssignees(marker, vendorLead, lead)).toBe(false)
    expect(canManageAssignees(marker, couple, lead)).toBe(false)
  })
})

describe('canCreateDirect', () => {
  it('private rows: any vendor; shared rows: lead only', () => {
    expect(canCreateDirect(vendorOther, lead, 'private')).toBe(true)
    expect(canCreateDirect(couple, lead, 'private')).toBe(false)
    expect(canCreateDirect(vendorLead, lead, 'couple')).toBe(true)
    expect(canCreateDirect(vendorOther, lead, 'couple')).toBe(false)
  })
})

describe('creatableVisibilities', () => {
  it('vendors can create in any scope; couples only couple-visible', () => {
    expect(creatableVisibilities(vendorOther)).toEqual(['couple', 'vendors', 'private'])
    expect(creatableVisibilities(couple)).toEqual(['couple'])
  })
})

describe('isTimelineLead', () => {
  it('matches lead user ids', () => {
    expect(isTimelineLead(lead, 'v1')).toBe(true)
    expect(isTimelineLead(lead, 'v2')).toBe(false)
  })
})
