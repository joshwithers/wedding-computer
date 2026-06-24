// Season + cohort derivation for the couples community.
//
// A cohort groups couples by the SEASON and YEAR of their wedding, in a room
// per country (see region.ts). Seasons are hemisphere-aware: the same calendar
// month is a different season north vs south of the equator. The Southern
// mapping reuses seasonOf() from lib/busyness.ts (the platform is
// Australia-first — Dec–Feb summer, …); the Northern mapping is that wheel
// turned half a year. Derive the cohort once at join time and store the slug;
// never re-derive a season from a month at render time (that would desync the
// label from the room a member actually joined).

import type { Season } from '../types'
import { seasonOf } from './busyness'
import type { Hemisphere, ResolvedRegion } from './region'
import { t } from '../i18n'
import type { MessageKey } from '../i18n'

/** Month (1-12) → season for the given hemisphere. */
export function seasonForMonth(month: number, hemi: Hemisphere): Season {
  // Northern is the Southern wheel shifted six months ((m+6) mod 12).
  return hemi === 'south' ? seasonOf(month) : seasonOf(((month + 5) % 12) + 1)
}

export type Cohort = {
  year: number
  season: Season
  /** URL/sort-friendly key, e.g. '2027-autumn-australia'. */
  cohortKey: string
}

/**
 * The cohort a dated wedding belongs to, or null when the wedding is undated or
 * its country is unknown (the join UI prompts for the missing piece instead).
 * `date` is the wedding's ISO 'YYYY-MM-DD'.
 */
export function cohortForWedding(
  date: string | null | undefined,
  region: ResolvedRegion
): Cohort | null {
  if (!date || !region.countryCode) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (!year || month < 1 || month > 12) return null
  const season = seasonForMonth(month, region.hemisphere)
  return { year, season, cohortKey: `${year}-${season}-${region.countryCode}` }
}

const SEASON_LABEL_KEY: Record<Season, MessageKey> = {
  summer: 'community.season.summer',
  autumn: 'community.season.autumn',
  winter: 'community.season.winter',
  spring: 'community.season.spring',
}

/** Localised season word, e.g. "Autumn". */
export function seasonWord(season: Season): string {
  return t(SEASON_LABEL_KEY[season])
}

/** Localised room label, e.g. "Australia · Autumn 2027". */
export function cohortLabel(opts: { countryName: string; season: Season; year: number }): string {
  return t('community.cohort.label', {
    country: opts.countryName,
    season: seasonWord(opts.season),
    year: opts.year,
  })
}
