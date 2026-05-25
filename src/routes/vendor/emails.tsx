import { Hono } from 'hono'
import type { Env } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { listEmails, getEmail, getEmailThread, markEmailRead, countUnread } from '../../db/emails'
import { sendEmailMessage } from '../../services/email'
import { formatDate } from '../../lib/date'
import { sanitize, sanitizeHtml } from '../../lib/validation'
import { auditLog } from '../../middleware/audit'

const emails = new Hono<Env>()

emails.use('/app/*', requireAuth, csrf, requireVendor)

// ─── Email list (inbox / sent) ───
emails.get('/app/emails', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const tab = c.req.query('tab') ?? 'inbox'
  const direction = tab === 'sent' ? 'outbound' : 'inbound'

  const items = await listEmails(c.env.DB, vendor.id, direction as 'inbound' | 'outbound')
  const unreadCount = await countUnread(c.env.DB, vendor.id)

  return c.html(
    <AppLayout title="Emails" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-3xl">
        {/* Header */}
        <div class="flex items-center justify-between gap-4 mb-6">
          <div>
            {unreadCount > 0 && (
              <p class="text-sm text-gray-500">{unreadCount} unread</p>
            )}
          </div>
          <a
            href="/app/emails/compose"
            class="bg-horizon-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            Compose
          </a>
        </div>

        {!vendor.email_handle && (
          <div class="bg-papaya-100 border border-papaya-300/50 rounded-xl p-4 mb-4 text-sm">
            <p class="font-bold text-gray-900 mb-1">Set up your email handle</p>
            <p class="text-gray-600 mb-2">
              Choose a handle to send and receive emails as <strong>you@wedding.computer</strong>.
            </p>
            <a href="/app/settings" class="text-horizon-700 font-bold hover:underline">
              Go to settings
            </a>
          </div>
        )}

        {/* Tabs */}
        <div class="flex gap-1 mb-4 border-b border-papaya-300/30">
          <a
            href="/app/emails"
            class={`px-4 py-2 text-sm font-medium border-b-2 ${
              tab === 'inbox'
                ? 'border-horizon-600 text-horizon-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Inbox
            {unreadCount > 0 && (
              <span class="ml-1.5 bg-grapefruit-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </a>
          <a
            href="/app/emails?tab=sent"
            class={`px-4 py-2 text-sm font-medium border-b-2 ${
              tab === 'sent'
                ? 'border-horizon-600 text-horizon-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Sent
          </a>
        </div>

        {/* Email list */}
        {items.length === 0 ? (
          <div class="text-center py-12">
            <p class="text-gray-500 text-sm">
              {tab === 'inbox' ? 'No emails received yet' : 'No emails sent yet'}
            </p>
          </div>
        ) : (
          <div class="bg-white border border-papaya-300/30 rounded-2xl divide-y divide-gray-100">
            {items.map((email) => (
              <a
                href={`/app/emails/${email.id}`}
                class={`block px-4 py-3 hover:bg-papaya-50 transition-colors ${
                  !email.is_read && direction === 'inbound' ? 'bg-horizon-50/30' : ''
                }`}
              >
                <div class="flex items-start gap-3">
                  {!email.is_read && direction === 'inbound' && (
                    <div class="w-2 h-2 mt-2 rounded-full bg-horizon-600 flex-shrink-0" />
                  )}
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-2 mb-0.5">
                      <p class={`text-sm truncate ${!email.is_read && direction === 'inbound' ? 'font-bold' : 'font-medium'} text-gray-900`}>
                        {direction === 'inbound'
                          ? (email.from_name ?? email.from_email)
                          : (email.to_name ?? email.to_email)}
                      </p>
                      <p class="text-xs text-gray-400 whitespace-nowrap">{formatDate(email.created_at)}</p>
                    </div>
                    <p class={`text-sm truncate ${!email.is_read && direction === 'inbound' ? 'text-gray-900' : 'text-gray-600'}`}>
                      {email.subject}
                    </p>
                    {email.body_text && (
                      <p class="text-xs text-gray-400 truncate mt-0.5">
                        {email.body_text.slice(0, 100)}
                      </p>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
})

// ─── Compose new email ───
emails.get('/app/emails/compose', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const sent = c.req.query('sent')
  const error = c.req.query('error')

  if (!vendor.email_handle) {
    return c.redirect('/app/settings')
  }

  return c.html(
    <AppLayout title="Compose" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-2xl">
        <p class="text-sm text-gray-500 mb-4">
          <a href="/app/emails" class="hover:text-horizon-700">Emails</a> / Compose
        </p>

        {sent && (
          <div class="bg-horizon-50 border border-horizon-600/20 text-horizon-700 text-sm font-bold rounded-xl p-3 mb-4">
            Email sent successfully
          </div>
        )}

        {error && (
          <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm rounded-xl p-3 mb-4">
            {decodeURIComponent(error)}
          </div>
        )}

        <form method="post" action="/app/emails/send" class="space-y-4">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />

          <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
            <p class="text-xs text-gray-400">
              From: {vendor.business_name} &lt;{vendor.email_handle}@wedding.computer&gt;
            </p>
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1">To</label>
              <input
                type="email"
                name="to"
                required
                autofocus
                placeholder="email@example.com"
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1">Subject</label>
              <input
                type="text"
                name="subject"
                required
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1">Message</label>
              <textarea
                name="body"
                rows={10}
                required
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
            </div>
          </div>

          <div class="flex gap-2">
            <button
              type="submit"
              class="flex-1 bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Send
            </button>
            <a
              href="/app/emails"
              class="border border-gray-200 py-3 px-6 rounded-xl text-sm hover:bg-papaya-50 transition-colors text-center"
            >
              Cancel
            </a>
          </div>
        </form>
      </div>
    </AppLayout>
  )
})

// ─── Send email (compose + reply) ───
emails.post('/app/emails/send', async (c) => {
  const vendor = c.get('vendor')!
  const user = c.get('user')

  if (!vendor.email_handle) {
    return c.redirect('/app/settings')
  }

  const body = await c.req.parseBody()
  const to = String(body.to).trim()
  const subject = String(body.subject).trim()
  const text = String(body.body).trim()
  const inReplyTo = (body.in_reply_to as string) || null
  const threadId = (body.thread_id as string) || null
  const contactId = (body.contact_id as string) || null

  if (!to || !subject || !text) {
    return c.redirect('/app/emails/compose?error=All+fields+are+required')
  }

  const html = `<div style="font-family: -apple-system, system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px;">
    ${text
      .split('\n')
      .map((line: string) => (line.trim() ? `<p style="margin: 0 0 12px;">${sanitize(line)}</p>` : ''))
      .join('')}
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
    <p style="color: #888; font-size: 13px;">
      ${sanitize(vendor.business_name)}<br/>
      ${vendor.phone ? sanitize(vendor.phone) + '<br/>' : ''}
      ${vendor.website ? sanitize(vendor.website) : ''}
    </p>
  </div>`

  try {
    await sendEmailMessage({
      db: c.env.DB,
      resendApiKey: c.env.RESEND_API_KEY,
      vendorId: vendor.id,
      contactId,
      to,
      subject,
      html,
      text,
      from: `${vendor.email_handle}@wedding.computer`,
      fromName: vendor.business_name,
      replyTo: `${vendor.email_handle}@wedding.computer`,
      inReplyTo,
      threadId,
    })

    await auditLog(c, 'email_sent', 'email', undefined, { to }).catch(() => {})
    return c.redirect('/app/emails?tab=sent')
  } catch (e: any) {
    return c.redirect(`/app/emails/compose?error=${encodeURIComponent(e.message)}`)
  }
})

// ─── View email ───
emails.get('/app/emails/:id', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const email = await getEmail(c.env.DB, vendor.id, c.req.param('id'))
  if (!email) return c.redirect('/app/emails')

  if (!email.is_read && email.direction === 'inbound') {
    await markEmailRead(c.env.DB, vendor.id, email.id)
  }

  const threadId = email.thread_id ?? email.message_id
  const thread = threadId ? await getEmailThread(c.env.DB, vendor.id, threadId) : []
  const otherMessages = thread.filter((e) => e.id !== email.id)

  return c.html(
    <AppLayout title={email.subject} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-3xl">
        <p class="text-sm text-gray-500 mb-4">
          <a href={`/app/emails${email.direction === 'outbound' ? '?tab=sent' : ''}`} class="hover:text-horizon-700">
            {email.direction === 'inbound' ? 'Inbox' : 'Sent'}
          </a>{' '}
          /
        </p>

        <div class="bg-white border border-papaya-300/30 rounded-2xl overflow-hidden">
          {/* Header */}
          <div class="px-5 py-4 border-b border-gray-100">
            <h2 class="text-lg font-bold mb-2">{email.subject}</h2>
            <div class="flex items-center justify-between gap-4">
              <div class="text-sm text-gray-600">
                <span class="font-medium text-gray-900">
                  {email.direction === 'inbound'
                    ? (email.from_name ?? email.from_email)
                    : `To: ${email.to_name ?? email.to_email}`}
                </span>
                {email.direction === 'inbound' && (
                  <span class="text-gray-400 ml-1">&lt;{email.from_email}&gt;</span>
                )}
              </div>
              <p class="text-xs text-gray-400 whitespace-nowrap">{formatDate(email.created_at)}</p>
            </div>
            {email.direction === 'outbound' && email.status && (
              <div class="mt-1">
                <StatusBadge status={email.status} />
              </div>
            )}
          </div>

          {/* Body */}
          <div class="px-5 py-4">
            {email.body_html ? (
              <div
                class="prose prose-sm max-w-none text-gray-700"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(email.body_html) }}
              />
            ) : email.body_text ? (
              <pre class="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                {email.body_text}
              </pre>
            ) : (
              <p class="text-sm text-gray-400 italic">No content</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div class="flex gap-2 mt-4">
          {email.direction === 'inbound' && vendor.email_handle && (
            <a
              href={`/app/emails/${email.id}/reply`}
              class="bg-horizon-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Reply
            </a>
          )}
          <a
            href={`/app/emails${email.direction === 'outbound' ? '?tab=sent' : ''}`}
            class="border border-gray-200 px-4 py-2.5 rounded-xl text-sm hover:bg-papaya-50 transition-colors"
          >
            Back
          </a>
        </div>

        {/* Thread */}
        {otherMessages.length > 0 && (
          <div class="mt-6">
            <h3 class="text-sm font-bold text-gray-500 mb-3">Conversation ({thread.length} messages)</h3>
            <div class="space-y-2">
              {otherMessages.map((msg) => (
                <a
                  href={`/app/emails/${msg.id}`}
                  class={`block bg-white border border-papaya-300/30 rounded-xl px-4 py-3 hover:bg-papaya-50 transition-colors`}
                >
                  <div class="flex items-center justify-between gap-2 mb-0.5">
                    <p class="text-sm font-medium text-gray-900 truncate">
                      {msg.direction === 'inbound'
                        ? (msg.from_name ?? msg.from_email)
                        : `You → ${msg.to_name ?? msg.to_email}`}
                    </p>
                    <p class="text-xs text-gray-400 whitespace-nowrap">{formatDate(msg.created_at)}</p>
                  </div>
                  {msg.body_text && (
                    <p class="text-xs text-gray-500 truncate">{msg.body_text.slice(0, 120)}</p>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
})

// ─── Reply form ───
emails.get('/app/emails/:id/reply', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const email = await getEmail(c.env.DB, vendor.id, c.req.param('id'))
  if (!email) return c.redirect('/app/emails')

  if (!vendor.email_handle) {
    return c.redirect('/app/settings')
  }

  const replySubject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`

  return c.html(
    <AppLayout title="Reply" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-2xl">
        <p class="text-sm text-gray-500 mb-4">
          <a href={`/app/emails/${email.id}`} class="hover:text-horizon-700">{email.subject}</a> / Reply
        </p>

        <form method="post" action="/app/emails/send" class="space-y-4">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
          <input type="hidden" name="in_reply_to" value={email.message_id ?? ''} />
          <input type="hidden" name="thread_id" value={email.thread_id ?? email.message_id ?? ''} />
          <input type="hidden" name="contact_id" value={email.contact_id ?? ''} />

          <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1">To</label>
              <input
                type="email"
                name="to"
                value={email.from_email}
                required
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1">Subject</label>
              <input
                type="text"
                name="subject"
                value={replySubject}
                required
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1">Message</label>
              <textarea
                name="body"
                rows={10}
                required
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent"
              />
            </div>

            {/* Original message */}
            <div class="border-t border-gray-100 pt-3">
              <p class="text-xs text-gray-400 mb-2">
                On {formatDate(email.created_at)}, {email.from_name ?? email.from_email} wrote:
              </p>
              <div class="text-xs text-gray-400 border-l-2 border-gray-200 pl-3">
                {email.body_text
                  ? email.body_text.slice(0, 500)
                  : '(no text content)'}
              </div>
            </div>
          </div>

          <div class="flex gap-2">
            <button
              type="submit"
              class="flex-1 bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Send reply
            </button>
            <a
              href={`/app/emails/${email.id}`}
              class="border border-gray-200 py-3 px-6 rounded-xl text-sm hover:bg-papaya-50 transition-colors text-center"
            >
              Cancel
            </a>
          </div>
        </form>
      </div>
    </AppLayout>
  )
})

export default emails

// ─── Components ───

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    sent: 'bg-green-50 text-green-700',
    queued: 'bg-yellow-50 text-yellow-700',
    failed: 'bg-grapefruit-50 text-grapefruit-700',
    draft: 'bg-gray-100 text-gray-600',
    received: 'bg-horizon-50 text-horizon-700',
  }
  return (
    <span class={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}
