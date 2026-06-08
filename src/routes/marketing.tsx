import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import type { Env } from '../types'
import { MarketingLayout } from '../views/layouts/marketing'

const marketing = new Hono<Env>()

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

// Markdown content negotiation — return markdown when agents request it
const markdownPages: Record<string, string> = {
  '/': `# Wedding Computer

The collaboration platform where vendors, venues, planners, and couples plan weddings together — with shared timelines, calendars, and files that keep everyone on the same page.

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
- **Analytics & benchmarks** — anonymised industry data at city, state, country, and global levels
- **Date demand scores** — see how in-demand any date is for enquiries and bookings in your area
- **Import from other CRMs** — CSV/JSON import from Dubsado, Studio Ninja, HoneyBook, VSCO Workspace, or any spreadsheet, with AI-powered text extraction
- **Team & agency management** — manage team rosters and assign members to weddings
- **Couple planner** — vendor grid, budget tracker, booking forms
- **Directory listing** — opt in to the wedding.institute vendor directory
- **GitHub sync** — contacts and weddings sync to a private repo as plain text markdown
- **Plain text files** — every file is portable, human-readable, and never locked in
- **Open source** — AGPL-3.0, self-hostable on Cloudflare Workers

## Collaboration

Every wedding is a shared workspace. Set ceremony, portraits, and reception times once — every vendor gets them in their calendar automatically. Vendor credits are built in for Instagram and blog posts.

## Your Data

All data is stored as plain text markdown files, synced live to GitHub. Access your files in Obsidian, VS Code, TextEdit, Notepad, or any text editor. If you stop using Wedding Computer, your data is already on your computer.

## Agent Access

- MCP Server: \`https://wedding.computer/mcp\` (Bearer token auth)
- [MCP Server Card](https://wedding.computer/.well-known/mcp/server-card.json)
- [Agent Discovery](https://wedding.computer/.well-known/agent)
- [Auth Instructions](https://wedding.computer/auth.md)

## Links

- [Get started free](https://wedding.computer/login)
- [About](https://wedding.computer/about)
- [Pricing](https://wedding.computer/pricing)
- [Open Format Spec](https://wedding.computer/standard)
- [Source Code](https://github.com/joshwithers/wedding-computer)
`,
  '/about': `# About Wedding Computer

Wedding Computer is a collaboration platform for the wedding industry. It started as a vendor CRM and evolved into a multi-party tool where vendors, venues, planners, and couples coordinate on shared wedding entities.

Built on Cloudflare Workers. Open source under AGPL-3.0.

## Links

- [Home](https://wedding.computer/)
- [Pricing](https://wedding.computer/pricing)
- [Source](https://github.com/joshwithers/wedding-computer)
`,
  '/pricing': `# Pricing — Wedding Computer

Wedding Computer is **free forever**. No trial, no credit card, no catch.

The core platform — CRM, calendar, invoicing, email, wedding workspaces, run sheets, quote calculator, GitHub sync — is free.

## Pro — $28 AUD/month

Upgrade for analytics and AI-powered features:

- Business analytics and reporting
- Anonymised industry benchmarks
- Date demand scores
- Goal tracking
- AI-powered insights
- AI enquiry auto-replies
- AI email drafting
- MCP access for AI tools (Claude, ChatGPT, Cursor, etc.)

## Links

- [Get started free](https://wedding.computer/login)
`,
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
          'Cache-Control': 'public, max-age=300, s-maxage=3600',
          'Vary': 'Accept',
        },
      })
    }
  }

  await next()
  if (c.res.status === 200 && c.req.method === 'GET') {
    c.res.headers.set('Cache-Control', 'public, max-age=300, s-maxage=3600')
    c.res.headers.set('Vary', 'Accept')
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
  return c.html(
    <MarketingLayout>
      <div class="max-w-5xl mx-auto px-4 sm:px-6">
        {/* Hero */}
        <section class="py-12 sm:py-16 lg:py-24 text-center">
          <div class="inline-block bg-horizon-50 text-horizon-700 font-semibold text-sm px-4 py-1.5 rounded-full mb-4 sm:mb-6">
            Free
          </div>
          <h1 class="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-4 sm:mb-6">
            <span class="block">Excel as a wedding creative</span>
            <span class="block">without running your business</span>
            <span class="block text-horizon-700">from a spreadsheet</span>
          </h1>
          <p class="text-base sm:text-lg text-gray-600 max-w-xl mx-auto mb-6 sm:mb-10 leading-relaxed">
            The platform where vendors, venues, planners, and couples
            plan weddings together — with a real CRM, shared timelines,
            and files that keep everyone on the same page.
          </p>
          <div class="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <a
              href="/login"
              class="bg-horizon-600 text-white px-8 py-3.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors shadow-lg shadow-horizon/20"
            >
              Get started free
            </a>
            <a
              href="/about"
              class="border border-gray-300 text-gray-700 px-6 py-3.5 rounded-xl text-sm font-bold hover:border-horizon-600 hover:text-horizon-700 transition-colors"
            >
              See how it works
            </a>
          </div>
        </section>

        {/* Collaboration pitch */}
        <section class="py-10 sm:py-16 border-t border-papaya-300/30">
          <div class="max-w-3xl mx-auto text-center mb-10">
            <h2 class="text-xl sm:text-2xl font-bold mb-4">One wedding, one place, everyone together</h2>
            <p class="text-gray-600 leading-relaxed mb-6">
              Weddings involve a lot of people — the couple, the celebrant, the photographer,
              the florist, the venue, the planner. Wedding Computer gives every party their own
              view of the same wedding, with shared timelines and files that stay in sync.
            </p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
            <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 text-center">
              <div class="text-2xl mb-2">🤝</div>
              <h3 class="text-sm font-bold mb-1">Shared timeline</h3>
              <p class="text-xs text-gray-500">Ceremony, portraits, reception — set the times once and every vendor gets them in their calendar automatically.</p>
            </div>
            <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 text-center">
              <div class="text-2xl mb-2">👥</div>
              <h3 class="text-sm font-bold mb-1">Everyone has access</h3>
              <p class="text-xs text-gray-500">Vendors manage their own invoices, checklists, and private notes. Couples see the big picture and track their budget.</p>
            </div>
            <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 text-center">
              <div class="text-2xl mb-2">📋</div>
              <h3 class="text-sm font-bold mb-1">Vendor credits built in</h3>
              <p class="text-xs text-gray-500">One-click copy of the full vendor credit list for Instagram captions or blog posts — with @handles and website links.</p>
            </div>
          </div>
        </section>

        {/* Features */}
        <section class="py-10 sm:py-16">
          <h2 class="text-xl sm:text-2xl font-bold text-center mb-3">Everything you need to run your wedding business</h2>
          <p class="text-center text-gray-500 text-sm mb-8 sm:mb-12 max-w-lg mx-auto">For vendors, couples, and everyone in between.</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-5">
            <FeatureCard
              color="horizon"
              icon="crm"
              title="CRM & pipeline"
              desc="Track every lead from first enquiry to booked. Eight-stage pipeline, activity log, notes, and search — all in one place."
            />
            <FeatureCard
              color="grapefruit"
              icon="form"
              title="Custom enquiry forms"
              desc="Build your own branded enquiry form with a visual editor. Embed it anywhere. Leads land straight in your CRM with CAPTCHA protection."
            />
            <FeatureCard
              color="horizon"
              icon="calendar"
              title="Calendar & availability"
              desc="Monthly calendar with availability settings and event management. Pro users can sync to Apple Calendar via CalDAV, or share a read-only iCal feed with any app."
            />
            <FeatureCard
              color="grapefruit"
              icon="invoice"
              title="Invoicing & payments"
              desc="Create invoices with line items and payment schedules. Accept card payments via Stripe Connect, or record cash and bank transfers."
            />
            <FeatureCard
              color="horizon"
              icon="email"
              title="Built-in email"
              desc="Send and receive from your own @wedding.computer address. Full inbox, sent mail, threading — logged to contact activity automatically."
            />
            <FeatureCard
              color="grapefruit"
              icon="ai"
              title="AI email drafting"
              desc="One-click personalised drafts for follow-ups, quotes, and confirmations. Powered by Cloudflare AI, or bring your own Anthropic key."
            />
            <FeatureCard
              color="horizon"
              icon="workspace"
              title="Wedding workspaces"
              desc="Every wedding is a shared workspace. Invite the couple, the venue, and every vendor — everyone sees the same timeline, places, and notes. Set it once, share it everywhere."
            />
            <FeatureCard
              color="grapefruit"
              icon="couple"
              title="Couple planner"
              desc="Couples get their own dashboard: vendor grid, live budget tracker, booking forms, and details — no spreadsheet required."
            />
            <FeatureCard
              color="horizon"
              icon="import"
              title="Import from anywhere"
              desc="Bring your existing data with you. Import CSV or JSON files from Dubsado, Studio Ninja, HoneyBook, VSCO Workspace, or any spreadsheet. AI-powered extraction can pull contacts from pasted text or a URL."
            />
            <FeatureCard
              color="grapefruit"
              icon="team"
              title="Team & agency management"
              desc="Photography studios, celebrant agencies, and multi-person businesses can manage a team roster and assign individual team members to each wedding."
            />
            <FeatureCard
              color="horizon"
              icon="sync"
              title="GitHub sync"
              desc="Connect your GitHub account and your contacts and weddings sync to a private repo automatically. Browse files on github.com, open them in Obsidian, or clone them anywhere."
            />
            <FeatureCard
              color="grapefruit"
              icon="analytics"
              title="Business analytics"
              desc="Track enquiries, bookings, revenue, and conversion rates. Set goals for the year and measure yourself against anonymised industry benchmarks at city, state, country, and global levels."
            />
            <FeatureCard
              color="horizon"
              icon="calendar"
              title="Date demand scores"
              desc="See how in-demand upcoming dates are for enquiries and bookings — at your city, state, country, and global level. Know whether a date is in high demand or likely to be quiet."
            />
            <FeatureCard
              color="grapefruit"
              icon="invoice"
              title="Quote calculator"
              desc="Create an embeddable quote calculator for your website. Clients choose their options and see an instant estimate. Capture enquiries directly from the calculator."
            />
            <FeatureCard
              color="horizon"
              icon="runsheet"
              title="Day-of run sheet"
              desc="Build a detailed timeline for each wedding day. AI generates a starting run sheet from your wedding details — then customise times, locations, and assignments."
            />
            <FeatureCard
              color="grapefruit"
              icon="mcp"
              title="MCP access for AI tools"
              desc="Connect Claude, ChatGPT, Cursor, or any AI tool that supports Model Context Protocol directly to your data. Read contacts, weddings, run sheets, and checklists from your own AI workflow. Pro feature."
            />
            <FeatureCard
              color="horizon"
              icon="opensource"
              title="Open source"
              desc="Built in the open under AGPL-3.0. Audit the code, self-host it, or contribute. Runs on Cloudflare Workers at the edge, globally."
            />
            <FeatureCard
              color="grapefruit"
              icon="plaintext"
              title="Plain text files — live, right now"
              desc="Every contact, wedding, checklist, and changelog is a plain text markdown file — synced live to GitHub. Open them in Obsidian, VS Code, TextEdit, or Notepad. Your data is portable, always accessible, and never locked in."
            />
          </div>
        </section>

        {/* Built for your role */}
        <section class="py-10 sm:py-16 border-t border-papaya-300/30">
          <div class="max-w-3xl mx-auto text-center mb-8">
            <h2 class="text-xl sm:text-2xl font-bold mb-3">Built for how you actually work</h2>
            <p class="text-gray-600 text-sm leading-relaxed max-w-lg mx-auto">
              Every vendor type has different priorities. Pick yours and see how Wedding Computer fits your workflow — and how collaboration makes it better.
            </p>
          </div>
          <div class="flex flex-wrap justify-center gap-2 mb-8" id="role-tabs">
            <RoleTab role="venue" label="Venues" active />
            <RoleTab role="planner" label="Planners" />
            <RoleTab role="photographer" label="Photographers" />
            <RoleTab role="videographer" label="Videographers" />
            <RoleTab role="celebrant" label="Celebrants" />
            <RoleTab role="florist" label="Florists" />
            <RoleTab role="music" label="Musicians & DJs" />
          </div>
          <div id="role-panels">
            <RolePanel role="venue" active>
              <RoleFeature
                title="One workspace per wedding — you're the host"
                desc="As the venue, you're often the hub. Create the wedding workspace, invite every vendor, and keep ceremony, reception, and bump-in times in one place. When you update the timeline, everyone sees it."
              />
              <RoleFeature
                title="Enquiry forms built for venue enquiries"
                desc="Custom form fields for event type, guest count, date preferences, and ceremony style. Leads land in your CRM pipeline with all the details you need to quote."
              />
              <RoleFeature
                title="Calendar that shows the full picture"
                desc="See every booking, hold, and blocked date. Know at a glance which Saturdays are free. Share your availability publicly so couples and planners can check before they enquire."
              />
              <RoleFeature
                title="Invoicing with payment schedules"
                desc="Venues often invoice in stages — deposit, interim, final. Create multi-installment invoices with due dates and track payments as they come in."
              />
              <RoleCollab>
                When the photographer needs bump-in times or the celebrant needs the ceremony location, they already have it — because you set it once in the shared workspace. No back-and-forth emails.
              </RoleCollab>
            </RolePanel>
            <RolePanel role="planner">
              <RoleFeature
                title="Manage every vendor from one dashboard"
                desc="You're coordinating the whole team. See every vendor on the wedding, their invoices, their timelines, and their checklists — without chasing updates."
              />
              <RoleFeature
                title="Run sheets your team can rely on"
                desc="Build the day-of timeline with times, locations, and assignments. AI generates a starting run sheet from the wedding details — then you refine it. Every vendor gets the same version."
              />
              <RoleFeature
                title="Team roster for your agency"
                desc="Assign coordinators, assistants, and day-of staff to each wedding. Everyone knows who's on the job."
              />
              <RoleFeature
                title="Analytics across your whole book of business"
                desc="Track enquiries, bookings, and revenue across all your weddings. See conversion rates, average deal sizes, and how your pipeline is trending."
              />
              <RoleCollab>
                You set the run sheet once and every vendor — photographer, celebrant, florist, DJ — sees the same timeline. Changes sync instantly. No more WhatsApp group updates at midnight.
              </RoleCollab>
            </RolePanel>
            <RolePanel role="photographer">
              <RoleFeature
                title="CRM built for how photographers sell"
                desc="Track every enquiry through your pipeline — from new lead to contacted, quoted, booked, and delivered. Log emails, calls, and notes on each contact."
              />
              <RoleFeature
                title="Know the wedding timeline before you arrive"
                desc="When the planner or venue sets ceremony, portraits, and reception times, you see them automatically. No hunting through email threads for the run sheet."
              />
              <RoleFeature
                title="Vendor credits, ready to paste"
                desc="After the wedding, one click gives you the full vendor credit list — formatted for Instagram captions with @handles, or for your blog with website links."
              />
              <RoleFeature
                title="Import from Studio Ninja, HoneyBook, or Dubsado"
                desc="Bring your existing client database with you. Upload a CSV and Wedding Computer maps the columns automatically."
              />
              <RoleCollab>
                When the celebrant and couple confirm the timeline, you see it immediately in your calendar. The florist's setup time, the DJ's bump-in — it's all there so you can plan your shot list around the real schedule.
              </RoleCollab>
            </RolePanel>
            <RolePanel role="videographer">
              <RoleFeature
                title="See the full timeline without asking"
                desc="Ceremony start, first look timing, reception formalities — it's all in the shared workspace. When times change, your calendar updates automatically."
              />
              <RoleFeature
                title="Coordinate with the photographer, not compete"
                desc="Both creatives see the same timeline and the same portrait window. Know when you're shooting together and when you each have dedicated time."
              />
              <RoleFeature
                title="Invoicing and quote calculator"
                desc="Create packages with add-ons — highlight reel, full ceremony edit, drone footage. Embed a quote calculator on your website so couples can estimate their package before they enquire."
              />
              <RoleFeature
                title="Vendor credits for your socials"
                desc="After delivery, pull the full vendor credit list for your Instagram reel caption — every vendor name and @handle, ready to paste."
              />
              <RoleCollab>
                The run sheet tells you when to be where. The photographer's timeline tells you when you'll be shooting together. No more texting each other the night before to figure out the schedule.
              </RoleCollab>
            </RolePanel>
            <RolePanel role="celebrant">
              <RoleFeature
                title="Enquiry pipeline built for ceremony bookings"
                desc="Track couples from first enquiry through to booked and completed. See their wedding date, ceremony type, and location right in your contact list."
              />
              <RoleFeature
                title="Checklists for legal and ceremony prep"
                desc="Use checklists to track your NOIM timeline, ceremony script drafts, rehearsal scheduling, and paperwork. Never miss a legal deadline."
              />
              <RoleFeature
                title="Calendar with ceremony-specific details"
                desc="Your calendar shows ceremony time, location, and getting-ready details. Share your availability publicly so couples can see your free dates."
              />
              <RoleFeature
                title="AI-drafted replies to enquiries"
                desc="When a new enquiry comes in, AI drafts a personalised response using the couple's details and your availability. Review it, edit it, send it."
              />
              <RoleCollab>
                When the venue confirms the ceremony location or the planner adjusts the timeline, you see it immediately — no more last-minute "actually, we moved the ceremony to the garden" emails.
              </RoleCollab>
            </RolePanel>
            <RolePanel role="florist">
              <RoleFeature
                title="Quote calculator for complex floral packages"
                desc="Bouquets, buttonholes, table centrepieces, ceremony arch — build a calculator with all your options and let couples estimate their florals before they enquire."
              />
              <RoleFeature
                title="Know bump-in times and venue details"
                desc="The shared workspace tells you when you can access the venue, where the ceremony and reception are, and when everything needs to be set up."
              />
              <RoleFeature
                title="Invoicing with deposit schedules"
                desc="Florals often need a deposit to secure flowers. Create invoices with custom payment schedules and track each payment."
              />
              <RoleFeature
                title="Import your existing client list"
                desc="Bring your contacts from any spreadsheet or CRM. Upload a CSV, map the columns, and you're running in minutes."
              />
              <RoleCollab>
                You need the venue's bump-in time and the ceremony start time to plan your setup. When the planner sets the run sheet, you see it in your calendar — setup window, ceremony start, pack-down time, all confirmed.
              </RoleCollab>
            </RolePanel>
            <RolePanel role="music">
              <RoleFeature
                title="Reception timeline at your fingertips"
                desc="First dance, speeches, cake cutting — the run sheet tells you exactly when each formality happens so you can plan your sets and transitions."
              />
              <RoleFeature
                title="Enquiry forms with your options"
                desc="Ceremony music, cocktail hour, reception DJ, live band — customise your enquiry form fields to capture exactly what the couple is looking for."
              />
              <RoleFeature
                title="Calendar with load-in details"
                desc="Know your bump-in time, sound check window, and set times. When the planner updates the schedule, your calendar reflects it."
              />
              <RoleFeature
                title="Quote calculator for packages and add-ons"
                desc="Ceremony acoustic set, cocktail hour, 5-hour reception, extra hour — let couples build their own package and see the price before they reach out."
              />
              <RoleCollab>
                The MC's speech schedule, the photographer's must-have moments, the caterer's meal service timing — everything is on the same run sheet, so your set list matches the actual flow of the night.
              </RoleCollab>
            </RolePanel>
          </div>
          <script dangerouslySetInnerHTML={{ __html: `
            document.getElementById('role-tabs').addEventListener('click', function(e) {
              var btn = e.target.closest('[data-role]');
              if (!btn) return;
              var role = btn.getAttribute('data-role');
              document.querySelectorAll('#role-tabs [data-role]').forEach(function(t) {
                t.classList.remove('bg-horizon-600', 'text-white');
                t.classList.add('bg-white', 'text-gray-700');
              });
              btn.classList.remove('bg-white', 'text-gray-700');
              btn.classList.add('bg-horizon-600', 'text-white');
              document.querySelectorAll('#role-panels [data-panel]').forEach(function(p) {
                p.style.display = p.getAttribute('data-panel') === role ? '' : 'none';
              });
            });
          ` }} />
        </section>

        {/* Switching CRMs */}
        <section class="py-10 sm:py-16 border-t border-papaya-300/30">
          <div class="max-w-3xl mx-auto text-center mb-8">
            <h2 class="text-xl sm:text-2xl font-bold mb-3">Switching from another CRM?</h2>
            <p class="text-gray-600 text-sm leading-relaxed max-w-lg mx-auto">
              Wedding Computer imports contacts from CSV and JSON files exported from the CRMs used by wedding vendors across Australia and beyond. Upload your file, map your columns, preview the data, and import.
            </p>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 max-w-3xl mx-auto mb-6">
            <div class="bg-white border border-papaya-300/30 rounded-xl p-4 text-center">
              <p class="text-sm font-bold text-gray-700">Dubsado</p>
              <p class="text-[10px] text-gray-500">CSV import</p>
            </div>
            <div class="bg-white border border-papaya-300/30 rounded-xl p-4 text-center">
              <p class="text-sm font-bold text-gray-700">Studio Ninja</p>
              <p class="text-[10px] text-gray-500">CSV import</p>
            </div>
            <div class="bg-white border border-papaya-300/30 rounded-xl p-4 text-center">
              <p class="text-sm font-bold text-gray-700">HoneyBook</p>
              <p class="text-[10px] text-gray-500">CSV import</p>
            </div>
            <div class="bg-white border border-papaya-300/30 rounded-xl p-4 text-center">
              <p class="text-sm font-bold text-gray-700">VSCO Workspace</p>
              <p class="text-[10px] text-gray-500 italic">formerly Táve</p>
            </div>
            <div class="bg-white border border-papaya-300/30 rounded-xl p-4 text-center">
              <p class="text-sm font-bold text-gray-700">Any CSV / JSON</p>
              <p class="text-[10px] text-gray-500">Custom mapping</p>
            </div>
          </div>
          <p class="text-center text-xs text-gray-400 max-w-lg mx-auto">
            Column mapping is automatic for known CRMs and fuzzy-matched for everything else. You can also paste text or a URL and let AI extract the contacts for you.
          </p>
        </section>

        {/* Data philosophy */}
        <section class="py-10 sm:py-16">
          <div class="bg-white border border-papaya-300/30 rounded-2xl sm:rounded-3xl p-6 sm:p-10 lg:p-12">
            <div class="max-w-2xl mx-auto text-center">
              <div class="w-12 h-12 rounded-2xl bg-horizon-50 flex items-center justify-center mx-auto mb-4">
                <div class="w-6 h-6 text-horizon-600" dangerouslySetInnerHTML={{ __html: featureIcons.plaintext }} />
              </div>
              <h2 class="text-xl sm:text-2xl font-bold mb-3">Your data is yours — live, portable, and never locked in</h2>
              <p class="text-gray-600 leading-relaxed mb-6">
                Wedding Computer stores everything as plain text markdown files — the same
                format used by Wikipedia, GitHub, and millions of writers. Your files sync live
                to a private GitHub repo, so you can access them right now in Obsidian, VS Code,
                TextEdit, Notepad, or any tool that reads text files. No proprietary format. No
                export-and-pray. If you stop using Wedding Computer tomorrow, your data is already
                on your computer in files you can read with anything.
              </p>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <div class="text-center">
                  <div class="text-lg mb-1">📂</div>
                  <p class="text-xs font-bold text-gray-700">GitHub</p>
                  <p class="text-[10px] text-gray-500">Auto-synced repo</p>
                </div>
                <div class="text-center">
                  <div class="text-lg mb-1">💎</div>
                  <p class="text-xs font-bold text-gray-700">Obsidian</p>
                  <p class="text-[10px] text-gray-500">Open as a vault</p>
                </div>
                <div class="text-center">
                  <div class="text-lg mb-1">📝</div>
                  <p class="text-xs font-bold text-gray-700">Any text editor</p>
                  <p class="text-[10px] text-gray-500">TextEdit, Notepad, vim</p>
                </div>
                <div class="text-center">
                  <div class="text-lg mb-1">🔧</div>
                  <p class="text-xs font-bold text-gray-700">Your own tools</p>
                  <p class="text-[10px] text-gray-500">Parse YAML + markdown</p>
                </div>
              </div>
              <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
                <a href="/standard" class="text-horizon-700 font-bold text-sm hover:underline">Read the open format spec →</a>
                <span class="hidden sm:inline text-gray-300">|</span>
                <a href="/docs/plain-text" class="text-horizon-700 font-bold text-sm hover:underline">How to access your files →</a>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section class="py-8 sm:py-16">
          <div class="bg-horizon-600 rounded-2xl sm:rounded-3xl p-6 sm:p-12 text-center text-white">
            <h2 class="text-2xl sm:text-3xl font-bold mb-4">Ready to simplify your wedding business?</h2>
            <p class="text-white mb-6 sm:mb-8 max-w-md mx-auto">
              Join vendors who are already managing their leads, weddings, and invoices in one place.
            </p>
            <a
              href="/login"
              class="inline-block bg-white text-horizon-700 font-bold px-8 py-3.5 rounded-xl hover:bg-horizon-50 transition-colors"
            >
              Get started free
            </a>
          </div>
        </section>
      </div>
    </MarketingLayout>
  )
})

