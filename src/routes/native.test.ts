import { describe, expect, it } from 'vitest'
import native, { safeNativeRedirect } from './native'
import { MockD1Database } from '../storage/__tests__/mock-d1'
import { sha256Hex } from '../lib/crypto'

class MockKV {
  store = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
}

async function env() {
  const token = 'a'.repeat(64)
  const db = new MockD1Database()
  db.seed('users', [
    { id: 'user-1', email: 'vendor@example.com', name: 'Vendor', deleted_at: null },
  ])
  db.seed('vendor_profiles', [
    {
      id: 'vendor-1',
      user_id: 'user-1',
      business_name: 'Vendor',
      ical_token: `sha256:${await sha256Hex(token)}`,
    },
  ])
  db.seed('subscriptions', [
    { id: 'sub-1', vendor_id: 'vendor-1', plan: 'pro', status: 'active' },
  ])
  db.seed('sessions', [])
  db.seed('audit_log', [])

  return {
    token,
    bindings: {
      DB: db,
      KV: new MockKV(),
      APP_URL: 'https://wedding.computer',
    } as any,
  }
}

describe('safeNativeRedirect', () => {
  it('keeps handoff redirects inside the app', () => {
    const requestUrl = 'https://wedding.computer/native/web-session'
    expect(safeNativeRedirect('/app/contacts/abc?tab=notes', requestUrl)).toBe('/app/contacts/abc?tab=notes')
    expect(safeNativeRedirect('https://wedding.computer/app/calendar', requestUrl)).toBe('/app/calendar')
    expect(safeNativeRedirect('https://evil.example/app', requestUrl)).toBe('/app')
    expect(safeNativeRedirect('/pricing', requestUrl)).toBe('/app')
    expect(safeNativeRedirect('//evil.example/app', requestUrl)).toBe('/app')
  })
})

describe('native web session handoff', () => {
  it('mints a one-use session URL from a valid sync token', async () => {
    const { token, bindings } = await env()
    const issue = await native.request(
      'https://wedding.computer/native/web-session',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ redirect: '/app/contacts/contact-1' }),
      },
      bindings
    )

    expect(issue.status).toBe(200)
    const body = await issue.json() as { url: string; expires_in: number }
    expect(body.url).toMatch(/^https:\/\/wedding\.computer\/native\/web-session\/consume\?token=/)
    expect(body.expires_in).toBe(60)

    const consume = await native.request(body.url, {}, bindings)
    expect(consume.status).toBe(302)
    expect(consume.headers.get('location')).toBe('/app/contacts/contact-1')
    expect(consume.headers.get('set-cookie')).toContain('wc_session=')
    expect(bindings.DB.getTable('sessions')).toHaveLength(1)

    const replay = await native.request(body.url, {}, bindings)
    expect(replay.status).toBe(302)
    expect(replay.headers.get('location')).toBe('/login?error=Invalid+or+expired+native+session')
    expect(bindings.DB.getTable('sessions')).toHaveLength(1)
  })

  it('rejects invalid sync tokens before creating a handoff', async () => {
    const { bindings } = await env()
    const response = await native.request(
      'https://wedding.computer/native/web-session',
      { method: 'POST', headers: { Authorization: `Bearer ${'b'.repeat(64)}` } },
      bindings
    )

    expect(response.status).toBe(401)
    expect([...bindings.KV.store.keys()].some((key) => key.startsWith('native_handoff:'))).toBe(false)
  })

  it('falls back to /app for unsafe redirects', async () => {
    const { token, bindings } = await env()
    const issue = await native.request(
      'https://wedding.computer/native/web-session',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ redirect: 'https://evil.example/app' }),
      },
      bindings
    )
    const body = await issue.json() as { url: string }
    const consume = await native.request(body.url, {}, bindings)
    expect(consume.headers.get('location')).toBe('/app')
  })
})
