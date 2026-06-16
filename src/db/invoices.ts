import type { Invoice, InvoicePayment, LineItem, VendorProfile } from '../types'

export async function listInvoices(
  db: D1Database,
  vendorId: string
): Promise<(Invoice & { contact_name: string | null })[]> {
  return db
    .prepare(
      `SELECT i.id, i.vendor_id, i.contact_id, i.wedding_id, i.title, i.description,
              i.amount_cents, i.currency, i.status, i.due_date, i.paid_at,
              i.booking_fee_type, i.booking_fee_value, i.public_token,
              i.created_at, i.updated_at,
              (c.first_name || ' ' || c.last_name) AS contact_name
       FROM invoices i
       LEFT JOIN contacts c ON c.id = i.contact_id
       WHERE i.vendor_id = ?
       ORDER BY i.created_at DESC
       LIMIT 500`
    )
    .bind(vendorId)
    .all<Invoice & { contact_name: string | null }>()
    .then((r) => r.results)
}

export type InvoiceWithPaymentSummary = Invoice & {
  contact_name: string | null
  paid_cents: number
  payment_count: number
  paid_count: number
}

export async function listInvoicesForWedding(
  db: D1Database,
  vendorId: string,
  weddingId: string
): Promise<InvoiceWithPaymentSummary[]> {
  return db
    .prepare(
      `SELECT i.*,
              (c.first_name || ' ' || c.last_name) AS contact_name,
              COALESCE((SELECT SUM(ip.amount_cents) FROM invoice_payments ip WHERE ip.invoice_id = i.id AND ip.status = 'paid'), 0) AS paid_cents,
              COALESCE((SELECT COUNT(*) FROM invoice_payments ip WHERE ip.invoice_id = i.id), 0) AS payment_count,
              COALESCE((SELECT COUNT(*) FROM invoice_payments ip WHERE ip.invoice_id = i.id AND ip.status = 'paid'), 0) AS paid_count
       FROM invoices i
       LEFT JOIN contacts c ON c.id = i.contact_id
       WHERE i.vendor_id = ? AND i.wedding_id = ?
       ORDER BY i.created_at DESC`
    )
    .bind(vendorId, weddingId)
    .all<InvoiceWithPaymentSummary>()
    .then((r) => r.results)
}

export async function getInvoice(
  db: D1Database,
  vendorId: string,
  invoiceId: string
): Promise<Invoice | null> {
  return db
    .prepare('SELECT * FROM invoices WHERE id = ? AND vendor_id = ?')
    .bind(invoiceId, vendorId)
    .first<Invoice>()
}

/** Calculate tax breakdown from line item totals and vendor tax config */
export function calculateTax(
  lineItemTotalCents: number,
  taxRate: number,
  taxInclusive: boolean
): { subtotal_cents: number; tax_amount_cents: number; total_cents: number } {
  if (taxRate <= 0) {
    return { subtotal_cents: lineItemTotalCents, tax_amount_cents: 0, total_cents: lineItemTotalCents }
  }
  if (taxInclusive) {
    // Prices already include tax — extract the tax component
    const taxAmount = Math.round(lineItemTotalCents * taxRate / (100 + taxRate))
    return {
      subtotal_cents: lineItemTotalCents - taxAmount,
      tax_amount_cents: taxAmount,
      total_cents: lineItemTotalCents,
    }
  } else {
    // Prices are ex-tax — add tax on top
    const taxAmount = Math.round(lineItemTotalCents * taxRate / 100)
    return {
      subtotal_cents: lineItemTotalCents,
      tax_amount_cents: taxAmount,
      total_cents: lineItemTotalCents + taxAmount,
    }
  }
}

/** Calculate optional card fee surcharge */
export function calculateCardFee(
  totalCents: number,
  cardFeePercent: number
): number {
  if (cardFeePercent <= 0) return 0
  return Math.round(totalCents * cardFeePercent / 100)
}

/** Derive the document title from tax config */
export function invoiceDocumentTitle(taxLabel: string | null, taxRate: number): string {
  if (!taxLabel || taxRate <= 0) return 'Invoice'
  if (taxLabel === 'GST') return 'Tax Invoice'
  if (taxLabel === 'VAT') return 'VAT Invoice'
  return 'Tax Invoice'
}

