import { describe, it, expect } from 'vitest'
import {
  sanitizeHex,
  isBrandFont,
  mixHex,
  contrastOn,
  parseBrandTheme,
  resolveBrandTheme,
  brandThemeVars,
  THEME_DEFAULTS,
} from './form-theme'

describe('sanitizeHex', () => {
  it('accepts 6-digit hex with or without #', () => {
    expect(sanitizeHex('#C53030')).toBe('#c53030')
    expect(sanitizeHex('c53030')).toBe('#c53030')
  })
  it('rejects malformed or unsafe input', () => {
    expect(sanitizeHex('red')).toBeNull()
    expect(sanitizeHex('#fff')).toBeNull() // shorthand not allowed
    expect(sanitizeHex('#12345')).toBeNull()
    expect(sanitizeHex('#1234567')).toBeNull()
    expect(sanitizeHex('#xyzxyz')).toBeNull()
    // CSS-injection attempts must not survive sanitisation
    expect(sanitizeHex('#000;}</style><script>')).toBeNull()
    expect(sanitizeHex('red;color:blue')).toBeNull()
    expect(sanitizeHex(42)).toBeNull()
    expect(sanitizeHex(undefined)).toBeNull()
  })
})

describe('isBrandFont', () => {
  it('only allows known font ids', () => {
    expect(isBrandFont('playfair')).toBe(true)
    expect(isBrandFont('dm-sans')).toBe(true)
    expect(isBrandFont('comic-sans')).toBe(false)
    expect(isBrandFont(undefined)).toBe(false)
  })
})

describe('mixHex', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
  })
  it('mixes to the midpoint', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('contrastOn', () => {
  it('picks white text on dark colours and dark text on light colours', () => {
    expect(contrastOn('#c53030')).toBe('#ffffff')
    expect(contrastOn('#111827')).toBe('#ffffff')
    expect(contrastOn('#fffbf5')).toBe('#1a1a1a')
    expect(contrastOn('#ffe0b5')).toBe('#1a1a1a')
  })
})

describe('parseBrandTheme', () => {
  it('returns an empty theme for null/invalid JSON', () => {
    expect(parseBrandTheme(null)).toEqual({})
    expect(parseBrandTheme('not json')).toEqual({})
    expect(parseBrandTheme('"a string"')).toEqual({})
  })
  it('parses a stored theme object', () => {
    expect(parseBrandTheme('{"accent":"#0066e6","logo":true}')).toEqual({
      accent: '#0066e6',
      logo: true,
    })
  })
})

describe('resolveBrandTheme', () => {
  it('falls back to house defaults when empty', () => {
    const r = resolveBrandTheme({})
    expect(r.accent).toBe(THEME_DEFAULTS.accent)
    expect(r.bg).toBe(THEME_DEFAULTS.background)
    expect(r.ink).toBe(THEME_DEFAULTS.ink)
    expect(r.surface).toBe('#ffffff')
    expect(r.fontStack).toContain('DM Sans')
    expect(r.googleFont).toBeUndefined() // DM Sans is loaded globally
  })
  it('honours valid overrides and derives dependent shades', () => {
    const r = resolveBrandTheme({ accent: '#0066e6', font: 'playfair' })
    expect(r.accent).toBe('#0066e6')
    expect(r.accentInk).toBe('#ffffff')
    expect(r.accentHover).not.toBe(r.accent) // darkened
    expect(r.accentTint).not.toBe(r.accent) // tinted toward white
    expect(r.fontStack).toContain('Playfair Display')
    expect(r.googleFont).toContain('Playfair')
  })
  it('ignores unsafe colours and unknown fonts, keeping defaults', () => {
    const r = resolveBrandTheme({ accent: 'red;}</style>', font: 'comic-sans' } as never)
    expect(r.accent).toBe(THEME_DEFAULTS.accent)
    expect(r.fontStack).toContain('DM Sans')
  })
})

describe('brandThemeVars', () => {
  it('emits all --form-* custom properties as a CSS string', () => {
    const css = brandThemeVars({})
    for (const v of [
      '--form-bg',
      '--form-surface',
      '--form-ink',
      '--form-ink-muted',
      '--form-accent',
      '--form-accent-ink',
      '--form-accent-hover',
      '--form-accent-tint',
      '--form-font',
    ]) {
      expect(css).toContain(v)
    }
    // never leaks an unsanitised value into the stylesheet
    expect(brandThemeVars({ accent: '#000;}<x' } as never)).toContain(THEME_DEFAULTS.accent)
  })
})
