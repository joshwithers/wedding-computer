import type { VendorProfile } from '../types'
import { isSecretRef, redactSecretValue } from '../services/secrets'

export function redactedVendorProfile(vendor: VendorProfile): VendorProfile {
  const redacted: VendorProfile = {
    ...vendor,
    anthropic_api_key: redactSecretValue(vendor.anthropic_api_key),
  }

  if (vendor.storage_config) {
    try {
      const config = JSON.parse(vendor.storage_config) as Record<string, unknown>
      if (typeof config.git_access_token === 'string') {
        delete config.git_access_token
      }
      if (typeof config.git_access_token_ref === 'string') {
        config.git_access_token_ref = '[redacted]'
      }
      redacted.storage_config = JSON.stringify(config)
    } catch {
      redacted.storage_config = '[redacted]'
    }
  }

  if (isSecretRef(vendor.anthropic_api_key)) {
    redacted.anthropic_api_key = '[redacted]'
  }

  return redacted
}
