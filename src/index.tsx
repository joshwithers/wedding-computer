import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { trimTrailingSlash } from 'hono/trailing-slash'
import type { Env } from './types'
import marketing from './routes/marketing'
import auth from './routes/auth'
import notify from './routes/notify'
import onboarding from './routes/onboarding'
import enquire from './routes/enquire'
import dashboard from './routes/vendor/dashboard'
import settings from './routes/vendor/settings'
import contacts from './routes/vendor/contacts'
import weddings from './routes/vendor/weddings'
import formEditor from './routes/vendor/form'
import calendarRoute from './routes/vendor/calendar'
import invoices from './routes/vendor/invoices'
import emailRoutes from './routes/vendor/emails'
import coupleRoute from './routes/couple'
import bookRoute from './routes/book'
import bookingFormRoute from './routes/vendor/booking-form'
import contractRoute from './routes/vendor/contracts'
import checklistsRoute from './routes/vendor/checklists'
import placesRoute from './routes/vendor/places'
import analyticsRoute from './routes/vendor/analytics'
import subscriptionRoute from './routes/vendor/subscription'
import teamRoute from './routes/vendor/team'
import importRoute from './routes/vendor/import'
import runSheetRoute from './routes/vendor/run-sheet'
import quotesRoute from './routes/vendor/quotes'
import accountRoute from './routes/account'
import adminRoute from './routes/admin'
import filesRoute from './routes/files'
import feed from './routes/feed'
import carddav from './routes/carddav'
import caldav from './routes/caldav'
import stripe from './routes/stripe'
import webhooks from './routes/webhooks'
import vaultApi from './routes/vault-api'
import mcpRoute from './routes/mcp'
import apiRoute from './routes/api'
import publicRoutes from './routes/public'
import formsRoute from './routes/vendor/forms'
import referRoute from './routes/vendor/refer'
import publicFormRoute from './routes/form'
import { authenticateVendor, basicAuthToken, CARDDAV_HEADERS, CALDAV_HEADERS, xmlResponse, escXml } from './lib/dav'
import { AuthLayout } from './views/layouts/auth'
import { getVendorWithEmail, getVendorById } from './db/vendors'
import { getContact } from './storage/contacts'
import { getStorageWithSecrets } from './storage'
import { StorageConflictError } from './storage/conflicts'
import { sendEmailMessage, EmailSendError, broadcastEmail, newLeadEmail, formSubmissionEmail, formNotificationEmail, formConfirmationEmail, enquiryConfirmationEmail, referralRewardEmail } from './services/email'
import { getBroadcast } from './db/broadcast'
import { handleInboundEmail } from './services/inbound-email'
import { notifyInvoiceSent, notifyVendorAdded, notifyCoupleJoined, notifyVisibilityChanged, notifyBookingConfirmed, notifyVendorRemoved, notifyVendorBooked, notifyWeddingDetailsUpdated, notifyPaymentReceived, notifyAdminSignup, notifyTimelineChangeRequested, notifyTimelineChangeDecided, runVendorDailyJobs, deliver, type NotifyEnv } from './services/notifications'
import { aggregateBusynessScores, aggregateDemandHistory } from './db/busyness'
import { geocodePendingLocations } from './services/geocode'
import { runWithI18n, resolveLocale } from './i18n'
import { runRetention } from './db/retention'
import { purgeExpiredAccounts } from './services/account'
import { logEvent } from './lib/log'
import { syncVendorStorage } from './services/storage-sync'

const app = new Hono<Env>()

// Every request runs inside an i18n context (AsyncLocalStorage) so t() and
// the date helpers work anywhere without prop-drilling. Seeded here from
// the public language preference cookie, then Accept-Language. The auth/tenant
// middleware refine it with the signed-in user's saved locale and timezone.
app.use((c, next) =>
  runWithI18n({ locale: resolveLocale(getCookie(c, 'wc_locale'), c.req.header('accept-language')) }, () => next())
)

// /app/ and friends: redirect trailing-slash 404s to the canonical path
app.use(trimTrailingSlash())

app.use('*', async (c, next) => {
  await next()

  const contentType = c.res.headers.get('Content-Type') ?? ''
  const isHtmx = c.req.header('hx-request') === 'true'
  if (!contentType.includes('text/html') || isHtmx) return

  const body = await c.res.clone().text()
  if (!body.startsWith('<html')) return

  const headers = new Headers(c.res.headers)
  headers.delete('Content-Length')
  c.res = new Response(`<!DOCTYPE html>${body}`, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  })
})

