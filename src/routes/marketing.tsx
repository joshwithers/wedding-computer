import { Hono } from 'hono'
import type { Env } from '../types'
import { MarketingLayout } from '../views/layouts/marketing'

const marketing = new Hono<Env>()

// Cache marketing pages at the edge — content rarely changes
marketing.use('*', async (c, next) => {
  await next()
  if (c.res.status === 200 && c.req.method === 'GET') {
    c.res.headers.set('Cache-Control', 'public, max-age=300, s-maxage=3600')
  }
})

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
              icon="analytics"
              title="Business analytics"
              desc="Track enquiries, bookings, revenue, and conversion rates. Set goals for the year and measure yourself against industry benchmarks."
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
              title="Plain text files"
              desc="Your contacts and weddings are stored as plain text markdown files with YAML frontmatter. Open them in any text editor, sync with Obsidian, or build your own tools. Your data outlives any app."
            />
          </div>
        </section>

        {/* Data philosophy */}
        <section class="py-10 sm:py-16">
          <div class="bg-white border border-papaya-300/30 rounded-2xl sm:rounded-3xl p-6 sm:p-10 lg:p-12">
            <div class="max-w-2xl mx-auto text-center">
              <div class="w-12 h-12 rounded-2xl bg-horizon-50 flex items-center justify-center mx-auto mb-4">
                <div class="w-6 h-6 text-horizon-600" dangerouslySetInnerHTML={{ __html: featureIcons.plaintext }} />
              </div>
              <h2 class="text-xl sm:text-2xl font-bold mb-3">Your data should outlive any app</h2>
              <p class="text-gray-600 leading-relaxed mb-4">
                Wedding Computer stores your contacts and weddings as plain text markdown files — the same
                format used by Wikipedia, GitHub, and millions of writers worldwide. No proprietary database
                lock-in. No export button that gives you a useless ZIP file. Your data is always readable,
                always yours, and will still make sense in 50 years.
              </p>
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
            It's free to start, open source, and built by people who work in weddings.
            Couples use it free forever. Vendors get a generous free tier with all the core tools,
            and can unlock analytics, benchmarking, and AI features with a Pro plan for $14/month.
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
              <PricingFeature text="Calendar with CalDAV/iCal sync" />
              <PricingFeature text="Invoicing with Stripe Connect" />
              <PricingFeature text="Built-in email" />
              <PricingFeature text="Wedding workspaces" />
              <PricingFeature text="Couple planner dashboard" />
              <PricingFeature text="CardDAV contact sync" />
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
            <p class="text-4xl font-bold mb-1">$14</p>
            <p class="text-sm text-gray-500 mb-6">per month</p>
            <ul class="space-y-2.5 text-sm text-gray-700 mb-8">
              <PricingFeature text="Everything in Free" bold />
              <PricingFeature text="Business analytics dashboard" />
              <PricingFeature text="Conversion funnel tracking" />
              <PricingFeature text="Revenue and source insights" />
              <PricingFeature text="Industry benchmarks" />
              <PricingFeature text="Business goals and targets" />
              <PricingFeature text="AI email drafting" />
              <PricingFeature text="AI-powered recommendations" />
            </ul>
            <a
              href="/login"
              class="block text-center bg-horizon-600 text-white py-3 px-4 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors shadow-lg shadow-horizon/20"
            >
              Start with Pro
            </a>
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
      sarah-james-2026-12-15.md
      smith-wilson-wedding.md`}</code></pre>
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
          <p class="text-horizon-100 mb-6 max-w-md mx-auto text-sm">
            If you're building wedding software, adopt this format. Your users will thank you.
          </p>
          <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="https://github.com/weddingcomputer/wedding-computer"
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
    <MarketingLayout title="Accessing Your Plain Text Files">
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <div class="inline-block bg-horizon-50 text-horizon-700 font-semibold text-sm px-4 py-1.5 rounded-full mb-4">
          Documentation
        </div>
        <h1 class="text-2xl sm:text-4xl font-bold mb-4 sm:mb-6">Accessing your plain text files</h1>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-12">
          <p>
            Every contact and wedding in Wedding Computer is stored as a plain text markdown file. These
            aren't exports or copies — they're the real, canonical data. The app reads and writes these
            files directly.
          </p>
          <p>
            This page explains every way you can access, read, edit, and back up your files outside of
            Wedding Computer. You don't need our permission, and you don't need to ask.
          </p>
        </div>

        {/* Overview */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Where your files live</h2>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-8">
          <p>
            Your files are stored on <a href="https://developers.cloudflare.com/r2/" class="text-horizon-700 font-bold hover:underline">Cloudflare R2</a>,
            which is an S3-compatible object storage service. Each vendor has their own directory:
          </p>
        </div>
        <div class="bg-gray-900 rounded-xl p-4 sm:p-6 mb-8 overflow-x-auto">
          <pre class="text-sm text-gray-100 leading-relaxed"><code>{`vendors/
  your-vendor-id/
    contacts/
      sarah-smith.md
      john-doe.md
      jane-wilson-james-brown.md
    weddings/
      sarah-james-2026-12-15.md
      doe-wedding.md`}</code></pre>
        </div>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-12">
          <p>
            Each file follows the{' '}
            <a href="/standard" class="text-horizon-700 font-bold hover:underline">Wedding CRM Markdown Standard</a> —
            YAML frontmatter for structured data, markdown body for notes.
          </p>
        </div>

        {/* Method 1: Data Export */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Method 1: Data export from the app</h2>
        <p class="text-gray-500 text-sm mb-6">The simplest way. No technical knowledge required.</p>
        <div class="space-y-3 mb-12">
          <AboutFeature
            title="Export all your data"
            desc={"Go to Settings, scroll to Data Export, and click Export All Data. You'll receive a JSON file containing every contact and wedding, plus the raw markdown source for each. This is a complete backup of everything in your account."}
          />
          <AboutFeature
            title="What you get"
            desc="The export contains contacts (with all fields, notes, tags, form data), weddings (with all details and timeline notes), and your vendor profile settings. It's a standard JSON file that any programming language can read."
          />
          <AboutFeature
            title="How often to export"
            desc="Export whenever you want a backup. There are no limits. We recommend exporting before making bulk changes, and keeping a regular backup (monthly, quarterly — whatever suits you)."
          />
        </div>

        {/* Method 2: Cloudflare R2 API */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Method 2: Cloudflare R2 API (S3-compatible)</h2>
        <p class="text-gray-500 text-sm mb-6">For developers and power users. Full programmatic access.</p>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-8">
          <p>
            Cloudflare R2 is S3-compatible, which means any tool that works with Amazon S3 also works with R2.
            This includes the AWS CLI, Cyberduck, rclone, s3cmd, and every S3 SDK in every programming language.
          </p>
          <p>
            To access your files directly, you'll need R2 API credentials. If you're self-hosting Wedding Computer,
            you already have these. If you're using the hosted version, contact us and we'll provision
            read-only credentials scoped to your vendor directory.
          </p>
        </div>

        <div class="bg-white border border-papaya-300/30 rounded-xl p-4 sm:p-6 mb-6">
          <h3 class="font-bold text-sm mb-3">Using rclone (recommended for non-developers)</h3>
          <p class="text-sm text-gray-600 mb-4">
            <a href="https://rclone.org/" class="text-horizon-700 font-bold hover:underline">rclone</a> is a free,
            open-source tool for syncing files to and from cloud storage. It works on macOS, Windows, and Linux.
          </p>
          <div class="bg-gray-900 rounded-lg p-4 overflow-x-auto">
            <pre class="text-sm text-gray-100"><code>{`# Install rclone
