import type { ServiceContract } from '../types'

export async function getContractTemplate(
  db: D1Database,
  vendorId: string
): Promise<ServiceContract | null> {
  return db
    .prepare('SELECT * FROM service_contracts WHERE vendor_id = ? AND is_template = 1 LIMIT 1')
    .bind(vendorId)
    .first<ServiceContract>()
}

export async function upsertContractTemplate(
  db: D1Database,
  vendorId: string,
  data: { title: string; body: string }
): Promise<void> {
  const existing = await getContractTemplate(db, vendorId)
  if (existing) {
    await db
      .prepare(
        `UPDATE service_contracts SET title = ?, body = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .bind(data.title, data.body, existing.id)
      .run()
  } else {
    await db
      .prepare(
        `INSERT INTO service_contracts (vendor_id, title, body, is_template)
         VALUES (?, ?, ?, 1)`
      )
      .bind(vendorId, data.title, data.body)
      .run()
  }
}

export async function createContractForInvoice(
  db: D1Database,
  vendorId: string,
  invoiceId: string,
  weddingId: string | null,
  data: { title: string; body: string }
): Promise<ServiceContract> {
  return db
    .prepare(
      `INSERT INTO service_contracts (vendor_id, invoice_id, wedding_id, title, body, is_template)
       VALUES (?, ?, ?, ?, ?, 0)
       RETURNING *`
    )
    .bind(vendorId, invoiceId, weddingId, data.title, data.body)
    .first<ServiceContract>() as Promise<ServiceContract>
}

export async function getContractByInvoice(
  db: D1Database,
  invoiceId: string
): Promise<ServiceContract | null> {
  return db
    .prepare('SELECT * FROM service_contracts WHERE invoice_id = ? AND is_template = 0 LIMIT 1')
    .bind(invoiceId)
    .first<ServiceContract>()
}

export async function signContract(
  db: D1Database,
  contractId: string,
  data: { signed_by_name: string; signed_by_email: string; signed_ip: string }
): Promise<void> {
  await db
    .prepare(
      `UPDATE service_contracts
       SET signed_at = datetime('now'), signed_by_name = ?, signed_by_email = ?, signed_ip = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(data.signed_by_name, data.signed_by_email, data.signed_ip, contractId)
    .run()
}

export async function getContractById(
  db: D1Database,
  contractId: string
): Promise<ServiceContract | null> {
  return db
    .prepare('SELECT * FROM service_contracts WHERE id = ?')
    .bind(contractId)
    .first<ServiceContract>()
}
