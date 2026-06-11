// Internationalisation bedrock.
//
// Every request runs inside an AsyncLocalStorage context carrying the
// viewer's locale (BCP 47 tag, e.g. 'en-AU'), language ('en'), and IANA
// timezone. `t()` and the date helpers in lib/date.ts read that context, so
// any component or service can use them without prop-drilling — and code
// running outside a request (cron, queue consumers) silently gets the
// platform defaults unless wrapped in runWithI18n().
//
// Adding a language: create src/i18n/<lang>.ts satisfying Dictionary,
// register it in DICTIONARIES, and add its regional tags to
// SUPPORTED_LOCALES. Untranslated keys fall back to English at runtime.

import { AsyncLocalStorage } from 'node:async_hooks'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { it } from './it'
import { ja } from './ja'
import { nl } from './nl'
import { pt } from './pt'
import { zh } from './zh'

export type MessageKey = keyof typeof en
export type Dictionary = Partial<Record<MessageKey, string>>

// Language dictionaries. Regional variants (en-AU vs en-US) share a
// dictionary; the full locale tag drives date/number formatting.
const DICTIONARIES: Record<string, Dictionary> = { en, es, fr, it, ja, nl, pt, zh }

export const SUPPORTED_LOCALES = [
  { tag: 'en-AU', label: 'English (Australia)' },
  { tag: 'en-NZ', label: 'English (New Zealand)' },
  { tag: 'en-GB', label: 'English (UK)' },
  { tag: 'en-US', label: 'English (US)' },
  { tag: 'es-ES', label: 'Español (España)' },
  { tag: 'es-MX', label: 'Español (México)' },
  { tag: 'fr-FR', label: 'Français (France)' },
  { tag: 'fr-CA', label: 'Français (Canada)' },
  { tag: 'it-IT', label: 'Italiano (Italia)' },
  { tag: 'it-CH', label: 'Italiano (Svizzera)' },
  { tag: 'ja-JP', label: '日本語（日本）' },
  { tag: 'nl-NL', label: 'Nederlands (Nederland)' },
  { tag: 'nl-BE', label: 'Nederlands (België)' },
  { tag: 'pt-PT', label: 'Português (Portugal)' },
  { tag: 'pt-BR', label: 'Português (Brasil)' },
  { tag: 'zh-CN', label: '中文（简体，中国）' },
  { tag: 'zh-SG', label: '中文（简体，新加坡）' },
] as const

export type I18nContext = {
  locale: string // BCP 47, drives Intl date/number formatting
  language: string // primary subtag, picks the dictionary
  timezone: string // IANA zone, drives time-of-day rendering
}

export const DEFAULT_LOCALE = 'en-AU'
export const DEFAULT_TIMEZONE = 'Australia/Sydney'

const DEFAULT_CONTEXT: I18nContext = {
  locale: DEFAULT_LOCALE,
  language: 'en',
  timezone: DEFAULT_TIMEZONE,
}

const als = new AsyncLocalStorage<I18nContext>()

export function getI18n(): I18nContext {
  return als.getStore() ?? DEFAULT_CONTEXT
}

/** Run fn inside an i18n context (requests via middleware; jobs explicitly). */
export function runWithI18n<T>(ctx: Partial<I18nContext>, fn: () => T): T {
  const locale = ctx.locale ?? DEFAULT_LOCALE
  return als.run(
    {
      locale,
      language: primaryLanguage(locale),
      timezone: ctx.timezone ?? DEFAULT_TIMEZONE,
    },
    fn
  )
}

/**
 * Refine the active context once more is known — e.g. the auth middleware
 * applying the signed-in user's saved locale/timezone after the global
 * middleware seeded the context from Accept-Language.
 */
export function updateI18n(patch: { locale?: string | null; timezone?: string | null }): void {
  const store = als.getStore()
  if (!store) return
  if (patch.locale) {
    store.locale = patch.locale
    store.language = primaryLanguage(patch.locale)
  }
  if (patch.timezone) store.timezone = patch.timezone
}

function primaryLanguage(locale: string): string {
  return locale.split('-')[0].toLowerCase()
}

/**
 * Pick the locale for a request: the viewer's saved preference when valid,
 * otherwise the best Accept-Language match, otherwise the platform default.
 */
export function resolveLocale(stored?: string | null, acceptLanguage?: string | null): string {
  const supported = SUPPORTED_LOCALES.map((l) => l.tag)
  if (stored && supported.includes(stored as (typeof supported)[number])) return stored

  for (const part of (acceptLanguage ?? '').split(',')) {
    const tag = part.split(';')[0].trim()
    if (!tag) continue
    const exact = supported.find((s) => s.toLowerCase() === tag.toLowerCase())
    if (exact) return exact
    const language = primaryLanguage(tag)
    const sameLanguage = supported.find((s) => primaryLanguage(s) === language)
    if (sameLanguage) return sameLanguage
  }
  return DEFAULT_LOCALE
}

/** Validate an IANA timezone (e.g. from a form post) without trusting input. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** IANA zones for the settings picker, grouped by region prefix. */
export function listTimezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return [DEFAULT_TIMEZONE, 'Australia/Brisbane', 'Australia/Perth', 'Pacific/Auckland', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'UTC']
  }
}

/** Translate a message key in the active language, with {slot} interpolation. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const { language } = getI18n()
  const dict = DICTIONARIES[language]
  const message = dict?.[key] ?? en[key] ?? key
  return interpolate(message, params)
}

// Keys that exist in `.one`/`.other` plural pairs, addressed by their base.
type PluralBase = MessageKey extends infer K
  ? K extends `${infer B}.one`
    ? B
    : never
  : never

/**
 * Plural-aware translation: tp('common.enquiry', 3) → "3 enquiries".
 * Categories come from Intl.PluralRules for the active locale; languages
 * without a key for a category fall back to `.other`, then English.
 */
export function tp(base: PluralBase, count: number, params?: Record<string, string | number>): string {
  const { locale } = getI18n()
  const category = new Intl.PluralRules(locale).select(count)
  const exact = `${base}.${category}` as MessageKey
  const fallback = `${base}.other` as MessageKey
  const key = (exact in en ? exact : fallback) as MessageKey
  return t(key, { count: new Intl.NumberFormat(locale).format(count), ...params })
}

function interpolate(message: string, params?: Record<string, string | number>): string {
  if (!params) return message
  return message.replace(/\{(\w+)\}/g, (match, name) =>
    name in params ? String(params[name]) : match
  )
}
