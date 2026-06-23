import { describe, it, expect } from 'vitest'
import {
  splitName,
  partnersFromTitle,
  buildSharedCoupleFields,
  fillableFromShared,
  type CoupleAccount,
  type DonorContact,
  type SharedCoupleFields,
} from './couple-contact'

const account = (over: Partial<CoupleAccount> = {}): CoupleAccount => ({
  first: 'Sarah',
  last: 'Smith',
  email: 'sarah@example.com',
  phone: '0400111222',
  ...over,
})

const donor = (over: Partial<DonorContact> = {}): DonorContact => ({
  first_name: 'Sarah',
  last_name: 'Smith',
  partner_first_name: 'James',
  partner_last_name: 'Lee',
  email: 'sarah@example.com',
  partner_email: 'james@example.com',
  phone: '0400111222',
  partner_phone: '0400333444',
  address: '1 Beach Rd, Byron Bay',
  instagram: 'sarahandjames',
  facebook: 'sarahandjames',
  tiktok: null,
  website: 'https://sarahandjames.example',
  ...over,
})

describe('splitName', () => {
  it('splits first + rest', () => {
    expect(splitName('Sarah Jane Smith')).toEqual(['Sarah', 'Jane Smith'])
  })
  it('handles a single word and null', () => {
    expect(splitName('Cher')).toEqual(['Cher', ''])
    expect(splitName(null)).toEqual(['', ''])
  })
})

describe('partnersFromTitle', () => {
  it('parses "A & B" and "A and B"', () => {
    expect(partnersFromTitle('Sarah Smith & James Lee')).toEqual([
      { first: 'Sarah', last: 'Smith' },
      { first: 'James', last: 'Lee' },
    ])
    expect(partnersFromTitle('Sarah and James')[1]).toMatchObject({ first: 'James' })
  })
})

describe('buildSharedCoupleFields', () => {
  it('prefers couple accounts for names/email/phone', () => {
    const out = buildSharedCoupleFields([account(), account({ first: 'James', last: 'Lee', email: 'james@example.com', phone: '0400333444' })], null)
    expect(out).toMatchObject({
      first_name: 'Sarah', last_name: 'Smith', email: 'sarah@example.com', phone: '0400111222',
      partner_first_name: 'James', partner_last_name: 'Lee', partner_email: 'james@example.com', partner_phone: '0400333444',
    })
    // No donor → no address/socials.
    expect(out.address).toBeNull()
    expect(out.instagram).toBeNull()
  })

  it('backfills surname, address and socials from the donor when the account lacks them', () => {
    // Couple account has only a first name (no surname, no phone).
    const out = buildSharedCoupleFields([account({ last: '', phone: null })], donor())
    expect(out.last_name).toBe('Smith') // from donor
    expect(out.phone).toBe('0400111222') // from donor
    expect(out.address).toBe('1 Beach Rd, Byron Bay')
    expect(out.instagram).toBe('sarahandjames')
    expect(out.website).toBe('https://sarahandjames.example')
  })

  it('uses the donor entirely when the couple has no account yet', () => {
    const out = buildSharedCoupleFields([], donor())
    expect(out).toMatchObject({
      first_name: 'Sarah', last_name: 'Smith', email: 'sarah@example.com',
      partner_first_name: 'James', partner_last_name: 'Lee', partner_phone: '0400333444',
      address: '1 Beach Rd, Byron Bay',
    })
  })

  it('ignores a donor first_name that is an email, but keeps its address/socials', () => {
    const out = buildSharedCoupleFields(
      [account({ first: 'Sarah', last: '' })],
      donor({ first_name: 'placeholder@example.com', last_name: '' })
    )
    expect(out.first_name).toBe('Sarah') // account wins; donor email-name ignored
    expect(out.address).toBe('1 Beach Rd, Byron Bay') // donor socials/address still used
  })

  it('falls back to the email local-part when no usable name exists anywhere', () => {
    const out = buildSharedCoupleFields([account({ first: '', last: '', phone: null })], null)
    expect(out.first_name).toBe('sarah') // sarah@example.com → "sarah"
  })

  it('never returns whitespace-only values (treats them as blank)', () => {
    const out = buildSharedCoupleFields([account({ last: '   ' })], donor({ last_name: 'Smith' }))
    expect(out.last_name).toBe('Smith')
  })
})

describe('fillableFromShared', () => {
  const shared: SharedCoupleFields = buildSharedCoupleFields([], donor())

  it('fills only fields the existing contact is missing', () => {
    const existing: Partial<SharedCoupleFields> = { first_name: 'Sarah', last_name: 'Smith', address: null, instagram: '' }
    const patch = fillableFromShared(existing, shared)
    expect(patch.address).toBe('1 Beach Rd, Byron Bay')
    expect(patch.instagram).toBe('sarahandjames')
    // Present fields are left alone (not in the patch).
    expect('first_name' in patch).toBe(false)
    expect('last_name' in patch).toBe(false)
  })

  it('never overwrites a non-empty existing value, even if it differs', () => {
    const existing: Partial<SharedCoupleFields> = { address: '99 Other St' }
    const patch = fillableFromShared(existing, shared)
    expect('address' in patch).toBe(false)
  })

  it('omits fields that are blank in both', () => {
    const patch = fillableFromShared({ tiktok: null }, buildSharedCoupleFields([], donor({ tiktok: null })))
    expect('tiktok' in patch).toBe(false)
  })
})
