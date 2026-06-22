// Handles nobody can claim as their @wedding.computer address. Three groups:
//   1. Role / system addresses (admin, support, billing, …)
//   2. Our own brands — Josh Withers (celebrant) + Elopement Collective +
//      Brittany Withers — so the brand can't be impersonated.
//   3. Generic wedding/common terms that shouldn't belong to one vendor.
// Inbound mail to any of these is forwarded to the team rather than bounced
// (see services/inbound-email.ts). Normalised to the handle charset: lowercase
// [a-z0-9-]. Matching is EXACT (the whole local-part), so it never over-blocks
// a legitimate longer handle like "joshsmithphoto".
export const RESERVED_HANDLES = new Set<string>([
  // ── Role / system ──
  'hello', 'hi', 'hey', 'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'admin', 'administrator', 'support', 'postmaster', 'abuse', 'info', 'billing',
  'security', 'hostmaster', 'webmaster', 'mailer-daemon', 'help', 'team', 'contact',
  'sales', 'notifications', 'notification', 'accounts', 'account', 'root', 'system',
  'staff', 'office', 'enquiries', 'enquiry', 'inquiries', 'inquiry', 'bookings',
  'booking', 'careers', 'jobs', 'press', 'media', 'legal', 'privacy', 'terms',
  'hr', 'finance', 'ceo', 'founder', 'owner', 'hq', 'mail', 'email', 'api', 'dev',
  'app', 'web', 'www', 'blog', 'news', 'shop', 'store', 'pay', 'payments',
  'invoice', 'invoices', 'test', 'demo', 'example', 'feedback', 'hi-there',

  // ── Our brands (Josh Withers / Elopement Collective / Brittany Withers) ──
  'josh', 'joshua', 'joshwithers', 'josh-withers', 'joshwitherscelebrant',
  'josh-withers-celebrant', 'joshwitherswedding', 'joshwithersweddings',
  'joshcelebrant', 'weddingsbyjosh', 'marriedbyjosh', 'married-by-josh', 'mbj',
  'brittany', 'britt', 'brittanywithers', 'brittany-withers', 'brittwithers',
  'britt-withers', 'withers', 'ec', 'elopementcollective', 'elopement-collective',
  'theelopementcollective', 'the-elopement-collective',

  // ── Generic wedding / common terms ──
  'celebrant', 'celebrants', 'wedding', 'weddings', 'elopement', 'elopements',
  'elope', 'marriage', 'married', 'marry', 'wed', 'bride', 'groom', 'ceremony',
  'vows', 'honeymoon', 'engaged', 'engagement', 'love', 'couple', 'couples',
  'nuptials', 'venue', 'venues', 'photographer', 'photography', 'florist', 'planner',
])

/** Normalise a raw handle to the @wedding.computer local-part charset. */
export function normalizeHandle(input: string | null | undefined): string {
  return (input ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
}

/** True if a handle is reserved (after normalisation). */
export function isReservedHandle(input: string | null | undefined): boolean {
  const h = normalizeHandle(input)
  return h.length > 0 && RESERVED_HANDLES.has(h)
}
