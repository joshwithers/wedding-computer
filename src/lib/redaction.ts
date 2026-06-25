import type { VendorProfile } from '../types'
import { isSecretRef, redactSecretValue } from '../services/secrets'

// Storage/driver/runtime internals that must never reach a client (they leak
// schema, table names, hostnames, or implementation detail useful to an
// attacker). Anything matching is replaced with a generic message.
const ERROR_INTERNALS =
  /\b(D1_ERROR|SQLITE|SQLITE_\w+|R2|KV|fetch failed|ECONN\w*|ETIMEDOUT|EAI_AGAIN|getaddrinfo|TypeError|ReferenceError|SyntaxError|RangeError|InternalError|stack|at \w+ \(|cannot read propert|is not a function|is not defined|Workers? AI|Anthropic)\b/i

/**
 * Turn an arbitrary thrown value into a single-line, length-capped message
 * safe to show a client (in a redirect ?error=, a flash, or a JSON body).
 * Intentional validation messages (a plain `throw new Error('Name required')`)
 * pass through; storage/driver/runtime internals are scrubbed to `fallback`.
 * Always log the original server-side — this is only for the client-facing copy.
 */
export function safeErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  let raw = ''
  if (err instanceof Error) raw = err.message
  else if (typeof err === 'string') raw = err
  else if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    raw = (err as { message: string }).message
  }
  const msg = raw.split('\n')[0].slice(0, 200).trim()
  if (!msg || ERROR_INTERNALS.test(msg)) return fallback
  return msg
}

export function redactedVendorProfile(vendor: VendorProfile): VendorProfile {
  const redacted: VendorProfile = {
    ...vendor,
    anthropic_api_key: redactSecretValue(vendor.anthropic_api_key),
    // Legacy rows may hold the sync token raw, and the enquiry intake key is
    // always raw — neither credential may leave the system in an export.
    ical_token: vendor.ical_token ? '[redacted]' : null,
    enquiry_key: vendor.enquiry_key ? '[redacted]' : null,
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
