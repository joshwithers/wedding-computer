import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { SUPPORTED_LOCALES, t, getI18n, type MessageKey } from '../i18n'
import type { Env } from '../types'
import { MarketingLayout } from '../views/layouts/marketing'
import { getProPrice, CURRENCIES, PRESENTMENT_CURRENCIES, isCurrencyCode, type CurrencyCode } from '../services/pricing'

const marketing = new Hono<Env>()
const PUBLIC_MARKETING_CACHE = 'public, max-age=300, s-maxage=3600'
const PRIVATE_MARKETING_VARIANT_CACHE = 'private, max-age=300'
const PUBLIC_MARKETING_VARY = 'Accept, Accept-Language, CF-IPCountry'

// Persist a referral code (?ref=) so it survives signup → onboarding.
function captureReferral(c: any) {
  const ref = c.req.query('ref')
  if (!ref) return
  const code = String(ref).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
  if (!code) return
  setCookie(c, 'wc_ref', code, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 30,
  })
}

function safeReturnTo(c: any, requested?: string): string {
  const fallback = '/'
  const candidate = requested || c.req.header('referer') || fallback

  if (candidate.startsWith('/') && !candidate.startsWith('//')) {
    return candidate === '/locale' ? fallback : candidate
  }

  try {
    const target = new URL(candidate)
    const current = new URL(c.req.url)
    if (target.origin === current.origin && target.pathname !== '/locale') {
      return `${target.pathname}${target.search}${target.hash}`
    }
  } catch {
    return fallback
  }

  return fallback
}

marketing.post('/locale', async (c) => {
  const body = await c.req.parseBody()
  const locale = typeof body.locale === 'string' ? body.locale.trim() : ''
  const returnTo = typeof body.return_to === 'string' ? body.return_to.trim() : undefined
  const supported = SUPPORTED_LOCALES.some((l) => l.tag === locale)

  if (supported) {
    const isSecureRequest = new URL(c.req.url).protocol === 'https:'
    setCookie(c, 'wc_locale', locale, {
      path: '/',
      httpOnly: true,
      secure: isSecureRequest,
      sameSite: 'Lax',
      maxAge: 60 * 60 * 24 * 365,
    })
  }

  return c.redirect(safeReturnTo(c, returnTo), 303)
})

marketing.post('/currency', async (c) => {
  const body = await c.req.parseBody()
  const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : ''
  const returnTo = typeof body.return_to === 'string' ? body.return_to.trim() : undefined

  if (isCurrencyCode(currency)) {
    const isSecureRequest = new URL(c.req.url).protocol === 'https:'
    setCookie(c, 'wc_currency', currency, {
      path: '/',
      httpOnly: true,
      secure: isSecureRequest,
      sameSite: 'Lax',
      maxAge: 60 * 60 * 24 * 365,
    })
  }

  return c.redirect(safeReturnTo(c, returnTo), 303)
})

// Markdown content negotiation — return markdown when agents request it
const markdownPages: Record<string, string> = {
  '/': `# Wedding Computer

The collaboration platform where vendors, venues, planners, and couples plan weddings together — with shared timelines, calendars, and files that keep everyone on the same page. Vendors get a full CRM; couples get a real planning dashboard; and every wedding is a shared workspace so details are entered once and seen by everyone.

## Why it's different

A wedding is a dozen people working toward one day — yet most tools treat each vendor as an island, and the big marketplaces rent you back your own data. Wedding Computer is built on four ideas the rest of the industry forgot:

- **Built for collaboration, not silos** — set the ceremony time once and it lands in every vendor's calendar; update the run sheet and the whole team sees it instantly. No re-keying the same details into a dozen forms.
- **Your data, in plain text, forever** — every contact and wedding is available as markdown and JSON through export, Obsidian, and the vault API. Real files you control, not a CSV afterthought. No lock-in, ever.
- **AI-native, by design** — connect Claude, ChatGPT, or Cursor straight to your data over MCP. Because your data is open text, you (or any AI you trust) can read and write it directly.
- **Know your market** — anonymised demand scores show how in-demand any date is for enquiries and bookings in your area, so you can decide which dates to chase and what to charge.

## Features

- **CRM & pipeline** — track every lead from first enquiry to booked
- **Custom enquiry forms** — branded forms with CAPTCHA protection
- **Calendar & availability** — monthly calendar with CalDAV and iCal sync
- **Public availability calendar** — share your availability publicly or with other vendors
- **Invoicing & payments** — ATO-compliant tax invoices with GST, ABN, payment schedules, and Stripe Connect
- **Quote calculator** — embeddable pricing tool for your website
- **Built-in email** — send and receive from your @wedding.computer address
- **AI email drafting** — one-click personalised drafts
- **AI enquiry auto-replies** — draft availability-aware responses to new enquiries
- **Day-of run sheet builder** — timeline planner with AI generation
- **Wedding workspaces** — shared workspace for each wedding with all vendors and the couple
- **Seasonal wedding communities** — opt-in rooms for couples marrying around the same time and place
- **Analytics & benchmarks** — anonymised industry data at city, state, country, and global levels
- **Date demand scores** — see how in-demand any date is for enquiries and bookings in your area
- **Import from other CRMs** — CSV/JSON import from Dubsado, Studio Ninja, HoneyBook, VSCO Workspace, or any spreadsheet, with AI-powered text extraction
- **Team & agency management** — manage team rosters and assign members to weddings
- **Couple planner** — vendor grid, budget tracker, booking forms
- **Directory listing** — opt in to the wedding.institute vendor directory
- **Obsidian plugin** — official two-way sync plugin in the [Obsidian community directory](https://community.obsidian.md/plugins/wedding-computer-sync)
- **Plain text files** — every file is portable, human-readable, and never locked in
- **Open file format** — files follow a CC0 public-domain standard (https://wedding.computer/standard) that any tool can implement

## Collaboration

Every wedding is a shared workspace. Set ceremony, portraits, and reception times once — every vendor gets them in their calendar automatically. Vendor credits are built in for Instagram and blog posts.

## Your Data

All data is available as plain text markdown files through export, Obsidian, and the vault API. Access your files in Obsidian, VS Code, TextEdit, Notepad, or any text editor. If you stop using Wedding Computer, your data comes with you.

## Agent Access

- MCP Server: \`https://wedding.computer/mcp\` (Bearer token auth)
- [MCP Server Card](https://wedding.computer/.well-known/mcp/server-card.json)
- [Agent Discovery](https://wedding.computer/.well-known/agent)
- [Auth Instructions](https://wedding.computer/auth.md)

## Links

- [Get started free](https://wedding.computer/login)
- [Be notified when it's live](https://wedding.computer/notify)
- [About](https://wedding.computer/about)
- [Pricing](https://wedding.computer/pricing)
- [Open Format Spec](https://wedding.computer/standard)
- [Obsidian Plugin](https://community.obsidian.md/plugins/wedding-computer-sync)
`,
  '/about': `# About Wedding Computer

Wedding Computer is a collaboration platform for the wedding industry. It started as a vendor CRM and evolved into a multi-party tool where vendors, venues, planners, and couples coordinate on shared wedding entities.

A wedding is one of the most collaborative events there is, yet most software treats every vendor as an island and the big marketplaces rent vendors back their own data. Wedding Computer is the opposite.

## What makes it different

- **Built for collaboration, not silos** — the wedding itself is the shared object. Enter the date, timeline, and run sheet once; every vendor and the couple work from the same source of truth.
- **Your data in plain text, owned by you** — every contact and wedding is readable as markdown and JSON through export, Obsidian, and the vault API. Your data stays portable. No lock-in.
- **AI-native through MCP** — connect Claude, ChatGPT, Cursor, or your own agent directly to your data. Your open-text data is readable and writable by you and any AI you trust.
- **Seasonal wedding communities** — couples can opt in to a country, season, and year cohort where only a display name, broad area, and wedding timing are shared; vendors appear with a badge.
- **Market intelligence built in** — anonymised demand scores show how in-demand any date is for enquiries and bookings, so vendors can decide which dates to chase and what to charge.

Built on Cloudflare Workers. Your data follows an open, CC0-licensed markdown format, with exports, vault API access, and two-way editing via the official Obsidian plugin.

## Pricing

Couples never pay — for anything, ever. Vendors are free to start, including up to 12 active weddings at a time; finished weddings free up a slot automatically. Pro unlocks unlimited weddings plus analytics and AI, shown and charged in your local currency from the A$28/month anchor.

## Links

- [Home](https://wedding.computer/)
- [Pricing](https://wedding.computer/pricing)
- [Open Format Spec](https://wedding.computer/standard)
- [Obsidian Plugin](https://community.obsidian.md/plugins/wedding-computer-sync)
`,
  '/pricing': `# Pricing — Wedding Computer

Wedding Computer is **free to start, forever**. No trial, no credit card.

**Couples never pay.** If you're planning your own wedding, Wedding Computer is free for everything, always — no limits, no upgrades, no catch.

For vendors, the core platform — CRM, calendar, invoicing, email, run sheets, quote calculator, and community — is free, along with up to **12 active weddings** at a time. Finished weddings free up a slot automatically, so a steady flow of weddings stays free for good.

## Pro

Upgrade for unlimited weddings, plus analytics and AI. Prices are shown and charged in your local currency, derived from the A$28/month anchor:

- Unlimited active weddings
- Business analytics and reporting
- Anonymised industry benchmarks
- Date demand scores
- Goal tracking
- AI-powered insights
- AI enquiry auto-replies
- AI email drafting
- Device sync (CalDAV/CardDAV) and Obsidian sync
- MCP access for AI tools (Claude, ChatGPT, Cursor, etc.)

## Links

- [Get started free](https://wedding.computer/login)
`,
}

// Public marketing pages that are safe to store in shared/CDN caches — tenant-independent,
// no per-user content. This middleware is registered as use('*'), but because the marketing
// router is mounted first at the root (app.route('/', marketing) in index.tsx), that wildcard
// wraps EVERY request — including authenticated, tenant-specific pages mounted later under
// /app/*, /account/*, /files/*, /wedding/*, /admin, /api/*. Emitting `public, s-maxage` on those
// lets an edge/proxy cache store one user's response and serve it to another (cross-tenant leak),
// and serves stale authenticated UI. So we only ever attach the shared-cache header to this
// explicit allowlist; everything else is left untouched (private by default).
const CACHEABLE_PUBLIC_PATHS = new Set(['/', '/about', '/pricing', '/standard', '/docs/plain-text', '/docs/import'])

function hasCookieVariant(c: any): boolean {
  return !!getCookie(c, 'wc_locale') || !!getCookie(c, 'wc_currency')
}

// Cache marketing pages at the edge — content rarely changes
marketing.use('*', async (c, next) => {
  // Check for markdown content negotiation before processing
  const accept = c.req.header('Accept') ?? ''
  if (accept.includes('text/markdown')) {
    const md = markdownPages[c.req.path]
    if (md) {
      const body = new TextEncoder().encode(md)
      return new Response(body, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Length': String(body.byteLength),
          'Cache-Control': PUBLIC_MARKETING_CACHE,
          'Vary': 'Accept',
        },
      })
    }
  }

  await next()
  // Only public marketing pages may be stored in shared caches. Never attach a public cache
  // header to authenticated/tenant routes, and never override a Cache-Control a route set for
  // itself (e.g. files.tsx serves private documents with `private, max-age=…`).
  if (
    c.req.method === 'GET' &&
    c.res.status === 200 &&
    CACHEABLE_PUBLIC_PATHS.has(c.req.path) &&
    !c.res.headers.has('Cache-Control') &&
    !c.res.headers.has('Set-Cookie')
  ) {
    if (hasCookieVariant(c)) {
      c.res.headers.set('Cache-Control', PRIVATE_MARKETING_VARIANT_CACHE)
      c.res.headers.set('Vary', 'Accept')
    } else {
      c.res.headers.set('Cache-Control', PUBLIC_MARKETING_CACHE)
      c.res.headers.set('Vary', PUBLIC_MARKETING_VARY)
    }
  }
})

// RFC 8288 Link headers for agent discovery
marketing.use('/', async (c, next) => {
  await next()
  c.header('Link', [
    '</sitemap.xml>; rel="sitemap"',
    '</standard>; rel="service-doc"; title="Open Format Specification"',
    '</docs/plain-text>; rel="help"; title="Plain Text Data Documentation"',
    '</.well-known/carddav>; rel="related"; title="CardDAV"',
    '</.well-known/caldav>; rel="related"; title="CalDAV"',
  ].join(', '))
})

marketing.get('/', (c) => {
  captureReferral(c)
  return c.html(<HomePage />)
})

marketing.get('/about', (c) => {
  return c.html(<AboutPage />)
})

marketing.get('/pricing', async (c) => {
  const currency = getI18n().currency as CurrencyCode
  const pro = await getProPrice(c.env, currency)
  return c.html(<PricingPage proPrice={pro.formatted} currency={currency} />)
})

// ─── Open Standard ───

marketing.get('/standard', (c) => {
  return c.html(<OpenStandardPage />)
})

// ─── Legal ───

marketing.get('/privacy', (c) => {
  return c.html(<PrivacyPage />)
})