app.onError((err, c) => {
  const url = c.req.url
  const method = c.req.method
  const path = c.req.path
  const userAgent = c.req.header('user-agent') ?? 'unknown'
  const isHtmx = c.req.header('hx-request') === 'true'

  if (err instanceof StorageConflictError) {
    if (isHtmx) {
      return c.html(
        <div class="bg-papaya-100 border border-papaya-300/50 text-gray-700 text-sm rounded-xl p-3">
          This file changed in your connected storage before we could save. We kept both versions and recorded a conflict for review.
        </div>,
        409
      )
    }

    return c.html(
      <AuthLayout title="Storage conflict">
        <div class="bg-white rounded-2xl shadow-lg shadow-horizon/5 p-5 sm:p-8 text-center">
          <div class="text-4xl mb-4">409</div>
          <h2 class="text-xl font-bold mb-2">Storage conflict</h2>
          <p class="text-sm text-gray-500 mb-6">This file changed in your connected storage before we could save. We kept both versions and recorded a conflict for review.</p>
          <a href="/app" class="inline-block bg-horizon-600 text-white py-2.5 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
            Back to dashboard
          </a>
        </div>
      </AuthLayout>,
      409
    )
  }

  // Log full error details for debugging
  console.error(JSON.stringify({
    level: 'error',
    handler: 'onError',
    method,
    path,
    url,
    error: err.message,
    stack: err.stack?.split('\n').slice(0, 5).join(' | '),
    userAgent: userAgent.slice(0, 100),
    isHtmx,
  }))

  // For htmx partial requests, return a small error fragment
  if (isHtmx) {
    return c.html(
      <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-3">
        Something went wrong. Please reload the page and try again.
      </div>,
      500
    )
  }

  return c.html(
    <AuthLayout title="Error">
      <div class="bg-white rounded-2xl shadow-lg shadow-horizon/5 p-5 sm:p-8 text-center">
        <div class="text-4xl mb-4">500</div>
        <h2 class="text-xl font-bold mb-2">Something went wrong</h2>
        <p class="text-sm text-gray-500 mb-6">We hit an unexpected error. Please try again.</p>
        <a href="/app" class="inline-block bg-horizon-600 text-white py-2.5 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
          Back to dashboard
        </a>
      </div>
    </AuthLayout>,
    500
  )
})

// Health check
app.get('/health', (c) => c.json({ ok: true }))

// Agent Skills Discovery (RFC v0.2.0)
app.get('/.well-known/agent-skills/index.json', (c) =>
  c.json({
    $schema: 'https://agentskills.io/schema/index.json',
    skills: [
      {
        name: 'wedding-computer-mcp',
        type: 'mcp',
        description: 'Access contacts, weddings, checklists, calendar, and vendor credits via MCP. Returns plain text markdown.',
        url: 'https://wedding.computer/.well-known/mcp/server-card.json',
        sha256: '',
      },
      {
        name: 'wedding-computer-enquiry-api',
        type: 'openapi',
        description: 'Send a lead/enquiry into a vendor\'s CRM via JSON (POST /api/v1/enquiries). For webhooks, Zapier, and agents. Bearer enquiry intake key; Pro.',
        url: 'https://wedding.computer/api/v1',
        sha256: '',
      },
      {
        name: 'wedding-computer-carddav',
        type: 'protocol',
        description: 'Sync wedding contacts to Apple Contacts, Google Contacts, or any CardDAV client.',
        url: 'https://wedding.computer/.well-known/carddav',
        sha256: '',
      },
      {
        name: 'wedding-computer-caldav',
        type: 'protocol',
        description: 'Sync wedding calendar events to Apple Calendar, Google Calendar, or any CalDAV client.',
        url: 'https://wedding.computer/.well-known/caldav',
        sha256: '',
      },
      {
        name: 'wedding-computer-ical',
        type: 'protocol',
        description: 'Read-only iCal calendar feed (.ics) for subscribing in any calendar app.',
        url: 'https://wedding.computer/feed',
        sha256: '',
      },
      {
        name: 'wedding-computer-agent-discovery',
        type: 'metadata',
        description: 'Agent discovery endpoint with protocol listings and documentation links.',
        url: 'https://wedding.computer/.well-known/agent',
        sha256: '',
      },
    ],
  })
)

