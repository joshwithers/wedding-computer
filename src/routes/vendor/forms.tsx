import { Hono } from 'hono'
import type { Env, VendorProfile } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { createForm, getForm, listForms, updateForm, deleteForm, listFormSubmissions, getFormSubmission, updateFormSubmission, formSubmissionFields } from '../../db/forms'
import { noimFormConfig } from '../../forms/noim/schema'
import { hasCategory } from '../../lib/categories'
import type { FormConfig, FormStep, FormField } from '../../lib/form-schema'
import { defaultFormConfig, defaultBookingFormConfig, parseFormConfig, parseBookingFormConfig, generateFieldId, BUILDER_FIELD_TYPES, CONTACT_MAPPINGS, sanitizeBuilderFields, validateBuilderFields, validateFormForType } from '../../lib/form-schema'
import { ensureSingletonForm } from '../../services/form-submit'
import { readEnquiryKeyFlash } from './form'
import { updateVendor } from '../../db/vendors'
import { isProVendor } from '../../db/subscriptions'
import { formatDate, formatDateTime } from '../../lib/date'
import { requireEmailHandle } from '../../middleware/email-handle'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { getCspNonce } from '../../i18n'

const forms = new Hono<Env>()

// Own guard chain — don't rely on mount-order inheritance from another sub-app.
// (CSRF + requireAuth/requireVendor are idempotent, so the dashboard guard also
// matching /app/* is harmless; this makes the surface self-protecting.)
forms.use('/app/forms', requireAuth, csrf, requireVendor)
forms.use('/app/forms/*', requireAuth, csrf, requireVendor)

// Custom forms send email on our domain too — require the handle once a vendor
// is in context (the guards above set it).
forms.use('/app/forms', requireEmailHandle)
forms.use('/app/forms/*', requireEmailHandle)

// ─── List all forms ───

// Reserved slugs for the per-vendor singleton intake forms, surfaced as pinned
// "Primary" rows (edited on their own pages) and hidden from the "Other" list so
// they never double-show.
// The per-vendor singletons surfaced as pinned "Primary" rows. Standalone
// booking forms (slug 'booking-form') are regular forms and show under "Other".
const SINGLETON_SLUGS = new Set(['enquiry', 'booking'])