marketing.get('/terms', (c) => {
  return c.html(<TermsPage />)
})

function HomePage() {
  return (
    <MarketingLayout>
      <div class="max-w-5xl mx-auto px-4 sm:px-6">
        <section class="py-12 sm:py-16 lg:py-24 text-center">
          <div class="inline-block bg-horizon-50 text-horizon-700 font-semibold text-sm px-4 py-1.5 rounded-full mb-4 sm:mb-6">{t('marketing.home.hero.badge')}</div>
          <h1 class="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-4 sm:mb-6">
            <span class="block">{t('marketing.home.hero.titleLine1')}</span>
            <span class="block text-horizon-700">{t('marketing.home.hero.titleLine2')}</span>
          </h1>
          <p class="text-base sm:text-lg text-gray-600 max-w-2xl mx-auto mb-6 sm:mb-10 leading-relaxed">{t('marketing.home.hero.body')}</p>
          <div class="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <a href="/login" class="bg-horizon-600 text-white px-8 py-3.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors shadow-lg shadow-horizon/20">{t('marketing.home.hero.primaryCta')}</a>
            <a href="/about" class="border border-gray-300 text-gray-700 px-6 py-3.5 rounded-xl text-sm font-bold hover:border-horizon-600 hover:text-horizon-700 transition-colors">{t('marketing.home.hero.secondaryCta')}</a>
          </div>
          <p class="text-xs text-gray-400 mt-5">{t('marketing.home.hero.finePrint')}</p>
        </section>

        <section class="pb-6 sm:pb-10">
          <div class="bg-grapefruit-700 rounded-2xl sm:rounded-3xl px-6 sm:px-10 py-8 sm:py-10 text-center">
            <p class="text-papaya-50 text-base sm:text-xl leading-relaxed max-w-3xl mx-auto font-medium">{t('marketing.home.bigIdea.body')}</p>
          </div>
        </section>

        <section class="py-10 sm:py-16">
          <div class="max-w-3xl mx-auto text-center mb-10 sm:mb-12">
            <h2 class="text-2xl sm:text-3xl font-bold mb-3">{t('marketing.home.audience.heading')}</h2>
            <p class="text-gray-600 leading-relaxed">{t('marketing.home.audience.subheading')}</p>
          </div>
          <div class="space-y-5 sm:space-y-6">
            {HOME_AUDIENCES.map((audience) => <AudienceBlock audience={audience} />)}
          </div>
        </section>

        <section class="py-10 sm:py-16 border-t border-papaya-300/30">
          <div class="max-w-3xl mx-auto text-center mb-8">
            <h2 class="text-2xl sm:text-3xl font-bold mb-3">{t('marketing.home.switching.title')}</h2>
            <p class="text-gray-600 leading-relaxed">{t('marketing.home.switching.body')}</p>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 max-w-3xl mx-auto mb-8">
            {CRM_IMPORTS.map((item) => (
              <div class="bg-white border border-papaya-300/30 rounded-xl p-4 text-center">
                <p class="text-sm font-bold text-gray-700">{item.name}</p>
                <p class={'text-[10px] text-gray-500 ' + (item.italic ? 'italic' : '')}>{t(item.caption)}</p>
              </div>
            ))}
          </div>
          <div class="bg-horizon-50 border border-horizon-600/15 rounded-2xl p-6 sm:p-8 max-w-3xl mx-auto">
            <div class="flex items-start gap-4">
              <div class="w-10 h-10 rounded-xl bg-horizon-100 flex items-center justify-center shrink-0"><div class="w-5 h-5 text-horizon-600" dangerouslySetInnerHTML={{ __html: featureIcons.mcp }} /></div>
              <div>
                <h3 class="text-lg font-bold mb-2">{t('marketing.home.switching.mcp.title')}</h3>
                <p class="text-gray-600 leading-relaxed mb-3 text-sm">{t('marketing.home.switching.mcp.body')}</p>
                <p class="text-xs text-gray-500">{t('marketing.home.switching.mcp.note')}</p>
              </div>
            </div>
          </div>
          <p class="text-center text-xs text-gray-400 max-w-lg mx-auto mt-5">{t('marketing.home.switching.note')}</p>
        </section>

        <section class="py-10 sm:py-16 border-t border-papaya-300/30">
          <div class="bg-white border border-papaya-300/30 rounded-2xl sm:rounded-3xl p-6 sm:p-10 lg:p-12">
            <div class="max-w-2xl mx-auto text-center">
              <div class="w-12 h-12 rounded-2xl bg-horizon-50 flex items-center justify-center mx-auto mb-4"><div class="w-6 h-6 text-horizon-600" dangerouslySetInnerHTML={{ __html: featureIcons.plaintext }} /></div>
              <h2 class="text-xl sm:text-2xl font-bold mb-3">{t('marketing.home.data.title')}</h2>
              <p class="text-gray-600 leading-relaxed mb-6">{t('marketing.home.data.body')}</p>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                {HOME_DATA_TOOLS.map((tool) => (
                  <div class="text-center">
                    <div class="text-lg mb-1">{tool.emoji}</div>
                    <p class="text-xs font-bold text-gray-700">{t(tool.name)}</p>
                    <p class="text-[10px] text-gray-500">{t(tool.caption)}</p>
                  </div>
                ))}
              </div>
              <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
                <a href="/standard" class="text-horizon-700 font-bold text-sm hover:underline">{t('marketing.home.data.standardLink')}</a>
                <span class="hidden sm:inline text-gray-300">|</span>
                <a href="/docs/plain-text" class="text-horizon-700 font-bold text-sm hover:underline">{t('marketing.home.data.filesLink')}</a>
              </div>
            </div>
          </div>
        </section>

        <section class="py-8 sm:py-16">
          <div class="bg-horizon-600 rounded-2xl sm:rounded-3xl p-6 sm:p-12 text-center text-white">
            <h2 class="text-2xl sm:text-3xl font-bold mb-4">{t('marketing.home.cta.title')}</h2>
            <p class="text-white mb-6 sm:mb-8 max-w-md mx-auto">{t('marketing.home.cta.body')}</p>
            <a href="/login" class="inline-block bg-white text-horizon-700 font-bold px-8 py-3.5 rounded-xl hover:bg-horizon-50 transition-colors">{t('marketing.home.hero.primaryCta')}</a>
          </div>
        </section>
      </div>
    </MarketingLayout>
  )
}

