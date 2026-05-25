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
            Free forever
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
          <div class="grid sm:grid-cols-3 gap-6">
            <FeatureCard
              color="horizon"
              title="CRM & pipeline"
              desc="Track every lead from first enquiry to booked. Move contacts through your pipeline with a click."
            />
            <FeatureCard
              color="grapefruit"
              title="Wedding collaboration"
              desc="Share a wedding workspace with couples and other vendors. Everyone stays in sync."
            />
            <FeatureCard
              color="horizon"
              title="Calendar & availability"
              desc="Set your availability, sync with Google Calendar, and never double-book again."
            />
          </div>
        </section>

        <section class="py-8 sm:py-16">
          <div class="grid sm:grid-cols-3 gap-6">
            <FeatureCard
              color="grapefruit"
              title="Invoicing"
              desc="Send professional invoices via Stripe. Get paid faster with online payments."
            />
            <FeatureCard
              color="horizon"
              title="AI-powered emails"
              desc="Draft personalised responses to enquiries in seconds. Your voice, powered by AI."
            />
            <FeatureCard
              color="grapefruit"
              title="Open source"
              desc="Built in the open under AGPL-3.0. Self-host or use our managed version. Your data is yours."
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
      <div class="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <h1 class="text-2xl sm:text-4xl font-bold mb-4 sm:mb-6">About Wedding Computer</h1>
        <div class="space-y-4 text-gray-600 leading-relaxed">
          <p>
            Wedding Computer is built by people who work in weddings and understand the
            daily friction of managing a wedding business — scattered inboxes, manual
            spreadsheets, and endless back-and-forth.
          </p>
          <p>
            We're building the tool we wished existed: a single workspace where vendors,
            couples, and venues can collaborate on the wedding from first enquiry to
            the big day.
          </p>
          <p>
            The project is open source under the AGPL-3.0 license. We believe the wedding
            industry deserves better tools, and that building in the open is the best way
            to get there.
          </p>
        </div>
      </div>
    </MarketingLayout>
  )
})

marketing.get('/pricing', (c) => {
  return c.html(
    <MarketingLayout title="Pricing">
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-16 text-center">
        <h1 class="text-2xl sm:text-4xl font-bold mb-4">Free, forever</h1>
        <p class="text-gray-600 mb-12">
          Everyone deserves a great CRM. Optional add-ons available down the road.
        </p>
        <div class="bg-white rounded-2xl sm:rounded-3xl border-2 border-horizon-600/20 p-6 sm:p-10 max-w-sm mx-auto shadow-lg shadow-horizon/5">
          <p class="text-4xl sm:text-5xl font-bold mb-2">$0</p>
          <p class="text-sm text-gray-500 font-medium mb-1">per month, forever</p>
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

function FeatureCard({ color, title, desc }: { color: 'horizon' | 'grapefruit'; title: string; desc: string }) {
  const bg = color === 'horizon' ? 'bg-horizon-50' : 'bg-grapefruit-50'
  const dot = color === 'horizon' ? 'bg-horizon' : 'bg-grapefruit'
  return (
    <div class={`${bg} rounded-2xl p-6`}>
      <div class={`w-2.5 h-2.5 ${dot} rounded-full mb-4`} />
      <h3 class="font-bold text-gray-900 mb-2">{title}</h3>
      <p class="text-sm text-gray-600 leading-relaxed">{desc}</p>
    </div>
  )
}
