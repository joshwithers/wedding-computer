import { Hono } from 'hono'
import type { Env } from './types'
import marketing from './routes/marketing'
import auth from './routes/auth'
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
import accountRoute from './routes/account'
import adminRoute from './routes/admin'
import filesRoute from './routes/files'
import feed from './routes/feed'
import carddav from './routes/carddav'
import caldav from './routes/caldav'
import stripe from './routes/stripe'
import { authenticateVendor, CARDDAV_HEADERS, CALDAV_HEADERS, xmlResponse, escXml } from './lib/dav'
import { AuthLayout } from './views/layouts/auth'
import { getVendorWithEmail } from './db/vendors'
import { getContact } from './storage/contacts'
import { getStorage } from './storage'
import { sendEmailMessage, newLeadEmail } from './services/email'
import { handleInboundEmail } from './services/inbound-email'
import { notifyInvoiceSent, notifyVendorAdded, notifyCoupleJoined, notifyVisibilityChanged, notifyBookingConfirmed, notifyVendorRemoved, notifyVendorBooked, notifyWeddingDetailsUpdated, dailyDigest } from './services/notifications'
import { syncStorageBackground } from './services/storage-sync'

const app = new Hono<Env>()

app.onError((err, c) => {
  const url = c.req.url
  const method = c.req.method
  const path = c.req.path
  const userAgent = c.req.header('user-agent') ?? 'unknown'
  const isHtmx = c.req.header('hx-request') === 'true'

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

// Public routes
app.route('/', marketing)
app.route('/', auth)
app.route('/', onboarding)
app.route('/', enquire)
app.route('/', bookRoute)
app.route('/', feed)
app.route('/', stripe)

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
app.route('/', accountRoute)
app.route('/', filesRoute)
app.route('/', coupleRoute)
app.route('/', adminRoute)

// ─── CardDAV + CalDAV ───

function cardDavDiscoveryXml(href: string, authHeader: string | undefined, db: D1Database) {
  return (async () => {
    const vendor = await authenticateVendor(db, authHeader)
    if (!vendor || !vendor.ical_token) {
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
    const token = vendor.ical_token
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
    if (!vendor || !vendor.ical_token) {
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
    const token = vendor.ical_token
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

// CardDAV well-known discovery (unauthenticated initial probe, authenticated follow-up)
app.on('PROPFIND', '/.well-known/carddav', (c) =>
  cardDavDiscoveryXml('/.well-known/carddav', c.req.raw.headers.get('Authorization') ?? undefined, c.env.DB))
app.get('/.well-known/carddav', (c) => c.redirect('/carddav/', 301))

// CalDAV well-known discovery
app.on('PROPFIND', '/.well-known/caldav', (c) =>
  calDavDiscoveryXml('/.well-known/caldav', c.req.raw.headers.get('Authorization') ?? undefined, c.env.DB))
app.get('/.well-known/caldav', (c) => c.redirect('/caldav/', 301))

// Root PROPFIND probe — check body to determine if CardDAV or CalDAV
app.on('PROPFIND', '/', async (c) => {
  const body = await c.req.text()
  if (body.includes('urn:ietf:params:xml:ns:caldav') || body.includes('calendar-home-set')) {
    return calDavDiscoveryXml('/', c.req.raw.headers.get('Authorization') ?? undefined, c.env.DB)
  }
  return cardDavDiscoveryXml('/', c.req.raw.headers.get('Authorization') ?? undefined, c.env.DB)
})

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

          const storage = getStorage(env, vendor)
          const contactResult = await getContact(storage, env.DB, body.vendorId, body.contactId)
          if (!contactResult) {
            console.error('[QUEUE] contact not found', body.contactId)
            msg.ack()
            continue
          }
          const contact = contactResult.contact

          const partnerName = [contact.partner_first_name, contact.partner_last_name]
            .filter(Boolean)
            .join(' ') || null

          const html = newLeadEmail({
            contactName: `${contact.first_name} ${contact.last_name}`,
            contactEmail: contact.email ?? '',
            contactPhone: contact.phone,
            partnerName,
            weddingDate: contact.wedding_date,
            weddingLocation: contact.wedding_location,
            message: contact.notes,
            appUrl: env.APP_URL,
            contactId: contact.id,
          })

          await sendEmailMessage({
            db: env.DB,
            resendApiKey: env.RESEND_API_KEY,
            vendorId: body.vendorId,
            to: vendor.user_email,
            toName: vendor.user_name,
            subject: `New enquiry from ${contact.first_name} ${contact.last_name}`,
            html,
          })

          console.log('[QUEUE] new_lead email sent to', vendor.user_email)
        } else if (body.type === 'notify_invoice_sent') {
          await notifyInvoiceSent(
            { db: env.DB, resendApiKey: env.RESEND_API_KEY, appUrl: env.APP_URL },
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_invoice_sent processed')

        } else if (body.type === 'notify_vendor_added') {
          await notifyVendorAdded(
            { db: env.DB, resendApiKey: env.RESEND_API_KEY, appUrl: env.APP_URL },
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_vendor_added processed')

        } else if (body.type === 'notify_couple_joined') {
          await notifyCoupleJoined(
            { db: env.DB, resendApiKey: env.RESEND_API_KEY, appUrl: env.APP_URL },
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_couple_joined processed')

        } else if (body.type === 'notify_visibility_changed') {
          await notifyVisibilityChanged(
            { db: env.DB, resendApiKey: env.RESEND_API_KEY, appUrl: env.APP_URL },
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_visibility_changed processed')

        } else if (body.type === 'notify_booking_confirmed') {
          await notifyBookingConfirmed(
            { db: env.DB, resendApiKey: env.RESEND_API_KEY, appUrl: env.APP_URL },
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_booking_confirmed processed')

        } else if (body.type === 'notify_vendor_removed') {
          await notifyVendorRemoved(
            { db: env.DB, resendApiKey: env.RESEND_API_KEY, appUrl: env.APP_URL },
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_vendor_removed processed')

        } else if (body.type === 'notify_vendor_booked') {
          await notifyVendorBooked(
            { db: env.DB, resendApiKey: env.RESEND_API_KEY, appUrl: env.APP_URL },
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_vendor_booked processed')

        } else if (body.type === 'notify_wedding_details_updated') {
          await notifyWeddingDetailsUpdated(
            { db: env.DB, resendApiKey: env.RESEND_API_KEY, appUrl: env.APP_URL },
            JSON.parse(body.payload)
          )
          console.log('[QUEUE] notify_wedding_details_updated processed')

        } else {
          console.log('[QUEUE] unknown message type', body.type)
        }

        msg.ack()
      } catch (e: any) {
        console.error('[QUEUE] failed', msg.id, e.message)
        msg.retry()
      }
    }
  },

  async email(message: ForwardableEmailMessage, env: Env['Bindings'], ctx: ExecutionContext): Promise<void> {
    await handleInboundEmail(message, env)
  },

  async scheduled(event: ScheduledEvent, env: Env['Bindings'], ctx: ExecutionContext): Promise<void> {
    console.log('[CRON] triggered', event.cron)

    if (event.cron === '0 20 * * *') {
      // Daily digest — 8pm UTC
      try {
        await dailyDigest({ db: env.DB, resendApiKey: env.RESEND_API_KEY, appUrl: env.APP_URL })
      } catch (e: any) {
        console.error('[CRON] daily digest failed', e.message)
      }
    }

    if (event.cron === '*/5 * * * *') {
      // Storage sync — every 5 minutes
      try {
        const result = await syncStorageBackground(env)
        if (result.weddingsSynced > 0 || result.errors > 0) {
          console.log(`[CRON] storage sync: ${result.vendorsChecked} vendors, ${result.weddingsSynced} weddings synced, ${result.errors} errors`)
        }
      } catch (e: any) {
        console.error('[CRON] storage sync failed', e.message)
      }
    }
  },
}