function AudienceBlock({ audience }: { audience: AudienceDef }) {
  const iconBg = audience.color === 'horizon' ? 'bg-horizon-100' : 'bg-grapefruit-100'
  const iconColor = audience.color === 'horizon' ? 'text-horizon-600' : 'text-grapefruit-600'
  const eyebrowColor = audience.color === 'horizon' ? 'text-horizon-700' : 'text-grapefruit-700'
  const btn = audience.color === 'horizon' ? 'bg-horizon-600 hover:bg-horizon-700 shadow-horizon/20' : 'bg-grapefruit-700 hover:bg-grapefruit-800 shadow-grapefruit/20'
  return (
    <div class="bg-white border border-papaya-300/30 rounded-2xl sm:rounded-3xl p-6 sm:p-8 lg:p-10">
      <div class="grid lg:grid-cols-5 gap-6 lg:gap-10 items-start">
        <div class="lg:col-span-2">
          <div class={`w-11 h-11 rounded-2xl ${iconBg} flex items-center justify-center mb-4`}><div class={`w-6 h-6 ${iconColor}`} dangerouslySetInnerHTML={{ __html: featureIcons[audience.icon] }} /></div>
          <p class={`text-xs font-bold uppercase tracking-wide mb-2 ${eyebrowColor}`}>{t(audience.eyebrow)}</p>
          <h3 class="text-xl sm:text-2xl font-bold leading-tight mb-5">{t(audience.title)}</h3>
          <a href="/login" class={`inline-block text-white text-sm font-bold px-6 py-3 rounded-xl transition-colors shadow-lg ${btn}`}>{t(audience.cta)}</a>
        </div>
        <ul class="lg:col-span-3 space-y-3">
          {audience.points.map((point) => (
            <li class="flex items-start gap-3">
              <svg class={`w-5 h-5 mt-0.5 shrink-0 ${iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
              <span class="text-sm text-gray-700 leading-relaxed">{t(point)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function AboutPage() {
  return (
    <MarketingLayout title={t('marketing.about.metaTitle')}>
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <h1 class="text-2xl sm:text-4xl font-bold mb-4 sm:mb-6">{t('marketing.about.title')}</h1>
        <CopyParagraphs keys={ABOUT_INTRO} className="space-y-4 text-gray-600 leading-relaxed mb-10" />
        {ABOUT_SECTIONS.map((section) => <PageFeatureSection section={section} />)}
        <h2 class="text-xl sm:text-2xl font-bold mb-2">{t('marketing.about.workspaces.title')}</h2>
        <p class="text-gray-500 text-sm mb-6">{t('marketing.about.workspaces.subtitle')}</p>
        <CopyParagraphs keys={ABOUT_WORKSPACE_PARAGRAPHS} className="space-y-4 text-gray-600 leading-relaxed mb-12" />
        <h2 class="text-xl sm:text-2xl font-bold mb-2">{t('marketing.about.collab.title')}</h2>
        <p class="text-gray-500 text-sm mb-6">{t('marketing.about.collab.subtitle')}</p>
        <div class="space-y-3 mb-12">{ABOUT_COLLAB_FEATURES.map((feature) => <AboutFeature title={t(feature.title)} desc={t(feature.desc)} />)}</div>
        <h2 class="text-xl sm:text-2xl font-bold mb-2">{t('marketing.home.roles.title')}</h2>
        <p class="text-gray-500 text-sm mb-6">{t('marketing.about.roles.examples')}</p>
        <div class="flex flex-wrap gap-2 mb-6" id="role-tabs">
          {HOME_ROLES.map((role, index) => <RoleTab role={role.role} label={t(role.label)} active={index === 0} />)}
        </div>
        <div id="role-panels" class="mb-12">
          {HOME_ROLES.map((panel, index) => (
            <RolePanel role={panel.role} active={index === 0}>
              {panel.features.map((feature) => <RoleFeature title={t(feature.title)} desc={t(feature.desc)} />)}
              <RoleCollab>{t(panel.collab)}</RoleCollab>
            </RolePanel>
          ))}
        </div>
        <script dangerouslySetInnerHTML={{ __html: ROLE_TABS_SCRIPT }} />
        <h2 class="text-xl sm:text-2xl font-bold mb-2">{t('marketing.about.data.title')}</h2>
        <p class="text-gray-500 text-sm mb-6">{t('marketing.about.data.subtitle')}</p>
        <CopyParagraphs keys={ABOUT_DATA_PARAGRAPHS} className="space-y-4 text-gray-600 leading-relaxed mb-6" />
        <div class="space-y-3 mb-12">{ABOUT_DATA_FEATURES.map((feature) => <AboutFeature title={t(feature.title)} desc={t(feature.desc)} />)}</div>
        <h2 class="text-xl sm:text-2xl font-bold mb-2">{t('marketing.about.ai.title')}</h2>
        <p class="text-gray-500 text-sm mb-6">{t('marketing.about.ai.subtitle')}</p>
        <CopyParagraphs keys={ABOUT_AI_PARAGRAPHS} className="space-y-4 text-gray-600 leading-relaxed mb-6" />
        <div class="space-y-3 mb-6">{ABOUT_AI_FEATURES.map((feature) => <AboutFeature title={t(feature.title)} desc={t(feature.desc)} />)}</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {HOME_AI_EXAMPLES.map((example) => (
            <div class="bg-white border border-papaya-300/30 rounded-2xl p-4 sm:p-5">
              <p class="text-sm font-bold text-gray-900 mb-1.5">“{t(example.q)}”</p>
              <p class="text-xs text-gray-500 leading-relaxed">{t(example.a)}</p>
            </div>
          ))}
        </div>
        <p class="text-xs text-gray-400 mb-4">{t('marketing.about.ai.proNote')}</p>
        <p class="text-gray-600 leading-relaxed mb-12"><a href="/mcp" class="text-horizon-700 font-bold hover:underline">{t('marketing.mcp.connectGuide')}</a></p>
        {ABOUT_MORE_SECTIONS.map((section) => <PageFeatureSection section={section} />)}
        <h2 class="text-xl sm:text-2xl font-bold mb-2">{t('marketing.about.openData.title')}</h2>
        <CopyParagraphs keys={ABOUT_OPEN_DATA_PARAGRAPHS} className="space-y-4 text-gray-600 leading-relaxed mb-6" />
        <p class="text-gray-600 leading-relaxed mb-12"><a href="/standard" class="text-horizon-700 font-bold hover:underline">{t('marketing.about.openData.standardLink')}</a>{' '}·{' '}<a href="https://community.obsidian.md/plugins/wedding-computer-sync" class="text-horizon-700 font-bold hover:underline" rel="noopener">{t('marketing.about.openData.pluginLink')}</a></p>
        <div class="bg-horizon-600 rounded-2xl p-6 sm:p-10 text-center text-white">
          <h2 class="text-xl sm:text-2xl font-bold mb-3">{t('marketing.about.cta.title')}</h2>
          <p class="text-white mb-6 max-w-md mx-auto text-sm">{t('marketing.about.cta.body')}</p>
          <a href="/login" class="inline-block bg-white text-horizon-700 font-bold px-8 py-3.5 rounded-xl hover:bg-horizon-50 transition-colors">{t('marketing.home.hero.primaryCta')}</a>
        </div>
      </div>
    </MarketingLayout>
  )
}

type LegalSection = { title: MessageKey; body: MessageKey[] }

function LegalPage({
  metaTitle,
  title,
  lastUpdated,
  intro,
  sections,
  showEnglishNotice = true,
}: {
  metaTitle: MessageKey
  title: MessageKey
  lastUpdated: MessageKey
  intro: MessageKey[]
  sections: LegalSection[]
  showEnglishNotice?: boolean
}) {
  const isEnglish = getI18n().locale.startsWith('en')
  return (
    <MarketingLayout title={t(metaTitle)}>
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <h1 class="text-2xl sm:text-4xl font-bold mb-2">{t(title)}</h1>
        <p class="text-sm text-gray-400 mb-2">{t(lastUpdated)}</p>
        {showEnglishNotice && !isEnglish && <p class="text-xs text-gray-400 mb-6 italic">{t('legal.englishNotice')}</p>}
        <div class="space-y-4 text-gray-600 leading-relaxed mb-10">
          {intro.map((k) => <p>{t(k)}</p>)}
        </div>
        {sections.map((s) => (
          <section class="mb-8">
            <h2 class="text-lg sm:text-xl font-bold mb-3 text-gray-900">{t(s.title)}</h2>
            <div class="space-y-3 text-gray-600 leading-relaxed">{s.body.map((k) => <p>{t(k)}</p>)}</div>
          </section>
        ))}
        <p class="text-sm text-gray-500 border-t border-papaya-300/40 pt-6 mt-4">{t('legal.contactLine')}</p>
      </div>
    </MarketingLayout>
  )
}

const PRIVACY_SECTIONS: LegalSection[] = [
  { title: 'legal.privacy.entity.title', body: ['legal.privacy.entity.p1'] },
  { title: 'legal.privacy.role.title', body: ['legal.privacy.role.p1', 'legal.privacy.role.p2'] },
  { title: 'legal.privacy.collect.title', body: ['legal.privacy.collect.p1', 'legal.privacy.collect.p2', 'legal.privacy.collect.p3', 'legal.privacy.collect.p4', 'legal.privacy.collect.p5', 'legal.privacy.collect.p6', 'legal.privacy.collect.p7', 'legal.privacy.collect.p8'] },
  { title: 'legal.privacy.use.title', body: ['legal.privacy.use.p1', 'legal.privacy.use.p2', 'legal.privacy.use.p3', 'legal.privacy.use.p4', 'legal.privacy.use.p5'] },
  { title: 'legal.privacy.legalBasis.title', body: ['legal.privacy.legalBasis.p1'] },
  { title: 'legal.privacy.share.title', body: ['legal.privacy.share.p1', 'legal.privacy.share.p2', 'legal.privacy.share.p3', 'legal.privacy.share.p4'] },
  { title: 'legal.privacy.ai.title', body: ['legal.privacy.ai.p1'] },
  { title: 'legal.privacy.cookies.title', body: ['legal.privacy.cookies.p1', 'legal.privacy.cookies.p2'] },
  { title: 'legal.privacy.transfers.title', body: ['legal.privacy.transfers.p1'] },
  { title: 'legal.privacy.retention.title', body: ['legal.privacy.retention.p1', 'legal.privacy.retention.p2'] },
  { title: 'legal.privacy.rights.title', body: ['legal.privacy.rights.p1', 'legal.privacy.rights.p2'] },
  { title: 'legal.privacy.security.title', body: ['legal.privacy.security.p1'] },
  { title: 'legal.privacy.children.title', body: ['legal.privacy.children.p1'] },
  { title: 'legal.privacy.changes.title', body: ['legal.privacy.changes.p1'] },
]

function PrivacyPage() {
  return <LegalPage metaTitle="legal.privacy.metaTitle" title="legal.privacy.title" lastUpdated="legal.privacy.lastUpdated" intro={['legal.privacy.intro.p1', 'legal.privacy.intro.p2', 'legal.privacy.intro.p3']} sections={PRIVACY_SECTIONS} showEnglishNotice={false} />
}

const TERMS_SECTIONS: LegalSection[] = [
  { title: 'legal.terms.service.title', body: ['legal.terms.service.p1'] },
  { title: 'legal.terms.accounts.title', body: ['legal.terms.accounts.p1'] },
  { title: 'legal.terms.plans.title', body: ['legal.terms.plans.p1'] },
  { title: 'legal.terms.acceptable.title', body: ['legal.terms.acceptable.p1'] },
  { title: 'legal.terms.data.title', body: ['legal.terms.data.p1'] },
  { title: 'legal.terms.thirdparty.title', body: ['legal.terms.thirdparty.p1'] },
  { title: 'legal.terms.warranty.title', body: ['legal.terms.warranty.p1'] },
  { title: 'legal.terms.termination.title', body: ['legal.terms.termination.p1'] },
  { title: 'legal.terms.law.title', body: ['legal.terms.law.p1'] },
]

function TermsPage() {
  return <LegalPage metaTitle="legal.terms.metaTitle" title="legal.terms.title" lastUpdated="legal.terms.lastUpdated" intro={['legal.terms.intro.p1']} sections={TERMS_SECTIONS} />
}

function PricingPage({ proPrice, currency }: { proPrice: string; currency: CurrencyCode }) {
  return (
    <MarketingLayout title={t('marketing.pricing.metaTitle')}>
      <div class="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <h1 class="text-2xl sm:text-4xl font-bold mb-4 text-center">{t('marketing.pricing.title')}</h1>
        <p class="text-gray-600 mb-10 sm:mb-12 text-center max-w-lg mx-auto">{t('marketing.pricing.subtitle')}</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 max-w-2xl mx-auto">
          <PlanCard name="marketing.pricing.free.name" price="$0" note="marketing.pricing.free.priceNote" features={PRICING_FREE_FEATURES} cta="marketing.home.hero.primaryCta" />
          <PlanCard name="marketing.pricing.pro.name" price={proPrice} note="marketing.pricing.pro.priceNote" features={PRICING_PRO_FEATURES} cta="marketing.pricing.pro.cta" highlighted />
        </div>
        <CurrencySwitcher currency={currency} />
        <div class="max-w-3xl mx-auto mt-12 sm:mt-16">
          <div class="bg-horizon-50 border border-horizon-600/20 rounded-2xl p-6 sm:p-10 text-center">
            <div class="inline-block bg-horizon-600 text-white text-xs font-bold px-3 py-1 rounded-full mb-3">{t('marketing.pricing.referral.badge')}</div>
            <h2 class="text-xl sm:text-2xl font-bold mb-3">{t('marketing.pricing.referral.title')}</h2>
            <p class="text-gray-600 max-w-xl mx-auto mb-5">{t('marketing.pricing.referral.body')}</p>
            <a href="/login" class="inline-block bg-horizon-600 text-white py-2.5 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors shadow-lg shadow-horizon/20">{t('marketing.pricing.referral.cta')}</a>
          </div>
        </div>
        <div class="max-w-3xl mx-auto mt-12 sm:mt-16">
          <h2 class="text-xl sm:text-2xl font-bold text-center mb-2">{t('marketing.pricing.compare.title')}</h2>
          <p class="text-center text-gray-500 text-sm mb-6">{t('marketing.pricing.compare.subtitle')}</p>
          <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table class="w-full text-sm">
              <thead><tr class="bg-gray-50 border-b border-gray-200"><th class="text-left py-3 px-4 font-bold text-gray-700">{t('marketing.pricing.compare.feature')}</th><th class="py-3 px-2 text-center font-bold text-gray-500 w-16 sm:w-24">{t('marketing.pricing.free.name')}</th><th class="py-3 px-2 text-center font-bold text-horizon-700 w-16 sm:w-24">{t('marketing.pricing.pro.name')}</th></tr></thead>
              <tbody>{PRICING_COMPARISON.map((group) => <><PlanGroup label={t(group.label)} />{group.rows.map((row) => <PlanRow feature={t(row.feature)} free={row.free} pro={row.pro} />)}</>)}</tbody>
            </table>
          </div>
        </div>
        <div class="text-center mt-8 sm:mt-12"><p class="text-sm text-gray-500">{t('marketing.pricing.footer')}</p></div>
      </div>
    </MarketingLayout>
  )
}

function OpenStandardPage() {
  return (
    <MarketingLayout title={t('marketing.standard.metaTitle')}>
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <div class="inline-block bg-horizon-50 text-horizon-700 font-semibold text-sm px-4 py-1.5 rounded-full mb-4">{t('marketing.standard.badge')}</div>
        <h1 class="text-2xl sm:text-4xl font-bold mb-4 sm:mb-6">{t('marketing.standard.title')}</h1>
        <CopyParagraphs keys={STANDARD_INTRO} className="space-y-4 text-gray-600 leading-relaxed mb-12" />
        <DocSection title="marketing.standard.why.title" paragraphs={STANDARD_WHY} />
        <DocSection title="marketing.standard.format.title" paragraphs={STANDARD_FORMAT} />
        <CodeBlock code={STANDARD_CONTACT_SAMPLE} className="mb-12" />
        <h2 class="text-xl sm:text-2xl font-bold mb-3">{t('marketing.standard.contact.title')}</h2>
        <p class="text-gray-600 leading-relaxed mb-6">{t('marketing.standard.contact.body')}</p>
        <SpecTable heading="marketing.standard.requiredFields" rows={STANDARD_CONTACT_REQUIRED} />
        <SpecTable heading="marketing.standard.optionalFields" rows={STANDARD_CONTACT_OPTIONAL} />
        <h3 class="text-lg font-bold mb-3">{t('marketing.standard.bodyNotes.title')}</h3>
        <CopyParagraphs keys={STANDARD_CONTACT_BODY} className="space-y-4 text-gray-600 leading-relaxed mb-12" />
        <h2 class="text-xl sm:text-2xl font-bold mb-3">{t('marketing.standard.wedding.title')}</h2>
        <p class="text-gray-600 leading-relaxed mb-6">{t('marketing.standard.wedding.body')}</p>
        <CodeBlock code={STANDARD_WEDDING_SAMPLE} className="mb-8" />
        <SpecTable heading="marketing.standard.requiredFields" rows={STANDARD_WEDDING_REQUIRED} />
        <SpecTable heading="marketing.standard.optionalFields" rows={STANDARD_WEDDING_OPTIONAL} />
        <h3 class="text-lg font-bold mb-3">{t('marketing.standard.bodyNotes.title')}</h3>
        <CopyParagraphs keys={STANDARD_WEDDING_BODY} className="space-y-4 text-gray-600 leading-relaxed mb-12" />
        <h2 class="text-xl sm:text-2xl font-bold mb-3">{t('marketing.standard.companions.title')}</h2>
        <CopyParagraphs keys={STANDARD_COMPANIONS} className="space-y-4 text-gray-600 leading-relaxed mb-6" />
        <SpecTable heading="marketing.standard.companions.files" rows={STANDARD_COMPANION_FILES} />
        <div class="mb-6" />
        <DocSection title="marketing.standard.naming.title" paragraphs={STANDARD_NAMING} />
        <div class="bg-white border border-papaya-300/30 rounded-xl p-4 sm:p-6 mb-6"><h3 class="font-bold text-sm mb-3">{t('marketing.standard.naming.contacts')}</h3><ExampleLines examples={STANDARD_CONTACT_FILENAME_EXAMPLES} /></div>
        <div class="bg-white border border-papaya-300/30 rounded-xl p-4 sm:p-6 mb-6"><h3 class="font-bold text-sm mb-3">{t('marketing.standard.naming.weddings')}</h3><ExampleLines examples={STANDARD_WEDDING_FILENAME_EXAMPLES} /></div>
        <div class="bg-white border border-papaya-300/30 rounded-xl p-4 sm:p-6 mb-12"><h3 class="font-bold text-sm mb-3">{t('marketing.standard.slug.title')}</h3><CopyParagraphs keys={STANDARD_SLUG_RULES} className="space-y-2 text-sm text-gray-600" /></div>
        <DocSection title="marketing.standard.directory.title" paragraphs={STANDARD_DIRECTORY} />
        <CodeBlock code={STANDARD_DIRECTORY_SAMPLE} className="mb-12" />
        <h2 class="text-xl sm:text-2xl font-bold mb-3">{t('marketing.standard.yaml.title')}</h2>
        <div class="space-y-3 mb-12">{STANDARD_YAML_TIPS.map((tip) => <AboutFeature title={t(tip.title)} desc={t(tip.desc)} />)}</div>
        <h2 class="text-xl sm:text-2xl font-bold mb-3">{t('marketing.standard.interop.title')}</h2>
        <CopyParagraphs keys={STANDARD_INTEROP_PARAGRAPHS} className="space-y-4 text-gray-600 leading-relaxed mb-4" />
        <ul class="list-disc list-inside space-y-1.5 text-gray-600 mb-4">{STANDARD_INTEROP_LIST.map((item) => <li>{t(item)}</li>)}</ul>
        <p class="text-gray-600 leading-relaxed mb-12">{t('marketing.standard.interop.parser')}</p>
        <h2 class="text-xl sm:text-2xl font-bold mb-3">{t('marketing.standard.license.title')}</h2>
        <CopyParagraphs keys={STANDARD_LICENSE} className="space-y-4 text-gray-600 leading-relaxed mb-12" />
        <div class="bg-horizon-600 rounded-2xl p-6 sm:p-10 text-center text-white">
          <h2 class="text-xl sm:text-2xl font-bold mb-3">{t('marketing.standard.cta.title')}</h2>
          <p class="text-white mb-6 max-w-md mx-auto text-sm">{t('marketing.standard.cta.body')}</p>
          <div class="flex flex-col sm:flex-row items-center justify-center gap-3"><a href="https://github.com/joshwithers/wedding-computer-sync" class="inline-block bg-white text-horizon-700 font-bold px-6 py-3 rounded-xl hover:bg-horizon-50 transition-colors text-sm">{t('marketing.standard.cta.reference')}</a><a href="/docs/plain-text" class="inline-block bg-horizon-500 text-white font-bold px-6 py-3 rounded-xl hover:bg-horizon-400 transition-colors text-sm">{t('marketing.standard.cta.files')}</a></div>
        </div>
      </div>
    </MarketingLayout>
  )
}

function PlanCard({ name, price, note, features, cta, highlighted }: { name: MessageKey; price: string; note: MessageKey; features: MessageKey[]; cta: MessageKey; highlighted?: boolean }) {
  return (
    <div class={`bg-white rounded-2xl ${highlighted ? 'border-2 border-horizon-600 relative' : 'border border-gray-200'} p-6 sm:p-8`}>
      {highlighted && <div class="absolute -top-3 left-6 bg-horizon-600 text-white text-xs font-bold px-3 py-1 rounded-full">{t('marketing.pricing.recommended')}</div>}
      <p class={`text-sm font-bold ${highlighted ? 'text-horizon-700' : 'text-gray-500'} uppercase tracking-wide mb-3`}>{t(name)}</p>
      <p class="text-4xl font-bold mb-1">{price}</p>
      <p class="text-sm text-gray-500 mb-6">{t(note)}</p>
      <ul class="space-y-2.5 text-sm text-gray-700 mb-8">{features.map((feature, index) => <PricingFeature text={t(feature)} bold={highlighted && index === 0} />)}</ul>
      <a href="/login" class={highlighted ? 'block text-center bg-horizon-600 text-white py-3 px-4 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors shadow-lg shadow-horizon/20' : 'block text-center bg-white border border-gray-200 text-gray-700 py-3 px-4 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors'}>{t(cta)}</a>
    </div>
  )
}

function currencyName(code: CurrencyCode): string {
  try {
    return new Intl.DisplayNames(getI18n().locale, { type: 'currency' }).of(code) ?? CURRENCIES[code].label
  } catch {
    return CURRENCIES[code].label
  }
}

function CurrencySwitcher({ currency }: { currency: CurrencyCode }) {
  return (
    <div class="mt-8 text-center">
      <form method="post" action="/currency" class="inline-flex items-center gap-2">
        <input type="hidden" name="return_to" value="/pricing" data-locale-return-to />
        <label for="currency-select" class="text-sm text-gray-500">{t('marketing.pricing.currency.label')}</label>
        <select
          id="currency-select"
          name="currency"
          aria-label={t('marketing.pricing.currency.label')}
          onchange="this.form.submit()"
          class="h-10 appearance-none rounded-xl bg-white py-2 pl-3 pr-8 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200 transition-colors hover:ring-gray-300 focus:outline-none focus:ring-2 focus:ring-horizon-500"
        >
          {PRESENTMENT_CURRENCIES.map((code) => (
            <option value={code} selected={code === currency}>{code} · {currencyName(code)}</option>
          ))}
        </select>
        <noscript>
          <button type="submit" class="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700">{t('common.save')}</button>
        </noscript>
      </form>
      <p class="mt-2 text-xs text-gray-400">{t('marketing.pricing.currency.help')}</p>
    </div>
  )
}

function CopyParagraphs({ keys, className }: { keys: MessageKey[]; className: string }) {
  return <div class={className}>{keys.map((key) => <p>{t(key)}</p>)}</div>
}

function PageFeatureSection({ section }: { section: FeatureSection }) {
  return <><h2 class="text-xl sm:text-2xl font-bold mb-2">{t(section.title)}</h2>{section.subtitle && <p class="text-gray-500 text-sm mb-6">{t(section.subtitle)}</p>}<div class="space-y-3 mb-12">{section.features.map((feature) => <AboutFeature title={t(feature.title)} desc={t(feature.desc)} />)}</div></>
}

function DocSection({ title, paragraphs }: { title: MessageKey; paragraphs: MessageKey[] }) {
  return <><h2 class="text-xl sm:text-2xl font-bold mb-3">{t(title)}</h2><CopyParagraphs keys={paragraphs} className="space-y-4 text-gray-600 leading-relaxed mb-12" /></>
}

function CodeBlock({ code, className }: { code: string; className: string }) {
  return <div class={'bg-gray-900 rounded-xl p-4 sm:p-6 ' + className + ' overflow-x-auto'}><pre class="text-sm text-gray-100 leading-relaxed"><code>{code}</code></pre></div>
}

function SpecTable({ heading, rows }: { heading: MessageKey; rows: SpecDef[] }) {
  return <><h3 class="text-lg font-bold mb-3">{t(heading)}</h3><div class="bg-white border border-papaya-300/30 rounded-xl overflow-hidden mb-6"><table class="w-full text-sm"><thead class="bg-papaya-50/50"><tr><th class="text-left px-4 py-2.5 font-bold text-gray-700">{t('marketing.standard.table.field')}</th><th class="text-left px-4 py-2.5 font-bold text-gray-700">{t('marketing.standard.table.type')}</th><th class="text-left px-4 py-2.5 font-bold text-gray-700">{t('marketing.standard.table.description')}</th></tr></thead><tbody class="divide-y divide-papaya-300/20">{rows.map((row) => <SpecRow field={row.field} type={row.type} desc={t(row.desc)} />)}</tbody></table></div></>
}

function ExampleLines({ examples }: { examples: ExampleLine[] }) {
  return <div class="space-y-2 text-sm text-gray-600">{examples.map((example) => <p><code class="bg-gray-100 px-1.5 py-0.5 rounded">{example.code}</code> — {t(example.desc)}</p>)}</div>
}

type MarketingColor = 'horizon' | 'grapefruit'
type CardDef = { title: MessageKey; desc: MessageKey }
type FeatureCardDef = CardDef & { color: MarketingColor; icon: string }
type AudienceDef = { color: MarketingColor; icon: string; eyebrow: MessageKey; title: MessageKey; points: MessageKey[]; cta: MessageKey }
type RoleDef = { role: string; label: MessageKey; features: CardDef[]; collab: MessageKey }
type FeatureSection = { title: MessageKey; subtitle?: MessageKey; features: CardDef[] }
type PlanRowDef = { feature: MessageKey; free?: boolean; pro?: boolean }
type PlanGroupDef = { label: MessageKey; rows: PlanRowDef[] }
type SpecDef = { field: string; type: string; desc: MessageKey }
type ExampleLine = { code: string; desc: MessageKey }

const ROLE_TABS_SCRIPT = "document.getElementById('role-tabs').addEventListener('click', function(e) { var btn = e.target.closest('[data-role]'); if (!btn) return; var role = btn.getAttribute('data-role'); document.querySelectorAll('#role-tabs [data-role]').forEach(function(t) { t.classList.remove('bg-horizon-600', 'text-white'); t.classList.add('bg-white', 'text-gray-700'); }); btn.classList.remove('bg-white', 'text-gray-700'); btn.classList.add('bg-horizon-600', 'text-white'); document.querySelectorAll('#role-panels [data-panel]').forEach(function(p) { p.style.display = p.getAttribute('data-panel') === role ? '' : 'none'; }); });"

const HOME_AUDIENCES: AudienceDef[] = [
  { color: 'horizon', icon: 'couple', eyebrow: 'marketing.home.audience.couples.eyebrow', title: 'marketing.home.audience.couples.title', cta: 'marketing.home.audience.couples.cta', points: ['marketing.home.audience.couples.p1', 'marketing.home.audience.couples.p2', 'marketing.home.audience.couples.p3', 'marketing.home.audience.couples.p4'] },
  { color: 'grapefruit', icon: 'runsheet', eyebrow: 'marketing.home.audience.venues.eyebrow', title: 'marketing.home.audience.venues.title', cta: 'marketing.home.audience.venues.cta', points: ['marketing.home.audience.venues.p1', 'marketing.home.audience.venues.p2', 'marketing.home.audience.venues.p3', 'marketing.home.audience.venues.p4'] },
  { color: 'horizon', icon: 'crm', eyebrow: 'marketing.home.audience.vendors.eyebrow', title: 'marketing.home.audience.vendors.title', cta: 'marketing.home.audience.vendors.cta', points: ['marketing.home.audience.vendors.p1', 'marketing.home.audience.vendors.p2', 'marketing.home.audience.vendors.p3', 'marketing.home.audience.vendors.p4'] },
]
const HOME_ROLES: RoleDef[] = [
  { role: 'venue', label: 'marketing.home.role.venue.label', collab: 'marketing.home.role.venue.collab', features: [{ title: 'marketing.home.role.venue.feature.workspace.title', desc: 'marketing.home.role.venue.feature.workspace.desc' },{ title: 'marketing.home.role.venue.feature.forms.title', desc: 'marketing.home.role.venue.feature.forms.desc' },{ title: 'marketing.home.role.venue.feature.calendar.title', desc: 'marketing.home.role.venue.feature.calendar.desc' },{ title: 'marketing.home.role.venue.feature.invoicing.title', desc: 'marketing.home.role.venue.feature.invoicing.desc' }] },
  { role: 'planner', label: 'marketing.home.role.planner.label', collab: 'marketing.home.role.planner.collab', features: [{ title: 'marketing.home.role.planner.feature.dashboard.title', desc: 'marketing.home.role.planner.feature.dashboard.desc' },{ title: 'marketing.home.role.planner.feature.runsheets.title', desc: 'marketing.home.role.planner.feature.runsheets.desc' },{ title: 'marketing.home.role.planner.feature.team.title', desc: 'marketing.home.role.planner.feature.team.desc' },{ title: 'marketing.home.role.planner.feature.analytics.title', desc: 'marketing.home.role.planner.feature.analytics.desc' }] },
  { role: 'photographer', label: 'marketing.home.role.photographer.label', collab: 'marketing.home.role.photographer.collab', features: [{ title: 'marketing.home.role.photographer.feature.crm.title', desc: 'marketing.home.role.photographer.feature.crm.desc' },{ title: 'marketing.home.role.photographer.feature.timeline.title', desc: 'marketing.home.role.photographer.feature.timeline.desc' },{ title: 'marketing.home.role.photographer.feature.credits.title', desc: 'marketing.home.role.photographer.feature.credits.desc' },{ title: 'marketing.home.role.photographer.feature.import.title', desc: 'marketing.home.role.photographer.feature.import.desc' }] },
  { role: 'videographer', label: 'marketing.home.role.videographer.label', collab: 'marketing.home.role.videographer.collab', features: [{ title: 'marketing.home.role.videographer.feature.timeline.title', desc: 'marketing.home.role.videographer.feature.timeline.desc' },{ title: 'marketing.home.role.videographer.feature.coordinate.title', desc: 'marketing.home.role.videographer.feature.coordinate.desc' },{ title: 'marketing.home.role.videographer.feature.quote.title', desc: 'marketing.home.role.videographer.feature.quote.desc' },{ title: 'marketing.home.role.videographer.feature.credits.title', desc: 'marketing.home.role.videographer.feature.credits.desc' }] },
  { role: 'celebrant', label: 'marketing.home.role.celebrant.label', collab: 'marketing.home.role.celebrant.collab', features: [{ title: 'marketing.home.role.celebrant.feature.pipeline.title', desc: 'marketing.home.role.celebrant.feature.pipeline.desc' },{ title: 'marketing.home.role.celebrant.feature.checklists.title', desc: 'marketing.home.role.celebrant.feature.checklists.desc' },{ title: 'marketing.home.role.celebrant.feature.calendar.title', desc: 'marketing.home.role.celebrant.feature.calendar.desc' },{ title: 'marketing.home.role.celebrant.feature.ai.title', desc: 'marketing.home.role.celebrant.feature.ai.desc' }] },
  { role: 'florist', label: 'marketing.home.role.florist.label', collab: 'marketing.home.role.florist.collab', features: [{ title: 'marketing.home.role.florist.feature.quote.title', desc: 'marketing.home.role.florist.feature.quote.desc' },{ title: 'marketing.home.role.florist.feature.bumpIn.title', desc: 'marketing.home.role.florist.feature.bumpIn.desc' },{ title: 'marketing.home.role.florist.feature.invoicing.title', desc: 'marketing.home.role.florist.feature.invoicing.desc' },{ title: 'marketing.home.role.florist.feature.import.title', desc: 'marketing.home.role.florist.feature.import.desc' }] },
  { role: 'music', label: 'marketing.home.role.music.label', collab: 'marketing.home.role.music.collab', features: [{ title: 'marketing.home.role.music.feature.timeline.title', desc: 'marketing.home.role.music.feature.timeline.desc' },{ title: 'marketing.home.role.music.feature.forms.title', desc: 'marketing.home.role.music.feature.forms.desc' },{ title: 'marketing.home.role.music.feature.calendar.title', desc: 'marketing.home.role.music.feature.calendar.desc' },{ title: 'marketing.home.role.music.feature.quote.title', desc: 'marketing.home.role.music.feature.quote.desc' }] },
]
const CRM_IMPORTS: Array<{ name: string; caption: MessageKey; italic?: boolean }> = [{ name: 'Dubsado', caption: 'marketing.home.switching.csvImport' },{ name: 'Studio Ninja', caption: 'marketing.home.switching.csvImport' },{ name: 'HoneyBook', caption: 'marketing.home.switching.csvImport' },{ name: 'VSCO Workspace', caption: 'marketing.home.switching.formerlyTave', italic: true },{ name: 'Any CSV / JSON', caption: 'marketing.home.switching.customMapping' }]
const HOME_DATA_TOOLS: Array<{ emoji: string; name: MessageKey; caption: MessageKey }> = [{ emoji: '💎', name: 'marketing.home.data.tool.obsidian', caption: 'marketing.home.data.obsidian' },{ emoji: '📝', name: 'marketing.home.data.tool.editor', caption: 'marketing.home.data.editor' },{ emoji: '🔧', name: 'marketing.home.data.tool.tools', caption: 'marketing.home.data.tools' }]
const ABOUT_INTRO: MessageKey[] = ['marketing.about.intro.p1', 'marketing.about.intro.p2', 'marketing.about.intro.p3', 'marketing.about.pricing']
const ABOUT_SECTIONS: FeatureSection[] = [{ title: 'marketing.about.difference.title', subtitle: 'marketing.about.difference.subtitle', features: [{ title: 'marketing.about.difference.collab.title', desc: 'marketing.about.difference.collab.desc' },{ title: 'marketing.about.difference.data.title', desc: 'marketing.about.difference.data.desc' },{ title: 'marketing.about.difference.ai.title', desc: 'marketing.about.difference.ai.desc' },{ title: 'marketing.about.difference.market.title', desc: 'marketing.about.difference.market.desc' }] },{ title: 'marketing.about.vendors.title', subtitle: 'marketing.about.vendors.subtitle', features: [{ title: 'marketing.about.vendors.pipeline.title', desc: 'marketing.about.vendors.pipeline.desc' },{ title: 'marketing.about.vendors.forms.title', desc: 'marketing.about.vendors.forms.desc' },{ title: 'marketing.about.vendors.calendar.title', desc: 'marketing.about.vendors.calendar.desc' },{ title: 'marketing.about.vendors.invoicing.title', desc: 'marketing.about.vendors.invoicing.desc' },{ title: 'marketing.about.vendors.email.title', desc: 'marketing.about.vendors.email.desc' },{ title: 'marketing.about.vendors.aiEmail.title', desc: 'marketing.about.vendors.aiEmail.desc' },{ title: 'marketing.about.vendors.bookingForms.title', desc: 'marketing.about.vendors.bookingForms.desc' },{ title: 'marketing.about.vendors.carddav.title', desc: 'marketing.about.vendors.carddav.desc' },{ title: 'marketing.about.vendors.notifications.title', desc: 'marketing.about.vendors.notifications.desc' },{ title: 'marketing.about.vendors.analytics.title', desc: 'marketing.about.vendors.analytics.desc' },{ title: 'marketing.about.vendors.goals.title', desc: 'marketing.about.vendors.goals.desc' },{ title: 'marketing.about.vendors.contracts.title', desc: 'marketing.about.vendors.contracts.desc' },{ title: 'marketing.about.vendors.import.title', desc: 'marketing.about.vendors.import.desc' },{ title: 'marketing.about.vendors.team.title', desc: 'marketing.about.vendors.team.desc' },{ title: 'marketing.about.vendors.quote.title', desc: 'marketing.about.vendors.quote.desc' },{ title: 'marketing.about.vendors.booking.title', desc: 'marketing.about.vendors.booking.desc' },{ title: 'marketing.about.vendors.checklists.title', desc: 'marketing.about.vendors.checklists.desc' },{ title: 'marketing.about.vendors.api.title', desc: 'marketing.about.vendors.api.desc' },{ title: 'marketing.about.vendors.mcp.title', desc: 'marketing.about.vendors.mcp.desc' }] },{ title: 'marketing.about.couples.title', subtitle: 'marketing.about.couples.subtitle', features: [{ title: 'marketing.about.couples.dashboard.title', desc: 'marketing.about.couples.dashboard.desc' },{ title: 'marketing.about.couples.budget.title', desc: 'marketing.about.couples.budget.desc' },{ title: 'marketing.about.couples.platform.title', desc: 'marketing.about.couples.platform.desc' },{ title: 'marketing.about.couples.runsheet.title', desc: 'marketing.about.couples.runsheet.desc' },{ title: 'marketing.about.couples.collab.title', desc: 'marketing.about.couples.collab.desc' },{ title: 'marketing.about.couples.forms.title', desc: 'marketing.about.couples.forms.desc' },{ title: 'marketing.about.couples.messages.title', desc: 'marketing.about.couples.messages.desc' },{ title: 'marketing.about.couples.weather.title', desc: 'marketing.about.couples.weather.desc' },{ title: 'marketing.about.couples.community.title', desc: 'marketing.about.couples.community.desc' },{ title: 'marketing.about.couples.visibility.title', desc: 'marketing.about.couples.visibility.desc' }] }]
const ABOUT_COLLAB_FEATURES: CardDef[] = [
  { title: 'marketing.about.collab.runsheet.title', desc: 'marketing.about.collab.runsheet.desc' },
  { title: 'marketing.about.collab.approval.title', desc: 'marketing.about.collab.approval.desc' },
  { title: 'marketing.about.collab.live.title', desc: 'marketing.about.collab.live.desc' },
  { title: 'marketing.about.collab.sun.title', desc: 'marketing.about.collab.sun.desc' },
  { title: 'marketing.about.collab.notes.title', desc: 'marketing.about.collab.notes.desc' },
  { title: 'marketing.about.collab.links.title', desc: 'marketing.about.collab.links.desc' },
  { title: 'marketing.about.collab.files.title', desc: 'marketing.about.collab.files.desc' },
  { title: 'marketing.about.collab.weather.title', desc: 'marketing.about.collab.weather.desc' },
  { title: 'marketing.about.collab.credits.title', desc: 'marketing.about.collab.credits.desc' },
  { title: 'marketing.about.collab.teamAssign.title', desc: 'marketing.about.collab.teamAssign.desc' },
]
const ABOUT_WORKSPACE_PARAGRAPHS: MessageKey[] = ['marketing.about.workspaces.p1', 'marketing.about.workspaces.p2', 'marketing.about.workspaces.p3', 'marketing.about.workspaces.p4']
const ABOUT_DATA_PARAGRAPHS: MessageKey[] = ['marketing.about.data.p1', 'marketing.about.data.p2', 'marketing.about.data.p3']
const ABOUT_DATA_FEATURES: CardDef[] = [{ title: 'marketing.about.data.markdown.title', desc: 'marketing.about.data.markdown.desc' },{ title: 'marketing.about.data.lockIn.title', desc: 'marketing.about.data.lockIn.desc' },{ title: 'marketing.about.data.standard.title', desc: 'marketing.about.data.standard.desc' }]
const ABOUT_MORE_SECTIONS: FeatureSection[] = [{ title: 'marketing.about.roadmap.title', subtitle: 'marketing.about.roadmap.subtitle', features: [{ title: 'marketing.about.roadmap.dateFinder.title', desc: 'marketing.about.roadmap.dateFinder.desc' },{ title: 'marketing.about.roadmap.ai.title', desc: 'marketing.about.roadmap.ai.desc' },{ title: 'marketing.about.roadmap.google.title', desc: 'marketing.about.roadmap.google.desc' }] },{ title: 'marketing.about.technical.title', subtitle: 'marketing.about.technical.subtitle', features: [{ title: 'marketing.about.technical.workers.title', desc: 'marketing.about.technical.workers.desc' },{ title: 'marketing.about.technical.hono.title', desc: 'marketing.about.technical.hono.desc' },{ title: 'marketing.about.technical.files.title', desc: 'marketing.about.technical.files.desc' },{ title: 'marketing.about.technical.dav.title', desc: 'marketing.about.technical.dav.desc' },{ title: 'marketing.about.technical.auth.title', desc: 'marketing.about.technical.auth.desc' },{ title: 'marketing.about.technical.stripe.title', desc: 'marketing.about.technical.stripe.desc' },{ title: 'marketing.about.technical.email.title', desc: 'marketing.about.technical.email.desc' },{ title: 'marketing.about.technical.queues.title', desc: 'marketing.about.technical.queues.desc' },{ title: 'marketing.about.technical.tenant.title', desc: 'marketing.about.technical.tenant.desc' },{ title: 'marketing.about.technical.tracking.title', desc: 'marketing.about.technical.tracking.desc' }] }]
const ABOUT_OPEN_DATA_PARAGRAPHS: MessageKey[] = ['marketing.about.openData.p1', 'marketing.about.openData.p2']
const ABOUT_AI_PARAGRAPHS: MessageKey[] = ['marketing.about.ai.p1', 'marketing.about.ai.p2', 'marketing.about.ai.p3']
const ABOUT_AI_FEATURES: CardDef[] = [
  { title: 'marketing.about.ai.brief.title', desc: 'marketing.about.ai.brief.desc' },
  { title: 'marketing.about.ai.update.title', desc: 'marketing.about.ai.update.desc' },
  { title: 'marketing.about.ai.rules.title', desc: 'marketing.about.ai.rules.desc' },
  { title: 'marketing.about.ai.open.title', desc: 'marketing.about.ai.open.desc' },
]
const HOME_AI_EXAMPLES: Array<{ q: MessageKey; a: MessageKey }> = [
  { q: 'marketing.home.ai.example1.q', a: 'marketing.home.ai.example1.a' },
  { q: 'marketing.home.ai.example2.q', a: 'marketing.home.ai.example2.a' },
  { q: 'marketing.home.ai.example3.q', a: 'marketing.home.ai.example3.a' },
  { q: 'marketing.home.ai.example4.q', a: 'marketing.home.ai.example4.a' },
]
const PRICING_FREE_FEATURES: MessageKey[] = ['marketing.pricing.feature.pipeline','marketing.pricing.feature.forms','marketing.pricing.feature.calendar','marketing.pricing.feature.invoicing','marketing.pricing.feature.booking','marketing.pricing.feature.email','marketing.pricing.feature.workspaces','marketing.pricing.feature.runsheet','marketing.pricing.feature.collab','marketing.pricing.feature.weather','marketing.pricing.feature.credits','marketing.pricing.feature.import','marketing.pricing.feature.team','marketing.pricing.feature.quote','marketing.pricing.feature.publicCalendar','marketing.pricing.feature.directory','marketing.pricing.feature.coupleDashboard','marketing.pricing.feature.community','marketing.pricing.feature.plainText','marketing.pricing.feature.passkeys']
const PRICING_PRO_FEATURES: MessageKey[] = ['marketing.pricing.feature.everythingFree','marketing.pricing.feature.unlimitedWeddings','marketing.pricing.feature.caldav','marketing.pricing.feature.carddav','marketing.pricing.feature.analyticsDashboard','marketing.pricing.feature.revenueInsights','marketing.pricing.feature.goals','marketing.pricing.feature.aiDrafting','marketing.pricing.feature.demandScores','marketing.pricing.feature.benchmarks','marketing.pricing.feature.aiReplies','marketing.pricing.feature.mcp']
const PRICING_COMPARISON: PlanGroupDef[] = [
  { label: 'marketing.pricing.group.leads', rows: [
    { feature: 'marketing.pricing.compare.pipeline', free: true, pro: true },
    { feature: 'marketing.pricing.compare.forms', free: true, pro: true },
    { feature: 'marketing.pricing.compare.htmlForm', free: true, pro: true },
    { feature: 'marketing.pricing.compare.spam', free: true, pro: true },
    { feature: 'marketing.pricing.compare.import', free: true, pro: true },
    { feature: 'marketing.pricing.compare.aiDrafting', pro: true },
    { feature: 'marketing.pricing.compare.aiReplies', pro: true },
    { feature: 'marketing.pricing.compare.webhooks', pro: true },
    { feature: 'marketing.pricing.compare.agentLead', pro: true },
  ] },
  { label: 'marketing.pricing.group.calendar', rows: [
    { feature: 'marketing.pricing.compare.calendar', free: true, pro: true },
    { feature: 'marketing.pricing.compare.availability', free: true, pro: true },
    { feature: 'marketing.pricing.compare.publicCalendar', free: true, pro: true },
    { feature: 'marketing.pricing.compare.directory', free: true, pro: true },
    { feature: 'marketing.pricing.compare.personalFeed', free: true, pro: true },
    { feature: 'marketing.pricing.compare.caldav', pro: true },
    { feature: 'marketing.pricing.compare.carddav', pro: true },
  ] },
  { label: 'marketing.pricing.group.money', rows: [
    { feature: 'marketing.pricing.compare.invoicing', free: true, pro: true },
    { feature: 'marketing.pricing.compare.booking', free: true, pro: true },
    { feature: 'marketing.pricing.compare.quote', free: true, pro: true },
    { feature: 'marketing.pricing.compare.contracts', free: true, pro: true },
  ] },
  { label: 'marketing.pricing.group.weddings', rows: [
    { feature: 'marketing.pricing.compare.workspaces', free: true, pro: true },
    { feature: 'marketing.pricing.compare.unlimitedWeddings', pro: true },
    { feature: 'marketing.pricing.compare.runsheet', free: true, pro: true },
    { feature: 'marketing.pricing.compare.timelineCollab', free: true, pro: true },
    { feature: 'marketing.pricing.compare.checklists', free: true, pro: true },
    { feature: 'marketing.pricing.compare.collab', free: true, pro: true },
    { feature: 'marketing.pricing.compare.weather', free: true, pro: true },
    { feature: 'marketing.pricing.compare.credits', free: true, pro: true },
    { feature: 'marketing.pricing.compare.team', free: true, pro: true },
    { feature: 'marketing.pricing.compare.coupleDashboard', free: true, pro: true },
    { feature: 'marketing.pricing.compare.community', free: true, pro: true },
  ] },
  { label: 'marketing.pricing.group.data', rows: [
    { feature: 'marketing.pricing.compare.plainText', free: true, pro: true },
    { feature: 'marketing.pricing.compare.passkeys', free: true, pro: true },
  ] },
  { label: 'marketing.pricing.group.insights', rows: [
    { feature: 'marketing.pricing.compare.analyticsOverview', free: true, pro: true },
    { feature: 'marketing.pricing.compare.demandTeaser', free: true, pro: true },
    { feature: 'marketing.pricing.compare.analytics', pro: true },
    { feature: 'marketing.pricing.compare.demand', pro: true },
    { feature: 'marketing.pricing.compare.revenue', pro: true },
    { feature: 'marketing.pricing.compare.goals', pro: true },
    { feature: 'marketing.pricing.compare.benchmarks', pro: true },
    { feature: 'marketing.pricing.compare.mcp', pro: true },
  ] },
]
const STANDARD_INTRO: MessageKey[] = ['marketing.standard.intro.p1', 'marketing.standard.intro.p2']
const STANDARD_WHY: MessageKey[] = ['marketing.standard.why.p1', 'marketing.standard.why.p2', 'marketing.standard.why.p3']
const STANDARD_FORMAT: MessageKey[] = ['marketing.standard.format.p1']
const STANDARD_CONTACT_BODY: MessageKey[] = ['marketing.standard.contact.bodyNotes.p1', 'marketing.standard.contact.bodyNotes.p2']
const STANDARD_WEDDING_BODY: MessageKey[] = ['marketing.standard.wedding.bodyNotes.p1']
const STANDARD_NAMING: MessageKey[] = ['marketing.standard.naming.p1']
const STANDARD_DIRECTORY: MessageKey[] = ['marketing.standard.directory.p1']
const STANDARD_SLUG_RULES: MessageKey[] = ['marketing.standard.slug.rule1','marketing.standard.slug.rule2','marketing.standard.slug.rule3','marketing.standard.slug.rule4','marketing.standard.slug.rule5','marketing.standard.slug.rule6','marketing.standard.slug.rule7']
const STANDARD_INTEROP_PARAGRAPHS: MessageKey[] = ['marketing.standard.interop.p1']
const STANDARD_INTEROP_LIST: MessageKey[] = ['marketing.standard.interop.editor','marketing.standard.interop.obsidian','marketing.standard.interop.static','marketing.standard.interop.scripting','marketing.standard.interop.yaml']
const STANDARD_LICENSE: MessageKey[] = ['marketing.standard.license.p1', 'marketing.standard.license.p2']
const STANDARD_CONTACT_REQUIRED: SpecDef[] = [{ field: 'id', type: 'string', desc: 'marketing.standard.spec.contact.id' },{ field: 'first_name', type: 'string', desc: 'marketing.standard.spec.contact.firstName' },{ field: 'last_name', type: 'string', desc: 'marketing.standard.spec.contact.lastName' },{ field: 'status', type: 'enum', desc: 'marketing.standard.spec.contact.status' },{ field: 'created_at', type: 'ISO 8601', desc: 'marketing.standard.spec.contact.createdAt' },{ field: 'updated_at', type: 'ISO 8601', desc: 'marketing.standard.spec.contact.updatedAt' }]
const STANDARD_CONTACT_OPTIONAL: SpecDef[] = [{ field: 'email', type: 'string', desc: 'marketing.standard.spec.contact.email' },{ field: 'phone', type: 'string', desc: 'marketing.standard.spec.contact.phone' },{ field: 'partner_first_name', type: 'string', desc: 'marketing.standard.spec.contact.partnerFirstName' },{ field: 'partner_last_name', type: 'string', desc: 'marketing.standard.spec.contact.partnerLastName' },{ field: 'partner_email', type: 'string', desc: 'marketing.standard.spec.contact.partnerEmail' },{ field: 'partner_phone', type: 'string', desc: 'marketing.standard.spec.contact.partnerPhone' },{ field: 'source', type: 'string', desc: 'marketing.standard.spec.contact.source' },{ field: 'wedding_id', type: 'string', desc: 'marketing.standard.spec.contact.weddingId' },{ field: 'wedding_date', type: 'string', desc: 'marketing.standard.spec.contact.weddingDate' },{ field: 'wedding_location', type: 'string', desc: 'marketing.standard.spec.contact.weddingLocation' },{ field: 'tags', type: 'string[]', desc: 'marketing.standard.spec.contact.tags' },{ field: 'form_data', type: 'object', desc: 'marketing.standard.spec.contact.formData' },{ field: 'last_contacted_at', type: 'ISO 8601', desc: 'marketing.standard.spec.contact.lastContactedAt' }]
const STANDARD_WEDDING_REQUIRED: SpecDef[] = [{ field: 'id', type: 'string', desc: 'marketing.standard.spec.wedding.id' },{ field: 'title', type: 'string', desc: 'marketing.standard.spec.wedding.title' },{ field: 'status', type: 'enum', desc: 'marketing.standard.spec.wedding.status' },{ field: 'created_by_user_id', type: 'string', desc: 'marketing.standard.spec.wedding.createdBy' },{ field: 'created_at', type: 'ISO 8601', desc: 'marketing.standard.spec.wedding.createdAt' },{ field: 'updated_at', type: 'ISO 8601', desc: 'marketing.standard.spec.wedding.updatedAt' }]
const STANDARD_WEDDING_OPTIONAL: SpecDef[] = [{ field: 'date', type: 'string', desc: 'marketing.standard.spec.wedding.date' },{ field: 'time', type: 'string', desc: 'marketing.standard.spec.wedding.time' },{ field: 'location', type: 'string', desc: 'marketing.standard.spec.wedding.location' },{ field: 'location_lat', type: 'number', desc: 'marketing.standard.spec.wedding.locationLat' },{ field: 'location_lng', type: 'number', desc: 'marketing.standard.spec.wedding.locationLng' },{ field: 'ceremony_type', type: 'string', desc: 'marketing.standard.spec.wedding.ceremonyType' },{ field: 'vendor_visibility', type: 'enum', desc: 'marketing.standard.spec.wedding.vendorVisibility' },{ field: 'reception_location', type: 'string', desc: 'marketing.standard.spec.wedding.receptionLocation' },{ field: 'reception_time', type: 'string', desc: 'marketing.standard.spec.wedding.receptionTime' },{ field: 'getting_ready_location', type: 'string', desc: 'marketing.standard.spec.wedding.gettingReadyLocation' },{ field: 'getting_ready_time', type: 'string', desc: 'marketing.standard.spec.wedding.gettingReadyTime' },{ field: 'dress_code', type: 'string', desc: 'marketing.standard.spec.wedding.dressCode' },{ field: 'guest_count', type: 'integer', desc: 'marketing.standard.spec.wedding.guestCount' },{ field: 'timeline_notes', type: 'string', desc: 'marketing.standard.spec.wedding.timelineNotes' }]
const STANDARD_CONTACT_FILENAME_EXAMPLES: ExampleLine[] = [{ code: 'sarah-smith.md', desc: 'marketing.standard.example.singleContact' },{ code: 'sarah-james-smith.md', desc: 'marketing.standard.example.sameSurname' },{ code: 'sarah-smith-james-wilson.md', desc: 'marketing.standard.example.differentSurnames' },{ code: 'john-doe-2.md', desc: 'marketing.standard.example.deduplicated' }]
const STANDARD_WEDDING_FILENAME_EXAMPLES: ExampleLine[] = [{ code: 'sarah-james-2026-12-15.md', desc: 'marketing.standard.example.weddingWithDate' },{ code: 'smith-jones-wedding.md', desc: 'marketing.standard.example.weddingWithoutDate' }]

const STANDARD_COMPANIONS: MessageKey[] = ['marketing.standard.companions.p1', 'marketing.standard.companions.p3']

const STANDARD_COMPANION_FILES: SpecDef[] = [
  { field: 'wedding.md', type: 'two-way', desc: 'marketing.standard.companions.wedding' },
  { field: 'todo.md', type: 'two-way', desc: 'marketing.standard.companions.todo' },
  { field: 'timeline.md', type: 'two-way', desc: 'marketing.standard.companions.timeline' },
  { field: 'notes.md', type: 'two-way', desc: 'marketing.standard.companions.notes' },
  { field: 'vendors.md', type: 'read-only', desc: 'marketing.standard.companions.vendors' },
  { field: 'log.md', type: 'read-only', desc: 'marketing.standard.companions.log' },
]
const STANDARD_YAML_TIPS: CardDef[] = [{ title: 'marketing.standard.yaml.phone.title', desc: 'marketing.standard.yaml.phone.desc' },{ title: 'marketing.standard.yaml.times.title', desc: 'marketing.standard.yaml.times.desc' },{ title: 'marketing.standard.yaml.dates.title', desc: 'marketing.standard.yaml.dates.desc' },{ title: 'marketing.standard.yaml.arrays.title', desc: 'marketing.standard.yaml.arrays.desc' },{ title: 'marketing.standard.yaml.colons.title', desc: 'marketing.standard.yaml.colons.desc' },{ title: 'marketing.standard.yaml.null.title', desc: 'marketing.standard.yaml.null.desc' }]
const STANDARD_CONTACT_SAMPLE = ['---','id: a1b2c3d4e5f6a1b2c3d4e5f6','first_name: Sarah','last_name: Smith','email: sarah@example.com','phone: "0400 123 456"','partner_first_name: James','partner_last_name: Wilson','status: quoted','wedding_date: 2026-12-15','wedding_location: Sydney','tags:','  - vip','  - referral','created_at: 2025-06-01T00:00:00.000Z','updated_at: 2025-06-01T00:00:00.000Z','---','','Met at the Bridal Expo in March 2025.','','- Interested in elopement ceremony','- Budget: $3,000 - $5,000','- Preferred dates: Dec 2026 or Jan 2027','','## Follow-up notes','','Called on March 15, very enthusiastic.','Sending quote this week.'].join('\n')
const STANDARD_WEDDING_SAMPLE = ['---','id: f8e7d6c5b4a3f8e7d6c5b4a3','title: Sarah & James','date: 2026-12-15','time: "15:00"','location: Royal Botanic Garden Sydney','location_lat: -33.8642','location_lng: 151.2166','status: confirmed','ceremony_type: legal','vendor_visibility: private','reception_location: The Calyx','reception_time: "17:30"','guest_count: 85','dress_code: Semi-formal','created_by_user_id: u1a2b3c4d5e6','created_at: 2025-06-01T00:00:00.000Z','updated_at: 2025-07-15T10:30:00.000Z','---','','Outdoor ceremony in the rose garden, weather permitting.','Backup plan: The Calyx indoor space.','','## Timeline','','- 13:00 — Getting ready at hotel','- 14:30 — First look photos','- 15:00 — Ceremony','- 15:30 — Family photos','- 16:00 — Canapes and drinks','- 17:30 — Reception begins'].join('\n')
const STANDARD_DIRECTORY_SAMPLE = ['vendors/','  {vendor_id}/','    contacts/','      sarah-smith.md','      john-james-doe.md','      jane-wilson-2.md','    weddings/','      2026-12-15-sarah-james/','        wedding.md','        todo.md','        timeline.md','        notes.md','        vendors.md','        log.md','        files/','      smith-wilson/','        wedding.md'].join('\n')

// ─── Plain Text Docs ───

marketing.get('/docs/plain-text', (c) => {
  return c.html(<PlainTextDocsPage />)
})

marketing.get('/docs/import', (c) => {
  return c.html(<ImportHelpPage />)
})

function PlainTextDocsPage() {
  return (
    <MarketingLayout title={t('marketing.docs.metaTitle')}>
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <h1 class="text-2xl sm:text-4xl font-bold mb-4 sm:mb-6">{t('marketing.docs.title')}</h1>
        <CopyParagraphs keys={DOCS_INTRO} className="space-y-4 text-gray-600 leading-relaxed mb-12" />
        <DocSection title="marketing.docs.look.title" paragraphs={DOCS_LOOK_PARAGRAPHS} />
        <CodeBlock code={DOCS_CONTACT_SAMPLE} className="mb-4" />
        <p class="text-sm text-gray-500 mb-12">{t('marketing.docs.look.caption')}</p>
        {DOCS_FEATURE_SECTIONS.map((section) => <PageFeatureSection section={section} />)}
        <DocSection title="marketing.docs.organised.title" paragraphs={DOCS_ORGANISED_PARAGRAPHS} />
        <CodeBlock code={DOCS_DIRECTORY_SAMPLE} className="mb-8" />
        <CopyParagraphs keys={DOCS_ORGANISED_AFTER} className="space-y-4 text-gray-600 leading-relaxed mb-12" />
        <DocSection title="marketing.docs.why.title" paragraphs={DOCS_WHY} />
        <details class="bg-white border border-papaya-300/30 rounded-xl mb-12">
          <summary class="px-4 sm:px-6 py-4 cursor-pointer font-bold text-sm text-gray-700 hover:text-gray-900">{t('marketing.docs.developers.summary')}</summary>
          <div class="px-4 sm:px-6 pb-6 pt-2 space-y-6">
            {DOCS_DEVELOPER_BLOCKS.map((block) => (
              <div>
                <h3 class="font-bold text-sm mb-2">{t(block.title)}</h3>
                <p class="text-sm text-gray-600 mb-3">{t(block.body)}</p>
                {block.code && <CodeBlock code={block.code} className="" />}
              </div>
            ))}
          </div>
        </details>
        <div class="bg-horizon-600 rounded-2xl p-6 sm:p-10 text-center text-white">
          <h2 class="text-xl sm:text-2xl font-bold mb-3">{t('marketing.docs.cta.title')}</h2>
          <p class="text-white mb-6 max-w-md mx-auto text-sm">{t('marketing.docs.cta.body')}</p>
          <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a href="/login" class="inline-block bg-white text-horizon-700 font-bold px-6 py-3 rounded-xl hover:bg-horizon-50 transition-colors text-sm">{t('marketing.home.hero.primaryCta')}</a>
            <a href="/standard" class="inline-block bg-horizon-500 text-white font-bold px-6 py-3 rounded-xl hover:bg-horizon-400 transition-colors text-sm">{t('marketing.docs.cta.standard')}</a>
          </div>
        </div>
      </div>
    </MarketingLayout>
  )
}

type DeveloperBlock = { title: MessageKey; body: MessageKey; code?: string }

const DOCS_INTRO: MessageKey[] = ['marketing.docs.intro.p1', 'marketing.docs.intro.p2']
const DOCS_LOOK_PARAGRAPHS: MessageKey[] = ['marketing.docs.look.p1']
const DOCS_FEATURE_SECTIONS: FeatureSection[] = [{ title: 'marketing.docs.download.title', subtitle: 'marketing.docs.download.subtitle', features: [{ title: 'marketing.docs.download.export.title', desc: 'marketing.docs.download.export.desc' },{ title: 'marketing.docs.download.limits.title', desc: 'marketing.docs.download.limits.desc' },{ title: 'marketing.docs.download.backups.title', desc: 'marketing.docs.download.backups.desc' }] },{ title: 'marketing.docs.obsidian.title', subtitle: 'marketing.docs.obsidian.subtitle', features: [{ title: 'marketing.docs.obsidian.plugin.title', desc: 'marketing.docs.obsidian.plugin.desc' },{ title: 'marketing.docs.obsidian.export.title', desc: 'marketing.docs.obsidian.export.desc' },{ title: 'marketing.docs.obsidian.view.title', desc: 'marketing.docs.obsidian.view.desc' }] },{ title: 'marketing.docs.phone.title', subtitle: 'marketing.docs.phone.subtitle', features: [{ title: 'marketing.docs.phone.carddav.title', desc: 'marketing.docs.phone.carddav.desc' },{ title: 'marketing.docs.phone.caldav.title', desc: 'marketing.docs.phone.caldav.desc' },{ title: 'marketing.docs.phone.setup.title', desc: 'marketing.docs.phone.setup.desc' }] }]
const DOCS_ORGANISED_PARAGRAPHS: MessageKey[] = ['marketing.docs.organised.p1']
const DOCS_ORGANISED_AFTER: MessageKey[] = ['marketing.docs.organised.p2']
const DOCS_WHY: MessageKey[] = ['marketing.docs.why.p1', 'marketing.docs.why.p2', 'marketing.docs.why.p3']
const DOCS_CONTACT_SAMPLE = ['---','first_name: Sarah','last_name: Smith','email: sarah@example.com','phone: "0400 123 456"','status: quoted','wedding_date: 2026-12-15','tags:','  - vip','  - referral','---','','Met at the Bridal Expo. Very enthusiastic about','an elopement ceremony at the Royal Botanic Garden.','','Budget: $3,000 - $5,000'].join('\n')
const DOCS_DIRECTORY_SAMPLE = ['contacts/','  sarah-smith.md','  john-doe.md','  jane-wilson-james-brown.md','weddings/','  2026-12-15-sarah-james/','    wedding.md','    todo.md','    timeline.md','    notes.md','    vendors.md','    log.md','    files/','  doe-wedding/','    wedding.md'].join('\n')
const DOCS_PYTHON_SAMPLE = ['# Python - list all quoted contacts','import yaml','from pathlib import Path','','for f in Path("contacts").glob("*.md"):','    parts = f.read_text().split("---", 2)','    data = yaml.safe_load(parts[1])','    if data.get("status") == "quoted":','        print(f"{data[\'first_name\']} {data[\'last_name\']}")'].join('\n')
const DOCS_DEVELOPER_BLOCKS: DeveloperBlock[] = [{ title: 'marketing.docs.developers.scripting.title', body: 'marketing.docs.developers.scripting.body', code: DOCS_PYTHON_SAMPLE },{ title: 'marketing.docs.developers.tools.title', body: 'marketing.docs.developers.tools.body' }]

function ImportHelpPage() {
  return (
    <MarketingLayout title={t('marketing.import.metaTitle')}>
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <div class="inline-block bg-horizon-50 text-horizon-700 font-semibold text-sm px-4 py-1.5 rounded-full mb-4">{t('marketing.import.badge')}</div>
        <h1 class="text-2xl sm:text-4xl font-bold mb-4 sm:mb-6">{t('marketing.import.title')}</h1>
        <CopyParagraphs keys={IMPORT_INTRO} className="space-y-4 text-gray-600 leading-relaxed mb-12" />

        {/* ── Featured: browser agent reads the old CRM + writes via MCP ── */}
        <div class="inline-block bg-grapefruit-50 text-grapefruit-700 font-semibold text-sm px-4 py-1.5 rounded-full mb-3">{t('marketing.import.browser.badge')}</div>
        <h2 class="text-xl sm:text-2xl font-bold mb-3">{t('marketing.import.browser.title')}</h2>
        <CopyParagraphs keys={IMPORT_BROWSER_INTRO} className="space-y-4 text-gray-600 leading-relaxed mb-6" />
        <div class="space-y-3 mb-6">{IMPORT_BROWSER_STEPS.map((s) => <AboutFeature title={t(s.title)} desc={t(s.desc)} />)}</div>
        <p class="text-sm font-bold text-gray-700 mb-2">{t('marketing.import.browser.promptLabel')}</p>
        <CodeBlock code={IMPORT_BROWSER_PROMPT} className="mb-4" />
        <CopyParagraphs keys={IMPORT_BROWSER_TIPS} className="space-y-2 text-sm text-gray-500 mb-12" />

        {/* ── Import a file ── */}
        <DocSection title="marketing.import.file.title" paragraphs={IMPORT_FILE_INTRO} />
        <div class="space-y-3 mb-12">{IMPORT_FILE_STEPS.map((s) => <AboutFeature title={t(s.title)} desc={t(s.desc)} />)}</div>

        <h2 class="text-xl sm:text-2xl font-bold mb-3">{t('marketing.import.fields.title')}</h2>
        <CopyParagraphs keys={IMPORT_FIELDS_INTRO} className="space-y-4 text-gray-600 leading-relaxed mb-6" />
        <SpecTable heading="marketing.standard.requiredFields" rows={IMPORT_REQUIRED} />
        <SpecTable heading="marketing.standard.optionalFields" rows={IMPORT_OPTIONAL} />
        <p class="text-sm text-gray-500 mb-12">{t('marketing.import.fields.note')}</p>

        <h3 class="text-lg font-bold mb-3">{t('marketing.import.sample.title')}</h3>
        <p class="text-gray-600 leading-relaxed mb-4">{t('marketing.import.sample.body')}</p>
        <CodeBlock code={IMPORT_CSV_SAMPLE} className="mb-2" />
        <p class="text-sm text-gray-500 mb-12">{t('marketing.import.sample.caption')}</p>

        <h3 class="text-lg font-bold mb-3">{t('marketing.import.status.title')}</h3>
        <p class="text-gray-600 leading-relaxed mb-4">{t('marketing.import.status.body')}</p>
        <CodeBlock code={IMPORT_STATUS_MAP} className="mb-12" />

        <h3 class="text-lg font-bold mb-3">{t('marketing.import.dates.title')}</h3>
        <CopyParagraphs keys={IMPORT_DATES} className="space-y-4 text-gray-600 leading-relaxed mb-12" />

        <h2 class="text-xl sm:text-2xl font-bold mb-3">{t('marketing.import.crms.title')}</h2>
        <p class="text-gray-600 leading-relaxed mb-6">{t('marketing.import.crms.body')}</p>
        <div class="space-y-3 mb-12">{IMPORT_CRMS.map((cr) => <AboutFeature title={cr.name} desc={t(cr.desc)} />)}</div>

        <div class="bg-white border border-papaya-300/30 rounded-xl p-4 sm:p-6 mb-12"><h3 class="font-bold text-sm mb-3">{t('marketing.import.limits.title')}</h3><CopyParagraphs keys={IMPORT_LIMITS} className="space-y-2 text-sm text-gray-600" /></div>

        {/* ── 2. Paste text / AI ── */}
        <DocSection title="marketing.import.ai.title" paragraphs={IMPORT_AI} />

        {/* ── 3. MCP + API ── */}
        <DocSection title="marketing.import.mcp.title" paragraphs={IMPORT_MCP_INTRO} />
        <div class="space-y-3 mb-8">{IMPORT_MCP_TOOLS.map((tl) => <AboutFeature title={tl.name} desc={t(tl.desc)} />)}</div>
        <h3 class="text-lg font-bold mb-3">{t('marketing.import.prompts.title')}</h3>
        <p class="text-gray-600 leading-relaxed mb-6">{t('marketing.import.prompts.body')}</p>
        {IMPORT_PROMPTS.map((p) => <><p class="text-sm font-bold text-gray-700 mb-2">{t(p.label)}</p><CodeBlock code={p.code} className="mb-6" /></>)}
        <h3 class="text-lg font-bold mb-3 mt-6">{t('marketing.import.api.title')}</h3>
        <CopyParagraphs keys={IMPORT_API} className="space-y-4 text-gray-600 leading-relaxed mb-6" />
        <CodeBlock code={IMPORT_API_SAMPLE} className="mb-12" />

        {/* ── 4. Vault / round-trip ── */}
        <DocSection title="marketing.import.vault.title" paragraphs={IMPORT_VAULT} />
        <h2 class="text-xl sm:text-2xl font-bold mb-3">{t('marketing.import.roundtrip.title')}</h2>
        <CopyParagraphs keys={IMPORT_ROUNDTRIP} className="space-y-4 text-gray-600 leading-relaxed mb-12" />

        <div class="bg-horizon-600 rounded-2xl p-6 sm:p-10 text-center text-white">
          <h2 class="text-xl sm:text-2xl font-bold mb-3">{t('marketing.import.cta.title')}</h2>
          <p class="text-white mb-6 max-w-md mx-auto text-sm">{t('marketing.import.cta.body')}</p>
          <div class="flex flex-col sm:flex-row items-center justify-center gap-3"><a href="/login" class="inline-block bg-white text-horizon-700 font-bold px-6 py-3 rounded-xl hover:bg-horizon-50 transition-colors text-sm">{t('marketing.import.cta.primary')}</a><a href="/standard" class="inline-block bg-horizon-500 text-white font-bold px-6 py-3 rounded-xl hover:bg-horizon-400 transition-colors text-sm">{t('marketing.import.cta.standard')}</a></div>
        </div>
      </div>
    </MarketingLayout>
  )
}

const IMPORT_INTRO: MessageKey[] = ['marketing.import.intro.p1', 'marketing.import.intro.p2']
const IMPORT_BROWSER_INTRO: MessageKey[] = ['marketing.import.browser.p1', 'marketing.import.browser.p2']
const IMPORT_BROWSER_STEPS: CardDef[] = [
  { title: 'marketing.import.browser.step1.title', desc: 'marketing.import.browser.step1.desc' },
  { title: 'marketing.import.browser.step2.title', desc: 'marketing.import.browser.step2.desc' },
  { title: 'marketing.import.browser.step3.title', desc: 'marketing.import.browser.step3.desc' },
]
const IMPORT_BROWSER_TIPS: MessageKey[] = ['marketing.import.browser.tip1', 'marketing.import.browser.tip2', 'marketing.import.browser.tip3']
const IMPORT_BROWSER_PROMPT = [
  'I’m logged into my old CRM in this browser tab. Go through my whole client list',
  'and, for each client, read their name, partner, email, phone, wedding date,',
  'venue and status — then add them to Wedding Computer with the submit_enquiry',
  'tool. Work through every page, skip anyone already in my contacts, and give me',
  'a running count. Pause if anything looks ambiguous so I can check.',
].join('\n')
const IMPORT_FILE_INTRO: MessageKey[] = ['marketing.import.file.p1', 'marketing.import.file.p2']
const IMPORT_FILE_STEPS: CardDef[] = [
  { title: 'marketing.import.step.upload.title', desc: 'marketing.import.step.upload.desc' },
  { title: 'marketing.import.step.map.title', desc: 'marketing.import.step.map.desc' },
  { title: 'marketing.import.step.preview.title', desc: 'marketing.import.step.preview.desc' },
  { title: 'marketing.import.step.run.title', desc: 'marketing.import.step.run.desc' },
]
const IMPORT_FIELDS_INTRO: MessageKey[] = ['marketing.import.fields.p1', 'marketing.import.fields.p2']
const IMPORT_REQUIRED: SpecDef[] = [
  { field: 'first_name', type: 'text', desc: 'marketing.import.spec.firstName' },
  { field: 'last_name', type: 'text', desc: 'marketing.import.spec.lastName' },
]
const IMPORT_OPTIONAL: SpecDef[] = [
  { field: 'email', type: 'text', desc: 'marketing.import.spec.email' },
  { field: 'phone', type: 'text', desc: 'marketing.import.spec.phone' },
  { field: 'partner_first_name', type: 'text', desc: 'marketing.import.spec.partnerFirstName' },
  { field: 'partner_last_name', type: 'text', desc: 'marketing.import.spec.partnerLastName' },
  { field: 'partner_email', type: 'text', desc: 'marketing.import.spec.partnerEmail' },
  { field: 'partner_phone', type: 'text', desc: 'marketing.import.spec.partnerPhone' },
  { field: 'address', type: 'text', desc: 'marketing.import.spec.address' },
  { field: 'instagram', type: 'text', desc: 'marketing.import.spec.instagram' },
  { field: 'facebook', type: 'text', desc: 'marketing.import.spec.facebook' },
  { field: 'tiktok', type: 'text', desc: 'marketing.import.spec.tiktok' },
  { field: 'website', type: 'text', desc: 'marketing.import.spec.website' },
  { field: 'wedding_date', type: 'date', desc: 'marketing.import.spec.weddingDate' },
  { field: 'wedding_location', type: 'text', desc: 'marketing.import.spec.weddingLocation' },
  { field: 'source', type: 'text', desc: 'marketing.import.spec.source' },
  { field: 'status', type: 'enum', desc: 'marketing.import.spec.status' },
  { field: 'notes', type: 'text', desc: 'marketing.import.spec.notes' },
  { field: 'created_at', type: 'date/time', desc: 'marketing.import.spec.createdAt' },
]
const IMPORT_DATES: MessageKey[] = ['marketing.import.dates.p1', 'marketing.import.dates.p2']
const IMPORT_CRMS: Array<{ name: string; desc: MessageKey }> = [
  { name: 'Dubsado', desc: 'marketing.import.crm.dubsado' },
  { name: 'Studio Ninja', desc: 'marketing.import.crm.studioNinja' },
  { name: 'HoneyBook', desc: 'marketing.import.crm.honeybook' },
  { name: 'VSCO Workspace (formerly Táve)', desc: 'marketing.import.crm.vsco' },
  { name: 'Any CSV / JSON', desc: 'marketing.import.crm.generic' },
]
const IMPORT_LIMITS: MessageKey[] = ['marketing.import.limits.p1', 'marketing.import.limits.p2', 'marketing.import.limits.p3']
const IMPORT_AI: MessageKey[] = ['marketing.import.ai.p1', 'marketing.import.ai.p2']
const IMPORT_MCP_INTRO: MessageKey[] = ['marketing.import.mcp.p1', 'marketing.import.mcp.p2']
const IMPORT_MCP_TOOLS: Array<{ name: string; desc: MessageKey }> = [
  { name: 'submit_enquiry', desc: 'marketing.import.tool.submitEnquiry' },
  { name: 'update_run_sheet', desc: 'marketing.import.tool.updateRunSheet' },
  { name: 'save_timeline_item', desc: 'marketing.import.tool.saveTimelineItem' },
  { name: 'update_wedding_todo', desc: 'marketing.import.tool.updateTodo' },
  { name: 'append_wedding_note', desc: 'marketing.import.tool.appendNote' },
  { name: 'propose_timeline_change', desc: 'marketing.import.tool.proposeChange' },
]
const IMPORT_API: MessageKey[] = ['marketing.import.api.p1', 'marketing.import.api.p2']
const IMPORT_VAULT: MessageKey[] = ['marketing.import.vault.p1', 'marketing.import.vault.p2']
const IMPORT_ROUNDTRIP: MessageKey[] = ['marketing.import.roundtrip.p1', 'marketing.import.roundtrip.p2', 'marketing.import.roundtrip.p3']

const IMPORT_PROMPTS: Array<{ label: MessageKey; code: string }> = [
  { label: 'marketing.import.prompt.leads', code: ['Add these three enquiries as contacts:', '1. Sarah & James Smith — sarah@example.com — 0400 123 456 — wedding 15 Dec 2026, Byron Bay', '2. Tom Nguyen — tom@example.com — no date yet — asked about pricing', '3. Alex Lee — alex@example.com — wedding Oct 2026, Melbourne'].join('\n') },
  { label: 'marketing.import.prompt.runsheet', code: ["Here's the run sheet the venue sent for the Smith wedding (id abc123). Update the timeline:", '- 12:00  Guest arrival — The Old Chapel', '- 14:30  Ceremony — The Old Chapel — category ceremony', '- 16:00  Couple portraits — East Garden — category portraits', '- 17:30  Reception dinner — The Marquee — category reception'].join('\n') },
  { label: 'marketing.import.prompt.sun', code: ['For the Smith wedding (abc123), add "Golden hour portraits":', '30 minutes before sunset, 60 minutes long, at the East Garden, assigned to me.'].join('\n') },
  { label: 'marketing.import.prompt.todo', code: ['Set the checklist for the Smith wedding (abc123):', '- [ ] Confirm coverage hours', '- [x] Send deposit invoice', '- [ ] Final timeline review 3 days before'].join('\n') },
  { label: 'marketing.import.prompt.reschedule', code: ['The Smith wedding moved a week. For abc123 set date 2026-12-22 and ceremony time 15:00.', "(I'm the planner, so apply it.)"].join('\n') },
]

const IMPORT_CSV_SAMPLE = [
  'First name,Last name,Email,Phone,Partner first name,Wedding date,Wedding location,Status,Instagram,Notes',
  'Sarah,Smith,sarah@example.com,0400 123 456,James,2026-12-15,"Byron Bay, NSW",Booked,@sarahandjames,"Met at the expo — wants an elopement"',
  'Tom,Nguyen,tom@example.com,0400 222 333,,2026-09-05,Melbourne,Enquiry,,"Asked about pricing"',
].join('\n')

const IMPORT_STATUS_MAP = [
  'new        ←  lead, inquiry, enquiry, prospect, pending',
  'contacted  ←  follow up, responded, replied',
  'meeting    ←  in progress, consultation',
  'quoted     ←  proposal, proposal sent, quote, quote sent',
  'booked     ←  confirmed, hired, active, won',
  'completed  ←  closed, done, finished, delivered',
  'lost       ←  declined, rejected, not booked, cancelled',
  'archived   ←  inactive, old',
  '',
  'Anything we don’t recognise becomes "new".',
].join('\n')

const IMPORT_API_SAMPLE = [
  'curl -X POST https://wedding.computer/api/v1/enquiries \\',
  '  -H "Authorization: Bearer YOUR_ENQUIRY_KEY" \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{',
  '    "first_name": "Sarah",',
  '    "last_name": "Smith",',
  '    "email": "sarah@example.com",',
  '    "phone": "0400 123 456",',
  '    "partner_first_name": "James",',
  '    "wedding_date": "2026-12-15",',
  '    "wedding_location": "Byron Bay, NSW",',
  '    "notes": "Wants an elopement"',
  '  }\'',
].join('\n')

export default marketing

function PricingFeature({ text, bold }: { text: string; bold?: boolean }) {
  return (
    <li class="flex items-start gap-2">
      <svg class="w-4 h-4 text-horizon-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
      <span class={bold ? 'font-bold' : ''}>{text}</span>
    </li>
  )
}

function PlanCheck() {
  return (
    <svg class="w-5 h-5 text-horizon-600 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" role="img" aria-label={t('marketing.pricing.included')}><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
  )
}

function PlanRow({ feature, free, pro }: { feature: string; free?: boolean; pro?: boolean }) {
  return (
    <tr class="border-t border-gray-100">
      <td class="py-3 px-4 text-gray-700">{feature}</td>
      <td class="py-3 px-2 text-center">{free ? <PlanCheck /> : <span class="text-gray-300" aria-label={t('marketing.pricing.notIncluded')}>—</span>}</td>
      <td class="py-3 px-2 text-center">{pro ? <PlanCheck /> : <span class="text-gray-300" aria-label={t('marketing.pricing.notIncluded')}>—</span>}</td>
    </tr>
  )
}

function PlanGroup({ label }: { label: string }) {
  return (
    <tr class="bg-papaya-50/60">
      <td colspan={3} class="py-2 px-4 text-xs font-bold uppercase tracking-wide text-gray-500">{label}</td>
    </tr>
  )
}

function SpecRow({ field, type, desc }: { field: string; type: string; desc: string }) {
  return (
    <tr>
      <td class="px-4 py-2.5 font-mono text-xs text-horizon-700 whitespace-nowrap">{field}</td>
      <td class="px-4 py-2.5 text-gray-500 whitespace-nowrap">{type}</td>
      <td class="px-4 py-2.5 text-gray-700">{desc}</td>
    </tr>
  )
}

function AboutFeature({ title, desc }: { title: string; desc: string }) {
  return (
    <div class="bg-white border border-papaya-300/30 rounded-xl p-4">
      <h3 class="font-bold text-gray-900 text-sm mb-1">{title}</h3>
      <p class="text-sm text-gray-600 leading-relaxed">{desc}</p>
    </div>
  )
}

function RoleTab({ role, label, active }: { role: string; label: string; active?: boolean }) {
  return (
    <button
      data-role={role}
      class={`px-4 py-2 rounded-full text-sm font-bold transition-colors cursor-pointer ${active ? 'bg-horizon-600 text-white' : 'bg-white text-gray-700'} border border-papaya-300/30 hover:border-horizon-600/30`}
    >
      {label}
    </button>
  )
}

function RolePanel({ role, active, children }: { role: string; active?: boolean; children: any }) {
  return (
    <div data-panel={role} style={active ? {} : { display: 'none' }} class="max-w-3xl mx-auto">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        {children}
      </div>
    </div>
  )
}

function RoleFeature({ title, desc }: { title: string; desc: string }) {
  return (
    <div class="bg-white border border-papaya-300/30 rounded-xl p-4">
      <h3 class="font-bold text-gray-900 text-sm mb-1">{title}</h3>
      <p class="text-xs text-gray-600 leading-relaxed">{desc}</p>
    </div>
  )
}

function RoleCollab({ children }: { children: any }) {
  return (
    <div class="sm:col-span-2 bg-horizon-50 border border-horizon-600/10 rounded-xl p-4">
      <p class="text-xs font-bold text-horizon-700 mb-1">{t('marketing.home.roles.collabHeading')}</p>
      <p class="text-xs text-gray-700 leading-relaxed">{children}</p>
    </div>
  )
}

const featureIcons: Record<string, string> = {
  crm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  form: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12h6"/><path d="M9 16h6"/><path d="M9 8h6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/></svg>',
  invoice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
  email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
  workspace: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z"/></svg>',
  analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>',
  openformat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 22h2a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v3"/><path d="M14 2v6h6"/><path d="m5 17 3-3-3-3"/><path d="M9 18h4"/></svg>',
  couple: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
  notifications: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  plaintext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
  import: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
  runsheet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/></svg>',
  mcp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6"/><path d="M9 13h4"/><circle cx="7" cy="9" r="0.5" fill="currentColor"/><circle cx="7" cy="13" r="0.5" fill="currentColor"/><path d="M15 17l2-2-2-2"/></svg>',
}
