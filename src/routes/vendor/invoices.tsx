import { Hono } from 'hono'
import type { Env, Invoice, InvoicePayment, LineItem, ServiceTemplate, InvoiceDefaults } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  listPayments,
  createPayment,
  createPaymentsBatch,
  getPayment,
  recordPayment,
  deletePayment,
  generatePaymentSchedule,
  recalculateInvoiceStatus,
  calculateTax,
  calculateCardFee,
  invoiceDocumentTitle,
} from '../../db/invoices'
import { getContractTemplate, createContractForInvoice, getContractByInvoice } from '../../db/contracts'
import { requireString, trimOrNull } from '../../lib/validation'
import { formatDate } from '../../lib/date'
import { auditLog } from '../../middleware/audit'
import { track } from '../../services/analytics'

const invoices = new Hono<Env>()

invoices.use('/app/*', requireAuth, csrf, requireVendor)

// ─── Invoice list ───

invoices.get('/app/invoices', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const list = await listInvoices(c.env.DB, vendor.id)
  const filter = c.req.query('status')

  const filtered = filter ? list.filter((i) => i.status === filter) : list

  return c.html(
    <AppLayout title="Invoices" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-4xl">
        <div class="flex items-center justify-between mb-6">
          <p class="text-sm text-gray-500">
            {list.length} invoice{list.length !== 1 ? 's' : ''}
          </p>
          <a
            href="/app/invoices/new"
            class="bg-horizon-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors"
          >
            New invoice
          </a>
        </div>

        <div class="flex gap-2 mb-4 text-sm overflow-x-auto">
          <FilterTab label="All" count={list.length} href="/app/invoices" active={!filter} />
          <FilterTab label="Draft" count={list.filter((i) => i.status === 'draft').length} href="/app/invoices?status=draft" active={filter === 'draft'} />
          <FilterTab label="Sent" count={list.filter((i) => i.status === 'sent').length} href="/app/invoices?status=sent" active={filter === 'sent'} />
          <FilterTab label="Partial" count={list.filter((i) => i.status === 'partial').length} href="/app/invoices?status=partial" active={filter === 'partial'} />
          <FilterTab label="Paid" count={list.filter((i) => i.status === 'paid').length} href="/app/invoices?status=paid" active={filter === 'paid'} />
        </div>

        {filtered.length === 0 ? (
          <div class="text-center py-12 bg-white border border-papaya-300/30 rounded-2xl">
            <p class="text-gray-500 text-sm">
              {list.length === 0 ? 'No invoices yet' : 'No matching invoices'}
            </p>
          </div>
        ) : (
          <div class="space-y-2">
            {filtered.map((inv) => (
              <a
                href={`/app/invoices/${inv.id}`}
                class="flex items-center justify-between bg-white border border-papaya-300/30 rounded-xl p-4 hover:border-papaya-300 transition-colors"
              >
                <div>
                  <p class="text-sm font-bold text-gray-900">
                    {inv.invoice_number && <span class="text-gray-400 font-normal mr-1.5">{inv.invoice_number}</span>}
                    {inv.title}
                  </p>
                  <p class="text-xs text-gray-500 mt-0.5">
                    {inv.contact_name ?? 'No client'}{inv.due_date ? ` · Due ${formatDate(inv.due_date)}` : ''}
                  </p>
                </div>
                <div class="flex items-center gap-3">
                  <span class="text-sm font-bold text-gray-900">{formatCents(inv.amount_cents)}</span>
                  <StatusBadge status={inv.status} />
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
})

// ─── Create invoice ───

invoices.get('/app/invoices/new', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const contactId = c.req.query('contact')
  const weddingId = c.req.query('wedding')

  // If coming from a wedding page, look up the wedding for pre-fill
  let weddingTitle: string | null = null
  let weddingDate: string | null = null
  if (weddingId) {
    const wed = await c.env.DB
      .prepare('SELECT title, date FROM weddings WHERE id = ?')
      .bind(weddingId)
      .first<{ title: string; date: string | null }>()
    if (wed) {
      weddingTitle = wed.title
      weddingDate = wed.date
    }
  }

  const contacts = await c.env.DB
    .prepare("SELECT id, first_name, last_name, wedding_date FROM contacts WHERE vendor_id = ? AND status IN ('quoted','booked','completed') ORDER BY last_name")
    .bind(vendor.id)
    .all<{ id: string; first_name: string; last_name: string; wedding_date: string | null }>()
    .then((r) => r.results)

  // Parse service templates and invoice defaults
  let serviceTemplates: ServiceTemplate[] = []
  if (vendor.service_templates) {
    try { serviceTemplates = JSON.parse(vendor.service_templates) } catch { /* ignore */ }
  }
  let defaults: Partial<InvoiceDefaults> = {}
  if (vendor.invoice_defaults) {
    try { defaults = JSON.parse(vendor.invoice_defaults) } catch { /* ignore */ }
  }

  const defaultFeeType = defaults.booking_fee_type ?? 'fixed'
  const defaultFeeValue = defaults.booking_fee_value ?? 500
  const defaultInstallments = defaults.installments ?? 1
  const defaultNotes = defaults.notes ?? ''
  const defaultCardFee = defaults.include_card_fee ?? false

  return c.html(
    <AppLayout title="New invoice" user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-2xl">
        <p class="text-sm text-gray-500 mb-4">
          {weddingId ? (
            <span>
              <a href={`/app/weddings/${weddingId}`} class="hover:text-gray-900">{weddingTitle ?? 'Wedding'}</a> / New invoice
            </span>
          ) : (
            <span>
              <a href="/app/invoices" class="hover:text-gray-900">Invoices</a> /
            </span>
          )}
        </p>

        <form method="post" action="/app/invoices/new" class="space-y-6">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
          {weddingId && <input type="hidden" name="wedding_id" value={weddingId} />}

          {weddingTitle && (
            <div class="bg-horizon-50 border border-horizon-200 rounded-2xl px-5 py-3 flex items-center gap-2">
              <span class="text-xs font-bold text-horizon-700">Wedding:</span>
              <a href={`/app/weddings/${weddingId}`} class="text-sm font-bold text-horizon-700 hover:underline">{weddingTitle}</a>
              {weddingDate && <span class="text-xs text-horizon-600">· {formatDate(weddingDate)}</span>}
            </div>
          )}

          <section class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
            <h3 class="text-sm font-bold">Invoice details</h3>
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1" for="title">Title</label>
              <input type="text" id="title" name="title" required placeholder="e.g. Wedding Ceremony Package"
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1" for="contact_id">Client</label>
              <select id="contact_id" name="contact_id"
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600">
                <option value="">Select a contact</option>
                {contacts.map((ct) => (
                  <option value={ct.id} selected={ct.id === contactId}>
                    {ct.first_name} {ct.last_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1" for="notes">Notes</label>
              <textarea id="notes" name="notes" rows={2} placeholder="Payment terms, conditions, etc."
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600">{defaultNotes}</textarea>
            </div>
          </section>

          <section class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
            <h3 class="text-sm font-bold">Services</h3>
            <p class="text-xs text-gray-500">Add line items for each service included.</p>

            {serviceTemplates.length > 0 && (
              <div class="flex items-center gap-2">
                <select id="svc-template-picker"
                  class="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600">
                  <option value="">Quick add from your services…</option>
                  {serviceTemplates.map((t, i) => (
                    <option value={String(i)}>
                      {t.name} — ${(t.price_cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
                    </option>
                  ))}
                </select>
                <button type="button" id="add-from-template-btn"
                  class="bg-horizon-600 text-white px-3 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors whitespace-nowrap">
                  Add
                </button>
              </div>
            )}

            <div id="line-items" class="space-y-3">
              <LineItemRow index={0} />
            </div>

            <button type="button"
              onclick="addLineItem()"
              class="text-sm text-horizon-600 font-bold hover:text-horizon-700">
              + Add blank service
            </button>
          </section>

          <section class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
            <h3 class="text-sm font-bold">Booking fee</h3>
            <p class="text-xs text-gray-500">Required deposit to secure the booking.</p>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-bold text-gray-700 mb-1" for="booking_fee_type">Type</label>
                <select id="booking_fee_type" name="booking_fee_type"
                  class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600">
                  <option value="fixed" selected={defaultFeeType === 'fixed'}>Fixed amount</option>
                  <option value="percentage" selected={defaultFeeType === 'percentage'}>Percentage</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-bold text-gray-700 mb-1" for="booking_fee_value">Amount</label>
                <input type="number" id="booking_fee_value" name="booking_fee_value" min="0" step="1" value={String(defaultFeeValue)} placeholder="500"
                  class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
                <p class="text-xs text-gray-400 mt-1" id="fee-hint">Dollars for fixed, whole number for %</p>
              </div>
            </div>
          </section>

          {/* Tax & fee info */}
          {(vendor.tax_rate > 0 || (vendor.card_fee_enabled === 1 && vendor.card_fee_percent > 0)) && (
            <section class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
              <h3 class="text-sm font-bold">Tax &amp; fees</h3>
              {vendor.tax_rate > 0 && (
                <div class="flex items-center gap-2 text-sm">
                  <span class="text-gray-500">{vendor.tax_label ?? 'Tax'} ({vendor.tax_rate}%)</span>
                  <span class="text-xs text-gray-400">
                    · Prices are {vendor.tax_inclusive ? 'inclusive' : 'exclusive'} of {vendor.tax_label ?? 'tax'}
                  </span>
                </div>
              )}
              {vendor.card_fee_enabled === 1 && vendor.card_fee_percent > 0 && (
                <label class="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" name="include_card_fee" value="1" checked={defaultCardFee}
                    class="w-4 h-4 rounded border-gray-300 text-horizon-600 focus:ring-horizon-600" />
                  <span class="text-sm text-gray-700">
                    Add credit card surcharge ({vendor.card_fee_percent}%)
                  </span>
                  <span class="text-xs text-gray-400">Passed on to client</span>
                </label>
              )}
            </section>
          )}

          <section class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
            <h3 class="text-sm font-bold">Payment schedule</h3>
            <p class="text-xs text-gray-500">How many installments after the booking fee?</p>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-bold text-gray-700 mb-1" for="installments">Installments</label>
                <select id="installments" name="installments"
                  class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600">
                  <option value="1" selected={defaultInstallments === 1}>1 (final payment)</option>
                  <option value="2" selected={defaultInstallments === 2}>2 payments</option>
                  <option value="3" selected={defaultInstallments === 3}>3 payments</option>
                  <option value="4" selected={defaultInstallments === 4}>4 payments</option>
                  <option value="6" selected={defaultInstallments === 6}>6 payments</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-bold text-gray-700 mb-1" for="wedding_date">Wedding date</label>
                <input type="date" id="wedding_date" name="wedding_date" value={weddingDate ?? ''}
                  class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
                <p class="text-xs text-gray-400 mt-1">Used to space out payments</p>
              </div>
            </div>
          </section>

          <input type="hidden" name="item_count" value="1" />

          <button type="submit"
            class="w-full bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
            Create invoice
          </button>
        </form>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        var lineItemCount = 1;
        var serviceTemplates = ${JSON.stringify(serviceTemplates)};

        function addLineItem(desc, qty, price) {
          var container = document.getElementById('line-items');
          var idx = lineItemCount++;
          var div = document.createElement('div');
          div.className = 'grid grid-cols-12 gap-2 items-end';
          div.innerHTML = '<div class="col-span-6"><input type="text" name="item_desc_' + idx + '" required placeholder="Service description" value="' + (desc || '').replace(/"/g, '&quot;') + '" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" /></div><div class="col-span-2"><input type="number" name="item_qty_' + idx + '" value="' + (qty || 1) + '" min="1" required class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" /></div><div class="col-span-3"><input type="number" name="item_price_' + idx + '" required min="0" step="0.01" placeholder="0.00" value="' + (price || '') + '" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" /></div><div class="col-span-1"><button type="button" onclick="this.closest(\\'.grid\\').remove()" class="text-gray-400 hover:text-grapefruit-700 text-sm p-2">✕</button></div>';
          container.appendChild(div);
          document.querySelector('input[name="item_count"]').value = lineItemCount;
        }

        var tplBtn = document.getElementById('add-from-template-btn');
        if (tplBtn) {
          tplBtn.addEventListener('click', function() {
            var picker = document.getElementById('svc-template-picker');
            var idx = parseInt(picker.value);
            if (isNaN(idx) || !serviceTemplates[idx]) return;
            var t = serviceTemplates[idx];
            addLineItem(t.description, 1, (t.price_cents / 100).toFixed(2));
            picker.value = '';
          });
        }
      ` }} />
    </AppLayout>
  )
})

invoices.post('/app/invoices/new', async (c) => {
  const vendor = c.get('vendor')!
  const body = await c.req.parseBody()

  try {
    const title = requireString(body.title, 'Title')
    const contactId = trimOrNull(body.contact_id)
    const weddingId = trimOrNull(body.wedding_id)

    const lineItems: LineItem[] = []
    const itemCount = parseInt(String(body.item_count || '10'))
    for (let i = 0; i <= itemCount; i++) {
      const desc = trimOrNull(body[`item_desc_${i}`])
      const qty = parseInt(String(body[`item_qty_${i}`] || '0'))
      const price = parseFloat(String(body[`item_price_${i}`] || '0'))
      if (desc && qty > 0 && price > 0) {
        lineItems.push({
          description: desc,
          quantity: qty,
          amount_cents: Math.round(price * 100),
        })
      }
    }

    if (lineItems.length === 0) {
      return c.redirect('/app/invoices/new?error=Add+at+least+one+service')
    }

    const totalCents = lineItems.reduce((sum, li) => sum + li.amount_cents * li.quantity, 0)
    const feeType = (body.booking_fee_type === 'percentage' ? 'percentage' : 'fixed') as 'fixed' | 'percentage'
    const feeRaw = parseInt(String(body.booking_fee_value || '0'))
    const feeValue = feeType === 'fixed' ? feeRaw * 100 : feeRaw

    const includeCardFee = body.include_card_fee === '1'

    const invoice = await createInvoice(c.env.DB, vendor.id, vendor, {
      contact_id: contactId,
      wedding_id: weddingId,
      title,
      amount_cents: totalCents,
      line_items: lineItems,
      booking_fee_type: feeType,
      booking_fee_value: feeValue,
      notes: trimOrNull(body.notes),
      include_card_fee: includeCardFee,
    })

    const installments = parseInt(String(body.installments || '1'))
    const weddingDate = trimOrNull(body.wedding_date)
    const schedule = generatePaymentSchedule(totalCents, feeType, feeValue, installments, weddingDate)

    await createPaymentsBatch(c.env.DB, vendor.id, invoice.id, schedule)

    if (schedule.length > 0) {
      await updateInvoice(c.env.DB, vendor.id, invoice.id, {
        due_date: schedule[0].due_date,
      })
    }

    track(c.env.DB, vendor.id, 'invoice_created', {
      contactId: contactId ?? undefined,
      invoiceId: invoice.id,
      metadata: { amount_cents: totalCents },
    })

    // Auto-attach contract template if vendor has one
    const contractTemplate = await getContractTemplate(c.env.DB, vendor.id)
    if (contractTemplate) {
      await createContractForInvoice(
        c.env.DB,
        vendor.id,
        invoice.id,
        invoice.wedding_id,
        { title: contractTemplate.title, body: contractTemplate.body }
      )
    }

    return c.redirect(`/app/invoices/${invoice.id}`)
  } catch (e: any) {
    return c.redirect(`/app/invoices/new?error=${encodeURIComponent(e.message)}`)
  }
})

// ─── Invoice detail ───

invoices.get('/app/invoices/:id', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const invoice = await getInvoice(c.env.DB, vendor.id, c.req.param('id'))
  if (!invoice) return c.text('Invoice not found', 404)

  const payments = await listPayments(c.env.DB, invoice.id)
  const items: LineItem[] = invoice.line_items ? JSON.parse(invoice.line_items) : []
  const contract = await getContractByInvoice(c.env.DB, invoice.id)

  const contact = invoice.contact_id
    ? await c.env.DB
        .prepare('SELECT first_name, last_name, email FROM contacts WHERE id = ?')
        .bind(invoice.contact_id)
        .first<{ first_name: string; last_name: string; email: string | null }>()
    : null

  const wedding = invoice.wedding_id
    ? await c.env.DB
        .prepare('SELECT id, title, date FROM weddings WHERE id = ?')
        .bind(invoice.wedding_id)
        .first<{ id: string; title: string; date: string | null }>()
    : null

  const paidTotal = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount_cents, 0)
  const outstanding = invoice.amount_cents - paidTotal

  const docTitle = invoiceDocumentTitle(invoice.tax_label, invoice.tax_rate)

  return c.html(
    <AppLayout title={invoice.title} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-2xl">
        <p class="text-sm text-gray-500 mb-1">
          <a href="/app/invoices" class="hover:text-gray-900">Invoices</a> /
        </p>

        <div class="flex items-start justify-between mb-6">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-xl font-bold">{invoice.title}</h2>
              {invoice.invoice_number && (
                <span class="text-sm text-gray-400 font-normal">{invoice.invoice_number}</span>
              )}
            </div>
            {docTitle !== 'Invoice' && (
              <p class="text-xs font-bold text-horizon-600 mt-0.5">{docTitle}</p>
            )}
            <div class="flex items-center gap-2 mt-0.5 flex-wrap">
              {contact && (
                <p class="text-sm text-gray-500">{contact.first_name} {contact.last_name}</p>
              )}
              {wedding && (
                <a href={`/app/weddings/${wedding.id}`}
                  class="inline-flex items-center gap-1 text-xs font-bold text-horizon-700 bg-horizon-50 px-2.5 py-0.5 rounded-full hover:bg-horizon-100 transition-colors">
                  💒 {wedding.title}
                </a>
              )}
            </div>
            {invoice.vendor_tax_number && (
              <p class="text-xs text-gray-400 mt-1">{invoice.tax_label === 'GST' ? 'ABN' : invoice.tax_label === 'VAT' ? 'VAT No.' : 'Tax No.'}: {invoice.vendor_tax_number}</p>
            )}
          </div>
          <div class="flex items-center gap-2">
            <StatusBadge status={invoice.status} />
            {invoice.status === 'draft' && (
              <div class="flex gap-2">
                <a href={`/app/invoices/${invoice.id}/edit`}
                  class="border border-gray-200 px-3 py-1.5 rounded-xl text-sm hover:bg-papaya-50">Edit</a>
                <form method="post" action={`/app/invoices/${invoice.id}/send`} class="inline">
                  <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                  <button type="submit"
                    class="bg-horizon-600 text-white px-3 py-1.5 rounded-xl text-sm font-bold hover:bg-horizon-700">
                    Send
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* Summary */}
        <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 mb-4">
          <div class="grid grid-cols-3 gap-4 text-center">
            <div>
              <p class="text-xs text-gray-500">Total</p>
              <p class="text-lg font-bold">{formatCents(invoice.amount_cents)}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Paid</p>
              <p class="text-lg font-bold text-horizon-700">{formatCents(paidTotal)}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Outstanding</p>
              <p class="text-lg font-bold text-grapefruit-700">{formatCents(outstanding)}</p>
            </div>
          </div>
        </div>

        {/* Line items */}
        <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 mb-4">
          <h3 class="text-sm font-bold mb-3">Services</h3>
          <div class="divide-y divide-gray-100">
            {items.map((item) => (
              <div class="flex items-center justify-between py-2">
                <div>
                  <p class="text-sm text-gray-900">{item.description}</p>
                  {item.quantity > 1 && (
                    <p class="text-xs text-gray-500">{item.quantity} × {formatCents(item.amount_cents)}</p>
                  )}
                </div>
                <p class="text-sm font-bold">{formatCents(item.amount_cents * item.quantity)}</p>
              </div>
            ))}
          </div>
          <div class="border-t border-gray-200 mt-2 pt-2 space-y-1">
            {invoice.tax_rate > 0 && (
              <>
                <div class="flex items-center justify-between">
                  <p class="text-sm text-gray-500">
                    Subtotal {invoice.tax_inclusive ? `(incl. ${invoice.tax_label ?? 'tax'})` : '(ex-tax)'}
                  </p>
                  <p class="text-sm text-gray-700">{formatCents(invoice.subtotal_cents)}</p>
                </div>
                <div class="flex items-center justify-between">
                  <p class="text-sm text-gray-500">{invoice.tax_label ?? 'Tax'} ({invoice.tax_rate}%)</p>
                  <p class="text-sm text-gray-700">{formatCents(invoice.tax_amount_cents)}</p>
                </div>
              </>
            )}
            {invoice.card_fee_cents > 0 && (
              <div class="flex items-center justify-between">
                <p class="text-sm text-gray-500">Card fee ({invoice.card_fee_percent}%)</p>
                <p class="text-sm text-gray-700">{formatCents(invoice.card_fee_cents)}</p>
              </div>
            )}
            <div class="flex items-center justify-between pt-1">
              <p class="text-sm font-bold text-gray-700">Total</p>
              <p class="text-sm font-bold">{formatCents(invoice.amount_cents)}</p>
            </div>
          </div>
        </div>

        {/* Payment schedule */}
        <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 mb-4">
          <h3 class="text-sm font-bold mb-3">Payment schedule</h3>
          <div class="space-y-3">
            {payments.map((payment) => (
              <div class="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div class="flex items-center gap-3">
                  <div class={`w-2 h-2 rounded-full ${
                    payment.status === 'paid' ? 'bg-horizon-600' :
                    payment.status === 'overdue' ? 'bg-grapefruit-700' : 'bg-gray-300'
                  }`} />
                  <div>
                    <p class="text-sm font-medium text-gray-900">{payment.label}</p>
                    <p class="text-xs text-gray-500">
                      {payment.due_date ? `Due ${formatDate(payment.due_date)}` : 'No due date'}
                      {payment.status === 'paid' && payment.method && (
                        <span> · Paid via {payment.method === 'bank_transfer' ? 'bank transfer' : payment.method}</span>
                      )}
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-3">
                  <span class="text-sm font-bold">{formatCents(payment.amount_cents)}</span>
                  {payment.status === 'paid' ? (
                    <span class="bg-horizon-50 text-horizon-700 text-xs font-bold px-2 py-0.5 rounded-full">Paid</span>
                  ) : (
                    <form method="post" action={`/app/invoices/${invoice.id}/payments/${payment.id}/record`}>
                      <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                      <button type="button"
                        onclick={`document.getElementById('modal-${payment.id}').classList.remove('hidden')`}
                        class="border border-gray-200 px-2.5 py-1 rounded-xl text-xs font-bold hover:bg-papaya-50 transition-colors">
                        Record
                      </button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        {invoice.notes && (
          <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 mb-4">
            <h3 class="text-sm font-bold mb-2">Notes</h3>
            <p class="text-sm text-gray-600 whitespace-pre-wrap">{invoice.notes}</p>
          </div>
        )}

        {/* Booking link */}
        {invoice.public_token && invoice.status !== 'draft' && (
          <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 mb-4">
            <h3 class="text-sm font-bold mb-2">Booking link</h3>
            <p class="text-xs text-gray-500 mb-3">Share this link with your client so they can view their booking details.</p>
            <div class="flex items-center gap-2 mb-3">
              <input
                type="text"
                readonly
                value={`${c.env.APP_URL}/book/${invoice.public_token}`}
                class="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-gray-50"
                id="booking-link"
              />
              <button
                type="button"
                onclick="navigator.clipboard.writeText(document.getElementById('booking-link').value);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)"
                class="border border-gray-200 px-3 py-2 rounded-xl text-sm font-bold hover:bg-papaya-50 transition-colors whitespace-nowrap"
              >
                Copy
              </button>
            </div>
            <details class="text-xs">
              <summary class="text-gray-500 cursor-pointer hover:text-gray-700">Embed code</summary>
              <textarea
                readonly
                rows={3}
                class="mt-2 w-full border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-600 bg-gray-50 font-mono"
                onclick="this.select()"
              >{`<iframe src="${c.env.APP_URL}/book/${invoice.public_token}?embed=1" width="100%" height="600" frameborder="0"></iframe>`}</textarea>
            </details>
          </div>
        )}

        {/* Contract status */}
        {contract && (
          <div class="bg-white border border-papaya-300/30 rounded-2xl p-5 mt-6">
            <h3 class="text-sm font-bold text-gray-500 mb-3">Service contract</h3>
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-bold text-gray-900">{contract.title}</p>
                <p class="text-xs text-gray-500 mt-0.5">
                  {contract.body.slice(0, 100)}{contract.body.length > 100 ? '...' : ''}
                </p>
              </div>
              {contract.signed_at ? (
                <div class="text-right shrink-0 ml-4">
                  <span class="text-xs font-bold text-horizon-700 bg-horizon-50 px-2.5 py-1 rounded-full">Signed</span>
                  <p class="text-xs text-gray-400 mt-1">by {contract.signed_by_name}</p>
                  <p class="text-xs text-gray-400">{contract.signed_at.split('T')[0]}</p>
                </div>
              ) : (
                <span class="text-xs font-bold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full shrink-0">Awaiting signature</span>
              )}
            </div>
          </div>
        )}

        {/* Delete (draft only) */}
        {invoice.status === 'draft' && (
          <form method="post" action={`/app/invoices/${invoice.id}/delete`} class="mt-4">
            <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
            <button type="submit"
              onclick="return confirm('Delete this draft invoice?')"
              class="text-sm text-gray-400 hover:text-grapefruit-700 transition-colors">
              Delete draft
            </button>
          </form>
        )}

        {/* Payment modals */}
        {payments.filter((p) => p.status !== 'paid').map((payment) => (
          <div id={`modal-${payment.id}`} class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/30"
            onclick="if(event.target===this)this.classList.add('hidden')">
            <div class="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
              <h3 class="text-base font-bold mb-1">Record payment</h3>
              <p class="text-sm text-gray-500 mb-4">{payment.label} — {formatCents(payment.amount_cents)}</p>
              <form method="post" action={`/app/invoices/${invoice.id}/payments/${payment.id}/record`} class="space-y-4">
                <input type="hidden" name="_csrf" value={c.get('csrfToken')} />
                <div>
                  <label class="block text-xs font-bold text-gray-700 mb-1">Payment method</label>
                  <select name="method" required
                    class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600">
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="cash">Cash</option>
                    <option value="payid">PayID</option>
                    <option value="stripe">Stripe / Card</option>
                  </select>
                </div>
                <div>
                  <label class="block text-xs font-bold text-gray-700 mb-1">Notes (optional)</label>
                  <input type="text" name="notes" placeholder="Reference number, etc."
                    class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
                </div>
                <div class="flex gap-2">
                  <button type="submit"
                    class="flex-1 bg-horizon-600 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700">
                    Confirm payment
                  </button>
                  <button type="button"
                    onclick={`document.getElementById('modal-${payment.id}').classList.add('hidden')`}
                    class="border border-gray-200 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        ))}
      </div>
    </AppLayout>
  )
})

// ─── Send invoice (change status from draft to sent) ───

invoices.post('/app/invoices/:id/send', async (c) => {
  const vendor = c.get('vendor')!
  const invoice = await getInvoice(c.env.DB, vendor.id, c.req.param('id'))
  if (!invoice) return c.text('Not found', 404)
  if (invoice.status !== 'draft') return c.redirect(`/app/invoices/${invoice.id}`)

  await updateInvoice(c.env.DB, vendor.id, invoice.id, { status: 'sent' })
  await auditLog(c, 'invoice_sent', 'invoice', invoice.id, { amount_cents: invoice.amount_cents }).catch(() => {})
  track(c.env.DB, vendor.id, 'invoice_sent', {
    invoiceId: invoice.id,
    contactId: invoice.contact_id ?? undefined,
    weddingId: invoice.wedding_id ?? undefined,
    metadata: { amount_cents: invoice.amount_cents },
  })

  if (invoice.wedding_id && invoice.contact_id) {
    const contact = await c.env.DB
      .prepare('SELECT first_name, email, partner_email FROM contacts WHERE id = ? AND vendor_id = ?')
      .bind(invoice.contact_id, vendor.id)
      .first<{ first_name: string; email: string | null; partner_email: string | null }>()
    if (contact) {
      const emails = [contact.email, contact.partner_email].filter(Boolean) as string[]
      for (const email of emails) {
        c.env.EMAIL_QUEUE.send({
          type: 'notify_invoice_sent',
          payload: JSON.stringify({
            weddingId: invoice.wedding_id,
            vendorId: vendor.id,
            invoiceTitle: invoice.title,
            amountCents: invoice.amount_cents,
            currency: invoice.currency,
            dueDate: invoice.due_date,
            coupleEmail: email,
            coupleName: contact.first_name,
          }),
        }).catch((e) => console.error('[NOTIFY] queue send failed', e))
      }
    }
  }

  return c.redirect(`/app/invoices/${invoice.id}`)
})

// ─── Record a payment ───

invoices.post('/app/invoices/:id/payments/:paymentId/record', async (c) => {
  const vendor = c.get('vendor')!
  const invoice = await getInvoice(c.env.DB, vendor.id, c.req.param('id'))
  if (!invoice) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  const method = String(body.method) as 'stripe' | 'cash' | 'bank_transfer' | 'payid'
  const notes = trimOrNull(body.notes)

  await recordPayment(c.env.DB, vendor.id, c.req.param('paymentId'), method, notes)
  await recalculateInvoiceStatus(c.env.DB, vendor.id, invoice.id)
  await auditLog(c, 'payment_recorded', 'invoice', invoice.id, { payment_id: c.req.param('paymentId'), method }).catch(() => {})
  track(c.env.DB, vendor.id, 'payment_received', {
    invoiceId: invoice.id,
    contactId: invoice.contact_id ?? undefined,
    weddingId: invoice.wedding_id ?? undefined,
    metadata: { method },
  })

  return c.redirect(`/app/invoices/${invoice.id}`)
})

// ─── Edit invoice (draft only) ───

invoices.get('/app/invoices/:id/edit', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const invoice = await getInvoice(c.env.DB, vendor.id, c.req.param('id'))
  if (!invoice) return c.text('Not found', 404)

  const items: LineItem[] = invoice.line_items ? JSON.parse(invoice.line_items) : []
  const payments = await listPayments(c.env.DB, invoice.id)

  return c.html(
    <AppLayout title={`Edit ${invoice.title}`} user={user} vendor={vendor} csrfToken={c.get('csrfToken')}>
      <div class="max-w-2xl">
        <p class="text-sm text-gray-500 mb-4">
          <a href="/app/invoices" class="hover:text-gray-900">Invoices</a> /{' '}
          <a href={`/app/invoices/${invoice.id}`} class="hover:text-gray-900">{invoice.title}</a> / Edit
        </p>

        <form method="post" action={`/app/invoices/${invoice.id}/edit`} class="space-y-6">
          <input type="hidden" name="_csrf" value={c.get('csrfToken')} />

          <section class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
            <h3 class="text-sm font-bold">Invoice details</h3>
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1" for="title">Title</label>
              <input type="text" id="title" name="title" required value={invoice.title}
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1" for="notes">Notes</label>
              <textarea id="notes" name="notes" rows={2}
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600">{invoice.notes ?? ''}</textarea>
            </div>
          </section>

          <section class="bg-white border border-papaya-300/30 rounded-2xl p-5 space-y-4">
            <h3 class="text-sm font-bold">Services</h3>
            <div id="line-items" class="space-y-3">
              {items.map((item, idx) => (
                <LineItemRow index={idx} desc={item.description} qty={item.quantity} price={item.amount_cents / 100} />
              ))}
            </div>
            <button type="button" onclick="addLineItem()"
              class="text-sm text-horizon-600 font-bold hover:text-horizon-700">
              + Add service
            </button>
          </section>

          <input type="hidden" name="item_count" value={items.length} />

          <button type="submit"
            class="w-full bg-horizon-600 text-white py-3 px-6 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors">
            Save changes
          </button>
        </form>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        let lineItemCount = ${items.length};
        function addLineItem() {
          const container = document.getElementById('line-items');
          const idx = lineItemCount++;
          const div = document.createElement('div');
          div.className = 'grid grid-cols-12 gap-2 items-end';
          div.innerHTML = \`
            <div class="col-span-6">
              <input type="text" name="item_desc_\${idx}" required placeholder="Service description"
                class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
            </div>
            <div class="col-span-2">
              <input type="number" name="item_qty_\${idx}" value="1" min="1" required
                class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
            </div>
            <div class="col-span-3">
              <input type="number" name="item_price_\${idx}" required min="0" step="0.01" placeholder="0.00"
                class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
            </div>
            <div class="col-span-1">
              <button type="button" onclick="this.closest('.grid').remove()"
                class="text-gray-400 hover:text-grapefruit-700 text-sm p-2">✕</button>
            </div>
          \`;
          container.appendChild(div);
          document.querySelector('input[name="item_count"]').value = lineItemCount;
        }
      ` }} />
    </AppLayout>
  )
})

invoices.post('/app/invoices/:id/edit', async (c) => {
  const vendor = c.get('vendor')!
  const invoice = await getInvoice(c.env.DB, vendor.id, c.req.param('id'))
  if (!invoice) return c.text('Not found', 404)

  const body = await c.req.parseBody()
  const title = requireString(body.title, 'Title')

  const lineItems: LineItem[] = []
  const itemCount = parseInt(String(body.item_count || '20'))
  for (let i = 0; i <= itemCount; i++) {
    const desc = trimOrNull(body[`item_desc_${i}`])
    const qty = parseInt(String(body[`item_qty_${i}`] || '0'))
    const price = parseFloat(String(body[`item_price_${i}`] || '0'))
    if (desc && qty > 0 && price > 0) {
      lineItems.push({
        description: desc,
        quantity: qty,
        amount_cents: Math.round(price * 100),
      })
    }
  }

  const lineItemTotal = lineItems.reduce((sum, li) => sum + li.amount_cents * li.quantity, 0)

  // Recalculate tax using the invoice's snapshot config
  const tax = calculateTax(lineItemTotal, invoice.tax_rate, !!invoice.tax_inclusive)
  const cardFeeCents = invoice.card_fee_percent > 0
    ? calculateCardFee(tax.total_cents, invoice.card_fee_percent)
    : 0
  const finalTotal = tax.total_cents + cardFeeCents

  await updateInvoice(c.env.DB, vendor.id, invoice.id, {
    title,
    notes: trimOrNull(body.notes),
    amount_cents: finalTotal,
    subtotal_cents: tax.subtotal_cents,
    tax_amount_cents: tax.tax_amount_cents,
    card_fee_cents: cardFeeCents,
    line_items: JSON.stringify(lineItems),
  })

  return c.redirect(`/app/invoices/${invoice.id}`)
})

// ─── Delete invoice (draft only) ───

invoices.post('/app/invoices/:id/delete', async (c) => {
  const vendor = c.get('vendor')!
  await auditLog(c, 'invoice_deleted', 'invoice', c.req.param('id')).catch(() => {})
  await deleteInvoice(c.env.DB, vendor.id, c.req.param('id'))
  return c.redirect('/app/invoices')
})

export default invoices

// ─── Components ───

function StatusBadge({ status }: { status: Invoice['status'] }) {
  const styles: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    sent: 'bg-papaya-100 text-papaya-700',
    partial: 'bg-horizon-50 text-horizon-700',
    paid: 'bg-horizon-100 text-horizon-700',
    overdue: 'bg-grapefruit-50 text-grapefruit-700',
    cancelled: 'bg-gray-100 text-gray-500',
    refunded: 'bg-gray-100 text-gray-500',
  }
  return (
    <span class={`text-xs font-bold px-2.5 py-0.5 rounded-full ${styles[status] ?? styles.draft}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function FilterTab({ label, count, href, active }: { label: string; count: number; href: string; active: boolean }) {
  return (
    <a
      href={href}
      class={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${
        active
          ? 'bg-grapefruit-700 text-white'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {label} {count > 0 && <span class="ml-0.5">({count})</span>}
    </a>
  )
}

function LineItemRow({ index, desc, qty, price }: { index: number; desc?: string; qty?: number; price?: number }) {
  return (
    <div class="grid grid-cols-12 gap-2 items-end">
      <div class="col-span-6">
        {index === 0 && <label class="block text-xs text-gray-500 mb-1">Description</label>}
        <input type="text" name={`item_desc_${index}`} required placeholder="Service description" value={desc ?? ''}
          class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
      </div>
      <div class="col-span-2">
        {index === 0 && <label class="block text-xs text-gray-500 mb-1">Qty</label>}
        <input type="number" name={`item_qty_${index}`} value={String(qty ?? 1)} min="1" required
          class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
      </div>
      <div class="col-span-3">
        {index === 0 && <label class="block text-xs text-gray-500 mb-1">Price ($)</label>}
        <input type="number" name={`item_price_${index}`} required min="0" step="0.01" placeholder="0.00" value={price ? String(price) : ''}
          class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600" />
      </div>
      <div class="col-span-1">
        {index > 0 && (
          <button type="button" onclick="this.closest('.grid').remove()"
            class="text-gray-400 hover:text-grapefruit-700 text-sm p-2">✕</button>
        )}
      </div>
    </div>
  )
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