export async function createInvoice(
  db: D1Database,
  vendorId: string,
  vendor: Pick<VendorProfile, 'tax_label' | 'tax_rate' | 'tax_inclusive' | 'tax_number' | 'business_name' | 'business_address' | 'invoice_prefix' | 'next_invoice_number' | 'card_fee_enabled' | 'card_fee_percent'>,
  data: {
    contact_id?: string | null
    wedding_id?: string | null
    title: string
    description?: string | null
    amount_cents: number
    line_items: LineItem[]
    booking_fee_type: 'fixed' | 'percentage'
    booking_fee_value: number
    notes?: string | null
    include_card_fee?: boolean
  }
): Promise<Invoice> {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0')).join('')

  // Tax calculation
  const taxInclusive = !!vendor.tax_inclusive
  const taxRate = vendor.tax_rate ?? 0
  const tax = calculateTax(data.amount_cents, taxRate, taxInclusive)

  // Card fee (opt-in per vendor, applied per invoice)
  const applyCardFee = data.include_card_fee && vendor.card_fee_enabled && vendor.card_fee_percent > 0
  const cardFeeCents = applyCardFee ? calculateCardFee(tax.total_cents, vendor.card_fee_percent) : 0
  const cardFeePercent = applyCardFee ? vendor.card_fee_percent : 0

  // Final total includes card fee
  const finalTotal = tax.total_cents + cardFeeCents

  // Invoice number
  const prefix = vendor.invoice_prefix || 'INV-'
  const num = vendor.next_invoice_number || 1
  const invoiceNumber = `${prefix}${String(num).padStart(4, '0')}`

  // Increment the counter
  await db
    .prepare("UPDATE vendor_profiles SET next_invoice_number = next_invoice_number + 1, updated_at = datetime('now') WHERE id = ?")
    .bind(vendorId)
    .run()

  const result = await db
    .prepare(
      `INSERT INTO invoices (
        vendor_id, contact_id, wedding_id, title, description,
        amount_cents, currency, line_items, booking_fee_type, booking_fee_value,
        public_token, notes, invoice_number,
        tax_label, tax_rate, tax_inclusive, subtotal_cents, tax_amount_cents,
        card_fee_cents, card_fee_percent,
        vendor_tax_number, vendor_business_name, vendor_business_address
      ) VALUES (?, ?, ?, ?, ?, ?, 'aud', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      vendorId,
      data.contact_id ?? null,
      data.wedding_id ?? null,
      data.title,
      data.description ?? null,
      finalTotal,
      JSON.stringify(data.line_items),
      data.booking_fee_type,
      data.booking_fee_value,
      token,
      data.notes ?? null,
      invoiceNumber,
      vendor.tax_label ?? null,
      taxRate,
      taxInclusive ? 1 : 0,
      tax.subtotal_cents,
      tax.tax_amount_cents,
      cardFeeCents,
      cardFeePercent,
      vendor.tax_number ?? null,
      vendor.business_name,
      vendor.business_address ?? null
    )
    .first<Invoice>()
  return result!
}

export async function getInvoiceByToken(
  db: D1Database,
  token: string
): Promise<(Invoice & { vendor_name: string; vendor_category: string; contact_name: string | null; contact_email: string | null }) | null> {
  return db
    .prepare(
      `SELECT i.*, vp.business_name AS vendor_name, vp.category AS vendor_category,
              (c.first_name || ' ' || c.last_name) AS contact_name, c.email AS contact_email
       FROM invoices i
       JOIN vendor_profiles vp ON vp.id = i.vendor_id
       LEFT JOIN contacts c ON c.id = i.contact_id
       WHERE i.public_token = ?`
    )
    .bind(token)
    .first<Invoice & { vendor_name: string; vendor_category: string; contact_name: string | null; contact_email: string | null }>()
}

/**
 * Atomically mark a booking as submitted. Returns true ONLY for the request
 * that actually flips booking_form_data from empty → set. Concurrent
 * double-submits of the same booking link (e.g. a double-click) lose the race
 * and get false, so the notifications and the couple's confirmation email are
 * sent exactly once. The cheap top-of-handler guard still short-circuits
 * ordinary sequential resubmits before this runs.
 */
export async function claimBookingSubmission(
  db: D1Database,
  vendorId: string,
  invoiceId: string,
  bookingFormData: string
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE invoices SET booking_form_data = ?, updated_at = datetime('now')
       WHERE id = ? AND vendor_id = ? AND (booking_form_data IS NULL OR booking_form_data = '')`
    )
    .bind(bookingFormData, invoiceId, vendorId)
    .run()
  return (res.meta?.changes ?? 0) > 0
}

export async function updateInvoice(
  db: D1Database,
  vendorId: string,
  invoiceId: string,
  data: Partial<Pick<Invoice, 'title' | 'description' | 'amount_cents' | 'line_items' | 'booking_fee_type' | 'booking_fee_value' | 'status' | 'notes' | 'due_date' | 'paid_at' | 'booking_form_data' | 'subtotal_cents' | 'tax_amount_cents' | 'card_fee_cents' | 'card_fee_percent'>>
): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`)
      values.push(val)
    }
  }
  if (sets.length === 0) return
  sets.push("updated_at = datetime('now')")
  values.push(invoiceId, vendorId)
  await db
    .prepare(`UPDATE invoices SET ${sets.join(', ')} WHERE id = ? AND vendor_id = ?`)
    .bind(...values)
    .run()
}

export async function deleteInvoice(
  db: D1Database,
  vendorId: string,
  invoiceId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM invoices WHERE id = ? AND vendor_id = ? AND status = ?')
    .bind(invoiceId, vendorId, 'draft')
    .run()
}

// ─── Payments ───

export async function listPayments(
  db: D1Database,
  invoiceId: string
): Promise<InvoicePayment[]> {
  return db
    .prepare('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY due_date, created_at')
    .bind(invoiceId)
    .all<InvoicePayment>()
    .then((r) => r.results)
}

export async function getPayment(
  db: D1Database,
  vendorId: string,
  paymentId: string
): Promise<InvoicePayment | null> {
  return db
    .prepare('SELECT * FROM invoice_payments WHERE id = ? AND vendor_id = ?')
    .bind(paymentId, vendorId)
    .first<InvoicePayment>()
}

export async function createPayment(
  db: D1Database,
  vendorId: string,
  invoiceId: string,
  data: {
    label: string
    amount_cents: number
    due_date?: string | null
  }
): Promise<InvoicePayment> {
  const result = await db
    .prepare(
      `INSERT INTO invoice_payments (invoice_id, vendor_id, label, amount_cents, due_date)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(invoiceId, vendorId, data.label, data.amount_cents, data.due_date ?? null)
    .first<InvoicePayment>()
  return result!
}

