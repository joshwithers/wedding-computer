// Shared community helpers used by both the hub (routes/community.tsx) and the
// couple wedding dashboard (routes/couple.tsx): derive the opt-in join card for
// a couple from their wedding's place + date.

import type { User, Wedding } from '../types'
import type { JoinCardData } from '../views/community'
import { resolveRegion } from '../lib/region'
import { cohortForWedding, cohortLabel } from '../lib/season'
import { getCohortByKey, getMembership } from '../db/community'

export function communityFirstName(name: string): string {
  const first = name.trim().split(/\s+/)[0]
  return first || name.trim() || 'Guest'
}

/**
 * The join-card state for a couple's wedding: an "add your date" prompt when
 * undated, a "you're in" card when already a member, or a join form otherwise
 * (pre-filled with the derived country/state, which the couple can correct).
 */
export async function buildCoupleJoinCard(
  db: D1Database,
  user: User,
  wedding: Wedding
): Promise<JoinCardData | null> {
  const region = resolveRegion({
    country: wedding.location_country,
    state: wedding.location_state,
    lat: wedding.location_lat,
    locale: user.locale,
  })

  if (!wedding.date) {
    return { mode: 'needsDate', editHref: `/wedding/${wedding.id}/edit` }
  }

  const cohort = cohortForWedding(wedding.date, region)
  const defaultDisplayName = communityFirstName(user.name)

  // Dated but no resolvable country → let them choose it on the form.
  if (!cohort) {
    return {
      mode: 'join',
      label: null,
      countryName: region.countryName,
      subdivisionLabel: region.subdivisionLabel,
      defaultDisplayName,
      weddingId: wedding.id,
    }
  }

  const existing = await getCohortByKey(db, cohort.cohortKey)
  const member = existing ? await getMembership(db, existing.id, user.id) : null
  if (member && member.status === 'active') {
    return {
      mode: 'member',
      label: cohortLabel({ countryName: existing!.country_name, season: existing!.season, year: existing!.year }),
      roomHref: `/community/c/${cohort.cohortKey}`,
    }
  }

  return {
    mode: 'join',
    label: cohortLabel({ countryName: region.countryName, season: cohort.season, year: cohort.year }),
    countryName: region.countryName,
    subdivisionLabel: region.subdivisionLabel,
    defaultDisplayName,
    weddingId: wedding.id,
  }
}