brew install rclone    # macOS
# or visit rclone.org/downloads for Windows/Linux

# Configure your R2 remote (one-time setup)
rclone config
# Choose: New remote → name it "wc" → type "s3"
# Provider: Cloudflare → enter your R2 credentials

# List your contacts
rclone ls wc:wedding-computer-storage/vendors/YOUR_ID/contacts/

# Download all your files to a local folder
rclone sync wc:wedding-computer-storage/vendors/YOUR_ID/ ./my-wedding-data/

# Set up automatic daily sync
# (add to crontab or Windows Task Scheduler)
rclone sync wc:wedding-computer-storage/vendors/YOUR_ID/ ~/wedding-backup/`}</code></pre>
          </div>
        </div>

        <div class="bg-white border border-papaya-300/30 rounded-xl p-4 sm:p-6 mb-6">
          <h3 class="font-bold text-sm mb-3">Using the AWS CLI</h3>
          <div class="bg-gray-900 rounded-lg p-4 overflow-x-auto">
            <pre class="text-sm text-gray-100"><code>{`# Configure for R2
aws configure --profile wc
# Enter your R2 Access Key ID and Secret Access Key
# Region: auto
# Output: json

# List contacts
aws s3 ls s3://wedding-computer-storage/vendors/YOUR_ID/contacts/ \\
  --endpoint-url https://YOUR_ACCOUNT.r2.cloudflarestorage.com \\
  --profile wc

