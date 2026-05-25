import { Hono } from 'hono'
import type { Env } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { getContractTemplate, upsertContractTemplate } from '../../db/contracts'

const contracts = new Hono<Env>()

contracts.use('/app/contract', requireAuth, requireVendor, csrf)

contracts.get('/app/contract', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const template = await getContractTemplate(c.env.DB, vendor.id)

  const inputClass = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent'

  return c.html(
    <AppLayout title="Service Contract" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 class="text-xl font-bold">Service contract template</h1>
          <p class="text-sm text-gray-500 mt-1">
            Write your default service agreement. This will be shown to couples when they confirm a booking.
            You can customise it per wedding when creating an invoice.
          </p>
        </div>

        <form method="post" class="space-y-4">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-1.5" for="title">Contract title</label>
            <input
              type="text"
              id="title"
              name="title"
              value={template?.title ?? 'Service Agreement'}
              class={inputClass}
              placeholder="Service Agreement"
            />
          </div>

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-1.5" for="body">Contract text</label>
            <p class="text-xs text-gray-400 mb-2">Plain text. Use blank lines between paragraphs.</p>
            <textarea
              id="body"
              name="body"
              rows={20}
              class={`${inputClass} font-mono text-xs leading-relaxed`}
              placeholder={'e.g.\n\nSERVICE AGREEMENT\n\nThis agreement is between [Vendor Name] ("the vendor") and the client(s) named below.\n\n1. SERVICES\nThe vendor agrees to provide the following services...\n\n2. PAYMENT TERMS\n...\n\n3. CANCELLATION POLICY\n...'}
            >{template?.body ?? ''}</textarea>
          </div>

          <div class="flex items-center gap-3">
            <button
              type="submit"
              class="bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
            >
              Save template
            </button>
            {template && (
              <span class="text-xs text-gray-400">Last saved {template.updated_at}</span>
            )}
          </div>
        </form>

        <div class="bg-papaya-100 rounded-xl p-4">
          <p class="text-xs text-gray-600 leading-relaxed">
            <strong>How it works:</strong> When you create an invoice with a booking link, your contract template is
            automatically attached. The couple must read and sign it before confirming their booking.
            Each signed contract is stored as a legal record with their name, email, timestamp, and IP address.
          </p>
        </div>
      </div>
    </AppLayout>
  )
})

contracts.post('/app/contract', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()

  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Service Agreement'
  const contractBody = typeof body.body === 'string' ? body.body.trim() : ''

  if (!contractBody) return c.redirect('/app/contract')

  await upsertContractTemplate(c.env.DB, vendor.id, { title, body: contractBody })

  return c.redirect('/app/contract')
})

export default contracts
