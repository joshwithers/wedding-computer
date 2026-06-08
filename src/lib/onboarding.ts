import type { VendorProfile } from '../types'

// Shared in-app education config: the setup checklist + category-tailored
// feature discovery. Reused by the onboarding wizard and the dashboard.

export type FeatureCard = { label: string; href: string; desc: string }

// Pool of tools we can recommend. One-liners mirror the marketing copy.
const FEATURES = {
  enquiry: { label: 'Enquiry form', href: '/app/form', desc: 'Capture leads from your website straight into your CRM' },
  forms: { label: 'Forms', href: '/app/forms', desc: 'Build any form — contact, intake, or a NOIM for couples' },
  noim: { label: 'NOIM form', href: '/app/forms/new', desc: 'Collect Notice of Intended Marriage details and generate the PDF' },
  calendar: { label: 'Calendar & availability', href: '/app/calendar', desc: 'Track bookings and share the dates you’re free' },
  quotes: { label: 'Quote calculator', href: '/app/quotes', desc: 'Let couples price up packages and add-ons' },
  invoices: { label: 'Invoicing', href: '/app/invoices', desc: 'Send invoices and take deposits with Stripe' },
  weddings: { label: 'Weddings', href: '/app/weddings', desc: 'Shared workspaces for couples and other vendors' },
  team: { label: 'Team', href: '/app/team', desc: 'Add staff and assign them to weddings' },
  checklists: { label: 'Checklists', href: '/app/checklists', desc: 'Reusable to-do lists that deploy when a wedding is booked' },
  contract: { label: 'Contracts', href: '/app/contract', desc: 'Set a contract template couples sign online' },
  analytics: { label: 'Analytics', href: '/app/analytics', desc: 'Conversion funnel, revenue and benchmarks (Pro)' },
  refer: { label: 'Refer & earn', href: '/app/refer', desc: 'Invite other vendors and earn free months' },
  import: { label: 'Import contacts', href: '/app/import', desc: 'Bring leads in from a CSV or another CRM' },
} as const satisfies Record<string, FeatureCard>

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
    blurb: 'Here are the tools most ' + categoryNoun(category) + ' set up first:',
    recommended: keys.map((k) => FEATURES[k]),
  }
}

function categoryNoun(category: string): string {
  const map: Record<string, string> = {
    celebrant: 'celebrants',
    photographer: 'photographers',
    videographer: 'videographers',
    planner: 'planners',
    venue: 'venues',
    florist: 'florists',
    caterer: 'caterers',
    stylist: 'stylists',
    dj: 'DJs',
    band: 'bands',
  }
  return map[category] ?? 'wedding pros'
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
      label: 'Add your business details',
      href: '/app/settings#business',
      done: !!(vendor.phone || vendor.website || vendor.bio),
    },
    {
      key: 'location',
      label: 'Set your location',
      href: '/app/settings#business',
      done: !!(vendor.location_city || vendor.location),
    },
    {
      key: 'email',
      label: 'Claim your @wedding.computer email',
      href: '/app/settings#communication',
      done: !!vendor.email_handle,
    },
    {
      key: 'payments',
      label: 'Connect payments with Stripe',
      href: '/app/settings#invoicing',
      done: vendor.stripe_onboarding_complete === 1,
    },
    {
      key: 'enquiry',
      label: 'Set up your enquiry form',
      href: '/app/form',
      done: !!vendor.enquiry_form,
    },
    {
      key: 'contact',
      label: 'Add your first contact',
      href: '/app/contacts',
      done: counts.contacts > 0,
    },
    {
      key: 'calendar',
      label: 'Add your availability',
      href: '/app/calendar',
      done: counts.events > 0,
    },
  ]

  const doneCount = items.filter((i) => i.done).length
  const total = items.length
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0
  return { items, doneCount, total, percent }
}
