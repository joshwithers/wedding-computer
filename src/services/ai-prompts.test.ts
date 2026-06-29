import { describe, it, expect } from 'vitest'
import {
  interpolatePrompt,
  resolvePromptTemplate,
  FALLBACK_ENQUIRY_REPLY,
} from './ai-prompts'
import type { Bindings } from '../types'

describe('interpolatePrompt', () => {
  it('substitutes known tokens', () => {
    expect(interpolatePrompt('Hi {name} from {city}', { name: 'Sam', city: 'Byron' }))
      .toBe('Hi Sam from Byron')
  })

  it('drops unknown tokens to empty (no leaked braces)', () => {
    expect(interpolatePrompt('Hi {name} {unknown}!', { name: 'Sam' })).toBe('Hi Sam !')
  })

  it('collapses the blank lines left by empty tokens', () => {
    const out = interpolatePrompt('A\n{x}\n{y}\n\nB', { x: '', y: '' })
    expect(out).toBe('A\n\nB')
  })

  it('trims surrounding whitespace', () => {
    expect(interpolatePrompt('  {x}  ', { x: 'hi' })).toBe('hi')
  })

  it('renders the real enquiry template into a clean prompt', () => {
    const out = interpolatePrompt(FALLBACK_ENQUIRY_REPLY, {
      vendorName: 'Bluebell',
      vendorCategory: 'photographer',
      contactName: 'Sam',
      requestedDate: 'Requested date: 2026-11-14',
      location: '',
      theirMessage: '',
      availabilityInfo: 'You ARE available on 2026-11-14.',
      instructionsBlock: '',
      replyNudge: '',
    })
    expect(out).toContain('You are a wedding photographer named Bluebell')
    expect(out).toContain('Requested date: 2026-11-14')
    // empty {location}/{theirMessage}/{instructionsBlock} leave no big gaps
    expect(out).not.toMatch(/\n{3,}/)
    expect(out).not.toContain('{')
  })
})

// Minimal D1 stub: returns whatever row is configured for the first() call.
function fakeEnv(row: { template: string } | null): Bindings {
  const db = {
    prepare() {
      return {
        bind() {
          return { first: async () => row }
        },
      }
    },
  }
  return { DB: db } as unknown as Bindings
}

describe('resolvePromptTemplate', () => {
  it('prefers a per-form override over everything', async () => {
    const env = fakeEnv({ template: 'admin row' })
    expect(await resolvePromptTemplate(env, 'enquiry_reply', '  custom per-form  ')).toBe('custom per-form')
  })

  it('falls back to the admin row when there is no per-form override', async () => {
    const env = fakeEnv({ template: 'admin row' })
    expect(await resolvePromptTemplate(env, 'enquiry_reply')).toBe('admin row')
    expect(await resolvePromptTemplate(env, 'enquiry_reply', '   ')).toBe('admin row')
  })

  it('falls back to the code default when there is no row', async () => {
    const env = fakeEnv(null)
    expect(await resolvePromptTemplate(env, 'enquiry_reply')).toBe(FALLBACK_ENQUIRY_REPLY)
  })

  it('falls back to the code default when the DB read throws', async () => {
    const db = { prepare() { throw new Error('db down') } }
    const env = { DB: db } as unknown as Bindings
    expect(await resolvePromptTemplate(env, 'enquiry_reply')).toBe(FALLBACK_ENQUIRY_REPLY)
  })
})
