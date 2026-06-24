import { describe, expect, it, vi } from 'vitest'
import type { Bindings, VendorProfile } from '../types'
import { getStorageWithSecrets } from '.'

function vendor(overrides: Partial<VendorProfile> = {}): VendorProfile {
  return {
    id: 'vendor-001',
    user_id: 'user-001',
    business_name: 'Test Vendor',
    category: 'celebrant',
    storage_type: 'r2',
    storage_config: null,
    logo_url: null,
    logo_r2_key: null,
    brand_color: null,
    secondary_color: null,
    accent_color: null,
    background_color: null,
    text_color: null,
    brand_font: null,
    heading_font: null,
    theme_json: null,
    bio: null,
    phone: null,
    website: null,
    instagram: null,
    facebook: null,
    tiktok: null,
    address: null,
    location_city: null,
    location_state: null,
    location_country: null,
    location_lat: null,
    location_lng: null,
    service_radius_km: null,
    public_handle: null,
    directory_listed: 0,
    default_tax_rate: null,
    invoice_prefix: null,
    invoice_next_number: null,
    payment_terms_days: null,
    stripe_account_id: null,
    stripe_charges_enabled: null,
    stripe_payouts_enabled: null,
    stripe_onboarding_complete: null,
    ical_token: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function r2Bucket(): R2Bucket {
  return {
    put: vi.fn(async (_key: string) => ({
      etag: 'r2-etag',
      size: 5,
      uploaded: new Date('2026-01-01T00:00:00.000Z'),
      key: _key,
      version: '',
      checksums: {},
      httpEtag: 'r2-etag',
      customMetadata: undefined,
      httpMetadata: undefined,
      range: undefined,
      writeHttpMetadata: vi.fn(),
    })),
    get: vi.fn(async () => null),
    head: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ objects: [], truncated: false })),
  } as unknown as R2Bucket
}

describe('getStorageWithSecrets', () => {
  it('routes legacy git vendors to R2 while GitHub sync is disabled', async () => {
    const bucket = r2Bucket()
    const env = { STORAGE: bucket } as unknown as Bindings
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const storage = await getStorageWithSecrets(env, vendor({
      storage_type: 'git',
      storage_config: JSON.stringify({
        git_repo: 'owner/repo',
        git_access_token_ref: 'kv:vendor_secret:vendor-001:github_access_token',
      }),
    }))

    await storage.write('contacts/sarah-smith.md', 'hello')

    expect(bucket.put).toHaveBeenCalledWith(
      'vendors/vendor-001/contacts/sarah-smith.md',
      'hello',
      expect.objectContaining({ httpMetadata: { contentType: 'text/markdown; charset=utf-8' } })
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('GitHub storage is disabled for launch'))
    warn.mockRestore()
  })
})
