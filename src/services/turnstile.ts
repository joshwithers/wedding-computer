export async function verifyTurnstile(
  secretKey: string,
  token: string,
  ip: string | null
): Promise<boolean> {
  const body = new URLSearchParams()
  body.append('secret', secretKey)
  body.append('response', token)
  if (ip) body.append('remoteip', ip)

  try {
    const res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body }
    )
    const data = (await res.json()) as { success: boolean }
    return data.success === true
  } catch {
    return false
  }
}