marketing.get('/about', (c) => {
  return c.html(
    <MarketingLayout title="About">
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        {/* Intro */}
        <h1 class="text-2xl sm:text-4xl font-bold mb-4 sm:mb-6">The wedding industry deserves better software</h1>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-12">
          <p>
            Most wedding professionals run their business across a dozen disconnected tools — a CRM here,
            a spreadsheet there, invoices in one app, calendar in another, and a group chat holding it all together with
            duct tape. Couples get an even worse deal: a shared Google Sheet and a prayer.
          </p>
          <p>
            Wedding Computer replaces all of that with one platform purpose-built for how weddings actually work.
            Vendors manage their entire business — leads, calendar, invoices, emails — from a single dashboard. Couples
            get a planning hub where they track their vendors, budget, and timeline. And when a booking happens, both
            sides share a workspace so nothing falls through the cracks.
          </p>
          <p>
            It's free to start, open source, and built by people who work in weddings.
            Couples use it free forever. Vendors get a generous free tier with all the core tools,
            and can unlock analytics, benchmarking, and AI features with a Pro plan for $28/month.
          </p>
        </div>

        {/* For Vendors */}
        <h2 class="text-xl sm:text-2xl font-bold mb-2">For vendors</h2>
        <p class="text-gray-500 text-sm mb-6">Everything you need to run your wedding business, nothing you don't.</p>
        <div class="space-y-3 mb-12">
          <AboutFeature
            title="CRM with an eight-stage pipeline"
            desc="Every enquiry flows through a clear pipeline: new, contacted, meeting, quoted, booked, completed, lost, archived. Click to change status. Filter by stage. Search across all contacts. Full activity log tracks every email, note, status change, and invoice automatically."
          />
          <AboutFeature
            title="Custom enquiry forms with CAPTCHA"
            desc="Build your own branded enquiry form with a visual editor — add text fields, dropdowns, date pickers, textareas, and partner details. Embed the form on your website or share the direct link. Submissions are protected by Cloudflare Turnstile (invisible CAPTCHA) and land straight in your CRM as a new lead with an automatic email notification."
          />
          <AboutFeature
            title="Calendar, availability, and iCal/CalDAV sync"
            desc="Monthly calendar with booking, blocked, and personal events. Set your default available days (e.g. Friday–Sunday) and add per-date overrides. Share a read-only iCal feed URL with any calendar app, or connect via CalDAV for two-way sync with Apple Calendar, Fantastical, or any CalDAV client. Events include timezone support, all-day events, and timed events with start/end."
          />
          <AboutFeature
            title="Invoicing with Stripe Connect"
            desc="Create invoices with line items, quantities, and notes. Track payments with a flexible schedule — deposits, progress payments, final balances. Accept card payments through Stripe Connect (vendors keep their own Stripe dashboard and full control). Record cash, bank transfer, and PayID payments manually. Automatic status tracking: draft, sent, partially paid, paid, overdue."
          />
          <AboutFeature
            title="Built-in email with your own address"
            desc="Claim a handle like josh@wedding.computer. Send and receive real emails from inside the dashboard — no external mail client needed. Full inbox and sent views with threaded conversations. Emails sent to contacts are automatically logged in their activity timeline. Powered by Cloudflare Email Routing."
          />
          <AboutFeature
            title="AI email drafting"
            desc="One click generates a personalised email draft based on the contact's history, wedding details, and your business context. Perfect for follow-ups, quotes, booking confirmations, and check-ins. Uses Cloudflare AI (Llama) by default — or bring your own Anthropic API key for Claude-powered drafts."
          />
          <AboutFeature
            title="Booking forms"
            desc="Once a couple books, they can fill out a detailed booking form to capture ceremony details, legal names, pronunciation guides, and everything else you need. Fully customisable per vendor. Responses attach to the wedding workspace."
          />
          <AboutFeature
            title="CardDAV contact sync"
            desc="Sync your CRM contacts to your phone's native contacts app via CardDAV. Add the server URL in Apple Contacts or any CardDAV client — your leads appear as real contacts with phone numbers, emails, partner details, and wedding notes. Read-only, always up to date, scoped to your vendor account only."
          />
          <AboutFeature
            title="Email notifications"
            desc="Get notified by email when things happen: new enquiries, couple accepts an invite, vendor joins a wedding, booking confirmations, invoice activity. Professional branded HTML emails, not plain text."
          />
          <AboutFeature
            title="Business analytics (Pro)"
            desc="Track enquiries, bookings, revenue, and conversion rates over time. See your conversion funnel from new lead to booked client. Measure enquiry sources, wedding locations, and average spend. Set goals for the year, season, or month and track your progress. Compare yourself against industry benchmarks from anonymised platform data."
          />
          <AboutFeature
            title="Business goals (Pro)"
            desc="Set targets for enquiries, bookings, or revenue — by year, season, or month. Track your progress with visual progress bars and year-over-year comparisons. See if you're ahead of pace or need to adjust your marketing."
          />
          <AboutFeature
            title="Service contracts"
            desc="Write a default service agreement template. When you create an invoice, a copy of the contract is attached automatically. Couples sign digitally on the booking page — their name, email, IP address, and timestamp are recorded."
          />
          <AboutFeature
            title="Import from other CRMs"
            desc="Switching from Dubsado, Studio Ninja, HoneyBook, or VSCO Workspace? Export your contacts as CSV and import them here. Columns are auto-mapped for known CRM exports, or you can map them manually. AI-powered extraction can also pull contacts from pasted text or any web page."
          />
          <AboutFeature
            title="Team & agency management"
            desc="Run a photography agency, celebrant team, or multi-person business? Add team members to your roster with contact details and roles. Then assign individuals to specific weddings — the wedding workspace shows which team members are working each event."
          />
          <AboutFeature
            title="MCP access for AI tools (Pro)"
            desc="Connect any AI tool that supports Model Context Protocol — Claude Desktop, ChatGPT, Cursor, Windsurf, or your own agent — directly to your Wedding Computer data. Read contacts, weddings, run sheets, checklists, and changelogs from your own AI workflow. Your token is in Settings under Calendar & Sync."
          />
        </div>

        {/* For Couples */}
        <h2 class="text-xl sm:text-2xl font-bold mb-2">For couples</h2>
        <p class="text-gray-500 text-sm mb-6">Plan your wedding without the spreadsheet chaos.</p>
        <div class="space-y-3 mb-12">
          <AboutFeature
            title="Wedding planner dashboard"
            desc="See your wedding at a glance: date, location, countdown, vendor grid, and budget summary. Everything in one place instead of scattered across apps."
          />
          <AboutFeature
            title="Vendor tracking with budget"
            desc="Track every vendor you're considering, contacted, or booked — with category, expected price, notes, and status. See your total expected spend, invoiced amount, and paid amount in a live budget summary."
          />
          <AboutFeature
            title="Platform vendor integration"
            desc="When your celebrant, photographer, or any vendor is on Wedding Computer, they appear in your dashboard automatically with an 'On platform' badge. Their invoices, booking forms, and updates are connected directly — no re-entering data."
          />
          <AboutFeature
            title="Vendor visibility controls"
            desc="You choose whether vendors on your wedding can see each other. Private by default — toggle to shared when you want your photographer and stylist to coordinate directly."
          />
        </div>

        {/* Wedding Workspaces */}
        <h2 class="text-xl sm:text-2xl font-bold mb-2">Wedding workspaces</h2>
        <p class="text-gray-500 text-sm mb-6">The thing that ties it all together.</p>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-12">
          <p>
            When a vendor books a lead, a shared wedding workspace is created. They invite
            the couple (who get the couple dashboard) and other vendors (who get scoped access to the wedding).
          </p>
          <p>
            Roles control who sees what. Managers (vendors, planners, or couples with the manage permission) have full control. Vendors see details relevant to their service.
            Couples see their vendors, budget, and timeline. Nobody sees more than they should.
          </p>
          <p>
            Couples can also create their own wedding and invite vendors — perfect for DIY weddings or
            when the couple is driving the planning process.
          </p>
        </div>

        {/* Data Philosophy */}
        <h2 class="text-xl sm:text-2xl font-bold mb-2">Your data, in plain text</h2>
        <p class="text-gray-500 text-sm mb-6">Built to outlast the app itself.</p>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-6">
          <p>
            Most SaaS tools store your data in a proprietary database. If the company shuts down, raises
            prices, or decides to pivot — your data goes with it. The best you get is a CSV export that
            loses half the context.
          </p>
          <p>
            Wedding Computer is different. Every contact and wedding is stored as a plain text
            markdown file with YAML frontmatter — the same open format used by static site generators,
            note-taking apps like Obsidian, and millions of developers worldwide. These files are human-readable,
            human-editable, and will still make perfect sense in 50 years on any computer.
          </p>
          <p>
            We think your client relationships are too important to trap inside a database you
            can't see. So we published the format as an{' '}
            <a href="/standard" class="text-horizon-700 font-bold hover:underline">open specification</a>{' '}
            that anyone can use. Other apps can read and write the same files. You can open them
            in a text editor, sync them with Obsidian, back them up to Git, or build your own tools on top.
          </p>
        </div>
        <div class="space-y-3 mb-12">
          <AboutFeature
            title="Markdown files with YAML frontmatter"
            desc="Each contact is a .md file with structured data (name, email, phone, status, tags) in the YAML header and free-form notes in the body. Each wedding is the same. The format is documented in our open standard — read it at /standard."
          />
          <AboutFeature
            title="No vendor lock-in"
            desc="Your files aren't trapped in our system. Access them through our app, through the Cloudflare R2 API, through Obsidian, or through any S3-compatible tool. If you leave Wedding Computer, you take everything — not an export, the actual files."
          />
          <AboutFeature
            title="An open standard for the wedding industry"
            desc="We published the Wedding CRM Markdown Standard so other developers and apps can use the same format. A contact created in Wedding Computer can be read by any tool that understands YAML frontmatter. We believe the wedding industry deserves interoperable data."
          />
        </div>

        {/* What's Coming */}
        <h2 class="text-xl sm:text-2xl font-bold mb-2">What's coming next</h2>
        <p class="text-gray-500 text-sm mb-6">On the roadmap, not yet shipped.</p>
        <div class="space-y-3 mb-12">
          <AboutFeature title="Available date finder" desc="A public search tool where couples can find vendors who are available on their wedding date. Vendors opt in to visibility. Filter by category, location, and date." />
          <AboutFeature title="Vendor collaboration" desc="Vendors on the same wedding will be able to coordinate directly — share timelines, run sheets, and logistics with each other (with the couple's permission)." />
          <AboutFeature title="Smarter AI" desc="AI-powered follow-up suggestions, budget recommendations, and automated reminders based on your pipeline and calendar." />
          <AboutFeature title="Google Calendar two-way sync" desc="OAuth-based two-way sync between your Wedding Computer calendar and Google Calendar. Create an event in either place and it appears in both." />
          <AboutFeature title="Document sharing" desc="Upload contracts, mood boards, run sheets, and other documents to a wedding workspace. Control visibility per document." />
        </div>

        {/* Technical / Nerdy */}
        <h2 class="text-xl sm:text-2xl font-bold mb-2">Under the hood</h2>
        <p class="text-gray-500 text-sm mb-6">For the nerds. We are also nerds.</p>
        <div class="space-y-3 mb-12">
          <AboutFeature
            title="Cloudflare Workers, globally"
            desc="The entire application runs on Cloudflare Workers — a single Worker serves marketing, auth, the vendor app, the couple app, DAV servers, webhooks, and API. Requests are handled at the nearest Cloudflare edge location, typically under 50ms. No origin server, no cold starts, no regions to choose."
          />
          <AboutFeature
            title="Hono + server-rendered JSX + htmx"
            desc="Built with Hono (a lightweight TypeScript web framework designed for edge runtimes) using JSX for server-side HTML rendering. Interactive elements use htmx for partial page updates without a client-side JavaScript framework. Zero JS bundle shipped to the browser — just htmx (10KB) and Tailwind CSS via CDN."
          />
          <AboutFeature
            title="Plain text files + D1 index"
            desc="Contacts and weddings are stored as markdown files on Cloudflare R2. A D1 (SQLite) index caches key fields for fast queries — but it's just a cache. The files are the source of truth. If the index is lost, it rebuilds from the files. If the app disappears, the files still make sense. 24-character hex IDs, ISO 8601 timestamps, and explicit tenant-scoping on every query."
          />
          <AboutFeature
            title="CardDAV and CalDAV servers (RFC 6352 / RFC 4791)"
            desc="Full DAV servers built from scratch, not a library. CardDAV serves your contacts as vCard 3.0 with proper line folding (byte-level, not character-level) and UTF-8 support. CalDAV serves calendar events as iCalendar with timezone-aware DTSTART/DTEND properties. Both support PROPFIND discovery, REPORT multiget, and individual resource GET. ETags from row timestamps, CTags from SHA-256 of count + max(updated_at). Read-only by design — write operations return 403."
          />
          <AboutFeature
            title="Passwordless auth with passkeys"
            desc="Magic links via email, Google/Apple OAuth, and WebAuthn passkeys (Touch ID, Face ID, Windows Hello, security keys). No passwords means no credential stuffing, no password reuse, no bcrypt CPU cost. Passkey registration and verification built from scratch using Web Crypto API on Cloudflare Workers — no external dependencies. Session tokens are 32-byte random values stored in KV with 30-day rolling TTL. CSRF protection on every state-changing request."
          />
          <AboutFeature
            title="Stripe Connect Standard"
            desc="Vendors connect their own Stripe accounts (Standard Connect, not Express). They keep full control of their Stripe dashboard — we never hold funds or handle card data. Invoices are created on the vendor's connected account using Stripe-Account headers. Webhooks handle payment lifecycle events."
          />
          <AboutFeature
            title="Cloudflare Email Routing"
            desc="Inbound and outbound email handled by Cloudflare's email workers and Resend for delivery. Each vendor gets a handle@wedding.computer address. Inbound emails are parsed, matched to contacts by sender address, and stored with full headers. Outbound emails use professional HTML templates with the vendor's branding."
          />
          <AboutFeature
            title="Background jobs via Queues"
            desc="Email sending, notifications, and heavy processing run through Cloudflare Queues — guaranteed delivery with automatic retries and dead letter handling. No waitUntil() hacks, no fire-and-forget. If a job fails, it retries. If it keeps failing, you can see it."
          />
          <AboutFeature
            title="Strict tenant isolation"
            desc="Every database query is scoped by vendor_id or wedding membership. There are no admin endpoints that bypass scoping. The data access layer requires a scoping ID as a mandatory parameter — it's architecturally impossible to write an unscoped query by accident. Wedding-level access checks run through middleware that verifies wedding_members before touching any wedding data."
          />
          <AboutFeature
            title="No tracking, no cookies banner"
            desc="Session cookies only (HttpOnly, Secure, SameSite=Lax). No analytics scripts, no tracking pixels, no third-party cookies. No consent banner needed because there's nothing to consent to."
          />
        </div>

        {/* Open Source */}
        <h2 class="text-xl sm:text-2xl font-bold mb-2">Open source (AGPL-3.0)</h2>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-12">
          <p>
            Wedding Computer is open source under the AGPL-3.0 license. That means anyone can read the code,
            audit the security, self-host it, or contribute improvements. The AGPL specifically requires that anyone
            who modifies and deploys the software must share their changes — it prevents hosted competitors from
            taking the code without giving back.
          </p>
          <p>
            We chose AGPL because the wedding industry has been underserved by closed, expensive SaaS tools for
            too long. Building in the open means vendors can trust what the software does with their data, and
            the community can help make it better.
          </p>
          <p>
            <a href="https://github.com/joshwithers/wedding-computer" class="text-horizon-700 font-bold hover:underline">View the source on GitHub</a>
          </p>
        </div>

        {/* CTA */}
        <div class="bg-horizon-600 rounded-2xl p-6 sm:p-10 text-center text-white">
          <h2 class="text-xl sm:text-2xl font-bold mb-3">Ready to try it?</h2>
          <p class="text-white mb-6 max-w-md mx-auto text-sm">
            Free to use. No credit card. Set up in under a minute.
          </p>
          <a
            href="/login"
            class="inline-block bg-white text-horizon-700 font-bold px-8 py-3.5 rounded-xl hover:bg-horizon-50 transition-colors"
          >
            Get started free
          </a>
        </div>
      </div>
    </MarketingLayout>
  )
})

