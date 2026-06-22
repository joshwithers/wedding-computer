import { describe, it, expect } from 'vitest'
import type { CoupleVendor } from '../types'
import {
  formatRoleSlug,
  parseMemberRoles,
  rolesLabel,
  buildCredits,
  formatInstagramCredits,
  formatWebCredits,
  formatHtmlCredits,
} from './wedding-credits'

// Minimal member shape buildCredits reads (matches getWeddingMembers projection).
function member(over: Partial<Parameters<typeof buildCredits>[0][number]> = {}) {
  return {
    role: 'vendor',
    user_name: 'Jane Doe',
    business_name: null,
    vendor_profile_id: null,
    vendor_role: null,
    vendor_roles: null,
    vendor_instagram: null,
    invited_instagram: null,
    vendor_website: null,
    ...over,
  } as Parameters<typeof buildCredits>[0][number]
}

function coupleVendor(over: Partial<CoupleVendor> = {}): CoupleVendor {
  return {
    id: 'cv1', wedding_id: 'w1', name: 'Petals', category: 'florist', email: null, phone: null,
    website: null, instagram: null, notes: null, expected_price_cents: null, vendor_profile_id: null,
    status: 'booked', created_at: '', updated_at: '', ...over,
  }
}

describe('formatRoleSlug', () => {
  it('title-cases single and multi-word slugs', () => {
    expect(formatRoleSlug('photographer')).toBe('Photographer')
    expect(formatRoleSlug('content-creator')).toBe('Content Creator')
    expect(formatRoleSlug('wedding_planner')).toBe('Wedding Planner')
  })
})

describe('parseMemberRoles', () => {
  it('uses the JSON array when present', () => {
    expect(parseMemberRoles('["photographer","celebrant"]', 'photographer')).toEqual(['photographer', 'celebrant'])
  })
  it('falls back to the singular role when the array is empty or missing', () => {
    expect(parseMemberRoles(null, 'florist')).toEqual(['florist'])
    expect(parseMemberRoles('[]', 'florist')).toEqual(['florist'])
  })
  it('falls back to the singular role on malformed JSON', () => {
    expect(parseMemberRoles('not json', 'florist')).toEqual(['florist'])
  })
  it('returns [] when nothing is set', () => {
    expect(parseMemberRoles(null, null)).toEqual([])
  })
  it('drops non-string / empty entries', () => {
    expect(parseMemberRoles('["photographer", 3, "", "celebrant"]', null)).toEqual(['photographer', 'celebrant'])
  })
})

describe('rolesLabel', () => {
  it('joins multiple roles with a middot', () => {
    expect(rolesLabel(['celebrant', 'content-creator'])).toBe('Celebrant · Content Creator')
  })
  it('defaults to Vendor when empty', () => {
    expect(rolesLabel([])).toBe('Vendor')
  })
})

describe('buildCredits', () => {
  it('parses a member vendor_roles array into multiple roles', () => {
    const credits = buildCredits([member({ vendor_roles: '["celebrant","content-creator"]' })], [])
    expect(credits[0].roles).toEqual(['celebrant', 'content-creator'])
    expect(rolesLabel(credits[0].roles)).toBe('Celebrant · Content Creator')
  })

  it('falls back to the singular vendor_role', () => {
    const credits = buildCredits([member({ vendor_role: 'photographer' })], [])
    expect(credits[0].roles).toEqual(['photographer'])
  })

  it('uses invited_instagram when the vendor has no profile handle yet', () => {
    const credits = buildCredits([member({ invited_instagram: 'freshflorals' })], [])
    expect(credits[0].instagram).toBe('freshflorals')
  })

  it('prefers the real profile handle over the invited one', () => {
    const credits = buildCredits([member({ vendor_instagram: 'realhandle', invited_instagram: 'oldinvite' })], [])
    expect(credits[0].instagram).toBe('realhandle')
  })

  it('sanitizes a pasted Instagram URL down to a handle', () => {
    const credits = buildCredits([member({ invited_instagram: 'https://instagram.com/janedoe/?hl=en' })], [])
    expect(credits[0].instagram).toBe('janedoe')
  })

  it('includes booked couple-vendors and excludes non-booked', () => {
    const credits = buildCredits([], [
      coupleVendor({ name: 'Booked Co', status: 'booked' }),
      coupleVendor({ id: 'cv2', name: 'Maybe Co', status: 'considering' }),
    ])
    expect(credits.map((c) => c.name)).toEqual(['Booked Co'])
  })

  it('skips non-vendor members', () => {
    const credits = buildCredits([member({ role: 'couple', user_name: 'The Couple' })], [])
    expect(credits).toHaveLength(0)
  })

  it('does not double-credit a platform vendor mirrored into couple_vendors', () => {
    const credits = buildCredits(
      [member({ vendor_profile_id: 'vp1', business_name: 'Jane Doe Studio', vendor_role: 'photographer' })],
      [coupleVendor({ name: 'Jane Doe Studio', category: 'photographer', vendor_profile_id: 'vp1', status: 'booked' })]
    )
    expect(credits).toHaveLength(1)
    expect(credits[0].name).toBe('Jane Doe Studio')
  })

  it('still credits a couple-added vendor that has no platform membership', () => {
    const credits = buildCredits(
      [member({ vendor_profile_id: 'vp1', business_name: 'Photo Co' })],
      [coupleVendor({ name: 'Indie Florist', category: 'florist', vendor_profile_id: null, status: 'booked' })]
    )
    expect(credits.map((c) => c.name).sort()).toEqual(['Indie Florist', 'Photo Co'])
  })
})

describe('credit formatters with multiple roles', () => {
  const credits = buildCredits(
    [member({ business_name: 'Jane Doe Studio', vendor_roles: '["photographer","videographer"]', vendor_instagram: 'janedoe', vendor_website: 'janedoe.com' })],
    []
  )

  it('Instagram caption shows the combined role label', () => {
    expect(formatInstagramCredits(credits)).toBe('Photographer · Videographer: Jane Doe Studio @janedoe')
  })
  it('Markdown shows the combined role label + link', () => {
    expect(formatWebCredits(credits)).toBe('- **Photographer · Videographer:** [Jane Doe Studio](https://janedoe.com)')
  })
  it('HTML shows the combined role label + link', () => {
    expect(formatHtmlCredits(credits)).toContain('<strong>Photographer · Videographer:</strong>')
    expect(formatHtmlCredits(credits)).toContain('href="https://janedoe.com"')
  })
})
