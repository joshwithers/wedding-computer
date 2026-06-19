import { describe, it, expect } from 'vitest'
import {
  canReadDoc,
  canWriteDoc,
  readableScopes,
  isDocScope,
  isSoloScope,
  scopeLabelKey,
  DOC_SCOPES,
  type DocMembership,
} from './doc-permissions'

const vendor: DocMembership = { role: 'vendor', can_manage: 0 }
const managingVendor: DocMembership = { role: 'vendor', can_manage: 1 }
const couple: DocMembership = { role: 'couple', can_manage: 0 }
const guest: DocMembership = { role: 'guest', can_manage: 0 }

describe('canReadDoc', () => {
  it('lets any member read the shared doc', () => {
    for (const m of [vendor, managingVendor, couple, guest]) {
      expect(canReadDoc(m, 'shared')).toBe(true)
    }
  })

  it('keeps the vendors doc to vendors and the couple doc to the couple', () => {
    expect(canReadDoc(vendor, 'vendors')).toBe(true)
    expect(canReadDoc(couple, 'vendors')).toBe(false)
    expect(canReadDoc(guest, 'vendors')).toBe(false)

    expect(canReadDoc(couple, 'couple')).toBe(true)
    expect(canReadDoc(vendor, 'couple')).toBe(false)
    expect(canReadDoc(guest, 'couple')).toBe(false)
  })

  it('keeps the private doc to vendors (each sees only their own)', () => {
    expect(canReadDoc(vendor, 'private')).toBe(true)
    expect(canReadDoc(managingVendor, 'private')).toBe(true)
    expect(canReadDoc(couple, 'private')).toBe(false)
    expect(canReadDoc(guest, 'private')).toBe(false)
  })
})

describe('canWriteDoc', () => {
  it('lets any vendor write the shared doc; couples read but cannot edit', () => {
    expect(canWriteDoc(vendor, 'shared')).toBe(true)
    expect(canWriteDoc(managingVendor, 'shared')).toBe(true)
    expect(canWriteDoc(couple, 'shared')).toBe(false)
    expect(canWriteDoc(guest, 'shared')).toBe(false)
  })

  it('lets vendors write the vendors doc and the couple write the couple doc', () => {
    expect(canWriteDoc(vendor, 'vendors')).toBe(true)
    expect(canWriteDoc(couple, 'vendors')).toBe(false)
    expect(canWriteDoc(couple, 'couple')).toBe(true)
    expect(canWriteDoc(vendor, 'couple')).toBe(false)
  })

  it('lets any vendor write their own private note', () => {
    expect(canWriteDoc(vendor, 'private')).toBe(true)
    expect(canWriteDoc(couple, 'private')).toBe(false)
    expect(canWriteDoc(guest, 'private')).toBe(false)
  })
})

describe('readableScopes', () => {
  it('returns scopes in display order per role', () => {
    expect(readableScopes(vendor)).toEqual(['shared', 'vendors', 'private'])
    expect(readableScopes(couple)).toEqual(['shared', 'couple'])
    expect(readableScopes(guest)).toEqual(['shared'])
  })
})

describe('isSoloScope', () => {
  it('marks only the private scope as solo (no presence/lock)', () => {
    expect(isSoloScope('private')).toBe(true)
    expect(isSoloScope('shared')).toBe(false)
    expect(isSoloScope('vendors')).toBe(false)
    expect(isSoloScope('couple')).toBe(false)
  })
})

describe('isDocScope', () => {
  it('accepts the three known scopes and rejects anything else', () => {
    for (const s of DOC_SCOPES) expect(isDocScope(s)).toBe(true)
    expect(isDocScope('heartbeat')).toBe(false)
    expect(isDocScope('')).toBe(false)
    expect(isDocScope(null)).toBe(false)
    expect(isDocScope(undefined)).toBe(false)
  })
})

describe('scopeLabelKey', () => {
  it('maps each scope to its i18n tab key', () => {
    expect(scopeLabelKey('shared')).toBe('docs.tab.everyone')
    expect(scopeLabelKey('vendors')).toBe('docs.tab.vendors')
    expect(scopeLabelKey('couple')).toBe('docs.tab.couple')
    expect(scopeLabelKey('private')).toBe('docs.tab.private')
  })
})
