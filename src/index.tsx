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
import feed from './routes/feed'
import stripe from './routes/stripe'
import { AuthLayout } from './views/layouts/auth'
import { getVendorWithEmail } from './db/vendors'
import { getContact } from './db/contacts'
import { sendEmail, newLeadEmail } from './services/email'

const app = new Hono<Env>()

app.onError((err, c) => {
  console.error(`[ERROR] ${c.req.method} ${c.req.path}`, err.message)
  return c.html(
    <AuthLayout title="Error">
      <div class="bg-white rounded-2xl shadow-lg shadow-horizon/5 p-5 sm:p-8 text-center">
        <div class="text-4xl mb-4">500</div>
        <h2 class="text-xl font-bold mb-2">Something went wrong</h2>
        <p class="text-sm text-gray-500 mb-6">We hit an unexpected error. Please try again.</p>
        <a href="/" class="inline-block bg-horizon-600 text-white py-2.5 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
          Go home
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

          const contact = await getContact(env.DB, body.vendorId, body.contactId)
          if (!contact) {
            console.error('[QUEUE] contact not found', body.contactId)
            msg.ack()
            continue
          }

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

          await sendEmail({
            to: vendor.user_email,
            toName: vendor.user_name,
            subject: `New enquiry from ${contact.first_name} ${contact.last_name}`,
            html,
            apiKey: env.RESEND_API_KEY,
          })

          console.log('[QUEUE] new_lead email sent to', vendor.user_email)
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

  async scheduled(event: ScheduledEvent, env: Env['Bindings'], ctx: ExecutionContext): Promise<void> {
    console.log('[CRON] triggered', event.cron)
  },
}