// API Catalog (RFC 9727)
app.get('/.well-known/api-catalog', (c) => {
  return new Response(JSON.stringify({
    linkset: [
      {
        anchor: 'https://wedding.computer/mcp',
        'service-desc': [{ href: 'https://wedding.computer/.well-known/mcp/server-card.json', type: 'application/json' }],
        'service-doc': [{ href: 'https://wedding.computer/auth.md', type: 'text/markdown' }],
        status: [{ href: 'https://wedding.computer/health', type: 'application/json' }],
      },
      {
        anchor: 'https://wedding.computer/api/v1/enquiries',
        'service-desc': [{ href: 'https://wedding.computer/api/v1', type: 'application/json' }],
        'service-doc': [{ href: 'https://wedding.computer/auth.md', type: 'text/markdown' }],
        status: [{ href: 'https://wedding.computer/health', type: 'application/json' }],
      },
      {
        anchor: 'https://wedding.computer/.well-known/carddav',
        'service-doc': [{ href: 'https://wedding.computer/docs/plain-text', type: 'text/html' }],
        status: [{ href: 'https://wedding.computer/health', type: 'application/json' }],
      },
      {
        anchor: 'https://wedding.computer/.well-known/caldav',
        'service-doc': [{ href: 'https://wedding.computer/docs/plain-text', type: 'text/html' }],
        status: [{ href: 'https://wedding.computer/health', type: 'application/json' }],
      },
      {
        anchor: 'https://wedding.computer/feed',
        'service-doc': [{ href: 'https://wedding.computer/docs/plain-text', type: 'text/html' }],
        status: [{ href: 'https://wedding.computer/health', type: 'application/json' }],
      },
    ],
  }), {
    headers: { 'Content-Type': 'application/linkset+json' },
  })
})

// OAuth Protected Resource metadata (RFC 9470)
app.get('/.well-known/oauth-protected-resource', (c) =>
  c.json({
    resource: 'https://wedding.computer',
    authorization_servers: ['https://wedding.computer'],
    bearer_methods_supported: ['header'],
    scopes_supported: ['read', 'enquiry:write'],
    resource_documentation: 'https://wedding.computer/auth.md',
    resource_signing_alg_values_supported: [],
  })
)

// OAuth Authorization Server metadata (with agent_auth extension)
app.get('/.well-known/oauth-authorization-server', (c) =>
  c.json({
    issuer: 'https://wedding.computer',
    token_endpoint: 'https://wedding.computer/login',
    token_endpoint_auth_methods_supported: ['none'],
    response_types_supported: ['token'],
    grant_types_supported: ['magic_link'],
    service_documentation: 'https://wedding.computer/auth.md',
    agent_auth: {
      register_uri: 'https://wedding.computer/login',
      identity_types: ['bearer_token'],
      credential_types: ['api_key'],
      claim_url: 'https://wedding.computer/app/settings',
      revocation_url: 'https://wedding.computer/app/settings',
      documentation_url: 'https://wedding.computer/auth.md',
      registration_instructions: 'Sign in at https://wedding.computer/login, then copy your sync token from Settings > Calendar & Sync.',
    },
  })
)

// MCP Server Card (SEP-1649)
app.get('/.well-known/mcp/server-card.json', (c) =>
  c.json({
    $schema: 'https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/mcp-server-card.schema.json',
    serverInfo: {
      name: 'wedding-computer',
      version: '1.0.0',
      title: 'Wedding Computer',
      description: 'Access your contacts, weddings, checklists, calendar, and vendor credits via MCP. Data returned as plain text markdown — the same format stored in your GitHub repo.',
    },
    transport: {
      type: 'streamable-http',
      url: 'https://wedding.computer/mcp',
      authentication: {
        type: 'bearer',
        instructions: 'Use your sync token from Settings > Calendar & Sync as the Bearer token.',
      },
    },
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
    tools: [
      { name: 'list_contacts', description: 'List all contacts with name, email, status, and wedding date.' },
      { name: 'get_contact', description: 'Get a contact as a markdown file by ID.' },
      { name: 'search_contacts', description: 'Search contacts by name, email, or status.' },
      { name: 'list_weddings', description: 'List all weddings with title, date, location, and status.' },
      { name: 'get_wedding', description: 'Get a wedding as a markdown file by ID.' },
      { name: 'get_wedding_todo', description: 'Get the checklist for a wedding.' },
      { name: 'get_wedding_log', description: 'Get the activity changelog for a wedding.' },
      { name: 'get_wedding_credits', description: 'Get vendor credits for Instagram, markdown, or HTML.' },
      { name: 'get_upcoming_events', description: 'Get calendar events for the next N days.' },
      { name: 'submit_enquiry', description: 'Create a new lead/enquiry in the CRM.' },
    ],
  })
)