marketing.get('/pricing', (c) => {
  return c.html(
    <MarketingLayout title="Pricing">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <h1 class="text-2xl sm:text-4xl font-bold mb-4 text-center">Simple pricing</h1>
        <p class="text-gray-600 mb-10 sm:mb-12 text-center max-w-lg mx-auto">
          Free for couples. Free core tools for vendors. Unlock analytics and AI with Pro.
        </p>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 max-w-2xl mx-auto">
          {/* Free plan */}
          <div class="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8">
            <p class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Free</p>
            <p class="text-4xl font-bold mb-1">$0</p>
            <p class="text-sm text-gray-500 mb-6">per month, forever</p>
            <ul class="space-y-2.5 text-sm text-gray-700 mb-8">
              <PricingFeature text="CRM with eight-stage pipeline" />
              <PricingFeature text="Custom enquiry forms" />
              <PricingFeature text="Calendar" />
              <PricingFeature text="Invoicing with Stripe Connect" />
              <PricingFeature text="Built-in email" />
              <PricingFeature text="Wedding workspaces" />
              <PricingFeature text="Import from other CRMs" />
              <PricingFeature text="Team & agency management" />
              <PricingFeature text="Day-of run sheet builder" />
              <PricingFeature text="Quote calculator" />
              <PricingFeature text="Public availability calendar" />
              <PricingFeature text="Directory listing opt-in" />
              <PricingFeature text="Couple planner dashboard" />
              <PricingFeature text="Plain text file access" />
              <PricingFeature text="Passkey sign-in" />
            </ul>
            <a
              href="/login"
              class="block text-center bg-white border border-gray-200 text-gray-700 py-3 px-4 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
            >
              Get started free
            </a>
          </div>

          {/* Pro plan */}
          <div class="bg-white rounded-2xl border-2 border-horizon-600 p-6 sm:p-8 relative">
            <div class="absolute -top-3 left-6 bg-horizon-600 text-white text-xs font-bold px-3 py-1 rounded-full">
              Recommended
            </div>
            <p class="text-sm font-bold text-horizon-700 uppercase tracking-wide mb-3">Pro</p>
            <p class="text-4xl font-bold mb-1">$28</p>
            <p class="text-sm text-gray-500 mb-6">per month</p>
            <ul class="space-y-2.5 text-sm text-gray-700 mb-8">
              <PricingFeature text="Everything in Free" bold />
              <PricingFeature text="GitHub sync for your data" />
              <PricingFeature text="CalDAV/iCal calendar sync" />
              <PricingFeature text="CardDAV contact sync to phone" />
              <PricingFeature text="Business analytics dashboard" />
              <PricingFeature text="Revenue and source insights" />
              <PricingFeature text="Business goals and targets" />
              <PricingFeature text="AI email drafting" />
              <PricingFeature text="Date demand scores" />
              <PricingFeature text="Anonymised industry benchmarks" />
              <PricingFeature text="AI enquiry auto-replies" />
              <PricingFeature text="MCP access for AI tools" />
            </ul>
            <a
              href="/login"
              class="block text-center bg-horizon-600 text-white py-3 px-4 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors shadow-lg shadow-horizon/20"
            >
              Start with Pro
            </a>
          </div>
        </div>

        {/* Live Pro for free — referral */}
        <div class="max-w-3xl mx-auto mt-12 sm:mt-16">
          <div class="bg-horizon-50 border border-horizon-600/20 rounded-2xl p-6 sm:p-10 text-center">
            <div class="inline-block bg-horizon-600 text-white text-xs font-bold px-3 py-1 rounded-full mb-3">Refer &amp; earn</div>
            <h2 class="text-xl sm:text-2xl font-bold mb-3">Live Pro for free</h2>
            <p class="text-gray-600 max-w-xl mx-auto mb-5">
              Love Wedding Computer? Share it. Every time someone you refer becomes a paying Pro member,
              you <strong class="text-gray-900">both</strong> get a month of Pro free — and you can bank up to
              <strong class="text-gray-900"> nine months</strong> at a time. Refer a handful of fellow vendors and
              your Pro plan pays for itself, indefinitely.
            </p>
            <a
              href="/login"
              class="inline-block bg-horizon-600 text-white py-2.5 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors shadow-lg shadow-horizon/20"
            >
              Get your referral link
            </a>
          </div>
        </div>

        {/* Detailed feature comparison */}
        <div class="max-w-3xl mx-auto mt-12 sm:mt-16">
          <h2 class="text-xl sm:text-2xl font-bold text-center mb-2">Compare every feature</h2>
          <p class="text-center text-gray-500 text-sm mb-6">All the core tools are free forever. Pro adds sync, analytics, and AI.</p>
          <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-gray-50 border-b border-gray-200">
                  <th class="text-left py-3 px-4 font-bold text-gray-700">Feature</th>
                  <th class="py-3 px-2 text-center font-bold text-gray-500 w-16 sm:w-24">Free</th>
                  <th class="py-3 px-2 text-center font-bold text-horizon-700 w-16 sm:w-24">Pro</th>
                </tr>
              </thead>
              <tbody>
                <PlanGroup label="Leads & CRM" />
                <PlanRow feature="CRM with 8-stage pipeline" free pro />
                <PlanRow feature="Custom enquiry forms" free pro />
                <PlanRow feature="Embeddable HTML form for your own site" free pro />
                <PlanRow feature="Spam protection (captcha + honeypot)" free pro />
                <PlanRow feature="Import from other CRMs" free pro />
                <PlanRow feature="AI email drafting" free={false} pro />
                <PlanRow feature="AI enquiry auto-replies" free={false} pro />
                <PlanRow feature="Enquiry API, webhooks & Zapier" free={false} pro />
                <PlanRow feature="AI agent lead capture (MCP)" free={false} pro />

                <PlanGroup label="Calendar & availability" />
                <PlanRow feature="Calendar & event management" free pro />
                <PlanRow feature="Availability settings" free pro />
                <PlanRow feature="Public availability calendar" free pro />
                <PlanRow feature="Directory listing" free pro />
                <PlanRow feature="CalDAV / iCal calendar sync" free={false} pro />
                <PlanRow feature="CardDAV contact sync to your phone" free={false} pro />

                <PlanGroup label="Money" />
                <PlanRow feature="Invoicing with Stripe Connect" free pro />
                <PlanRow feature="Quote calculator" free pro />
                <PlanRow feature="Contracts" free pro />

                <PlanGroup label="Weddings & collaboration" />
                <PlanRow feature="Wedding workspaces" free pro />
                <PlanRow feature="Day-of run sheet builder" free pro />
                <PlanRow feature="Checklists & NOIM forms" free pro />
                <PlanRow feature="Team & agency management" free pro />
                <PlanRow feature="Couple planner dashboard" free pro />

                <PlanGroup label="Your data" />
                <PlanRow feature="Plain-text file access" free pro />
                <PlanRow feature="Passkey sign-in" free pro />
                <PlanRow feature="GitHub sync for your data" free={false} pro />

                <PlanGroup label="Insights & AI" />
                <PlanRow feature="Business analytics dashboard" free={false} pro />
                <PlanRow feature="Revenue & source insights" free={false} pro />
                <PlanRow feature="Business goals & targets" free={false} pro />
                <PlanRow feature="Date demand scores" free={false} pro />
                <PlanRow feature="Anonymised industry benchmarks" free={false} pro />
                <PlanRow feature="MCP access for AI tools" free={false} pro />
              </tbody>
            </table>
          </div>
        </div>

        <div class="text-center mt-8 sm:mt-12">
          <p class="text-sm text-gray-500">
            Couples always free. No credit card required to start. Cancel Pro anytime.
          </p>
        </div>
      </div>
    </MarketingLayout>
  )
})