# Download a single contact
aws s3 cp s3://wedding-computer-storage/vendors/YOUR_ID/contacts/sarah-smith.md . \\
  --endpoint-url https://YOUR_ACCOUNT.r2.cloudflarestorage.com \\
  --profile wc

# Sync everything locally
aws s3 sync s3://wedding-computer-storage/vendors/YOUR_ID/ ./backup/ \\
  --endpoint-url https://YOUR_ACCOUNT.r2.cloudflarestorage.com \\
  --profile wc`}</code></pre>
          </div>
        </div>

        <div class="bg-white border border-papaya-300/30 rounded-xl p-4 sm:p-6 mb-12">
          <h3 class="font-bold text-sm mb-3">Using Cyberduck (graphical, macOS/Windows)</h3>
          <p class="text-sm text-gray-600 mb-3">
            <a href="https://cyberduck.io/" class="text-horizon-700 font-bold hover:underline">Cyberduck</a> is
            a free file browser for cloud storage. Drag and drop, just like Finder.
          </p>
          <div class="text-sm text-gray-600 space-y-2">
            <p>1. Download Cyberduck from cyberduck.io</p>
            <p>2. Click "Open Connection" → choose "Amazon S3"</p>
            <p>3. Server: <code class="bg-gray-100 px-1.5 py-0.5 rounded">YOUR_ACCOUNT.r2.cloudflarestorage.com</code></p>
            <p>4. Enter your R2 Access Key ID and Secret Access Key</p>
            <p>5. Navigate to <code class="bg-gray-100 px-1.5 py-0.5 rounded">wedding-computer-storage/vendors/YOUR_ID/</code></p>
            <p>6. Browse, download, or drag files to your desktop</p>
          </div>
        </div>

        {/* Method 3: Obsidian */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Method 3: Obsidian</h2>
        <p class="text-gray-500 text-sm mb-6">For people who love plain text notes.</p>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-8">
          <p>
            <a href="https://obsidian.md/" class="text-horizon-700 font-bold hover:underline">Obsidian</a> is
            a free note-taking app that works with local markdown files. Since Wedding Computer stores
            data as markdown with YAML frontmatter, Obsidian reads it natively.
          </p>
        </div>
        <div class="space-y-3 mb-12">
          <AboutFeature
            title="Step 1: Sync files locally"
            desc="Use rclone (described above) to sync your Wedding Computer files to a local folder. Set it to run automatically — every hour, every day, whatever suits you."
          />
          <AboutFeature
            title="Step 2: Open as an Obsidian vault"
            desc='Open Obsidian → "Open folder as vault" → select the folder where your files sync to. Obsidian will show your contacts and weddings in the sidebar, with YAML frontmatter rendered as properties.'
          />
          <AboutFeature
            title="Step 3: Browse and search"
            desc="Use Obsidian's search to find contacts by name, email, or any field. Use Dataview plugin to build custom views — e.g. 'show all contacts with status: quoted' or 'weddings in the next 3 months'."
          />
          <AboutFeature
            title="A note on editing"
            desc="If you edit files in Obsidian and sync them back to R2, Wedding Computer will pick up the changes on next sync. The app uses ETags to detect file changes. However, be careful with concurrent edits — if you and the app edit the same file at the same time, the last write wins."
          />
        </div>

        {/* Method 4: Any text editor */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Method 4: Any text editor</h2>
        <p class="text-gray-500 text-sm mb-6">It's just text. Open it in anything.</p>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-8">
          <p>
            Once you've synced your files locally (via rclone, the AWS CLI, Cyberduck, or the data
            export), you can open them in literally any text editor:
          </p>
          <ul class="list-disc list-inside space-y-1.5">
            <li><strong>VS Code</strong> — excellent markdown preview, YAML syntax highlighting</li>
            <li><strong>Sublime Text</strong> — fast, lightweight, handles thousands of files</li>
            <li><strong>Notepad</strong> (Windows) / <strong>TextEdit</strong> (macOS) — they're just text files</li>
            <li><strong>vim / nano</strong> — if you're into that</li>
            <li><strong>iA Writer</strong> — beautiful markdown editor with YAML support</li>
          </ul>
          <p>
            There's no special software required. No plugin, no viewer, no converter. The files
            are UTF-8 text with a <code class="bg-gray-100 px-1.5 py-0.5 rounded">.md</code> extension.
          </p>
        </div>

        <div class="bg-white border border-papaya-300/30 rounded-xl p-4 sm:p-6 mb-12">
          <h3 class="font-bold text-sm mb-3">What a contact looks like in a text editor</h3>
          <div class="bg-gray-900 rounded-lg p-4 overflow-x-auto">
            <pre class="text-sm text-gray-100"><code>{`---
