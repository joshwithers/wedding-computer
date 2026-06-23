import { describe, it, expect, vi, afterEach } from 'vitest'
import { redeemBankedMonthsToStripe } from './free-months'

// A live Pro subscriber: getSubscription returns this row, getVendorById returns
// the vendor with banked months. Override fields per test.
function activeSub(overrides: Record<string, unknown> = {}) {
  return {
    plan: 'pro',
    status: 'active',
    stripe_customer_id: 'cus_123',
    stripe_subscription_id: 'sub_123',
    ...overrides,
  }
}

// Minimal D1 fake: routes .first() by table and records the balance-zeroing
// UPDATE so a test can assert the months were (or weren't) redeemed.
function fakeDB({ sub, freeMonths }: { sub: unknown; freeMonths: number }) {
  const state = { zeroed: false }
  const DB = {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async first() {
              if (sql.includes('FROM subscriptions')) return sub
              if (sql.includes('FROM vendor_profiles')) return { free_months: freeMonths }
              return null
            },
            async run() {
              if (sql.includes('UPDATE vendor_profiles')) state.zeroed = true
              return { success: true }
            },
          }
        },
      }
    },
  }
  return { DB, state }
}

// Stub fetch for the two Stripe calls: GET subscription (→ its locked line-item
// price + currency) and POST the balance credit (captured for assertions).
// Pass `sub: null` to simulate a failed subscription lookup.
function stubStripe(sub: { unitAmount: number; currency: string } | null) {
  const captured: { amount?: string; currency?: string; called: boolean } = { called: false }
  const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (url.includes('/v1/subscriptions/')) {
      if (sub === null) return { ok: false, status: 404, json: async () => ({}) }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          currency: sub.currency,
          items: { data: [{ quantity: 1, price: { unit_amount: sub.unitAmount, currency: sub.currency } }] },
        }),
      }
    }
    if (url.includes('/balance_transactions')) {
      captured.called = true
      const params = new URLSearchParams(init?.body ?? '')
      captured.amount = params.get('amount') ?? undefined
      captured.currency = params.get('currency') ?? undefined
      return { ok: true, status: 200, text: async () => '' }
    }
    throw new Error('unexpected fetch ' + url)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { captured, fetchMock }
}

function makeEnv(DB: unknown) {
  return { DB, STRIPE_SECRET_KEY: 'sk_test' } as any
}

describe('redeemBankedMonthsToStripe', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("credits a USD subscriber in USD at the subscription's own locked price", async () => {
    const { DB, state } = fakeDB({ sub: activeSub(), freeMonths: 2 })
    // 2000 (US$20) is the locked price — deliberately NOT the $19 seed price, to
    // prove the credit mirrors what they actually pay, not the market rate.
    const { captured } = stubStripe({ unitAmount: 2000, currency: 'usd' })

    await redeemBankedMonthsToStripe(makeEnv(DB), 'v1')

    expect(captured.called).toBe(true)
    expect(captured.currency).toBe('usd')
    expect(captured.amount).toBe('-4000') // 2 × US$20, negative = credit
    expect(state.zeroed).toBe(true)
  })

  it('keeps AUD subscribers identical: A$28 × months credited in AUD', async () => {
    const { DB, state } = fakeDB({ sub: activeSub(), freeMonths: 3 })
    const { captured } = stubStripe({ unitAmount: 2800, currency: 'aud' })

    await redeemBankedMonthsToStripe(makeEnv(DB), 'v1')

    expect(captured.currency).toBe('aud')
    expect(captured.amount).toBe('-8400') // 3 × A$28 (2800 cents)
    expect(state.zeroed).toBe(true)
  })

  it('treats JPY as zero-decimal: the amount is whole yen, not cents', async () => {
    const { DB } = fakeDB({ sub: activeSub(), freeMonths: 1 })
    const { captured } = stubStripe({ unitAmount: 3200, currency: 'jpy' })

    await redeemBankedMonthsToStripe(makeEnv(DB), 'v1')

    expect(captured.currency).toBe('jpy')
    expect(captured.amount).toBe('-3200') // 1 × ¥3,200, NOT -320000
  })

  it('leaves months banked when the vendor is not an active subscriber', async () => {
    const { DB, state } = fakeDB({ sub: activeSub({ status: 'cancelled' }), freeMonths: 5 })
    const { fetchMock } = stubStripe({ unitAmount: 2000, currency: 'usd' })

    await redeemBankedMonthsToStripe(makeEnv(DB), 'v1')

    expect(fetchMock).not.toHaveBeenCalled() // returns before touching Stripe
    expect(state.zeroed).toBe(false)
  })

  it('does nothing when there are no banked months', async () => {
    const { DB, state } = fakeDB({ sub: activeSub(), freeMonths: 0 })
    const { fetchMock } = stubStripe({ unitAmount: 2000, currency: 'usd' })

    await redeemBankedMonthsToStripe(makeEnv(DB), 'v1')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.zeroed).toBe(false)
  })

  it('does not credit (and keeps months banked) when the subscription lookup fails', async () => {
    const { DB, state } = fakeDB({ sub: activeSub(), freeMonths: 2 })
    const { captured } = stubStripe(null) // subscription fetch 404s → price unknown

    await redeemBankedMonthsToStripe(makeEnv(DB), 'v1')

    expect(captured.called).toBe(false) // never posts a balance with a guessed amount
    expect(state.zeroed).toBe(false) // months stay banked for retry
  })
})
