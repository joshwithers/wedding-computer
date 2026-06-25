import { describe, expect, it } from 'vitest'
import { WeddingDoc } from './wedding-doc'

describe('WeddingDoc polling script', () => {
  it('uses visibility-aware self-scheduling instead of a fixed interval', () => {
    const html = String(WeddingDoc({
      baseUrl: '/app/weddings/w1/docs',
      csrfToken: 'csrf',
      tabs: [{
        scope: 'shared',
        content: 'Hello',
        token: 'tok',
        canWrite: true,
        solo: false,
      }],
    }))
    expect(html).toContain('visibilitychange')
    expect(html).toContain('POLL_IDLE_MS=15000')
    expect(html).toContain('schedulePoll')
    expect(html).not.toContain('setInterval')
  })
})