id: a1b2c3d4e5f6a1b2c3d4e5f6
first_name: Sarah
last_name: Smith
email: sarah@example.com
phone: "0400 123 456"
status: quoted
wedding_date: 2026-12-15
tags:
  - vip
  - referral
created_at: 2025-06-01T00:00:00.000Z
updated_at: 2025-06-01T00:00:00.000Z
---

Met at the Bridal Expo. Very enthusiastic about
an elopement ceremony at the Royal Botanic Garden.

Budget: $3,000 - $5,000`}</code></pre>
          </div>
          <p class="text-sm text-gray-500 mt-3">
            That's it. No binary format, no encoding, no special reader required. Just text.
          </p>
        </div>

        {/* Method 5: Build your own tools */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Method 5: Build your own tools</h2>
        <p class="text-gray-500 text-sm mb-6">For developers who want to build on top of their data.</p>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-8">
          <p>
            Because the files follow an <a href="/standard" class="text-horizon-700 font-bold hover:underline">open standard</a>,
            you can write scripts and applications that read, query, and transform your data.
          </p>
        </div>

        <div class="bg-white border border-papaya-300/30 rounded-xl p-4 sm:p-6 mb-6">
          <h3 class="font-bold text-sm mb-3">Python example: list all quoted contacts</h3>
          <div class="bg-gray-900 rounded-lg p-4 overflow-x-auto">
            <pre class="text-sm text-gray-100"><code>{`import yaml
from pathlib import Path

contacts_dir = Path("./my-wedding-data/contacts")

for file in contacts_dir.glob("*.md"):
    text = file.read_text()
    # Split frontmatter from body
    parts = text.split("---", 2)
    if len(parts) >= 3:
        frontmatter = yaml.safe_load(parts[1])
        if frontmatter.get("status") == "quoted":
            name = f"{frontmatter['first_name']} {frontmatter['last_name']}"
            email = frontmatter.get("email", "no email")
            print(f"{name} ({email})")`}</code></pre>
          </div>
        </div>

        <div class="bg-white border border-papaya-300/30 rounded-xl p-4 sm:p-6 mb-6">
          <h3 class="font-bold text-sm mb-3">JavaScript/Node example: upcoming weddings</h3>
          <div class="bg-gray-900 rounded-lg p-4 overflow-x-auto">
            <pre class="text-sm text-gray-100"><code>{`import { readdir, readFile } from 'fs/promises'
import { parse } from 'yaml'

const files = await readdir('./my-wedding-data/weddings')