// ─── Open Standard ───

marketing.get('/standard', (c) => {
  return c.html(
    <MarketingLayout title="Wedding CRM Markdown Standard">
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <div class="inline-block bg-horizon-50 text-horizon-700 font-semibold text-sm px-4 py-1.5 rounded-full mb-4">
          Open Standard v1.0
        </div>
        <h1 class="text-2xl sm:text-4xl font-bold mb-4 sm:mb-6">Wedding CRM Markdown Standard</h1>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-12">
          <p>
            An open file format for storing wedding industry CRM data as plain text markdown files
            with YAML frontmatter. Designed to be human-readable, human-editable, and interoperable
            across any tool that understands text files.
          </p>
          <p>
            This specification is published by <a href="/" class="text-horizon-700 font-bold hover:underline">Wedding Computer</a> and
            is free for anyone to implement. We encourage other wedding software, CRM tools, and
            planning apps to adopt this format so that wedding professionals can move their data freely
            between tools.
          </p>
        </div>

        {/* Why this exists */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Why an open format?</h2>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-12">
          <p>
            Wedding professionals build their business on relationships — client details, wedding timelines,
            notes from consultations, follow-up history. This data is the lifeblood of their business, but
            it's usually trapped inside a proprietary database owned by a SaaS vendor.
          </p>
          <p>
            Plain text files solve this. A markdown file created today will be readable on any computer
            in 2050, 2075, or 2100. YAML frontmatter is a widely-adopted standard for structured metadata
            in text files. Together, they give you structured data that's also human-friendly.
          </p>
          <p>
            By publishing this as an open standard, we're making a bet: that the best way to serve wedding
            professionals is to ensure their data is never locked in.
          </p>
        </div>

        {/* Format overview */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Format overview</h2>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-8">
          <p>
            Each entity (contact, wedding) is stored as a single <code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm">.md</code> file.
            Structured data lives in YAML frontmatter between <code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm">---</code> fences
            at the top of the file. Free-form notes are the markdown body below.
          </p>
        </div>
        <div class="bg-gray-900 rounded-xl p-4 sm:p-6 mb-12 overflow-x-auto">
          <pre class="text-sm text-gray-100 leading-relaxed"><code>{`---
id: a1b2c3d4e5f6a1b2c3d4e5f6
first_name: Sarah
last_name: Smith
email: sarah@example.com
phone: "0400 123 456"
partner_first_name: James
partner_last_name: Wilson
status: quoted
wedding_date: 2026-12-15
wedding_location: Sydney
tags:
  - vip
  - referral
created_at: 2025-06-01T00:00:00.000Z
updated_at: 2025-06-01T00:00:00.000Z
---

Met at the Bridal Expo in March 2025.

- Interested in elopement ceremony
- Budget: $3,000 - $5,000
- Preferred dates: Dec 2026 or Jan 2027

## Follow-up notes

Called on March 15, very enthusiastic.
Sending quote this week.`}</code></pre>
        </div>

        {/* Contact spec */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Contact file specification</h2>
        <p class="text-gray-600 leading-relaxed mb-6">
          Contact files represent a lead, client, or business relationship. They live in a <code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm">contacts/</code> directory.
        </p>

        <h3 class="text-lg font-bold mb-3">Required fields</h3>
        <div class="bg-white border border-papaya-300/30 rounded-xl overflow-hidden mb-6">
          <table class="w-full text-sm">
            <thead class="bg-papaya-50/50">
              <tr>
                <th class="text-left px-4 py-2.5 font-bold text-gray-700">Field</th>
                <th class="text-left px-4 py-2.5 font-bold text-gray-700">Type</th>
                <th class="text-left px-4 py-2.5 font-bold text-gray-700">Description</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-papaya-300/20">
              <SpecRow field="id" type="string" desc="Unique identifier. 24-character hex string recommended. Must be globally unique." />
              <SpecRow field="first_name" type="string" desc="Contact's first (given) name." />
              <SpecRow field="last_name" type="string" desc="Contact's last (family) name." />
              <SpecRow field="status" type="enum" desc="Pipeline stage. One of: new, contacted, meeting, quoted, booked, completed, lost, archived." />
              <SpecRow field="created_at" type="ISO 8601" desc="When the contact was first created. Example: 2025-06-01T00:00:00.000Z" />
              <SpecRow field="updated_at" type="ISO 8601" desc="When the contact was last modified." />
            </tbody>
          </table>
        </div>

        <h3 class="text-lg font-bold mb-3">Optional fields</h3>
        <div class="bg-white border border-papaya-300/30 rounded-xl overflow-hidden mb-6">
          <table class="w-full text-sm">
            <thead class="bg-papaya-50/50">
              <tr>
                <th class="text-left px-4 py-2.5 font-bold text-gray-700">Field</th>
                <th class="text-left px-4 py-2.5 font-bold text-gray-700">Type</th>
                <th class="text-left px-4 py-2.5 font-bold text-gray-700">Description</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-papaya-300/20">
              <SpecRow field="email" type="string" desc="Primary email address." />
              <SpecRow field="phone" type="string" desc='Phone number. Always quote in YAML to prevent numeric parsing. Example: "0400 123 456"' />
              <SpecRow field="partner_first_name" type="string" desc="Partner's first name (for couples)." />
              <SpecRow field="partner_last_name" type="string" desc="Partner's last name." />
              <SpecRow field="partner_email" type="string" desc="Partner's email address." />
              <SpecRow field="partner_phone" type="string" desc='Partner phone number. Always quote.' />
              <SpecRow field="source" type="string" desc="Where the lead came from. Examples: website, instagram, referral, bridal-expo." />
              <SpecRow field="wedding_id" type="string" desc="ID of a linked wedding entity, if one exists." />
              <SpecRow field="wedding_date" type="string" desc="Expected wedding date. Format: YYYY-MM-DD." />
              <SpecRow field="wedding_location" type="string" desc="Expected wedding location. Free text." />
              <SpecRow field="tags" type="string[]" desc="YAML array of tags. Example: [vip, referral, 2026]" />
              <SpecRow field="form_data" type="object" desc="Structured data from enquiry/booking forms. YAML object with arbitrary keys." />
              <SpecRow field="last_contacted_at" type="ISO 8601" desc="When you last reached out to this contact." />
            </tbody>
          </table>
        </div>

        <h3 class="text-lg font-bold mb-3">Body (notes)</h3>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-12">
          <p>
            Everything below the closing <code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm">---</code> fence is
            free-form markdown. This is where you write notes, follow-up history, meeting summaries, or anything
            else. Use headings, lists, links — any valid markdown.
          </p>
          <p>
            In Wedding Computer, this maps to the "notes" field in the contact record. If the body is empty,
            notes are null.
          </p>
        </div>

        {/* Wedding spec */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Wedding file specification</h2>
        <p class="text-gray-600 leading-relaxed mb-6">
          Wedding files represent a wedding event. They live in a <code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm">weddings/</code> directory.
        </p>

        <div class="bg-gray-900 rounded-xl p-4 sm:p-6 mb-8 overflow-x-auto">
          <pre class="text-sm text-gray-100 leading-relaxed"><code>{`---
id: f8e7d6c5b4a3f8e7d6c5b4a3
title: Sarah & James
date: 2026-12-15
time: "15:00"
location: Royal Botanic Garden Sydney
location_lat: -33.8642
location_lng: 151.2166
status: confirmed
ceremony_type: legal
vendor_visibility: private
reception_location: The Calyx
reception_time: "17:30"
guest_count: 85
dress_code: Semi-formal
created_by_user_id: u1a2b3c4d5e6
created_at: 2025-06-01T00:00:00.000Z
updated_at: 2025-07-15T10:30:00.000Z
---

Outdoor ceremony in the rose garden, weather permitting.
Backup plan: The Calyx indoor space.

## Timeline

- 13:00 — Getting ready at hotel
- 14:30 — First look photos
- 15:00 — Ceremony
- 15:30 — Family photos
- 16:00 — Canapes and drinks
- 17:30 — Reception begins`}</code></pre>
        </div>

        <h3 class="text-lg font-bold mb-3">Required fields</h3>
        <div class="bg-white border border-papaya-300/30 rounded-xl overflow-hidden mb-6">
          <table class="w-full text-sm">
            <thead class="bg-papaya-50/50">
              <tr>
                <th class="text-left px-4 py-2.5 font-bold text-gray-700">Field</th>
                <th class="text-left px-4 py-2.5 font-bold text-gray-700">Type</th>
                <th class="text-left px-4 py-2.5 font-bold text-gray-700">Description</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-papaya-300/20">
              <SpecRow field="id" type="string" desc="Unique identifier. 24-character hex string recommended." />
              <SpecRow field="title" type="string" desc={"Wedding title. Typically the couple's names: \"Sarah & James\"."} />
              <SpecRow field="status" type="enum" desc="One of: planning, confirmed, completed, cancelled." />
              <SpecRow field="created_by_user_id" type="string" desc="ID of the user who created this wedding." />
              <SpecRow field="created_at" type="ISO 8601" desc="When the wedding record was created." />
              <SpecRow field="updated_at" type="ISO 8601" desc="When the wedding record was last modified." />
            </tbody>
          </table>
        </div>

        <h3 class="text-lg font-bold mb-3">Optional fields</h3>
        <div class="bg-white border border-papaya-300/30 rounded-xl overflow-hidden mb-6">
          <table class="w-full text-sm">
            <thead class="bg-papaya-50/50">
              <tr>
                <th class="text-left px-4 py-2.5 font-bold text-gray-700">Field</th>
                <th class="text-left px-4 py-2.5 font-bold text-gray-700">Type</th>
                <th class="text-left px-4 py-2.5 font-bold text-gray-700">Description</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-papaya-300/20">
              <SpecRow field="date" type="string" desc="Wedding date. Format: YYYY-MM-DD." />
              <SpecRow field="time" type="string" desc='Ceremony start time. Format: HH:MM (24-hour). Always quote in YAML.' />
              <SpecRow field="location" type="string" desc="Ceremony venue name and/or address." />
              <SpecRow field="location_lat" type="number" desc="Latitude of the ceremony location. Decimal degrees." />
              <SpecRow field="location_lng" type="number" desc="Longitude of the ceremony location. Decimal degrees." />
              <SpecRow field="ceremony_type" type="string" desc="Type of ceremony. Examples: legal, commitment, renewal, elopement." />
              <SpecRow field="vendor_visibility" type="enum" desc="Whether vendors on this wedding can see each other. One of: private, visible." />
              <SpecRow field="reception_location" type="string" desc="Reception venue name and/or address." />
              <SpecRow field="reception_time" type="string" desc='Reception start time. Format: HH:MM. Always quote.' />
              <SpecRow field="getting_ready_location" type="string" desc="Where the couple is getting ready (hotel, home, etc.)." />
              <SpecRow field="getting_ready_time" type="string" desc='Getting ready start time. Always quote.' />
              <SpecRow field="dress_code" type="string" desc="Dress code for guests. Free text." />
              <SpecRow field="guest_count" type="integer" desc="Expected number of guests." />
              <SpecRow field="timeline_notes" type="string" desc="Additional notes about the day's timeline." />
            </tbody>
          </table>
        </div>

        <h3 class="text-lg font-bold mb-3">Body (notes)</h3>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-12">
          <p>
            The markdown body holds free-form notes about the wedding — logistics, backup plans,
            run sheet details, vendor coordination notes, or anything else. Use headings to organise
            sections. This maps to the "notes" field on the wedding record.
          </p>
        </div>

        {/* File naming */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">File naming conventions</h2>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-8">
          <p>
            Filenames should be human-readable slugs. This makes them easy to browse in a file explorer
            or Obsidian's sidebar.
          </p>
        </div>

        <div class="bg-white border border-papaya-300/30 rounded-xl p-4 sm:p-6 mb-6">
          <h3 class="font-bold text-sm mb-3">Contacts</h3>
          <div class="space-y-2 text-sm text-gray-600">
            <p><code class="bg-gray-100 px-1.5 py-0.5 rounded">sarah-smith.md</code> — Single contact</p>
            <p><code class="bg-gray-100 px-1.5 py-0.5 rounded">sarah-james-smith.md</code> — Couple with same surname</p>
            <p><code class="bg-gray-100 px-1.5 py-0.5 rounded">sarah-smith-james-wilson.md</code> — Couple with different surnames</p>
            <p><code class="bg-gray-100 px-1.5 py-0.5 rounded">john-doe-2.md</code> — Deduplicated (second John Doe)</p>
          </div>
        </div>

        <div class="bg-white border border-papaya-300/30 rounded-xl p-4 sm:p-6 mb-6">
          <h3 class="font-bold text-sm mb-3">Weddings</h3>
          <div class="space-y-2 text-sm text-gray-600">
            <p><code class="bg-gray-100 px-1.5 py-0.5 rounded">sarah-james-2026-12-15.md</code> — Wedding with date</p>
            <p><code class="bg-gray-100 px-1.5 py-0.5 rounded">smith-jones-wedding.md</code> — Wedding without date</p>
          </div>
        </div>

        <div class="bg-white border border-papaya-300/30 rounded-xl p-4 sm:p-6 mb-12">
          <h3 class="font-bold text-sm mb-3">Slugification rules</h3>
          <div class="space-y-2 text-sm text-gray-600">
            <p>1. Decompose Unicode (NFKD normalisation), strip combining marks</p>
            <p>2. Lowercase everything</p>
            <p>3. Strip apostrophes and quotes — O'Brien becomes obrien</p>
            <p>4. Replace <code class="bg-gray-100 px-1.5 py-0.5 rounded">&amp;</code> with a hyphen</p>
            <p>5. Replace all non-alphanumeric characters with hyphens</p>
            <p>6. Collapse multiple hyphens, trim leading/trailing hyphens</p>
            <p>7. If the result is empty, use <code class="bg-gray-100 px-1.5 py-0.5 rounded">untitled</code></p>
          </div>
        </div>

        {/* Directory structure */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Directory structure</h2>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-8">
          <p>
            Files are organised by vendor, then by entity type:
          </p>
        </div>
        <div class="bg-gray-900 rounded-xl p-4 sm:p-6 mb-12 overflow-x-auto">
          <pre class="text-sm text-gray-100 leading-relaxed"><code>{`vendors/
  {vendor_id}/
    contacts/
      sarah-smith.md
      john-james-doe.md
      jane-wilson-2.md
    weddings/
      2026-12-15-sarah-james/
        wedding.md
        todo.md
        log.md
        files/
      smith-wilson/
        wedding.md`}</code></pre>
        </div>

        {/* YAML tips */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">YAML authoring tips</h2>
        <div class="space-y-3 mb-12">
          <AboutFeature
            title='Always quote phone numbers'
            desc='YAML parses unquoted numbers like 0400123456 as the integer 400123456, losing the leading zero. Always wrap phone numbers in quotes: phone: "0400 123 456".'
          />
          <AboutFeature
            title="Always quote times"
            desc='YAML may parse HH:MM as a sexagesimal number. Write time: "15:00" not time: 15:00.'
          />
          <AboutFeature
            title="Dates can be unquoted"
            desc="YAML 1.2 handles ISO dates well. wedding_date: 2026-12-15 and created_at: 2025-06-01T00:00:00.000Z both work without quotes."
          />
          <AboutFeature
            title="Use YAML arrays for tags"
            desc='Write tags as a YAML array — either inline [vip, referral] or block style with - vip on each line. Not a JSON string.'
          />
          <AboutFeature
            title="Colons and special characters in values"
            desc='If a value contains a colon, hash, or other YAML-special character, quote it: location: "Ceremony: 3pm at The Grand Ballroom".'
          />
          <AboutFeature
            title="Null vs absent"
            desc="Omitting a field and setting it to null are equivalent. Wedding Computer treats both as null. If you're hand-editing, just leave optional fields out."
          />
        </div>

        {/* Interop */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Interoperability</h2>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-12">
          <p>
            Files conforming to this standard can be read by:
          </p>
          <ul class="list-disc list-inside space-y-1.5">
            <li><strong>Any text editor</strong> — VS Code, Sublime Text, Notepad, vim</li>
            <li><strong>Obsidian</strong> — reads YAML frontmatter natively, renders the markdown body</li>
            <li><strong>Static site generators</strong> — Hugo, Jekyll, Eleventy, Astro all read YAML frontmatter</li>
            <li><strong>Scripting languages</strong> — Python (PyYAML), JavaScript (yaml), Ruby, Go all have YAML parsers</li>
            <li><strong>Any YAML-aware tool</strong> — the frontmatter is standard YAML 1.2</li>
          </ul>
          <p>
            Wedding Computer uses the <a href="https://eemeli.org/yaml/" class="text-horizon-700 font-bold hover:underline">yaml</a> npm
            package (YAML 1.2 compliant) for parsing and serialisation. We recommend other implementations
            use a YAML 1.2 parser for maximum compatibility.
          </p>
        </div>

        {/* License */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">License</h2>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-12">
          <p>
            This specification is published under{' '}
            <a href="https://creativecommons.org/publicdomain/zero/1.0/" class="text-horizon-700 font-bold hover:underline">CC0 1.0 Universal (Public Domain)</a>.
            You are free to implement, modify, and redistribute it without restriction.
            No attribution required, though we'd appreciate a link back.
          </p>
          <p>
            The Wedding Computer application that implements this standard is licensed under AGPL-3.0.
            The specification itself carries no such requirement — you can implement it in proprietary software.
          </p>
        </div>

        {/* CTA */}
        <div class="bg-horizon-600 rounded-2xl p-6 sm:p-10 text-center text-white">
          <h2 class="text-xl sm:text-2xl font-bold mb-3">Build on this standard</h2>
          <p class="text-white mb-6 max-w-md mx-auto text-sm">
            If you're building wedding software, adopt this format. Your users will thank you.
          </p>
          <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="https://github.com/joshwithers/wedding-computer"
              class="inline-block bg-white text-horizon-700 font-bold px-6 py-3 rounded-xl hover:bg-horizon-50 transition-colors text-sm"
            >
              View on GitHub
            </a>
            <a
              href="/docs/plain-text"
              class="inline-block bg-horizon-500 text-white font-bold px-6 py-3 rounded-xl hover:bg-horizon-400 transition-colors text-sm"
            >
              Access your files
            </a>
          </div>
        </div>
      </div>
    </MarketingLayout>
  )
})

// ─── Plain Text Docs ───

marketing.get('/docs/plain-text', (c) => {
  return c.html(
    <MarketingLayout title="Your Data, Your Way">
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <h1 class="text-2xl sm:text-4xl font-bold mb-4 sm:mb-6">Your data, your way</h1>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-12">
          <p>
            Every contact and wedding in Wedding Computer is stored as a plain text file — not
            locked in a database you can't see. These files are yours. You can read them, copy them,
            edit them, and back them up however you like.
          </p>
          <p>
            This page shows you how. Most people will want to start with GitHub sync — it's the
            easiest way to keep a copy of everything, and it works with Obsidian too.
          </p>
        </div>

        {/* What the files look like */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">What your files look like</h2>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-6">
          <p>
            Each contact is a file. Each wedding is a file. They look like this:
          </p>
        </div>
        <div class="bg-gray-900 rounded-xl p-4 sm:p-6 mb-4 overflow-x-auto">
          <pre class="text-sm text-gray-100 leading-relaxed"><code>{`---
first_name: Sarah
last_name: Smith
email: sarah@example.com
phone: "0400 123 456"
status: quoted
wedding_date: 2026-12-15
tags:
  - vip
  - referral
---

Met at the Bridal Expo. Very enthusiastic about
an elopement ceremony at the Royal Botanic Garden.

Budget: $3,000 - $5,000`}</code></pre>
        </div>
        <p class="text-sm text-gray-500 mb-12">
          That's a real contact file. The structured data (name, email, status, tags) is at the top.
          Your notes are below. You can open this in any text editor on any computer, forever.
        </p>

        {/* Method 1: GitHub */}
        <div class="bg-horizon-50 rounded-2xl p-6 sm:p-8 mb-12">
          <div class="flex items-start gap-4">
            <div class="w-10 h-10 rounded-xl bg-horizon-100 flex items-center justify-center shrink-0">
              <div class="w-5 h-5 text-horizon-600" dangerouslySetInnerHTML={{ __html: featureIcons.sync }} />
            </div>
            <div>
              <div class="inline-block bg-horizon-600 text-white text-xs font-bold px-2.5 py-0.5 rounded-full mb-2">
                Recommended
              </div>
              <h2 class="text-xl sm:text-2xl font-bold mb-2">Connect to GitHub</h2>
              <p class="text-gray-600 leading-relaxed mb-4">
                The easiest way to access your files. Connect your GitHub account in Settings, and
                we automatically sync all your contacts and weddings to a private GitHub repository.
                Every change you make in Wedding Computer creates a new version in your repo.
              </p>
            </div>
          </div>

          <div class="space-y-3 mt-4">
            <AboutFeature
              title="How to set it up"
              desc={"Go to Settings and click Connect GitHub. Sign in with your GitHub account and choose a repository (or we'll create one for you). That's it — your data starts syncing immediately."}
            />
            <AboutFeature
              title="What happens next"
              desc="Every time you add a contact, update a wedding, or write a note, the change syncs to your GitHub repo within minutes. You get a folder of contacts and a folder of weddings — plain text files you can browse right on github.com."
            />
            <AboutFeature
              title="Full version history"
              desc="GitHub tracks every change automatically. You can see when a contact was created, when their status changed, when you added notes — and roll back to any previous version if you need to."
            />
            <AboutFeature
              title="Works with Obsidian"
              desc={"Obsidian (a free note-taking app) can open your GitHub repo directly using the Obsidian Git plugin. Your contacts and weddings show up as browsable, searchable notes with all the structured data visible as properties. It's a beautiful way to work with your CRM data."}
            />
            <AboutFeature
              title="Works offline"
              desc="Clone the repo to your computer and you have a local copy of everything. Works without internet. Make changes in a text editor and push them back when you reconnect."
            />
          </div>
          <p class="text-sm text-gray-500 mt-4">
            GitHub sync is available on the Pro plan ($28/month).
          </p>
        </div>

        {/* Method 2: Download from the app */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Download your data</h2>
        <p class="text-gray-500 text-sm mb-6">Available on all plans, any time.</p>
        <div class="space-y-3 mb-12">
          <AboutFeature
            title="Export everything"
            desc={"Go to Settings, scroll down to Data Export, and click the button. You'll get a file containing every contact, every wedding, all your notes — everything. Save it to your computer, a USB drive, Dropbox, wherever you like."}
          />
          <AboutFeature
            title="No limits, no tricks"
            desc="Export as many times as you want. There are no limits, no waiting periods, and no reduced-quality exports. You get the real data, the same files the app uses."
          />
          <AboutFeature
            title="Regular backups"
            desc="We recommend exporting a backup once a month (or more if you like). Keep it somewhere safe. If anything ever happens to Wedding Computer — or any software — you have everything."
          />
        </div>

        {/* Method 3: Obsidian */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Use with Obsidian</h2>
        <p class="text-gray-500 text-sm mb-6">A beautiful way to browse your CRM data.</p>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-6">
          <p>
            <a href="https://obsidian.md/" class="text-horizon-700 font-bold hover:underline">Obsidian</a> is
            a free app for reading and writing markdown files. It runs on Mac, Windows, Linux, iPhone,
            iPad, and Android. Since your Wedding Computer data is markdown, Obsidian reads it perfectly.
          </p>
        </div>
        <div class="space-y-3 mb-12">
          <AboutFeature
            title="With GitHub sync (easiest)"
            desc={"If you've connected GitHub, install the free Obsidian Git plugin. Point it at your repo and your CRM data appears as an Obsidian vault. Search contacts, browse weddings, and see all your notes — with live sync in both directions."}
          />
          <AboutFeature
            title="With a downloaded export"
            desc={"Download your data export, unzip it into a folder, and open that folder as an Obsidian vault. You'll see all your contacts and weddings in the sidebar. Use Obsidian's search to find anyone by name, email, wedding date, or any field."}
          />
          <AboutFeature
            title="What you see in Obsidian"
            desc="Each contact shows up as a note. The structured data (name, email, phone, status, tags) appears as properties at the top. Your free-form notes are the body. Obsidian renders it all beautifully — headings, lists, links, everything."
          />
        </div>

        {/* Phone sync */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Sync to your phone</h2>
        <p class="text-gray-500 text-sm mb-6">Your leads as real contacts on your phone. Pro plan.</p>
        <div class="space-y-3 mb-12">
          <AboutFeature
            title="CardDAV: contacts on your phone"
            desc="Add Wedding Computer as a contacts account on your iPhone or Android. Your CRM contacts appear in your phone's native Contacts app — with names, phone numbers, emails, and wedding notes. When you update a contact in Wedding Computer, it updates on your phone automatically."
          />
          <AboutFeature
            title="CalDAV / iCal: calendar events on your phone"
            desc="Subscribe to your Wedding Computer calendar from Apple Calendar, Google Calendar, or any calendar app. Your bookings, blocked dates, and events show up alongside your personal calendar. Changes sync automatically."
          />
          <AboutFeature
            title="How to set it up"
            desc="Go to Settings and you'll find your CardDAV and CalDAV server details. Add them as accounts on your phone — it takes about 30 seconds. Available on the Pro plan."
          />
        </div>

        {/* What the files look like in a folder */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">How your files are organised</h2>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-6">
          <p>
            Whether you access your files through GitHub, Obsidian, or a data export,
            the structure is the same:
          </p>
        </div>
        <div class="bg-gray-900 rounded-xl p-4 sm:p-6 mb-8 overflow-x-auto">
          <pre class="text-sm text-gray-100 leading-relaxed"><code>{`contacts/
  sarah-smith.md
  john-doe.md
  jane-wilson-james-brown.md
weddings/
  2026-12-15-sarah-james/
    wedding.md
    todo.md
    log.md
    files/
  doe-wedding/
    wedding.md`}</code></pre>
        </div>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-12">
          <p>
            Contact files are named after the person (or couple). Wedding files are named after the
            couple and date. The files follow the{' '}
            <a href="/standard" class="text-horizon-700 font-bold hover:underline">Wedding CRM Markdown Standard</a> —
            an open format anyone can use.
          </p>
        </div>

        {/* Why */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Why we do this</h2>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-12">
          <p>
            Most CRM tools store your data in a proprietary database. If the company shuts down,
            raises prices, or gets acquired — your data goes with it. The best you usually get is
            a CSV export that loses half the context.
          </p>
          <p>
            We think your client relationships are worth more than that. A wedding vendor's
            contact list represents years of relationship building. Notes from consultations,
            follow-up plans, wedding details — that's the lifeblood of your business.
          </p>
          <p>
            Plain text files are the most durable data format ever created. A text file written in
            1970 is still perfectly readable today. We chose this format because your data should
            outlive any app — including ours.
          </p>
        </div>

        {/* For developers */}
        <details class="bg-white border border-papaya-300/30 rounded-xl mb-12">
          <summary class="px-4 sm:px-6 py-4 cursor-pointer font-bold text-sm text-gray-700 hover:text-gray-900">
            For developers: API access, scripting, and self-hosting
          </summary>
          <div class="px-4 sm:px-6 pb-6 pt-2 space-y-6">
            <div>
              <h3 class="font-bold text-sm mb-2">Cloudflare R2 API (S3-compatible)</h3>
              <p class="text-sm text-gray-600 mb-3">
                Files are stored on Cloudflare R2. Any S3-compatible tool (rclone, AWS CLI, Cyberduck, boto3) works.
                Self-hosters have direct access. Hosted users can request read-only API credentials scoped to their data.
              </p>
              <div class="bg-gray-900 rounded-lg p-4 overflow-x-auto">
                <pre class="text-sm text-gray-100"><code>{`# rclone — sync everything to a local folder
rclone sync wc:wedding-computer-storage/vendors/YOUR_ID/ ./my-data/

# AWS CLI — download a single contact
aws s3 cp s3://wedding-computer-storage/vendors/YOUR_ID/contacts/sarah-smith.md . \\
  --endpoint-url https://YOUR_ACCOUNT.r2.cloudflarestorage.com`}</code></pre>
              </div>
            </div>

            <div>
              <h3 class="font-bold text-sm mb-2">Scripting your data</h3>
              <p class="text-sm text-gray-600 mb-3">
                Files follow the <a href="/standard" class="text-horizon-700 font-bold hover:underline">Wedding CRM Markdown Standard</a>.
                Parse the YAML frontmatter with any language:
              </p>
              <div class="bg-gray-900 rounded-lg p-4 overflow-x-auto">
                <pre class="text-sm text-gray-100"><code>{`# Python — list all quoted contacts
import yaml
from pathlib import Path

for f in Path("contacts").glob("*.md"):
    parts = f.read_text().split("---", 2)
    data = yaml.safe_load(parts[1])
    if data.get("status") == "quoted":
        print(f"{data['first_name']} {data['last_name']}")`}</code></pre>
              </div>
            </div>

            <div>
              <h3 class="font-bold text-sm mb-2">Self-hosting</h3>
              <p class="text-sm text-gray-600">
                Wedding Computer is open source (AGPL-3.0). Self-host it on your own Cloudflare account
                and you have direct access to the R2 bucket, D1 database, and all files. See the{' '}
                <a href="https://github.com/joshwithers/wedding-computer" class="text-horizon-700 font-bold hover:underline">GitHub repo</a> for
                setup instructions.
              </p>
            </div>
          </div>
        </details>

        {/* CTA */}
        <div class="bg-horizon-600 rounded-2xl p-6 sm:p-10 text-center text-white">
          <h2 class="text-xl sm:text-2xl font-bold mb-3">Your data, always yours</h2>
          <p class="text-white mb-6 max-w-md mx-auto text-sm">
            Start using Wedding Computer. Connect GitHub. And never worry about losing your data again.
          </p>
          <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="/login"
              class="inline-block bg-white text-horizon-700 font-bold px-6 py-3 rounded-xl hover:bg-horizon-50 transition-colors text-sm"
            >
              Get started free
            </a>
            <a
              href="/standard"
              class="inline-block bg-horizon-500 text-white font-bold px-6 py-3 rounded-xl hover:bg-horizon-400 transition-colors text-sm"
            >
              Read the open standard
            </a>
          </div>
        </div>
      </div>
    </MarketingLayout>
  )
})

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
    <svg class="w-5 h-5 text-horizon-600 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" role="img" aria-label="Included"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
  )
}

function PlanRow({ feature, free, pro }: { feature: string; free?: boolean; pro?: boolean }) {
  return (
    <tr class="border-t border-gray-100">
      <td class="py-3 px-4 text-gray-700">{feature}</td>
      <td class="py-3 px-2 text-center">{free ? <PlanCheck /> : <span class="text-gray-300" aria-label="Not included">—</span>}</td>
      <td class="py-3 px-2 text-center">{pro ? <PlanCheck /> : <span class="text-gray-300" aria-label="Not included">—</span>}</td>
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
      <p class="text-xs font-bold text-horizon-700 mb-1">How collaboration makes it better</p>
      <p class="text-xs text-gray-700 leading-relaxed">{children}</p>
    </div>
  )
}

function FeatureCard({ color, icon, title, desc }: { color: 'horizon' | 'grapefruit'; icon: string; title: string; desc: string }) {
  const bg = color === 'horizon' ? 'bg-horizon-50' : 'bg-grapefruit-50'
  const iconBg = color === 'horizon' ? 'bg-horizon-100' : 'bg-grapefruit-100'
  const iconColor = color === 'horizon' ? 'text-horizon-600' : 'text-grapefruit-600'
  return (
    <div class={`${bg} rounded-2xl p-5 sm:p-6`}>
      <div class={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl ${iconBg} flex items-center justify-center mb-3 sm:mb-4`}>
        <div class={`w-5 h-5 ${iconColor}`} dangerouslySetInnerHTML={{ __html: featureIcons[icon] }} />
      </div>
      <h3 class="font-bold text-gray-900 mb-1.5">{title}</h3>
      <p class="text-sm text-gray-600 leading-relaxed">{desc}</p>
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
  opensource: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 22h2a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v3"/><path d="M14 2v6h6"/><path d="m5 17 3-3-3-3"/><path d="M9 18h4"/></svg>',
  couple: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
  notifications: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  plaintext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
  import: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
  runsheet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/></svg>',
  mcp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6"/><path d="M9 13h4"/><circle cx="7" cy="9" r="0.5" fill="currentColor"/><circle cx="7" cy="13" r="0.5" fill="currentColor"/><path d="M15 17l2-2-2-2"/></svg>',
}