forms.get('/app/forms', async (c) => {
  const vendor = c.get('vendor')!
  const allForms = await listForms(c.env.DB, vendor.id)

  // The two lead-generating singletons. Their config lives in the legacy vendor
  // blob (read-both bridge) but their submission count comes from any migrated
  // forms row.
  const enquiryRow = allForms.find((f) => f.slug === 'enquiry')
  const enquiryConfig = parseFormConfig(enquiryRow?.config ?? vendor.enquiry_form)
  const bookingRow = allForms.find((f) => f.slug === 'booking')
  const bookingConfig = parseBookingFormConfig(bookingRow?.config ?? vendor.booking_form)

  const otherForms = allForms.filter((f) => !(f.slug && SINGLETON_SLUGS.has(f.slug)))

  return c.html(
    <AppLayout title="Forms" user={c.get('user')} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-4xl mx-auto">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h1 class="text-2xl font-bold text-gray-900">Forms</h1>
            <p class="text-sm text-gray-600 mt-1">Your enquiry &amp; booking forms, plus any forms you build to collect information</p>
          </div>
          <a href="/app/forms/new" class="bg-horizon-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-horizon-700 transition-colors">
            New form
          </a>
        </div>

        {/* Primary, lead-generating forms — always present, pinned to the top. */}
        <h2 class="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">Lead-generating</h2>
        <div class="space-y-3 mb-8">
          <PrimaryFormRow
            title={enquiryConfig.title || 'Enquiry form'}
            badge="Enquiry"
            badgeClass="bg-horizon-100 text-horizon-700"
            description="Collects enquiries and creates leads in your CRM"
            editHref="/app/forms/enquiry"
            publicHref={`/enquire/${vendor.id}`}
            count={enquiryRow?.submission_count ?? 0}
          />
          <PrimaryFormRow
            title={bookingConfig.title || 'Booking form'}
            badge="Booking"
            badgeClass="bg-green-100 text-green-700"
            description="Shown when a couple confirms a booking from an invoice"
            editHref="/app/forms/booking"
            count={bookingRow?.submission_count ?? 0}
          />
        </div>

        <h2 class="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">Other forms</h2>
        {otherForms.length === 0 ? (
          <div class="bg-white border border-papaya-300/30 rounded-xl p-8 text-center">
            <p class="text-gray-600 mb-4">No information or NOIM forms yet.</p>
            <a href="/app/forms/new" class="text-horizon-600 font-bold hover:underline">Build a form</a>
          </div>
        ) : (
          <div class="space-y-3">
            {otherForms.map((form) => (
              <div class="bg-white border border-papaya-300/30 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <div class="flex items-center gap-2">
                    <h3 class="font-bold text-gray-900">{form.title}</h3>
                    <TypeBadge type={form.type} kind={form.kind} />
                    {!form.is_active && <span class="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Inactive</span>}
                  </div>
                  <p class="text-xs text-gray-500 mt-1">
                    {form.submission_count} submission{form.submission_count !== 1 ? 's' : ''}
                    {' '}&middot;{' '}
                    Created {formatDate(form.created_at)}
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <a href={`/app/forms/${form.id}/submissions`} class="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5 border border-gray-200 rounded-lg">
                    Submissions
                  </a>
                  <a href={`/app/forms/${form.id}`} class="text-xs text-horizon-600 hover:text-horizon-700 px-3 py-1.5 border border-horizon-200 rounded-lg">
                    Edit
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
})

function PrimaryFormRow({ title, badge, badgeClass, description, editHref, publicHref, count }: {
  title: string; badge: string; badgeClass: string; description: string; editHref: string; publicHref?: string; count: number
}) {
  return (
    <div class="bg-white border border-papaya-300/30 rounded-xl p-4 flex items-center justify-between">
      <div>
        <div class="flex items-center gap-2">
          <h3 class="font-bold text-gray-900">{title}</h3>
          <span class={`text-xs px-2 py-0.5 rounded-full ${badgeClass}`}>{badge}</span>
        </div>
        <p class="text-xs text-gray-500 mt-1">
          {description}{count > 0 ? ` · ${count} submission${count !== 1 ? 's' : ''}` : ''}
        </p>
      </div>
      <div class="flex items-center gap-2">
        {publicHref && (
          <a href={publicHref} target="_blank" class="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5 border border-gray-200 rounded-lg">
            View
          </a>
        )}
        <a href={editHref} class="text-xs text-horizon-600 hover:text-horizon-700 px-3 py-1.5 border border-horizon-200 rounded-lg">
          Edit
        </a>
      </div>
    </div>
  )
}

function TypeBadge({ type, kind }: { type: string; kind?: string }) {
  if (type === 'noim') return <span class="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">NOIM</span>
  if (kind === 'enquiry') return <span class="text-xs px-2 py-0.5 rounded-full bg-horizon-100 text-horizon-700">Enquiry</span>
  if (kind === 'booking') return <span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Booking</span>
  return <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">Information</span>
}

// The unified "on submission" card — one action model for every kind.
function ActionsCard({ form, config, isPro, csrfToken }: { form: { id: string; kind: string; type: string }; config: FormConfig; isPro: boolean; csrfToken: string }) {
  const a = config.actions
  const isLead = form.kind === 'enquiry' || form.kind === 'booking'
  const createContact = isLead || a.createContact === true || a.actions?.some((x) => x.type === 'create_contact' && x.enabled)
  return (
    <div class="bg-white border border-papaya-300/30 rounded-xl p-5 mb-4">
      <h2 class="font-bold text-gray-900 mb-3">When someone submits this form</h2>
      <form method="post" action={`/app/forms/${form.id}/actions`}>
        <input type="hidden" name="_csrf" value={csrfToken} />
        <div class="space-y-3">
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" name="notifyVendor" value="1" checked={a.notifyVendor !== false} class="rounded" />
            Email me when someone submits this form
          </label>
          {isLead ? (
            <p class="text-sm text-gray-500 flex items-center gap-2">
              <span class="text-horizon-700">✓</span> Creates a contact in your CRM{form.kind === 'booking' ? ' and joins the wedding' : ''}
            </p>
          ) : (
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" name="create_contact" value="1" checked={createContact} class="rounded" />
              Create a contact/lead in my CRM
            </label>
          )}
          <div>
            <label class="block text-sm text-gray-700 mb-1">Also send each submission to another email (optional)</label>
            <input type="text" name="email_recipient" value={a.emailRecipient ?? a.actions?.find((x) => x.type === 'email_recipient')?.recipientEmail ?? ''} class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. assistant@example.com" />
          </div>

          <ConfirmationEmailFields config={config} isPro={isPro} />
        </div>
        <button type="submit" class="mt-4 bg-horizon-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-horizon-700">Save</button>
      </form>
    </div>
  )
}

function ConfirmationEmailFields({ config, isPro }: { config: FormConfig; isPro: boolean }) {
  const conf = config.actions.confirmationEmail ?? { enabled: false, mode: 'ai' as const }
  return (
    <div class="border-t border-gray-100 pt-3 mt-1 space-y-3">
      <label class="flex items-center gap-2 text-sm font-bold text-gray-700">
        <input type="checkbox" name="confirm_enabled" value="1" checked={conf.enabled} class="rounded" />
        Send a confirmation email to the submitter
      </label>
      <div class="pl-6 space-y-3">
        <div class="space-y-2">
          <label class="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="confirm_mode" value="ai" checked={conf.mode !== 'template'} class="accent-grapefruit-700 mt-0.5" />
            <span class="text-sm text-gray-700"><span class="font-bold">AI-personalised</span> <span class="text-xs text-gray-400">(Pro)</span><span class="block text-xs text-gray-400">A warm reply tailored to each submission. Free plans send the message below.</span></span>
          </label>
          <label class="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="confirm_mode" value="template" checked={conf.mode === 'template'} class="accent-grapefruit-700 mt-0.5" />
            <span class="text-sm text-gray-700"><span class="font-bold">Write my own message</span><span class="block text-xs text-gray-400">The same message goes to everyone.</span></span>
          </label>
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-500 mb-1" for="confirm_template">Your message</label>
          <textarea id="confirm_template" name="confirm_template" rows={3} class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" placeholder="Thanks for reaching out! We'll be in touch within 24 hours.">{conf.template ?? ''}</textarea>
        </div>
        {isPro && (
          <>
            <div>
              <label class="block text-xs font-bold text-gray-500 mb-1" for="confirm_ai_instructions">Guide the AI <span class="text-gray-400 font-normal">(Pro)</span></label>
              <textarea id="confirm_ai_instructions" name="confirm_ai_instructions" rows={2} class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" placeholder="e.g. Keep it casual, mention we reply within a day, include our booking link.">{conf.aiInstructions ?? ''}</textarea>
            </div>
            <details class="border border-gray-200 rounded-xl px-3 py-2">
              <summary class="text-xs font-bold text-gray-500 cursor-pointer">Advanced: rewrite the whole AI prompt</summary>
              <textarea name="confirm_ai_prompt" rows={6} class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono mt-2" placeholder="Leave blank to use the platform default. Placeholders: {contactName} {requestedDate} {availabilityInfo} …">{conf.aiPrompt ?? ''}</textarea>
            </details>
          </>
        )}
      </div>
    </div>
  )
}

// Enquiry-only: the Pro JSON intake API key (generate/rotate/revoke + one-time
// reveal). Posts to the relocated key routes in routes/vendor/form.tsx.
function ApiKeyCard({ vendor, appUrl, isPro, csrfToken, revealedKey }: { vendor: VendorProfile; appUrl: string; isPro: boolean; csrfToken: string; revealedKey: string | null }) {
  return (
    <div id="api" class="bg-white border border-papaya-300/30 rounded-xl p-5 mb-4">
      <h2 class="font-bold text-gray-900 mb-1">Enquiry API <span class="text-xs text-gray-400 font-normal">(Pro)</span></h2>
      <p class="text-sm text-gray-500 mb-3">Let Zapier, your website, or an agent post enquiries to <code class="text-xs bg-gray-100 rounded px-1">{appUrl}/api/v1/enquiries</code>.</p>
      {!isPro ? (
        <p class="text-sm text-gray-600">The enquiry API is a Pro feature. <a href="/app/subscription" class="font-bold text-horizon-700 hover:underline">Upgrade to Pro</a>.</p>
      ) : revealedKey ? (
        <div class="bg-horizon-50 border border-horizon-600/20 rounded-xl p-3 mb-3">
          <p class="text-xs text-gray-600 mb-1">Your new key (copy it now — it won't be shown again):</p>
          <code class="block text-xs font-mono break-all text-gray-900">{revealedKey}</code>
        </div>
      ) : vendor.enquiry_key ? (
        <div class="flex items-center gap-2">
          <span class="text-sm text-gray-600">A key is active.</span>
          <form method="post" action="/app/form/rotate-key"><input type="hidden" name="_csrf" value={csrfToken} /><button class="text-xs text-horizon-700 hover:underline">Rotate</button></form>
          <form method="post" action="/app/form/revoke-key"><input type="hidden" name="_csrf" value={csrfToken} /><button class="text-xs text-gray-400 hover:text-red-600">Revoke</button></form>
        </div>
      ) : (
        <form method="post" action="/app/form/generate-key">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <button type="submit" class="bg-horizon-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-horizon-700">Generate API key</button>
        </form>
      )}
    </div>
  )
}

// ─── New form (choose type) ───

forms.get('/app/forms/new', async (c) => {
  const vendor = c.get('vendor')!

  return c.html(
    <AppLayout title="New Form" user={c.get('user')} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-2xl mx-auto">
        <h1 class="text-2xl font-bold text-gray-900 mb-6">Create a new form</h1>

        <div class="space-y-4">
          <form method="post" action="/app/forms/new">
            <input type="hidden" name="type" value="contact" />
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <button type="submit" class="w-full text-left bg-white border border-papaya-300/30 rounded-xl p-5 hover:border-horizon-600/30 transition-colors cursor-pointer">
              <h3 class="font-bold text-gray-900">Contact / Enquiry form</h3>
              <p class="text-sm text-gray-600 mt-1">Collect enquiries and create leads in your CRM automatically</p>
            </button>
          </form>

          {hasCategory(vendor, 'celebrant') && (
            <form method="post" action="/app/forms/new">
              <input type="hidden" name="type" value="noim" />
              <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
              <button type="submit" class="w-full text-left bg-white border border-purple-200 rounded-xl p-5 hover:border-purple-400 transition-colors cursor-pointer">
                <h3 class="font-bold text-gray-900">Notice of Intended Marriage (NOIM)</h3>
                <p class="text-sm text-gray-600 mt-1">Collect NOIM details from couples and generate a completed PDF</p>
                <span class="inline-block mt-2 text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">Celebrant</span>
              </button>
            </form>
          )}

          <form method="post" action="/app/forms/new">
            <input type="hidden" name="type" value="booking" />
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <button type="submit" class="w-full text-left bg-white border border-green-200 rounded-xl p-5 hover:border-green-400 transition-colors cursor-pointer">
              <h3 class="font-bold text-gray-900">Booking form</h3>
              <p class="text-sm text-gray-600 mt-1">A public form that books a couple in — creates a contact and joins their wedding</p>
              <span class="inline-block mt-2 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Booking</span>
            </button>
          </form>

          <form method="post" action="/app/forms/new">
            <input type="hidden" name="type" value="custom" />
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <button type="submit" class="w-full text-left bg-white border border-papaya-300/30 rounded-xl p-5 hover:border-horizon-600/30 transition-colors cursor-pointer">
              <h3 class="font-bold text-gray-900">Custom form</h3>
              <p class="text-sm text-gray-600 mt-1">Build any form with custom fields, actions, and notifications</p>
            </button>
          </form>
        </div>
      </div>
    </AppLayout>
  )
})

forms.post('/app/forms/new', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()
  const type = (body.type as string) || 'custom'

  let config: FormConfig
  let title: string
  // The form row's intent. Booking forms create a contact AND attach the vendor
  // to the couple's wedding; everything else is information-only here.
  let kind: 'information' | 'booking' = 'information'
  let slug: string | undefined

  switch (type) {
    case 'noim':
      config = noimFormConfig()
      title = 'Notice of Intended Marriage'
      break
    case 'contact':
      config = defaultFormConfig()
      title = 'Enquiry Form'
      break
    case 'booking':
      kind = 'booking'
      slug = 'booking-form'
      title = 'Booking form'
      config = {
        version: 1,
        title: 'Confirm your booking',
        submitLabel: 'Confirm booking',
        fields: [
          { id: generateFieldId(), type: 'heading', label: 'Your details' },
          { id: 'first_name', type: 'text', label: 'First name', required: true, width: 'half', mapTo: 'first_name' },
          { id: 'last_name', type: 'text', label: 'Last name', required: true, width: 'half', mapTo: 'last_name' },
          { id: 'email', type: 'email', label: 'Email', required: true, width: 'half', mapTo: 'email' },
          { id: 'phone', type: 'tel', label: 'Phone', width: 'half', mapTo: 'phone' },
          { id: 'wedding_date', type: 'date', label: 'Wedding date', width: 'half', mapTo: 'wedding_date' },
          { id: 'wedding_location', type: 'address', label: 'Wedding location', width: 'half', mapTo: 'wedding_location' },
          { id: 'notes', type: 'textarea', label: 'Anything we should know?', mapTo: 'notes' },
        ],
        actions: {
          notifyVendor: true,
          confirmationEmail: { enabled: false, mode: 'ai' },
        },
      }
      break
    default:
      config = {
        version: 1,
        title: 'Custom Form',
        submitLabel: 'Submit',
        fields: [
          { id: generateFieldId(), type: 'heading', label: 'Your details' },
          { id: 'first_name', type: 'text', label: 'First name', required: true, width: 'half', mapTo: 'first_name' },
          { id: 'last_name', type: 'text', label: 'Last name', required: true, width: 'half', mapTo: 'last_name' },
          { id: 'email', type: 'email', label: 'Email', required: true, mapTo: 'email' },
        ],
        actions: {
          notifyVendor: true,
          confirmationEmail: { enabled: false, mode: 'ai' },
          actions: [{ type: 'create_contact', enabled: true }],
        },
      }
      title = 'Custom Form'
  }

  const form = await createForm(c.env.DB, vendor.id, {
    title,
    type: (type === 'booking' ? 'custom' : type) as 'custom' | 'noim' | 'contact',
    kind,
    slug,
    config: JSON.stringify(config),
  })

  return c.redirect(`/app/forms/${form.id}`)
})

// ─── Singleton convenience routes ───
// The enquiry + invoice-booking forms are per-vendor singletons whose config
// still lives in the legacy vendor blob. These get-or-create the backing forms
// row (migrating the blob) and open it in the unified editor. Registered before
// /app/forms/:id so the literal slugs win.

forms.get('/app/forms/enquiry', async (c) => {
  const vendor = c.get('vendor')!
  const config = parseFormConfig(vendor.enquiry_form)
  const form = await ensureSingletonForm(
    c.env.DB, vendor, 'enquiry', 'enquiry', config.title || 'Enquiry form',
    vendor.enquiry_form ?? JSON.stringify(defaultFormConfig()),
  )
  return c.redirect(`/app/forms/${form.id}`)
})

forms.get('/app/forms/booking', async (c) => {
  const vendor = c.get('vendor')!
  const config = parseBookingFormConfig(vendor.booking_form)
  const form = await ensureSingletonForm(
    c.env.DB, vendor, 'booking', 'booking', config.title || 'Booking form',
    vendor.booking_form ?? JSON.stringify(defaultBookingFormConfig()),
  )
  return c.redirect(`/app/forms/${form.id}`)
})

// ─── Edit form ───

forms.get('/app/forms/:id', async (c) => {
  const vendor = c.get('vendor')!
  const form = await getForm(c.env.DB, vendor.id, c.req.param('id'))
  if (!form) return c.text('Not found', 404)
  const isPro = await isProVendor(c.env.DB, vendor.id)
  // The enquiry form is the only one with an API intake key; surface its
  // one-time key reveal here after a generate/rotate.
  const revealedKey = form.kind === 'enquiry' ? await readEnquiryKeyFlash(c.env, vendor.id) : null

  const config = JSON.parse(form.config) as FormConfig
  // The public URL depends on the form's role: enquiry has a per-vendor URL,
  // a standalone booking form has /book-form, the invoice-booking form is only
  // shown on an invoice's accept page (no standalone URL), everything else /form.
  const publicPath =
    form.kind === 'enquiry' ? `/enquire/${vendor.id}`
      : form.slug === 'booking-form' ? `/book-form/${form.public_token}`
      : form.slug === 'booking' ? null
      : `/form/${form.public_token}`
  const publicUrl = publicPath ? `${c.env.APP_URL}${publicPath}` : null
  const saved = c.req.query('saved')
  const buildError = c.req.query('error')

  return c.html(
    <AppLayout title={`Edit: ${form.title}`} user={c.get('user')} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-3xl mx-auto">
        <div class="flex items-center justify-between mb-6">
          <div>
            <a href="/app/forms" class="text-sm text-gray-500 hover:text-gray-700">&larr; All forms</a>
            <div class="flex items-center gap-2 mt-1">
              <h1 class="text-2xl font-bold text-gray-900">{form.title}</h1>
              <TypeBadge type={form.type} kind={form.kind} />
            </div>
          </div>
          <div class="flex items-center gap-2">
            {publicPath && (
              <a href={publicPath} target="_blank" class="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5 border border-gray-200 rounded-lg">
                Preview
              </a>
            )}
            <a href={`/app/forms/${form.id}/submissions`} class="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5 border border-gray-200 rounded-lg">
              Submissions ({form.submission_count})
            </a>
          </div>
        </div>

        {saved && (
          <div class="bg-horizon-50 border border-horizon-600/20 text-horizon-700 text-sm font-bold rounded-xl p-3 mb-4">
            {saved === 'fields' ? 'Fields saved.' : 'Saved.'}
          </div>
        )}
        {buildError && (
          <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-3 mb-4">
            {decodeURIComponent(buildError)}
          </div>
        )}

        {/* Settings */}
        <form method="post" action={`/app/forms/${form.id}/settings`} class="bg-white border border-papaya-300/30 rounded-xl p-5 mb-4">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1">Form title</label>
              <input type="text" name="title" value={form.title} class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-1">Submit button text</label>
              <input type="text" name="submitLabel" value={config.submitLabel} class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div class="mb-4">
            <label class="block text-sm font-bold text-gray-700 mb-1">Subtitle (optional)</label>
            <input type="text" name="subtitle" value={config.subtitle ?? ''} class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Shown below the title" />
          </div>
          <div class="mb-4">
            <label class="block text-sm font-bold text-gray-700 mb-1">Redirect after submit (optional)</label>
            <input type="url" name="redirectUrl" value={config.redirectUrl ?? ''} class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="https://yoursite.com/thank-you" />
            <p class="text-xs text-gray-400 mt-1">Leave blank to show the built-in thank-you page.</p>
          </div>
          <div class="flex items-center gap-4 mb-4">
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_active" value="1" checked={!!form.is_active} class="rounded" />
              Active (accepting submissions)
            </label>
          </div>
          <button type="submit" class="bg-horizon-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-horizon-700">Save settings</button>
        </form>

        {/* What happens on submission (unified action model) */}
        <ActionsCard form={form} config={config} isPro={isPro} csrfToken={c.get('csrfToken')} />

        {/* Enquiry intake API key (Pro) — only the enquiry form has one. */}
        {form.kind === 'enquiry' && (
          <ApiKeyCard vendor={vendor} appUrl={c.env.APP_URL} isPro={isPro} csrfToken={c.get('csrfToken')} revealedKey={revealedKey} />
        )}

        {/* Share / Embed */}
        {publicUrl ? (
          <div class="bg-white border border-papaya-300/30 rounded-xl p-5 mb-4">
            <h2 class="font-bold text-gray-900 mb-3">Share & embed</h2>
            <div class="space-y-3">
              <div>
                <label class="block text-xs font-bold text-gray-700 mb-1">Direct link</label>
                <input type="text" readonly value={publicUrl} class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50 font-mono text-xs" />
              </div>
              <div>
                <label class="block text-xs font-bold text-gray-700 mb-1">Embed code</label>
                <textarea readonly class="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs bg-gray-50 font-mono" rows={3}>
                  {`<iframe src="${publicUrl}?embed=1" width="100%" height="800" frameborder="0"></iframe>`}
                </textarea>
              </div>
            </div>
          </div>
        ) : (
          <div class="bg-white border border-papaya-300/30 rounded-xl p-5 mb-4 text-sm text-gray-600">
            This form is shown to couples on your invoice booking pages.
          </div>
        )}

        {/* Field builder */}
        {form.type !== 'noim' && (
          <FormBuilder formId={form.id} fields={config.fields} csrfToken={c.get('csrfToken')} />
        )}

        {form.type === 'noim' && config.steps && (
          <div class="bg-white border border-papaya-300/30 rounded-xl p-5 mb-4">
            <h2 class="font-bold text-gray-900 mb-3">Form steps ({config.steps.length})</h2>
            <div class="space-y-2">
              {config.steps.map((step, i) => (
                <div class="flex items-center gap-2 text-sm py-1 border-b border-gray-100 last:border-0">
                  <span class="text-xs text-gray-400 w-6">{i + 1}</span>
                  <span class="text-gray-900 font-medium">{step.title}</span>
                  <span class="text-xs text-gray-500">({step.fields.length} fields)</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Danger zone — the per-vendor singletons (enquiry, invoice-booking)
            can't be deleted (they're core surfaces, re-created on demand). */}
        {form.slug !== 'enquiry' && form.slug !== 'booking' && (
          <div class="bg-white border border-red-200 rounded-xl p-5">
            <h2 class="font-bold text-red-700 mb-3">Danger zone</h2>
            <form method="post" action={`/app/forms/${form.id}/delete`} onsubmit="return confirm('Delete this form and all submissions?')">
              <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
              <button type="submit" class="text-sm text-red-600 hover:text-red-800 px-3 py-1.5 border border-red-200 rounded-lg">
                Delete form
              </button>
            </form>
          </div>
        )}
      </div>
    </AppLayout>
  )
})

// ─── Update settings ───

forms.post('/app/forms/:id/settings', async (c) => {
  const vendor = c.get('vendor')!
  const form = await getForm(c.env.DB, vendor.id, c.req.param('id'))
  if (!form) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  const config = JSON.parse(form.config) as FormConfig
  config.title = (body.title as string) || config.title
  config.submitLabel = (body.submitLabel as string) || config.submitLabel
  config.subtitle = (body.subtitle as string) || undefined
  const redirectUrl = typeof body.redirectUrl === 'string' ? body.redirectUrl.trim() : ''
  config.redirectUrl = redirectUrl || undefined

  await updateForm(c.env.DB, vendor.id, form.id, {
    title: (body.title as string) || form.title,
    config: JSON.stringify(config),
    is_active: body.is_active ? 1 : 0,
  })
  await mirrorLegacyBlob(c.env.DB, vendor.id, form, config)

  return c.redirect(`/app/forms/${form.id}`)
})

// ─── Update actions ───

forms.post('/app/forms/:id/actions', async (c) => {
  const vendor = c.get('vendor')!
  const form = await getForm(c.env.DB, vendor.id, c.req.param('id'))
  if (!form) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  const config = JSON.parse(form.config) as FormConfig
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '')

  // Unified action model (migration 075) — flat fields, no more actions[] array.
  config.actions = {
    notifyVendor: !!body.notifyVendor,
    // enquiry/booking always create a contact; information opts in.
    createContact: form.kind === 'enquiry' || form.kind === 'booking' ? true : !!body.create_contact,
    emailRecipient: str('email_recipient') || undefined,
    confirmationEmail: {
      enabled: !!body.confirm_enabled,
      mode: body.confirm_mode === 'template' ? 'template' : 'ai',
      template: str('confirm_template') || undefined,
      aiInstructions: str('confirm_ai_instructions') || undefined,
      aiPrompt: str('confirm_ai_prompt') || undefined,
    },
  }

  await updateForm(c.env.DB, vendor.id, form.id, { config: JSON.stringify(config) })
  await mirrorLegacyBlob(c.env.DB, vendor.id, form, config)
  return c.redirect(`/app/forms/${form.id}`)
})

// During the read-both transition the singleton enquiry/booking forms are still
// read from the vendor blob by some surfaces (e.g. the invoice booking page).
// Keep the blob in sync whenever the unified editor saves those rows.
async function mirrorLegacyBlob(db: D1Database, vendorId: string, form: { slug: string | null }, config: FormConfig): Promise<void> {
  if (form.slug === 'enquiry') await updateVendor(db, vendorId, { enquiry_form: JSON.stringify(config) })
  else if (form.slug === 'booking') await updateVendor(db, vendorId, { booking_form: JSON.stringify(config) })
}

// ─── Update fields (modern builder) ───

forms.post('/app/forms/:id/build', async (c) => {
  const vendor = c.get('vendor')!
  const form = await getForm(c.env.DB, vendor.id, c.req.param('id'))
  if (!form) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  let raw: unknown = []
  try { raw = JSON.parse(String(body.fields ?? '[]')) } catch { raw = [] }

  const fields = sanitizeBuilderFields(raw)
  const config = JSON.parse(form.config) as FormConfig
  config.fields = fields
  // The builder edits a flat field list; custom forms don't use steps.
  if (form.type !== 'noim') delete config.steps

  // sanitizeBuilderFields drops fields with a blank label; if the client sent
  // more field objects than survived, one lost its label — surface that rather
  // than silently deleting it on a "saved" confirmation. Then enforce the
  // kind's contract (enquiry/booking need email+name mappings so leads land).
  const sentCount = Array.isArray(raw) ? raw.filter((r) => r && typeof r === 'object').length : 0
  const error = fields.length < sentCount ? 'Every field needs a label.' : validateFormForType(form.kind, config)
  if (error) return c.redirect(`/app/forms/${form.id}?error=${encodeURIComponent(error)}#fields`)

  await updateForm(c.env.DB, vendor.id, form.id, { config: JSON.stringify(config) })
  await mirrorLegacyBlob(c.env.DB, vendor.id, form, config)
  return c.redirect(`/app/forms/${form.id}?saved=fields#fields`)
})

// ─── Delete form ───

forms.post('/app/forms/:id/delete', async (c) => {
  const vendor = c.get('vendor')!
  await deleteForm(c.env.DB, vendor.id, c.req.param('id'))
  return c.redirect('/app/forms')
})

// ─── Submissions ───

forms.get('/app/forms/:id/submissions', async (c) => {
  const vendor = c.get('vendor')!
  const form = await getForm(c.env.DB, vendor.id, c.req.param('id'))
  if (!form) return c.text('Not found', 404)

  const submissions = await listFormSubmissions(c.env.DB, vendor.id, form.id)

  return c.html(
    <AppLayout title={`Submissions: ${form.title}`} user={c.get('user')} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-4xl mx-auto">
        <div class="mb-6">
          <a href={`/app/forms/${form.id}`} class="text-sm text-gray-500 hover:text-gray-700">&larr; {form.title}</a>
          <h1 class="text-2xl font-bold text-gray-900 mt-1">Submissions</h1>
          <p class="text-sm text-gray-600">{submissions.length} submission{submissions.length !== 1 ? 's' : ''}</p>
        </div>

        {submissions.length === 0 ? (
          <div class="bg-white border border-papaya-300/30 rounded-xl p-8 text-center">
            <p class="text-gray-600">No submissions yet.</p>
          </div>
        ) : (
          <div class="space-y-3">
            {submissions.map((sub) => {
              const data = JSON.parse(sub.data) as Record<string, string>
              const name = [data.first_name || data.p1_first_name, data.last_name || data.p1_last_name].filter(Boolean).join(' ') || 'Anonymous'
              const email = data.email || data.couple_email || ''
              return (
                <a href={`/app/forms/${form.id}/submissions/${sub.id}`} class="block bg-white border border-papaya-300/30 rounded-xl p-4 hover:border-horizon-600/30 transition-colors">
                  <div class="flex items-center justify-between">
                    <div>
                      <span class="font-bold text-gray-900 text-sm">{name}</span>
                      {email && <span class="text-xs text-gray-500 ml-2">{email}</span>}
                    </div>
                    <div class="flex items-center gap-2">
                      <span class={`text-xs px-2 py-0.5 rounded-full ${sub.status === 'submitted' ? 'bg-blue-100 text-blue-700' : sub.status === 'reviewed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                        {sub.status}
                      </span>
                      <span class="text-xs text-gray-400">{formatDate(sub.created_at)}</span>
                    </div>
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </div>
    </AppLayout>
  )
})

// ─── View single submission ───

forms.get('/app/forms/:id/submissions/:subId', async (c) => {
  const vendor = c.get('vendor')!
  const form = await getForm(c.env.DB, vendor.id, c.req.param('id'))
  if (!form) return c.text('Not found', 404)

  const sub = await getFormSubmission(c.env.DB, vendor.id, c.req.param('subId'))
  if (!sub) return c.text('Not found', 404)

  const rows = formSubmissionFields(form.config, sub.data)

  if (sub.status === 'submitted') {
    await updateFormSubmission(c.env.DB, vendor.id, sub.id, { status: 'reviewed' })
  }

  return c.html(
    <AppLayout title="Submission Detail" user={c.get('user')} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-3xl mx-auto">
        <div class="mb-6">
          <a href={`/app/forms/${form.id}/submissions`} class="text-sm text-gray-500 hover:text-gray-700">&larr; All submissions</a>
          <h1 class="text-2xl font-bold text-gray-900 mt-1">Submission</h1>
          <p class="text-xs text-gray-500">
            Submitted {formatDateTime(sub.created_at)}
            {sub.ip_address && ` from ${sub.ip_address}`}
          </p>
        </div>

        <div class="bg-white border border-papaya-300/30 rounded-xl p-5">
          <div class="space-y-3">
            {rows.filter((r) => !r.label.startsWith('_')).map((r) => (
              <div class="flex gap-4 py-2 border-b border-gray-100 last:border-0">
                <span class="text-sm font-medium text-gray-600 w-48 flex-shrink-0">{r.label}</span>
                <span class="text-sm text-gray-900">
                  {r.file ? (
                    <a href={`/form-file/${r.file.id}`} target="_blank" rel="noopener" class="text-horizon-600 hover:underline font-medium">{r.file.name} &darr;</a>
                  ) : (r.value || '—')}
                </span>
              </div>
            ))}
          </div>
        </div>

        {sub.contact_id && (
          <div class="mt-4">
            <a href={`/app/contacts/${sub.contact_id}`} class="text-sm text-horizon-600 hover:underline">View linked contact &rarr;</a>
          </div>
        )}
      </div>
    </AppLayout>
  )
})

// ─── Modern client-side field builder ───
//
// A Tally-style editor for a custom form's fields: an add-field menu with typed
// icons, inline label editing, per-type settings, drag/▲▼ reorder, and delete.
// State lives in the browser; on save the whole fields array is posted as JSON
// to /app/forms/:id/build, where it's sanitised + validated server-side.

function FormBuilder({ formId, fields, csrfToken }: { formId: string; fields: FormField[]; csrfToken: string }) {
  const initial = fields.map((f) => ({
    ...f,
    options: Array.isArray(f.options)
      ? f.options.map((o) => (typeof o === 'string' ? o : o.value)).join('\n')
      : f.options,
  }))
  const data = { fields: initial, types: BUILDER_FIELD_TYPES, mappings: CONTACT_MAPPINGS }
  return (
    <div class="bg-white border border-papaya-300/30 rounded-xl p-5 mb-4" id="fields">
      <h2 class="font-bold text-gray-900 mb-3">Fields (<span id="fb-count">{fields.length}</span>)</h2>
      <noscript><p class="text-sm text-gray-500">Enable JavaScript to edit this form's fields.</p></noscript>

      <div id="fb-root">
        <div id="fb-list" class="space-y-3"></div>
        <div class="relative mt-3">
          <button type="button" data-act="add" class="w-full border-2 border-dashed border-gray-200 text-gray-500 hover:border-horizon-400 hover:text-horizon-600 rounded-xl py-3 text-sm font-bold transition-colors">+ Add field</button>
          <div id="fb-menu" class="hidden absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-2 max-h-80 overflow-y-auto"></div>
        </div>
      </div>

      <form method="post" action={`/app/forms/${formId}/build`} id="fb-form" class="mt-4">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <input type="hidden" name="fields" id="fb-fields-input" />
        <button type="submit" id="fb-save" class="bg-horizon-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-horizon-700 transition-colors">Save fields</button>
      </form>

      <script nonce={getCspNonce()} type="application/json" id="fb-data" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />
      <script nonce={getCspNonce()} dangerouslySetInnerHTML={{ __html: formBuilderScript() }} />
    </div>
  )
}

function formBuilderScript(): string {
  return `
(function(){
  var box = document.getElementById('fields'); if(!box) return;
  var DATA = {}; try { DATA = JSON.parse(document.getElementById('fb-data').textContent); } catch(e){}
  var TYPES = DATA.types || [], MAPPINGS = DATA.mappings || [];
  var fields = (DATA.fields || []).map(normalize);

  var list = document.getElementById('fb-list');
  var menu = document.getElementById('fb-menu');
  var countEl = document.getElementById('fb-count');
  var input = document.getElementById('fb-fields-input');
  var form = document.getElementById('fb-form');
  var root = document.getElementById('fb-root');

  var INCLS = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm';
  var OPTION_TYPES = {select:1, radio:1, multiselect:1};
  var TEXTY = {text:1,textarea:1,email:1,tel:1,number:1,url:1,date:1,time:1,address:1,country:1};
  var TYPE_LABEL = {}, TYPE_ICON = {};
  TYPES.forEach(function(t){ TYPE_LABEL[t.value]=t.label; TYPE_ICON[t.value]=t.icon; });

  function gen(){ return 'f_' + Math.random().toString(36).slice(2,8); }
  function normalize(f){
    f = Object.assign({}, f);
    if (!f.id) f.id = gen();
    if (!f.type) f.type = 'text';
    if (Array.isArray(f.options)) f.options = f.options.map(function(o){ return typeof o==='string'?o:(o&&o.value)||''; }).join('\\n');
    return f;
  }
  function byId(id){ for (var i=0;i<fields.length;i++) if (fields[i].id===id) return fields[i]; return null; }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function field(label, control){ return '<div><label class="block text-xs font-bold text-gray-500 mb-1">'+esc(label)+'</label>'+control+'</div>'; }

  function typeSelectHtml(cur){
    var groups = {}, order = [];
    TYPES.forEach(function(t){ if(!groups[t.group]){groups[t.group]=[];order.push(t.group);} groups[t.group].push(t); });
    var html = '<select data-prop="type" class="text-xs font-bold text-gray-500 bg-transparent border-0 focus:ring-0 cursor-pointer shrink-0 max-w-[7rem]">';
    order.forEach(function(g){
      html += '<optgroup label="'+esc(g)+'">';
      groups[g].forEach(function(t){ html += '<option value="'+t.value+'"'+(t.value===cur?' selected':'')+'>'+esc(t.label)+'</option>'; });
      html += '</optgroup>';
    });
    return html + '</select>';
  }
  function mapSelectHtml(){
    var html = '<select data-prop="mapTo" class="'+INCLS+'"><option value="">Custom data</option>';
    MAPPINGS.forEach(function(m){ html += '<option value="'+esc(m.value)+'">'+esc(m.label)+'</option>'; });
    return html + '</select>';
  }
  function iconSvg(d, cls){ return '<svg class="'+cls+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" stroke-linejoin="round" d="'+d+'"/></svg>'; }

  function cardHtml(f){
    var isHeading = f.type==='heading';
    var settings = '';
    if (!isHeading){
      var rows = '';
      if (TEXTY[f.type]) rows += field('Placeholder', '<input data-prop="placeholder" class="'+INCLS+'">');
      if (OPTION_TYPES[f.type]) rows += field('Options (one per line)', '<textarea data-prop="options" rows="3" class="'+INCLS+'"></textarea>');
      if (f.type==='rating') rows += field('Number of stars', '<input data-prop="max" type="number" min="3" max="10" class="'+INCLS+'">');
      if (f.type==='scale'){
        rows += '<div class="grid grid-cols-2 gap-2">'+field('From','<input data-prop="min" type="number" min="0" max="1" class="'+INCLS+'">')+field('To','<input data-prop="max" type="number" min="2" max="11" class="'+INCLS+'">')+'</div>';
        rows += '<div class="grid grid-cols-2 gap-2">'+field('Low label','<input data-prop="minLabel" class="'+INCLS+'">')+field('High label','<input data-prop="maxLabel" class="'+INCLS+'">')+'</div>';
      }
      if (f.type==='file') rows += field('Accepted files (hint)', '<input data-prop="accept" placeholder="e.g. PDFs and images" class="'+INCLS+'">');
      rows += field('Help text', '<input data-prop="helpText" class="'+INCLS+'">');
      rows += '<div class="grid grid-cols-2 gap-2">'+field('Width','<select data-prop="width" class="'+INCLS+'"><option value="full">Full</option><option value="half">Half</option></select>')+field('Maps to', mapSelectHtml())+'</div>';
      rows += '<label class="flex items-center gap-2 text-sm mt-1"><input type="checkbox" data-prop="required" class="accent-horizon-600"> Required</label>';
      settings = '<div class="fb-body hidden mt-3 pt-3 border-t border-gray-100 space-y-2">'+rows+'</div>';
    }
    return '<div class="fb-card bg-white border border-gray-200 rounded-xl p-3" data-fid="'+f.id+'">'
      + '<div class="flex items-center gap-2">'
      +   '<span class="fb-handle cursor-grab text-gray-300 hover:text-gray-500 shrink-0" title="Drag to reorder"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg></span>'
      +   '<span class="text-gray-400 shrink-0">'+iconSvg(TYPE_ICON[f.type]||'', 'w-4 h-4')+'</span>'
      +   '<input data-prop="label" placeholder="'+(isHeading?'Section heading':'Field label')+'" class="flex-1 min-w-0 font-medium text-gray-900 text-sm bg-transparent border-0 focus:ring-0 px-0">'
      +   typeSelectHtml(f.type)
      +   '<button type="button" data-act="up" class="text-gray-400 hover:text-gray-700 shrink-0 px-1" title="Move up">&#9650;</button>'
      +   '<button type="button" data-act="down" class="text-gray-400 hover:text-gray-700 shrink-0 px-1" title="Move down">&#9660;</button>'
      +   (isHeading ? '' : '<button type="button" data-act="toggle" class="text-gray-400 hover:text-gray-700 shrink-0" title="Settings">'+iconSvg('M10.3 3.3a1 1 0 011.4 0l.5.6a1 1 0 00.9.3 1 1 0 011.2.8l.1.8a1 1 0 00.6.6 1 1 0 01.5 1.4l-.4.7a1 1 0 000 .9l.4.7a1 1 0 01-.5 1.4 1 1 0 00-.6.6l-.1.8a1 1 0 01-1.2.8 1 1 0 00-.9.3l-.5.6a1 1 0 01-1.4 0M12 9a3 3 0 100 6 3 3 0 000-6z','w-4 h-4')+'</button>')
      +   '<button type="button" data-act="del" class="text-gray-300 hover:text-red-500 shrink-0" title="Delete">'+iconSvg('M6 7h12M9 7V5h6v2m-1 0v12H10V7M5 7l1 13h12l1-13','w-4 h-4')+'</button>'
      + '</div>'
      + settings
      + '</div>';
  }

  function setVal(card, prop, val){ var el = card.querySelector('[data-prop="'+prop+'"]'); if(el) el.value = (val==null?'':val); }
  function setChk(card, prop, on){ var el = card.querySelector('[data-prop="'+prop+'"]'); if(el) el.checked = !!on; }

  function render(){
    list.innerHTML = fields.map(cardHtml).join('');
    fields.forEach(function(f){
      var card = list.querySelector('.fb-card[data-fid="'+f.id+'"]'); if(!card) return;
      setVal(card,'label',f.label); setVal(card,'placeholder',f.placeholder); setVal(card,'options',f.options);
      setVal(card,'helpText',f.helpText); setVal(card,'width',f.width||'full'); setVal(card,'mapTo',f.mapTo);
      setVal(card,'max',f.max); setVal(card,'min',f.min); setVal(card,'minLabel',f.minLabel); setVal(card,'maxLabel',f.maxLabel);
      setVal(card,'accept',f.accept); setChk(card,'required',f.required);
    });
    if (countEl) countEl.textContent = fields.length;
  }

  function onEdit(el){
    if (!el || !el.getAttribute) return;
    var prop = el.getAttribute('data-prop'); if(!prop || prop==='type') return;
    var card = el.closest('.fb-card'); if(!card) return;
    var f = byId(card.getAttribute('data-fid')); if(!f) return;
    f[prop] = (el.type==='checkbox') ? el.checked : el.value;
  }
  root.addEventListener('input', function(e){ onEdit(e.target); });
  root.addEventListener('change', function(e){
    var el = e.target;
    if (el.getAttribute && el.getAttribute('data-prop')==='type'){
      var card = el.closest('.fb-card'); var f = card && byId(card.getAttribute('data-fid')); if(!f) return;
      f.type = el.value;
      if (f.type==='rating' && !f.max) f.max = 5;
      if (f.type==='scale'){ if(f.min==null||f.min==='')f.min=1; if(f.max==null||f.max==='')f.max=10; }
      if (OPTION_TYPES[f.type] && !f.options) f.options = 'Option 1\\nOption 2';
      render();
    } else { onEdit(el); }
  });

  root.addEventListener('click', function(e){
    var btn = e.target.closest('[data-act]'); if(!btn) return;
    var act = btn.getAttribute('data-act');
    if (act==='add'){ toggleMenu(); return; }
    if (act==='addtype'){ addField(btn.getAttribute('data-type')); toggleMenu(false); return; }
    var card = btn.closest('.fb-card'); if(!card) return;
    var id = card.getAttribute('data-fid');
    if (act==='del'){ if(confirm('Delete this field?')){ fields = fields.filter(function(f){return f.id!==id;}); render(); } }
    else if (act==='up'){ move(id,-1); }
    else if (act==='down'){ move(id,1); }
    else if (act==='toggle'){ var b=card.querySelector('.fb-body'); if(b) b.classList.toggle('hidden'); }
  });

  function move(id, dir){
    var i = fields.findIndex(function(f){return f.id===id;}); var j = i+dir;
    if (i<0||j<0||j>=fields.length) return;
    var t = fields[i]; fields[i]=fields[j]; fields[j]=t; render();
  }
  function addField(type){
    var f = { id: gen(), type: type, label: TYPE_LABEL[type]||'Field', width:'full' };
    if (type==='heading') f.label = 'Section heading';
    if (type==='rating') f.max = 5;
    if (type==='scale'){ f.min=1; f.max=10; }
    if (OPTION_TYPES[type]) f.options = 'Option 1\\nOption 2';
    fields.push(f); render();
    var card = list.querySelector('.fb-card[data-fid="'+f.id+'"]');
    if (card){ card.scrollIntoView({block:'center'}); var b=card.querySelector('.fb-body'); if(b) b.classList.remove('hidden'); var lab=card.querySelector('[data-prop="label"]'); if(lab) lab.focus(); }
  }

  function menuHtml(){
    var groups = {}, order = [];
    TYPES.forEach(function(t){ if(!groups[t.group]){groups[t.group]=[];order.push(t.group);} groups[t.group].push(t); });
    return order.map(function(g){
      return '<div class="px-2 pt-2 pb-1 text-xs font-bold text-gray-400 uppercase tracking-wide">'+esc(g)+'</div>'
        + '<div class="grid grid-cols-2 gap-1">'
        + groups[g].map(function(t){
            return '<button type="button" data-act="addtype" data-type="'+t.value+'" class="flex items-center gap-2 text-left px-2 py-2 rounded-lg hover:bg-papaya-50 text-sm text-gray-700">'
              + '<span class="text-gray-400 shrink-0">'+iconSvg(t.icon,'w-4 h-4')+'</span>'+esc(t.label)+'</button>';
          }).join('') + '</div>';
    }).join('');
  }
  var menuOpen = false;
  function toggleMenu(force){
    menuOpen = (force===undefined) ? !menuOpen : force;
    if (menuOpen){ menu.innerHTML = menuHtml(); menu.classList.remove('hidden'); } else menu.classList.add('hidden');
  }
  document.addEventListener('click', function(e){ if(menuOpen && !menu.contains(e.target) && !e.target.closest('[data-act="add"]')) toggleMenu(false); });

  // drag reorder, initiated from the handle
  var dragId = null;
  list.addEventListener('mousedown', function(e){ var h=e.target.closest('.fb-handle'); if(h){ var c=h.closest('.fb-card'); if(c) c.setAttribute('draggable','true'); } });
  list.addEventListener('dragstart', function(e){ var c=e.target.closest('.fb-card'); if(c){ dragId=c.getAttribute('data-fid'); c.style.opacity='0.4'; } });
  list.addEventListener('dragend', function(e){ var c=e.target.closest('.fb-card'); if(c){ c.style.opacity=''; c.removeAttribute('draggable'); } dragId=null; });
  list.addEventListener('dragover', function(e){ e.preventDefault(); });
  list.addEventListener('drop', function(e){
    e.preventDefault(); var over=e.target.closest('.fb-card'); if(!over||!dragId) return;
    var overId=over.getAttribute('data-fid'); if(overId===dragId) return;
    var from=fields.findIndex(function(f){return f.id===dragId;});
    var to=fields.findIndex(function(f){return f.id===overId;});
    if(from<0||to<0) return;
    var moved=fields.splice(from,1)[0]; fields.splice(to,0,moved); render();
  });

  form.addEventListener('submit', function(){ input.value = JSON.stringify(fields); });
  render();
})();
`
}

export default forms
