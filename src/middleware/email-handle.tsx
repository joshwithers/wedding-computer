import { createMiddleware } from 'hono/factory'
import type { Env } from '../types'
import { AppLayout } from '../views/layouts/app'

// Forms send and receive email on the vendor's behalf — confirmations to
// couples and notifications to the vendor. We keep all of that on our own
// domain (handle@wedding.computer) so it's SPF/DKIM/DMARC-aligned and lands in
// the inbox, and so replies + new-message alerts actually reach them. So a
// vendor must claim their handle before any form surface.
//
// Defensive: only acts when a vendor IS in context but has no handle. If no
// vendor is set (an unauthenticated path slipping through), it defers to the
// real auth/tenant guards rather than rendering a gate.
export const requireEmailHandle = createMiddleware<Env>(async (c, next) => {
  const vendor = c.get('vendor')
  if (!vendor || vendor.email_handle) return next()

  const user = c.get('user')
  const csrfToken = c.get('csrfToken')
  const pathname = new URL(c.req.url).pathname
  // Send them back to the base of whichever form surface they were on, e.g.
  // /app/form/add-field -> /app/form.
  const returnTo = '/' + pathname.split('/').filter(Boolean).slice(0, 2).join('/')
  const error = c.req.query('error')
  const suggested = (vendor.business_name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24)

  return c.html(
    <AppLayout title="Set up your email" user={user} vendor={vendor} csrfToken={csrfToken}>
      <EmailHandleGate csrfToken={csrfToken} returnTo={returnTo} suggested={suggested} error={error} />
    </AppLayout>
  )
})

function EmailHandleGate({
  csrfToken,
  returnTo,
  suggested,
  error,
}: {
  csrfToken?: string
  returnTo: string
  suggested: string
  error?: string
}) {
  return (
    <div class="max-w-xl">
      <div class="bg-white rounded-2xl p-5 sm:p-8">
        <span class="inline-block bg-horizon-50 text-horizon-700 text-xs font-bold px-3 py-1 rounded-full mb-4">
          One quick step
        </span>
        <h1 class="text-xl font-bold text-gray-900 mb-3">Set up your @wedding.computer address to use forms</h1>
        <p class="text-sm text-gray-600 leading-relaxed mb-4">
          Your enquiry and booking forms send email on your behalf — confirmations to couples, and
          notifications to you. We keep all of it on our own domain
          (<strong>yourname@wedding.computer</strong>) so it's properly authenticated and lands in the inbox
          instead of the spam folder.
        </p>
        <p class="text-sm text-gray-600 leading-relaxed mb-6">
          Once it's set, you'll get an email whenever a new enquiry or message comes in, and any replies go
          straight to you.
        </p>

        {error && (
          <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-3 mb-4">
            {decodeURIComponent(error)}
          </div>
        )}

        <form method="post" action="/app/settings/email-handle">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <input type="hidden" name="return" value={returnTo} />
          <label class="block text-sm font-bold text-gray-700 mb-1.5" for="email_handle">
            Choose your handle
          </label>
          <div class="flex items-center gap-0 max-w-md">
            <input
              type="text"
              id="email_handle"
              name="email_handle"
              value={suggested}
              placeholder="yourname"
              pattern="[a-z0-9\-]+"
              required
              class="flex-1 border border-gray-200 rounded-l-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
            />
            <span class="border border-l-0 border-gray-200 rounded-r-xl px-4 py-3 text-sm text-gray-500 bg-gray-50">
              @wedding.computer
            </span>
          </div>
          <p class="text-xs text-gray-400 mt-1.5">Lowercase letters, numbers and hyphens. At least 3 characters.</p>
          <button
            type="submit"
            class="mt-4 bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            Claim it &amp; continue
          </button>
        </form>
      </div>
    </div>
  )
}
