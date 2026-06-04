type VendorSecretName = 'github_access_token' | 'anthropic_api_key'

const REF_PREFIX = 'kv:'

export function vendorSecretKey(vendorId: string, name: VendorSecretName): string {
  return `vendor_secret:${vendorId}:${name}`
}

export function secretRef(key: string): string {
  return `${REF_PREFIX}${key}`
}

export function isSecretRef(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(REF_PREFIX)
}

export function redactSecretValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? '[redacted]' : null
}

export async function putVendorSecret(
  kv: KVNamespace,
  vendorId: string,
  name: VendorSecretName,
  value: string
): Promise<string> {
  const key = vendorSecretKey(vendorId, name)
  await kv.put(key, value)
  return secretRef(key)
}

export async function deleteVendorSecret(
  kv: KVNamespace,
  vendorId: string,
  name: VendorSecretName
): Promise<void> {
  await kv.delete(vendorSecretKey(vendorId, name))
}

export async function resolveSecret(
  kv: KVNamespace,
  value: string | null | undefined
): Promise<string | null> {
  if (!value) return null

  if (value.startsWith(REF_PREFIX)) {
    return kv.get(value.slice(REF_PREFIX.length))
  }

  // Backward compatibility for secrets stored before KV references existed.
  return value
}
