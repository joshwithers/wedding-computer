import { describe, it, expect } from 'vitest'
import { buildSetupChecklist, categorySetup } from './onboarding'
import { VENDOR_CATEGORIES } from '../types'

const emptyVendor = {
  phone: null,
  website: null,
  bio: null,
  location: null,
  location_city: null,
  email_handle: null,
  stripe_onboarding_complete: 0,
  enquiry_form: null,
}

describe('buildSetupChecklist', () => {
  it('reports nothing done for a fresh vendor', () => {
    const r = buildSetupChecklist(emptyVendor, { contacts: 0, events: 0 })
    expect(r.total).toBe(7)
    expect(r.doneCount).toBe(0)
    expect(r.percent).toBe(0)
    expect(r.items.every((i) => !i.done)).toBe(true)
  })

  it('reports 100% when everything is configured', () => {
    const r = buildSetupChecklist(
      {
        phone: '0400000000',
        website: 'https://x.com',
        bio: 'hi',
        location: 'Sydney',
        location_city: 'Sydney',
        email_handle: 'me',
        stripe_onboarding_complete: 1,
        enquiry_form: '{"version":1}',
      },
      { contacts: 3, events: 2 }
    )
    expect(r.doneCount).toBe(7)
    expect(r.percent).toBe(100)
  })

  it('counts partial progress and rounds the percentage', () => {
    // business (bio), email, contact done = 3 of 7
    const r = buildSetupChecklist(
      { ...emptyVendor, bio: 'hi', email_handle: 'me' },
      { contacts: 1, events: 0 }
    )
    expect(r.doneCount).toBe(3)
    expect(r.percent).toBe(43) // round(3/7*100)
  })

  it('treats any of phone/website/bio as business details, and location_city OR location', () => {
    expect(buildSetupChecklist({ ...emptyVendor, website: 'x' }, { contacts: 0, events: 0 }).items.find((i) => i.key === 'business')!.done).toBe(true)
    expect(buildSetupChecklist({ ...emptyVendor, location: 'Perth' }, { contacts: 0, events: 0 }).items.find((i) => i.key === 'location')!.done).toBe(true)
  })
})

describe('categorySetup', () => {
  it('gives celebrants a NOIM recommendation', () => {
    const s = categorySetup('celebrant')
    expect(s.recommended.some((r) => r.href === '/app/forms/new')).toBe(true)
  })

  it('falls back to a sensible default for unknown categories', () => {
    const s = categorySetup('spaceship-captain')
    expect(s.recommended.length).toBeGreaterThan(0)
    expect(s.recommended.some((r) => r.href === '/app/invoices')).toBe(true)
  })

  it('returns a non-empty recommendation set for every known category', () => {
    for (const cat of VENDOR_CATEGORIES) {
      const s = categorySetup(cat)
      expect(s.recommended.length, cat).toBeGreaterThan(0)
      expect(s.blurb.length, cat).toBeGreaterThan(0)
    }
  })
})
