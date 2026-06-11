import { describe, it, expect } from 'vitest'
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_KEYS,
  parseNotificationPrefs,
  isNotificationEnabled,
  makeUnsubscribeToken,
  verifyUnsubscribeToken,
  unsubscribeUrl,
} from './notification-prefs'

const SECRET = 'test-secret-key-for-hmac-signing'

describe('NOTIFICATION_TYPES registry', () => {
  it('has unique keys', () => {
    const keys = NOTIFICATION_TYPES.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every type has a label and description', () => {
    for (const t of NOTIFICATION_TYPES) {
      expect(t.labelKey.length).toBeGreaterThan(0)
      expect(t.descriptionKey.length).toBeGreaterThan(0)
    }
  })

  it('NOTIFICATION_KEYS mirrors the registry', () => {
    expect(NOTIFICATION_KEYS.size).toBe(NOTIFICATION_TYPES.length)
    for (const t of NOTIFICATION_TYPES) expect(NOTIFICATION_KEYS.has(t.key)).toBe(true)
  })
})

describe('parseNotificationPrefs', () => {
  it('treats null/empty/invalid as all-enabled defaults', () => {
    expect(parseNotificationPrefs(null)).toEqual({})
    expect(parseNotificationPrefs(undefined)).toEqual({})
    expect(parseNotificationPrefs('')).toEqual({})
    expect(parseNotificationPrefs('not json')).toEqual({})
    expect(parseNotificationPrefs('[1,2]')).toEqual({})
    expect(parseNotificationPrefs('"str"')).toEqual({})
  })

  it('parses a valid prefs object and coerces values to booleans', () => {
    expect(parseNotificationPrefs('{"enquiries":false,"daily_digest":1}')).toEqual({
      enquiries: false,
      daily_digest: true,
    })
  })
})

describe('isNotificationEnabled', () => {
  it('missing key = enabled (opt-out model)', () => {
    expect(isNotificationEnabled('{}', 'enquiries')).toBe(true)
    expect(isNotificationEnabled(null, 'daily_digest')).toBe(true)
  })

  it('explicit false disables, explicit true enables', () => {
    const prefs = '{"enquiries":false,"announcements":true}'
    expect(isNotificationEnabled(prefs, 'enquiries')).toBe(false)
    expect(isNotificationEnabled(prefs, 'announcements')).toBe(true)
    expect(isNotificationEnabled(prefs, 'invoices')).toBe(true)
  })
})

describe('unsubscribe tokens', () => {
  it('round-trips a valid token', async () => {
    const token = await makeUnsubscribeToken(SECRET, 'user123abc', 'payment_reminders')
    const parsed = await verifyUnsubscribeToken(SECRET, token)
    expect(parsed).toEqual({ userId: 'user123abc', key: 'payment_reminders' })
  })

  it('rejects a tampered user id', async () => {
    const token = await makeUnsubscribeToken(SECRET, 'user123abc', 'enquiries')
    const [, key, sig] = token.split('.')
    expect(await verifyUnsubscribeToken(SECRET, `otheruser.${key}.${sig}`)).toBeNull()
  })

  it('rejects a swapped notification key', async () => {
    const token = await makeUnsubscribeToken(SECRET, 'user123abc', 'enquiries')
    const [userId, , sig] = token.split('.')
    expect(await verifyUnsubscribeToken(SECRET, `${userId}.announcements.${sig}`)).toBeNull()
  })

  it('rejects unknown keys, malformed tokens, and wrong secrets', async () => {
    const token = await makeUnsubscribeToken(SECRET, 'u1', 'enquiries')
    expect(await verifyUnsubscribeToken('different-secret', token)).toBeNull()
    expect(await verifyUnsubscribeToken(SECRET, 'just-one-part')).toBeNull()
    expect(await verifyUnsubscribeToken(SECRET, 'a.b.c.d')).toBeNull()
    const [userId, , sig] = token.split('.')
    expect(await verifyUnsubscribeToken(SECRET, `${userId}.not_a_real_key.${sig}`)).toBeNull()
  })

  it('builds the unsubscribe URL with the token encoded', () => {
    expect(unsubscribeUrl('https://wedding.computer', 'abc.def.ghi')).toBe(
      'https://wedding.computer/email/unsubscribe?token=abc.def.ghi'
    )
  })
})