for (const file of files.filter(f => f.endsWith('.md'))) {
  const text = await readFile(\`./my-wedding-data/weddings/\${file}\`, 'utf8')
  const [, frontmatter] = text.split('---')
  const data = parse(frontmatter)

  if (data.date && new Date(data.date) > new Date()) {
    console.log(\`\${data.title} — \${data.date} at \${data.location}\`)
  }
}`}</code></pre>
          </div>
        </div>

        <div class="bg-white border border-papaya-300/30 rounded-xl p-4 sm:p-6 mb-12">
          <h3 class="font-bold text-sm mb-3">Shell example: count contacts by status</h3>
          <div class="bg-gray-900 rounded-lg p-4 overflow-x-auto">
            <pre class="text-sm text-gray-100"><code>{`# Count contacts by pipeline stage
grep -l "status: new" contacts/*.md | wc -l
grep -l "status: quoted" contacts/*.md | wc -l
grep -l "status: booked" contacts/*.md | wc -l

# Find all contacts with a specific tag
grep -l "- vip" contacts/*.md

# Find all weddings in December 2026
grep -l "date: 2026-12" weddings/*.md`}</code></pre>
          </div>
        </div>

        {/* Method 6: Git */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Method 6: Version control with Git</h2>
        <p class="text-gray-500 text-sm mb-6">Track every change, forever.</p>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-8">
          <p>
            Because the files are plain text, they work beautifully with Git. Every change is a
            meaningful diff — you can see exactly what changed, when, and (with commit messages) why.
          </p>
        </div>
        <div class="bg-white border border-papaya-300/30 rounded-xl p-4 sm:p-6 mb-12">
          <div class="bg-gray-900 rounded-lg p-4 overflow-x-auto">
            <pre class="text-sm text-gray-100"><code>{`# Initialise a repo in your synced folder
cd my-wedding-data
git init
git add .
git commit -m "Initial backup of wedding data"

# After each sync, commit changes
rclone sync wc:wedding-computer-storage/vendors/YOUR_ID/ .
git add .
git commit -m "Sync $(date +%Y-%m-%d)"

# Now you have full version history
git log --oneline contacts/sarah-smith.md
# See exactly what changed in a contact
git diff HEAD~1 contacts/sarah-smith.md`}</code></pre>
          </div>
          <p class="text-sm text-gray-500 mt-3">
            Push to a private GitHub or GitLab repo for off-site backup. Your entire CRM history
            in version control.
          </p>
        </div>

        {/* Method 7: CardDAV and CalDAV */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Bonus: CardDAV and CalDAV sync</h2>
        <p class="text-gray-500 text-sm mb-6">Your data also speaks standard protocols.</p>
        <div class="space-y-3 mb-12">
          <AboutFeature
            title="CardDAV: contacts on your phone"
            desc='Wedding Computer includes a CardDAV server (RFC 6352). Add it as a contacts account in Apple Contacts, and your CRM contacts appear as native phone contacts — with names, phone numbers, emails, and wedding notes. Go to Settings → CardDAV to get your server URL.'
          />
          <AboutFeature
            title="CalDAV / iCal: calendar events everywhere"
            desc="Your calendar events are available via iCal feed (read-only) for any calendar app, and CalDAV for two-way sync with Apple Calendar, Fantastical, or any CalDAV client. Go to Settings → Calendar to get your feed URL."
          />
          <AboutFeature
            title="Why this matters"
            desc="CardDAV and iCal are open standards from the 2000s. They'll work with any app that supports contacts or calendars — not just ours. Your data is accessible through multiple independent paths, using open protocols, stored in open formats."
          />
        </div>

        {/* Philosophy */}
        <h2 class="text-xl sm:text-2xl font-bold mb-3">Why we built it this way</h2>
        <div class="space-y-4 text-gray-600 leading-relaxed mb-12">
          <p>
            We believe your client relationships are too important to be trapped in someone else's
            database. Wedding vendors build their businesses over years — every lead, every note, every
            follow-up is part of that story. That data should belong to you, in a format you can read
            without our help.
          </p>
          <p>
            Plain text is the most durable file format ever created. A text file from 1970 is still
            perfectly readable today. We can't say the same about any proprietary database format,
            any SaaS export, or any binary file. By choosing markdown and YAML, we're choosing
            longevity over convenience.
          </p>
          <p>
            And by publishing the <a href="/standard" class="text-horizon-700 font-bold hover:underline">format as an open standard</a>,
            we're inviting the rest of the wedding industry to join us. If every wedding CRM spoke the same
            file format, switching tools would be as easy as pointing a new app at the same folder.
          </p>
          <p>
            That's the future we're building toward.
          </p>
        </div>

        {/* CTA */}
        <div class="bg-horizon-600 rounded-2xl p-6 sm:p-10 text-center text-white">
          <h2 class="text-xl sm:text-2xl font-bold mb-3">Your data, your way</h2>
          <p class="text-horizon-100 mb-6 max-w-md mx-auto text-sm">
            Start using Wedding Computer and your data is always yours — in plain text, accessible anywhere.
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
}