// Public routes
app.route('/', marketing)
app.route('/', auth)
app.route('/', notify)
app.route('/', onboarding)
app.route('/', enquire)
app.route('/', bookRoute)
app.route('/', publicRoutes)
app.route('/', publicFormRoute)
app.route('/', feed)
app.route('/', stripe)
app.route('/', webhooks)
app.route('/', vaultApi)

// Authenticated vendor routes
app.route('/', dashboard)
app.route('/', settings)
app.route('/', contacts)
app.route('/', weddings)
app.route('/', formEditor)
app.route('/', calendarRoute)
app.route('/', invoices)
app.route('/', emailRoutes)
app.route('/', bookingFormRoute)
app.route('/', contractRoute)
app.route('/', checklistsRoute)
app.route('/', placesRoute)
app.route('/', analyticsRoute)
app.route('/', subscriptionRoute)
app.route('/', teamRoute)
app.route('/', importRoute)
app.route('/', runSheetRoute)
app.route('/', quotesRoute)
app.route('/', formsRoute)
app.route('/', referRoute)
app.route('/', accountRoute)
app.route('/', filesRoute)
app.route('/', coupleRoute)
app.route('/', adminRoute)

// ─── CardDAV + CalDAV ───

function cardDavDiscoveryXml(href: string, authHeader: string | undefined, db: D1Database) {
  return (async () => {
    const vendor = await authenticateVendor(db, authHeader)
    const rawToken = basicAuthToken(authHeader)
    if (!vendor || !rawToken) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>${escXml(href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal><D:href>/carddav/principals/user/</D:href></D:current-user-principal>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`, 207, CARDDAV_HEADERS)
    }
    const token = rawToken
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>${escXml(href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal><D:href>/carddav/principals/${escXml(token)}/</D:href></D:current-user-principal>
        <C:addressbook-home-set><D:href>/carddav/addressbooks/${escXml(token)}/</D:href></C:addressbook-home-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`, 207, CARDDAV_HEADERS)
  })()
}

function calDavDiscoveryXml(href: string, authHeader: string | undefined, db: D1Database) {
  return (async () => {
    const vendor = await authenticateVendor(db, authHeader)
    const rawToken = basicAuthToken(authHeader)
    if (!vendor || !rawToken) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>${escXml(href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal><D:href>/caldav/principals/user/</D:href></D:current-user-principal>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`, 207, CALDAV_HEADERS)
    }
    const token = rawToken
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>${escXml(href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal><D:href>/caldav/principals/${escXml(token)}/</D:href></D:current-user-principal>
        <C:calendar-home-set><D:href>/caldav/calendars/${escXml(token)}/</D:href></C:calendar-home-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`, 207, CALDAV_HEADERS)
  })()
}

// MCP server
app.route('/', mcpRoute)
app.route('/', apiRoute)

// Agent discovery (DNS-AID / well-known)
app.get('/.well-known/agent', (c) =>
  c.json({
    name: 'Wedding Computer',
    description: 'Wedding collaboration platform for vendors, venues, planners, and couples.',
    url: 'https://wedding.computer',
    protocols: {
      mcp: { endpoint: '/mcp', description: 'Model Context Protocol — AI agent access to contacts, weddings, checklists, calendar, and lead intake (submit_enquiry)', auth: 'Bearer token' },
      enquiry_api: { endpoint: '/api/v1/enquiries', method: 'POST', description: 'Send a lead/enquiry into a vendor\'s CRM (JSON). For webhooks, Zapier, and agents.', auth: 'Bearer enquiry intake key', catalog: '/api/v1' },
      carddav: { endpoint: '/.well-known/carddav', description: 'Contact sync via CardDAV' },
      caldav: { endpoint: '/.well-known/caldav', description: 'Calendar sync via CalDAV' },
      ical: { endpoint: '/feed/{token}.ics', description: 'Read-only calendar feed (iCal)' },
    },
    documentation: {
      homepage: 'https://wedding.computer/about',
      'open-format': 'https://wedding.computer/standard',
      'plain-text-data': 'https://wedding.computer/docs/plain-text',
      'obsidian-plugin': 'https://community.obsidian.md/plugins/wedding-computer-sync',
    },
    sitemap: 'https://wedding.computer/sitemap.xml',
  })
)

// CardDAV well-known discovery (unauthenticated initial probe, authenticated follow-up)
app.on('PROPFIND', '/.well-known/carddav', (c) =>
  cardDavDiscoveryXml('/.well-known/carddav', c.req.raw.headers.get('Authorization') ?? undefined, c.env.DB))
app.get('/.well-known/carddav', (c) => c.redirect('/carddav', 301))

// CalDAV well-known discovery
app.on('PROPFIND', '/.well-known/caldav', (c) =>
  calDavDiscoveryXml('/.well-known/caldav', c.req.raw.headers.get('Authorization') ?? undefined, c.env.DB))
app.get('/.well-known/caldav', (c) => c.redirect('/caldav', 301))

// Root PROPFIND probe — check body to determine if CardDAV or CalDAV
app.on('PROPFIND', '/', async (c) => {
  const body = await c.req.text()
  if (body.includes('urn:ietf:params:xml:ns:caldav') || body.includes('calendar-home-set')) {
    return calDavDiscoveryXml('/', c.req.raw.headers.get('Authorization') ?? undefined, c.env.DB)
  }
  return cardDavDiscoveryXml('/', c.req.raw.headers.get('Authorization') ?? undefined, c.env.DB)
})

// CardDAV/CalDAV with trailing slash — Hono sub-routers don't match the trailing slash
app.on('PROPFIND', '/carddav/', (c) =>
  cardDavDiscoveryXml('/carddav/', c.req.raw.headers.get('Authorization') ?? undefined, c.env.DB))
app.on('PROPFIND', '/caldav/', (c) =>
  calDavDiscoveryXml('/caldav/', c.req.raw.headers.get('Authorization') ?? undefined, c.env.DB))

// Mount DAV sub-routers
app.route('/carddav', carddav)
app.route('/caldav', caldav)

app.notFound((c) =>
  c.html(
    <AuthLayout title="Not found">
      <div class="bg-white rounded-2xl shadow-lg shadow-horizon/5 p-5 sm:p-8 text-center">
        <div class="text-4xl mb-4">404</div>
        <h2 class="text-xl font-bold mb-2">Page not found</h2>
        <p class="text-sm text-gray-500 mb-6">The page you're looking for doesn't exist or has moved.</p>
        <a href="/" class="inline-block bg-horizon-600 text-white py-2.5 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
          Go home
        </a>
      </div>
    </AuthLayout>,
    404
  )
)

function notifyEnv(env: Env['Bindings']): NotifyEnv {
  return { db: env.DB, resendApiKey: env.RESEND_API_KEY, appUrl: env.APP_URL, sessionSecret: env.SESSION_SECRET }
}

// Git vendors are swept across this many consecutive 5-minute ticks, so the
// background sync is a ~30-minute backstop (immediate pushes + GitHub
// webhooks handle real-time). This keeps per-tick fan-out volume ~1/N of the
// fleet. The shard for a tick is (tickIndex % N); a vendor's shard is a
// stable function of its id, so every vendor is covered exactly once per
// cycle regardless of N.
const SYNC_SHARD_COUNT = 6

/** Enqueue messages in batches of 100 (the sendBatch limit) so the cron's
 *  own subrequest budget isn't blown fanning out thousands of vendors. */
async function enqueueInBatches(env: Env['Bindings'], messages: { body: Record<string, string> }[]): Promise<void> {
  for (let i = 0; i < messages.length; i += 100) {
    await env.EMAIL_QUEUE.sendBatch(messages.slice(i, i + 100))
  }
}

async function enqueueStorageSyncJobs(env: Env['Bindings'], scheduledTime: number): Promise<number> {
  const shard = Math.floor(scheduledTime / 300000) % SYNC_SHARD_COUNT
  const vendors = await env.DB
    .prepare(
      `SELECT id FROM vendor_profiles
       WHERE storage_type = 'git' AND storage_config IS NOT NULL
         AND (unicode(substr(id, -1, 1)) % ?) = ?`
    )
    .bind(SYNC_SHARD_COUNT, shard)
    .all<{ id: string }>()
    .then((r) => r.results)
  await enqueueInBatches(env, vendors.map((v) => ({ body: { type: 'sync_vendor', vendorId: v.id } })))
  return vendors.length
}

async function enqueueVendorDailyJobs(env: Env['Bindings']): Promise<number> {
  const vendors = await env.DB
    .prepare('SELECT id FROM vendor_profiles')
    .all<{ id: string }>()
    .then((r) => r.results)
  await enqueueInBatches(env, vendors.map((v) => ({ body: { type: 'vendor_digest', vendorId: v.id } })))
  return vendors.length
}

export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch, env: Env['Bindings']): Promise<void> {
    for (const msg of batch.messages) {
      try {
        const body = msg.body as Record<string, string>

        if (body.type === 'new_lead') {
          const vendor = await getVendorWithEmail(env.DB, body.vendorId)
          if (!vendor) {
            console.error('[QUEUE] vendor not found', body.vendorId)
            msg.ack()
            continue
          }

          let lead: {
            contactName: string
            contactEmail: string
            contactPhone: string | null
            partnerName: string | null
            weddingDate: string | null
            weddingLocation: string | null
            message: string | null
          }
          if (body.contactFirst !== undefined) {
            // New format: fields embedded in the message (storage-independent).
            lead = {
              contactName: `${body.contactFirst} ${body.contactLast ?? ''}`.trim(),
              contactEmail: body.contactEmail || '',
              contactPhone: body.contactPhone || null,
              partnerName: [body.partnerFirst, body.partnerLast].filter(Boolean).join(' ') || null,
              weddingDate: body.weddingDate || null,
              weddingLocation: body.weddingLocation || null,
              message: body.message || null,
            }
          } else {
            // Legacy in-flight message: read the contact from storage.
            const storage = await getStorageWithSecrets(env, vendor)
            const contactResult = await getContact(storage, env.DB, body.vendorId, body.contactId)
            if (!contactResult) {
              console.error('[QUEUE] contact not found', body.contactId)
              msg.ack()
              continue
            }
            const contact = contactResult.contact
            lead = {
              contactName: `${contact.first_name} ${contact.last_name}`,
              contactEmail: contact.email ?? '',
              contactPhone: contact.phone,
              partnerName: [contact.partner_first_name, contact.partner_last_name].filter(Boolean).join(' ') || null,
              weddingDate: contact.wedding_date,
              weddingLocation: contact.wedding_location,
              message: contact.notes,
            }
          }

          const html = newLeadEmail({
            ...lead,
            appUrl: env.APP_URL,
            contactId: body.contactId,
          })

          const sent = await deliver(notifyEnv(env), {
            key: 'enquiries',
            recipient: { id: vendor.user_id, email: vendor.user_email, name: vendor.user_name, notification_prefs: vendor.user_notification_prefs },
            subject: `New enquiry from ${lead.contactName}`,
            html,
            vendorId: body.vendorId,
            contactId: body.contactId,
          })

          console.log('[QUEUE] new_lead email', sent ? 'sent to' : 'skipped for', vendor.user_email)
        } else if (body.type === 'notify_invoice_sent') {
          await notifyInvoiceSent(
            notifyEnv(env),
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_invoice_sent processed')

        } else if (body.type === 'notify_vendor_added_to_wedding') {
          await notifyVendorAdded(
            notifyEnv(env),
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_vendor_added_to_wedding processed')

        } else if (body.type === 'notify_couple_joined') {
          await notifyCoupleJoined(
            notifyEnv(env),
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_couple_joined processed')

        } else if (body.type === 'notify_visibility_changed') {
          await notifyVisibilityChanged(
            notifyEnv(env),
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_visibility_changed processed')

        } else if (body.type === 'notify_booking_confirmed') {
          await notifyBookingConfirmed(
            notifyEnv(env),
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_booking_confirmed processed')

        } else if (body.type === 'notify_vendor_removed') {
          await notifyVendorRemoved(
            notifyEnv(env),
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_vendor_removed processed')

        } else if (body.type === 'notify_vendor_booked') {
          await notifyVendorBooked(
            notifyEnv(env),
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_vendor_booked processed')

        } else if (body.type === 'notify_wedding_details_updated') {
          await notifyWeddingDetailsUpdated(
            notifyEnv(env),
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_wedding_details_updated processed')

        } else if (body.type === 'notify_timeline_change_requested') {
          await notifyTimelineChangeRequested(
            notifyEnv(env),
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_timeline_change_requested processed')

        } else if (body.type === 'notify_timeline_change_decided') {
          await notifyTimelineChangeDecided(
            notifyEnv(env),
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_timeline_change_decided processed')

        } else if (body.type === 'notify_payment_received') {
          await notifyPaymentReceived(
            notifyEnv(env),
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_payment_received processed')

        } else if (body.type === 'notify_admin_signup') {
          await notifyAdminSignup(
            notifyEnv(env),
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_admin_signup processed')

        } else if (body.type === 'form_submission') {
          // Notify the vendor that someone submitted one of their forms
          const vendor = await getVendorWithEmail(env.DB, body.vendorId)
          if (!vendor) {
            console.error('[QUEUE] vendor not found', body.vendorId)
            msg.ack()
            continue
          }
          const html = formSubmissionEmail({
            formTitle: body.formTitle,
            fields: (body.fields as unknown as { label: string; value: string }[]) ?? [],
            appUrl: env.APP_URL,
            formId: body.formId,
            submissionId: body.submissionId,
          })
          const sent = await deliver(notifyEnv(env), {
            key: 'enquiries',
            recipient: { id: vendor.user_id, email: vendor.user_email, name: vendor.user_name, notification_prefs: vendor.user_notification_prefs },
            subject: `New submission: ${body.formTitle}`,
            html,
            vendorId: body.vendorId,
          })
          console.log('[QUEUE] form_submission email', sent ? 'sent to' : 'skipped for', vendor.user_email)

        } else if (body.type === 'form_notification') {
          // Notify a specific recipient configured on the form
          const html = formNotificationEmail({
            formTitle: body.formTitle,
            vendorName: body.vendorName,
            fields: (body.fields as unknown as { label: string; value: string }[]) ?? [],
          })
          await sendEmailMessage({
            db: env.DB,
            resendApiKey: env.RESEND_API_KEY,
            vendorId: null,
            to: body.to,
            subject: `New submission: ${body.formTitle}`,
            html,
            isSystem: true,
          })
          console.log('[QUEUE] form_notification email sent to', body.to)

        } else if (body.type === 'form_confirmation') {
          // Confirmation back to the person who submitted the form
          const html = formConfirmationEmail({
            formTitle: body.formTitle,
            vendorName: body.vendorName,
            fields: (body.fields as unknown as { label: string; value: string }[]) ?? [],
          })
          await sendEmailMessage({
            db: env.DB,
            resendApiKey: env.RESEND_API_KEY,
            vendorId: null,
            to: body.to,
            subject: `We've received your submission — ${body.vendorName}`,
            html,
            isSystem: true,
          })
          console.log('[QUEUE] form_confirmation email sent to', body.to)

        } else if (body.type === 'enquiry_confirmation') {
          // AI/template confirmation back to the enquirer (enquiry form option)
          const html = enquiryConfirmationEmail({
            vendorName: body.vendorName,
            contactName: body.contactName,
            bodyText: body.bodyText,
          })
          await sendEmailMessage({
            db: env.DB,
            resendApiKey: env.RESEND_API_KEY,
            vendorId: null,
            to: body.to,
            subject: `Thanks for your enquiry — ${body.vendorName}`,
            html,
            isSystem: true,
          })
          console.log('[QUEUE] enquiry_confirmation email sent to', body.to)

        } else if (body.type === 'referral_reward') {
          // Notify a vendor that a referral converted and they earned a free month
          const vendor = await getVendorWithEmail(env.DB, body.vendorId)
          if (!vendor) {
            console.error('[QUEUE] referral_reward vendor not found', body.vendorId)
            msg.ack()
            continue
          }
          const sent = await deliver(notifyEnv(env), {
            key: 'referrals',
            recipient: { id: vendor.user_id, email: vendor.user_email, name: vendor.user_name, notification_prefs: vendor.user_notification_prefs },
            subject: 'You earned a free month 🎉',
            html: referralRewardEmail({ appUrl: env.APP_URL }),
            vendorId: body.vendorId,
          })
          console.log('[QUEUE] referral_reward email', sent ? 'sent to' : 'skipped for', vendor.user_email)

        } else if (body.type === 'broadcast_email') {
          // One recipient of an admin broadcast. New messages carry a
          // broadcastId (body stored once); older in-flight messages may still
          // carry inline subject/html — handle both.
          let subject = body.subject
          let html = body.html
          if (body.broadcastId) {
            const broadcast = await getBroadcast(env.DB, body.broadcastId)
            if (!broadcast) {
              console.error('[QUEUE] broadcast not found', body.broadcastId)
              msg.ack()
              continue
            }
            subject = broadcast.subject
            html = broadcastEmail({ bodyText: broadcast.body, unsubscribeUrl: body.unsub || null })
          }
          await sendEmailMessage({
            db: env.DB,
            resendApiKey: env.RESEND_API_KEY,
            vendorId: null,
            to: body.to,
            toName: body.toName || undefined,
            subject,
            html,
            isSystem: true,
            listUnsubscribeUrl: body.unsub || undefined,
            idempotencyKey: msg.id,
          })
          console.log('[QUEUE] broadcast_email sent to', body.to)

        } else if (body.type === 'sync_vendor') {
          // One vendor's storage sync, fanned out from the */5 cron so each
          // message stays well under the per-invocation subrequest budget.
          // syncVendorStorage handles its own per-vendor lock and errors;
          // swallow here so a transient failure just waits for the next
          // sweep instead of re-running (and re-pushing) on retry.
          try {
            const vendor = await getVendorById(env.DB, body.vendorId)
            if (vendor) {
              const r = await syncVendorStorage(env, vendor)
              if (r.errors > 0) logEvent('sync.vendor_errors', { vendorId: body.vendorId, errors: r.errors, pulled: r.pulled, pushed: r.weddingsSynced })
            }
          } catch (e: any) {
            logEvent('sync.vendor_failed', { vendorId: body.vendorId, error: e.message })
          }

        } else if (body.type === 'vendor_digest') {
          // One vendor's daily digest + payment reminders, fanned out from
          // the 0 20 cron. runVendorDailyJobs never throws.
          await runVendorDailyJobs(notifyEnv(env), body.vendorId)

        } else {
          console.log('[QUEUE] unknown message type', body.type)
        }

        msg.ack()
      } catch (e: any) {
        console.error('[QUEUE] failed', msg.id, e.message)
        logEvent('queue.failed', { id: msg.id, type: (msg.body as { type?: string })?.type, error: e.message })
        if (e instanceof EmailSendError && !e.retryable) {
          // Permanent failure (bad address, other 4xx) — retrying will never
          // succeed, so ack it. The failure is recorded on the email row.
          msg.ack()
        } else {
          // Transient (rate limit, 5xx, network) — back off before retrying so
          // we don't hammer Resend. After max_retries the dead-letter queue
          // captures the message for inspection.
          msg.retry({ delaySeconds: 30 })
        }
      }
    }
  },

  async email(message: ForwardableEmailMessage, env: Env['Bindings'], ctx: ExecutionContext): Promise<void> {
    await handleInboundEmail(message, env)
  },

  async scheduled(event: ScheduledEvent, env: Env['Bindings'], ctx: ExecutionContext): Promise<void> {
    console.log('[CRON] triggered', event.cron)

    if (event.cron === '0 20 * * *') {
      // Daily digest + payment reminders — fanned out one job per vendor so
      // a single invocation never iterates every vendor (which blows the
      // subrequest/CPU budget and Resend rate limit past a few hundred).
      try {
        const n = await enqueueVendorDailyJobs(env)
        logEvent('cron.daily_enqueued', { jobs: n })
      } catch (e: any) {
        logEvent('cron.daily_failed', { error: e.message })
      }

      // Geocode any locations added or changed since the last run (bounded,
      // KV-cached) so the aggregations below bucket by the wedding's region.
      try {
        await geocodePendingLocations(env, 25)
      } catch (e: any) {
        console.error('[CRON] geocode catch-up failed', e.message)
      }

      // Busyness aggregation is a single query — fine to run inline.
      try {
        await aggregateBusynessScores(env.DB)
      } catch (e: any) {
        console.error('[CRON] busyness aggregation failed', e.message)
      }

      try {
        await aggregateDemandHistory(env.DB)
      } catch (e: any) {
        console.error('[CRON] demand history aggregation failed', e.message)
      }

      // Prune unbounded write-only tables (sessions, system emails, analytics,
      // audit, import staging) so they don't creep toward the D1 10GB cap.
      try {
        await runRetention(env.DB)
      } catch (e: any) {
        console.error('[CRON] retention failed', e.message)
      }

      // Hard-purge accounts whose 30-day soft-delete grace has elapsed.
      try {
        await purgeExpiredAccounts(env)
      } catch (e: any) {
        console.error('[CRON] purge expired accounts failed', e.message)
      }
    }

    if (event.cron === '*/5 * * * *') {
      // Storage sync — fan out one job per git vendor, sharded across ticks
      // so each message handles a single vendor (bounded subrequests) and no
      // single invocation iterates the whole fleet.
      try {
        const n = await enqueueStorageSyncJobs(env, event.scheduledTime)
        if (n > 0) logEvent('cron.sync_enqueued', { jobs: n })
      } catch (e: any) {
        logEvent('cron.sync_failed', { error: e.message })
      }
    }
  },
}
