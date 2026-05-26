import { Hono } from 'hono'
import type { Env } from '../types'
import { MarketingLayout } from '../views/layouts/marketing'

const marketing = new Hono<Env>()

marketing.get('/', (c) => {
  return c.html(
    <MarketingLayout>
      <div class="max-w-5xl mx-auto px-4 sm:px-6">
        {/* Hero */}
        <section class="py-12 sm:py-16 lg:py-24 text-center">
          <div class="inline-block bg-horizon-50 text-horizon-700 font-semibold text-sm px-4 py-1.5 rounded-full mb-4 sm:mb-6">
            Free
          </div>
          <h1 class="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-4 sm:mb-6">
            Run your wedding<br />
            business from<br />
            <span class="text-horizon-700">one place</span>
          </h1>
          <p class="text-base sm:text-lg text-gray-600 max-w-xl mx-auto mb-6 sm:mb-10 leading-relaxed">
            CRM, calendar, invoicing, and collaboration — built for the
            people who make weddings happen.
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
              class="text-gray-600 px-6 py-3.5 rounded-xl text-sm font-bold hover:text-horizon-700 transition-colors"
            >
              Learn more
            </a>
          </div>
        </section>

        {/* Features */}
        <section class="py-8 sm:py-16">
          <h2 class="text-xl sm:text-2xl font-bold text-center mb-3">Everything you need to run your wedding business</h2>
          <p class="text-center text-gray-500 text-sm mb-8 sm:mb-12 max-w-lg mx-auto">For vendors, couples, and everyone in between.</p>
          <div class="grid sm:grid-cols-3 gap-4 sm:gap-6">
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
              title="Calendar & device sync"
              desc="Monthly calendar with availability settings. Sync to Apple Calendar via CalDAV, or share a read-only iCal feed with any app."
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
              desc="Shared workspace for each wedding. Invite couples and other vendors with role-based access. Vendor visibility controlled by the couple."
            />
            <FeatureCard
              color="grapefruit"
              icon="couple"
              title="Couple planner"
              desc="Couples get their own dashboard: vendor grid, live budget tracker, booking forms, and details — no spreadsheet required."
            />
            <FeatureCard
              color="horizon"
              icon="sync"
              title="CardDAV contact sync"
              desc="Sync your CRM contacts to your phone's native contacts app. Leads show up as real contacts with phone numbers, emails, and wedding notes."
            />
            <FeatureCard
              color="grapefruit"
              icon="data"
              title="Data you control"
              desc="Export all your data anytime. Delete your account completely. No lock-in, no dark patterns, no tracking cookies. Session cookies only."
            />
            <FeatureCard
              color="horizon"
              icon="opensource"
              title="Open source"
              desc="Built in the open under AGPL-3.0. Audit the code, self-host it, or contribute. Runs on Cloudflare Workers at the edge, globally."
            />
            <FeatureCard
              color="grapefruit"
              icon="notifications"
              title="Smart notifications"
              desc="Email notifications for new enquiries, booking confirmations, couple joins, vendor updates. Professional branded HTML — not plain text."
            />
          </div>
        </section>

        {/* CTA */}
        <section class="py-8 sm:py-16">
          <div class="bg-horizon-600 rounded-2xl sm:rounded-3xl p-6 sm:p-12 text-center text-white">
            <h2 class="text-2xl sm:text-3xl font-bold mb-4">Ready to simplify your wedding business?</h2>
            <p class="text-horizon-100 mb-6 sm:mb-8 max-w-md mx-auto">
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
            It's free to use, it's open source, and it's built by people who work in weddings.
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
            When a vendor books a lead, a shared wedding workspace is created. The vendor is the owner. They invite
            the couple (who get the couple dashboard) and other vendors (who get scoped access to the wedding).
          </p>
          <p>
            Roles control who sees what. Owners have full control. Vendors see details relevant to their service.
            Couples see their vendors, budget, and timeline. Nobody sees more than they should.
          </p>
          <p>
            Couples can also create their own wedding and invite vendors — perfect for DIY weddings or
            when the couple is driving the planning process.
          </p>
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
            title="D1 (SQLite at the edge)"
            desc="All data lives in Cloudflare D1 — a globally-replicated SQLite database. Fast reads everywhere, consistent writes, and full SQL support. The schema uses 24-character hex IDs, ISO 8601 timestamps, and explicit tenant-scoping on every query. No unscoped database access exists in the codebase."
          />
          <AboutFeature
            title="CardDAV and CalDAV servers (RFC 6352 / RFC 4791)"
            desc="Full DAV servers built from scratch, not a library. CardDAV serves your contacts as vCard 3.0 with proper line folding (byte-level, not character-level) and UTF-8 support. CalDAV serves calendar events as iCalendar with timezone-aware DTSTART/DTEND properties. Both support PROPFIND discovery, REPORT multiget, and individual resource GET. ETags from row timestamps, CTags from SHA-256 of count + max(updated_at). Read-only by design — write operations return 403."
          />
          <AboutFeature
            title="Authentication without passwords"
            desc="Magic links via email and Google/Apple OAuth. No passwords means no credential stuffing, no password reuse, no bcrypt CPU cost, no password reset flows. Session tokens are 32-byte random values stored in Cloudflare KV with 30-day rolling TTL. CSRF protection on every state-changing request. New session ID on every login to prevent fixation."
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
            <a href="https://github.com/weddingcomputer/wedding-computer" class="text-horizon-700 font-bold hover:underline">View the source on GitHub</a>
          </p>
        </div>

        {/* CTA */}
        <div class="bg-horizon-600 rounded-2xl p-6 sm:p-10 text-center text-white">
          <h2 class="text-xl sm:text-2xl font-bold mb-3">Ready to try it?</h2>
          <p class="text-horizon-100 mb-6 max-w-md mx-auto text-sm">
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
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-16 text-center">
        <h1 class="text-2xl sm:text-4xl font-bold mb-4">Free to use</h1>
        <p class="text-gray-600 mb-12">
          Everything you need to run your wedding business, at no cost.
        </p>
        <div class="bg-white rounded-2xl sm:rounded-3xl border-2 border-horizon-600/20 p-6 sm:p-10 max-w-sm mx-auto shadow-lg shadow-horizon/5">
          <p class="text-4xl sm:text-5xl font-bold mb-2">$0</p>
          <p class="text-sm text-gray-500 font-medium mb-1">per month</p>
          <p class="text-sm text-gray-600 mb-8">
            CRM, calendar, invoicing, and collaboration. No credit card, no catch.
          </p>
          <a
            href="/login"
            class="block bg-horizon-600 text-white py-3 px-4 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            Get started
          </a>
        </div>
      </div>
    </MarketingLayout>
  )
})

export default marketing

function AboutFeature({ title, desc }: { title: string; desc: string }) {
  return (
    <div class="bg-white border border-papaya-300/30 rounded-xl p-4">
      <h3 class="font-bold text-gray-900 text-sm mb-1">{title}</h3>
      <p class="text-sm text-gray-600 leading-relaxed">{desc}</p>
    </div>
  )
}

function FeatureCard({ color, icon, title, desc }: { color: 'horizon' | 'grapefruit'; icon: string; title: string; desc: string }) {
  const bg = color === 'horizon' ? 'bg-horizon-50' : 'bg-grapefruit-50'
  const iconColor = color === 'horizon' ? 'text-horizon-600' : 'text-grapefruit-600'
  return (
    <div class={`${bg} rounded-2xl p-6`}>
      <div class={`w-10 h-10 mb-4 ${iconColor}`} dangerouslySetInnerHTML={{ __html: featureIcons[icon] }} />
      <h3 class="font-bold text-gray-900 mb-2">{title}</h3>
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
  data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
  opensource: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 22h2a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v3"/><path d="M14 2v6h6"/><path d="m5 17 3-3-3-3"/><path d="M9 18h4"/></svg>',
  couple: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
  notifications: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
}
