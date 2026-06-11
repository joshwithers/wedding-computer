import { describe, expect, it } from 'vitest'
import type { VendorProfile } from '../types'
import { redactedVendorProfile } from './redaction'

function vendor(overrides: Partial<VendorProfile>): VendorProfile {
  return {
    id: 'vendor-1',
    user_id: 'user-1',
    business_name: 'Test Vendor',
    category: 'celebrant',
    phone: null,
    website: null,
    instagram: null,
    bio: null,
    location: null,
    timezone: 'Australia/Sydney',
    stripe_account_id: null,
    stripe_onboarding_complete: 0,
    availability_default: null,
    is_organiser: 0,
    enquiry_form: null,
    booking_form: null,
    ceremony_types: null,
    ical_token: null,
    enquiry_key: null,
    anthropic_api_key: null,
    email_handle: null,
    storage_type: 'r2',
    storage_config: null,
    tax_label: null,
    tax_rate: 0,
    tax_inclusive: 1,
    tax_number: null,
    tax_number_label: null,
    business_address: null,
    invoice_prefix: 'INV-',
    next_invoice_number: 1,
    card_fee_enabled: 0,
    card_fee_percent: 0,
    service_templates: null,
    invoice_defaults: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('redactedVendorProfile', () => {
  it('redacts AI keys and GitHub token references from exports', () => {
    const result = redactedVendorProfile(vendor({
      anthropic_api_key: 'kv:vendor_secret:vendor-1:anthropic_api_key',
      storage_type: 'git',
      storage_config: JSON.stringify({
        type: 'git',
        git_provider: 'github',
        git_repo: 'owner/repo',
        git_branch: 'main',
        git_path: '',
        git_access_token_ref: 'kv:vendor_secret:vendor-1:github_access_token',
      }),
    }))

    expect(result.anthropic_api_key).toBe('[redacted]')
    expect(result.storage_config).not.toContain('vendor_secret')
    expect(result.storage_config).toContain('"git_access_token_ref":"[redacted]"')
  })

  it('removes legacy raw GitHub tokens from exports', () => {
    const result = redactedVendorProfile(vendor({
      anthropic_api_key: 'sk-ant-secret',
      storage_type: 'git',
      storage_config: JSON.stringify({
        type: 'git',
        git_provider: 'github',
        git_repo: 'owner/repo',
        git_access_token: 'ghp_secret',
      }),
    }))

    expect(result.anthropic_api_key).toBe('[redacted]')
    expect(result.storage_config).not.toContain('ghp_secret')
    expect(result.storage_config).not.toContain('git_access_token')
  })

  it('strips sync tokens from exports, hashed or legacy raw', () => {
    const hashed = redactedVendorProfile(vendor({
      ical_token: 'sha256:aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
    }))
    expect(hashed.ical_token).toBe('[redacted]')

    // Legacy rows store the raw token — a live credential if exported
    const legacy = redactedVendorProfile(vendor({ ical_token: 'aabbccddeeff00112233445566778899' }))
    expect(legacy.ical_token).toBe('[redacted]')
  })

  it('strips the enquiry intake key from exports', () => {
    const result = redactedVendorProfile(vendor({ enquiry_key: 'ek_aabbccddeeff001122334455' }))
    expect(result.enquiry_key).toBe('[redacted]')
  })

  it('leaves unset credentials null', () => {
    const result = redactedVendorProfile(vendor({}))
    expect(result.ical_token).toBeNull()
    expect(result.enquiry_key).toBeNull()
  })
})
