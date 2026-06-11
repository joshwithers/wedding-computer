import type { VendorProfile } from '../types'
import { t, type MessageKey } from '../i18n'

// Shared in-app education config: the setup checklist + category-tailored
// feature discovery. Reused by the onboarding wizard and the dashboard.

export type FeatureCard = { label: string; href: string; desc: string }
type FeatureDef = { labelKey: MessageKey; href: string; descKey: MessageKey }

// Pool of tools we can recommend. One-liners mirror the marketing copy.
const FEATURES = {
  enquiry: { labelKey: 'dashboard.feature.enquiry.label', href: '/app/form', descKey: 'dashboard.feature.enquiry.desc' },
  forms: { labelKey: 'dashboard.feature.forms.label', href: '/app/forms', descKey: 'dashboard.feature.forms.desc' },
  noim: { labelKey: 'dashboard.feature.noim.label', href: '/app/forms/new', descKey: 'dashboard.feature.noim.desc' },
  calendar: { labelKey: 'dashboard.feature.calendar.label', href: '/app/calendar', descKey: 'dashboard.feature.calendar.desc' },
  quotes: { labelKey: 'dashboard.feature.quotes.label', href: '/app/quotes', descKey: 'dashboard.feature.quotes.desc' },
  invoices: { labelKey: 'dashboard.feature.invoices.label', href: '/app/invoices', descKey: 'dashboard.feature.invoices.desc' },
  weddings: { labelKey: 'dashboard.feature.weddings.label', href: '/app/weddings', descKey: 'dashboard.feature.weddings.desc' },
  team: { labelKey: 'dashboard.feature.team.label', href: '/app/team', descKey: 'dashboard.feature.team.desc' },
  checklists: { labelKey: 'dashboard.feature.checklists.label', href: '/app/checklists', descKey: 'dashboard.feature.checklists.desc' },
  contract: { labelKey: 'dashboard.feature.contract.label', href: '/app/contract', descKey: 'dashboard.feature.contract.desc' },
  analytics: { labelKey: 'dashboard.feature.analytics.label', href: '/app/analytics', descKey: 'dashboard.feature.analytics.desc' },
  refer: { labelKey: 'dashboard.feature.refer.label', href: '/app/refer', descKey: 'dashboard.feature.refer.desc' },
  import: { labelKey: 'dashboard.feature.import.label', href: '/app/import', descKey: 'dashboard.feature.import.desc' },
} as const satisfies Record<string, FeatureDef>

type FeatureKey = keyof typeof FEATURES

export type CategorySetup = { blurb: string; recommended: FeatureCard[] }

// Per-category recommended first actions. Falls back to DEFAULT_KEYS.
const DEFAULT_KEYS: FeatureKey[] = ['enquiry', 'calendar', 'quotes', 'invoices', 'refer']

const CATEGORY_KEYS: Record<string, FeatureKey[]> = {
  celebrant: ['noim', 'enquiry', 'calendar', 'invoices', 'refer'],
  photographer: ['enquiry', 'calendar', 'quotes', 'invoices', 'refer'],
  videographer: ['enquiry', 'calendar', 'quotes', 'invoices', 'refer'],
  planner: ['weddings', 'team', 'checklists', 'invoices', 'refer'],
  venue: ['weddings', 'team', 'checklists', 'invoices', 'refer'],
  florist: ['enquiry', 'quotes', 'calendar', 'invoices'],
  caterer: ['enquiry', 'quotes', 'calendar', 'invoices'],
  stylist: ['enquiry', 'quotes', 'calendar', 'invoices'],
  cake: ['enquiry', 'quotes', 'calendar', 'invoices'],
  stationery: ['enquiry', 'quotes', 'calendar', 'invoices'],
  dj: ['enquiry', 'calendar', 'quotes', 'invoices'],
  band: ['enquiry', 'calendar', 'quotes', 'invoices'],
  hair: ['enquiry', 'calendar', 'quotes', 'invoices'],
  makeup: ['enquiry', 'calendar', 'quotes', 'invoices'],
}

export function categorySetup(category: string): CategorySetup {
  const keys = CATEGORY_KEYS[category] ?? DEFAULT_KEYS
  return {
    blurb: t('dashboard.discovery.blurb', { category: t(categoryNounKey(category)) }),
    recommended: keys.map((k) => featureCard(FEATURES[k])),
  }
}

function featureCard(def: FeatureDef): FeatureCard {
  return {
    label: t(def.labelKey),
    href: def.href,
    desc: t(def.descKey),
  }
}

function categoryNounKey(category: string): MessageKey {
  const map: Record<string, MessageKey> = {
    celebrant: 'dashboard.discovery.category.celebrant',
    photographer: 'dashboard.discovery.category.photographer',
    videographer: 'dashboard.discovery.category.videographer',
    planner: 'dashboard.discovery.category.planner',
    venue: 'dashboard.discovery.category.venue',
    florist: 'dashboard.discovery.category.florist',
    caterer: 'dashboard.discovery.category.caterer',
    stylist: 'dashboard.discovery.category.stylist',
    cake: 'dashboard.discovery.category.cake',
    stationery: 'dashboard.discovery.category.stationery',
    dj: 'dashboard.discovery.category.dj',
    band: 'dashboard.discovery.category.band',
    hair: 'dashboard.discovery.category.hair',
    makeup: 'dashboard.discovery.category.makeup',
  }
  return map[category] ?? 'dashboard.discovery.category.weddingPros'
}

// ─── Setup checklist ───

export type ChecklistItem = { key: string; label: string; href: string; done: boolean }
export type SetupChecklist = { items: ChecklistItem[]; doneCount: number; total: number; percent: number }

type ChecklistVendor = Pick<
  VendorProfile,
  'phone' | 'website' | 'bio' | 'location' | 'location_city' | 'email_handle' | 'stripe_onboarding_complete' | 'enquiry_form'
>

// Build the universal "get set up" checklist from already-loaded vendor data
// plus simple counts. Pure (no DB) so it's easy to test.
export function buildSetupChecklist(
  vendor: ChecklistVendor,
  counts: { contacts: number; events: number }
): SetupChecklist {
  const items: ChecklistItem[] = [
    {
      key: 'business',
      label: t('dashboard.setup.item.business'),
      href: '/app/settings#business',
      done: !!(vendor.phone || vendor.website || vendor.bio),
    },
    {
      key: 'location',
      label: t('dashboard.setup.item.location'),
      href: '/app/settings#business',
      done: !!(vendor.location_city || vendor.location),
    },
    {
      key: 'email',
      label: t('dashboard.setup.item.email'),
      href: '/app/settings#communication',
      done: !!vendor.email_handle,
    },
    {
      key: 'payments',
      label: t('dashboard.setup.item.payments'),
      href: '/app/settings#invoicing',
      done: vendor.stripe_onboarding_complete === 1,
    },
    {
      key: 'enquiry',
      label: t('dashboard.setup.item.enquiry'),
      href: '/app/form',
      done: !!vendor.enquiry_form,
    },
    {
      key: 'contact',
      label: t('dashboard.setup.item.contact'),
      href: '/app/contacts',
      done: counts.contacts > 0,
    },
    {
      key: 'calendar',
      label: t('dashboard.setup.item.calendar'),
      href: '/app/calendar',
      done: counts.events > 0,
    },
  ]

  const doneCount = items.filter((i) => i.done).length
  const total = items.length
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0
  return { items, doneCount, total, percent }
}
