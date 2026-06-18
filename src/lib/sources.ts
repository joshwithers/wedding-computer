// Enquiry-source taxonomy.
//
// `contacts.source` is free text (typed by vendors, or set by the enquiry
// pipeline), so the same channel arrives spelled a dozen ways: "Website",
// "website", "web", "IG", "insta". This module is the single place that
// (a) offers a modern, curated list of channels for the contact form, and
// (b) folds the messy stored values back into canonical buckets for analytics
// so we never again render "Website" twice.

export type EnquirySourceOption = { value: string; label: string }

// Canonical channels, ordered roughly by how vendors think about them:
// owned/social first, then directories, then word-of-mouth, then inbound
// machinery. `value` is the canonical key we group on; `label` is shown.
export const ENQUIRY_SOURCES: readonly EnquirySourceOption[] = [
  { value: 'website', label: 'Website' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'pinterest', label: 'Pinterest' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'google', label: 'Google Search' },
  { value: 'google_business', label: 'Google Business Profile' },
  { value: 'easy_weddings', label: 'Easy Weddings' },
  { value: 'hitched', label: 'Hitched' },
  { value: 'wedding_directory', label: 'Wedding directory' },
  { value: 'referral', label: 'Referral' },
  { value: 'past_client', label: 'Past client' },
  { value: 'vendor_referral', label: 'Vendor referral' },
  { value: 'venue_referral', label: 'Venue referral' },
  { value: 'planner_referral', label: 'Planner referral' },
  { value: 'word_of_mouth', label: 'Word of mouth' },
  { value: 'wedding_fair', label: 'Wedding fair / expo' },
  { value: 'advertising', label: 'Advertising' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'api', label: 'API' },
  { value: 'agent', label: 'AI agent' },
  { value: 'other', label: 'Other' },
] as const

const LABELS: Record<string, string> = Object.fromEntries(
  ENQUIRY_SOURCES.map((s) => [s.value, s.label])
)

// Common spellings/abbreviations → canonical value. Keys are already
// normalized (lowercased, non-alphanumerics collapsed to underscore).
const ALIASES: Record<string, string> = {
  web: 'website',
  site: 'website',
  web_site: 'website',
  ig: 'instagram',
  insta: 'instagram',
  gram: 'instagram',
  fb: 'facebook',
  meta: 'facebook',
  tik_tok: 'tiktok',
  pin: 'pinterest',
  yt: 'youtube',
  google_search: 'google',
  search: 'google',
  google_business_profile: 'google_business',
  gbp: 'google_business',
  google_maps: 'google_business',
  maps: 'google_business',
  google_my_business: 'google_business',
  easyweddings: 'easy_weddings',
  easy_wedding: 'easy_weddings',
  word_of_mouth_referral: 'word_of_mouth',
  wom: 'word_of_mouth',
  recommendation: 'word_of_mouth',
  recommended: 'word_of_mouth',
  ref: 'referral',
  referred: 'referral',
  friend: 'referral',
  family: 'referral',
  repeat: 'past_client',
  repeat_client: 'past_client',
  returning: 'past_client',
  vendor: 'vendor_referral',
  supplier_referral: 'vendor_referral',
  venue: 'venue_referral',
  planner: 'planner_referral',
  coordinator: 'planner_referral',
  expo: 'wedding_fair',
  fair: 'wedding_fair',
  bridal_fair: 'wedding_fair',
  bridal_expo: 'wedding_fair',
  wedding_expo: 'wedding_fair',
  trade_show: 'wedding_fair',
  ad: 'advertising',
  ads: 'advertising',
  advert: 'advertising',
  google_ads: 'advertising',
  facebook_ads: 'advertising',
  mail: 'email',
  e_mail: 'email',
  call: 'phone',
  telephone: 'phone',
  mobile: 'phone',
  sms: 'phone',
  text: 'phone',
  wa: 'whatsapp',
  walkin: 'walk_in',
  walk_up: 'walk_in',
  in_person: 'walk_in',
  zapier: 'api',
  webhook: 'api',
  integration: 'api',
  ai: 'agent',
  chatbot: 'agent',
  assistant: 'agent',
  unknown: 'other',
  na: 'other',
  none: 'other',
}

/**
 * Fold a raw stored source into its canonical key. Lowercases, trims, and
 * collapses any run of non-alphanumerics to a single underscore, then applies
 * the alias map. Unknown-but-clean values pass through so genuinely novel
 * channels still group consistently with themselves. Empty → 'other'.
 */
export function normalizeSource(raw: string | null | undefined): string {
  if (!raw) return 'other'
  const key = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!key) return 'other'
  if (LABELS[key]) return key
  if (ALIASES[key]) return ALIASES[key]
  return key
}

/** Human label for a canonical (or unknown-but-normalized) source value. */
export function sourceLabel(value: string): string {
  if (LABELS[value]) return LABELS[value]
  // Title-case an unknown value: "wedding_blog" → "Wedding blog".
  const words = value.replace(/_/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Other'
}

/**
 * Re-aggregate raw `{ source, count }` rows (as grouped by SQL) into canonical
 * buckets with display labels, sorted by count desc. Merges case variants and
 * aliases that SQL's GROUP BY left separate.
 */
export function aggregateSources(
  rows: { source: string | null; count: number }[]
): { value: string; label: string; count: number }[] {
  const merged = new Map<string, number>()
  for (const row of rows) {
    const value = normalizeSource(row.source)
    merged.set(value, (merged.get(value) ?? 0) + row.count)
  }
  return [...merged.entries()]
    .map(([value, count]) => ({ value, label: sourceLabel(value), count }))
    .sort((a, b) => b.count - a.count)
}
