import type { Context, Next } from 'hono'
import type { Env } from '../types'

export async function auditLog(
  c: Context<Env>,
  action: string,
  resourceType?: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const user = c.get('user')
  const ip =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for') ??
    null

  await c.env.DB
    .prepare(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      user?.id ?? null,
      action,
      resourceType ?? null,
      resourceId ?? null,
      metadata ? JSON.stringify(metadata) : null,
      ip
    )
    .run()
}

export function withAudit(
  action: string,
  getResource?: (c: Context<Env>) => { type: string; id: string }
) {
  return async (c: Context<Env>, next: Next) => {
    await next()
    if (c.res.status < 400) {
      const resource = getResource?.(c)
      await auditLog(c, action, resource?.type, resource?.id).catch((e) =>
        console.error('[AUDIT]', e.message)
      )
    }
  }
}
