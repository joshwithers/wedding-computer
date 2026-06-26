import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import marketing from './marketing'

function buildApp() {
  const app = new Hono()
  app.route('/', marketing)
  return app
}

function mockEnv() {
  const kv = new Map<string, string>()
  let prompt = ''

  return {
    env: {
      KV: {
        get: async (key: string) => kv.get(key) ?? null,
        put: async (key: string, value: string) => void kv.set(key, value),
      },
      AI: {
        run: async (_model: string, options: { messages: Array<{ content: string }> }) => {
          prompt = options.messages.at(-1)?.content ?? ''
          return { response: '# Condiciones traducidas\n\nTexto traducido.' }
        },
      },
    },
    getPrompt: () => prompt,
  }
}

describe('terms page', () => {
  it('explains the terms and offers AI translation', async () => {
    const res = await buildApp().request('/terms')
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('These Terms and Conditions explain the rules for using Wedding Computer')
    expect(html).toContain('we offer these terms in English as the legally controlling version')
    expect(html).toContain('Translate these terms with AI')
  })

  it('translates the published English terms through the AI endpoint', async () => {
    const { env, getPrompt } = mockEnv()
    const res = await buildApp().request(
      '/terms/translate',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '203.0.113.10',
        },
        body: JSON.stringify({ locale: 'es-ES' }),
      },
      env,
    )
    const data = await res.json() as { language: string; translation: string }

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(data.language).toBe('Español')
    expect(data.translation).toContain('Condiciones traducidas')
    expect(getPrompt()).toContain('# Terms and Conditions')
    expect(getPrompt()).toContain('Snow Withers Trust (ABN 37 709 073 991)')
  })
})