export async function createPaymentsBatch(
  db: D1Database,
  vendorId: string,
  invoiceId: string,
  payments: { label: string; amount_cents: number; due_date: string | null }[]
): Promise<void> {
  if (payments.length === 0) return
  const stmts = payments.map((p) =>
    db
      .prepare(
        `INSERT INTO invoice_payments (invoice_id, vendor_id, label, amount_cents, due_date)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(invoiceId, vendorId, p.label, p.amount_cents, p.due_date)
  )
  await db.batch(stmts)
}

export async function recordPayment(
  db: D1Database,
  vendorId: string,
  paymentId: string,
  method: 'stripe' | 'cash' | 'bank_transfer' | 'payid',
  notes?: string | null
): Promise<void> {
  await db
    .prepare(
      `UPDATE invoice_payments
       SET status = 'paid', method = ?, paid_at = datetime('now'), notes = ?
       WHERE id = ? AND vendor_id = ?`
    )
    .bind(method, notes ?? null, paymentId, vendorId)
    .run()
}

export async function deletePayment(
  db: D1Database,
  vendorId: string,
  paymentId: string
): Promise<void> {
  await db
    .prepare("DELETE FROM invoice_payments WHERE id = ? AND vendor_id = ? AND status = 'pending'")
    .bind(paymentId, vendorId)
    .run()
}

export function generatePaymentSchedule(
  totalCents: number,
  bookingFeeType: 'fixed' | 'percentage',
  bookingFeeValue: number,
  installments: number,
  weddingDate?: string | null
): { label: string; amount_cents: number; due_date: string | null }[] {
  let bookingFeeCents: number
  if (bookingFeeType === 'percentage') {
    bookingFeeCents = Math.round((totalCents * bookingFeeValue) / 100)
  } else {
    bookingFeeCents = bookingFeeValue
  }
  bookingFeeCents = Math.min(bookingFeeCents, totalCents)

  const remaining = totalCents - bookingFeeCents
  const schedule: { label: string; amount_cents: number; due_date: string | null }[] = []

  const today = new Date()
  const bookingDue = new Date(today)
  bookingDue.setDate(bookingDue.getDate() + 7)
  schedule.push({
    label: 'Booking fee',
    amount_cents: bookingFeeCents,
    due_date: bookingDue.toISOString().slice(0, 10),
  })

  if (installments <= 1 || remaining <= 0) {
    if (remaining > 0) {
      schedule.push({
        label: 'Final payment',
        amount_cents: remaining,
        due_date: weddingDate
          ? offsetDate(weddingDate, -30)
          : offsetFromNow(90),
      })
    }
    return schedule
  }

  const perPayment = Math.floor(remaining / installments)
  const lastPayment = remaining - perPayment * (installments - 1)

  for (let i = 0; i < installments; i++) {
    const isLast = i === installments - 1
    const amount = isLast ? lastPayment : perPayment
    const label = isLast ? 'Final payment' : `Payment ${i + 2}`

    let dueDate: string | null
    if (weddingDate) {
      const totalDays = daysBetween(today, new Date(weddingDate))
      const interval = Math.floor(totalDays / (installments + 1))
      dueDate = offsetFromNow(interval * (i + 1))
    } else {
      dueDate = offsetFromNow(30 * (i + 1) + 30)
    }

    schedule.push({ label, amount_cents: amount, due_date: dueDate })
  }

  return schedule
}

function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function offsetFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysBetween(a: Date, b: Date): number {
  return Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

export async function recalculateInvoiceStatus(
  db: D1Database,
  vendorId: string,
  invoiceId: string
): Promise<void> {
  const payments = await listPayments(db, invoiceId)
  if (payments.length === 0) return

  const allPaid = payments.every((p) => p.status === 'paid')
  const somePaid = payments.some((p) => p.status === 'paid')

  let newStatus: string
  if (allPaid) {
    newStatus = 'paid'
  } else if (somePaid) {
    newStatus = 'partial'
  } else {
    const invoice = await getInvoice(db, vendorId, invoiceId)
    if (!invoice || invoice.status === 'draft' || invoice.status === 'cancelled') return
    newStatus = 'sent'
  }

  await db
    .prepare("UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ? AND vendor_id = ?")
    .bind(newStatus, invoiceId, vendorId)
    .run()
}
