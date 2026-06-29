import { Hono } from 'hono'
import type { Env } from '../../types'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { requireEmailHandle } from '../../middleware/email-handle'
import { csrf } from '../../middleware/csrf'
import { updateVendor, hashEnquiryKey } from '../../db/vendors'
import { isProVendor } from '../../db/subscriptions'
import { generateToken } from '../../lib/crypto'

// The enquiry form is now edited through the unified builder at
// /app/forms/enquiry (migration 075). This module keeps only:
//  - a redirect shim from the old /app/form URL, and
//  - the Pro enquiry-intake API-key management (generate/rotate/revoke), whose
//    UI lives in the unified editor's enquiry "API" section.
const form = new Hono<Env>()

form.use('/app/form', requireAuth, csrf, requireVendor)
form.use('/app/form/*', requireAuth, csrf, requireVendor)
form.use('/app/form', requireEmailHandle)
form.use('/app/form/*', requireEmailHandle)

// ─── Enquiry intake key (Pro) ───

function newEnquiryKey(token: string): string {
  return `wc_intake_${token}`
}

const ENQ_KEY_FLASH_TTL = 600 // 10-min one-time reveal window
function enqKeyFlashId(vendorId: string): string {
  return `enqkey_flash:${vendorId}`
}

// Read + clear the one-time raw-key reveal (the key is hashed at rest, so this
// KV flash is the only chance to show it). Used by the unified enquiry editor.
export async function readEnquiryKeyFlash(env: Env['Bindings'], vendorId: string): Promise<string | null> {
  const id = enqKeyFlashId(vendorId)
  const v = await env.KV.get(id)
  if (v) await env.KV.delete(id)
  return v
}

async function issueEnquiryKey(env: Env['Bindings'], vendorId: string): Promise<void> {
  const raw = newEnquiryKey(await generateToken(24))
  await updateVendor(env.DB, vendorId, { enquiry_key: await hashEnquiryKey(raw) })
  await env.KV.put(enqKeyFlashId(vendorId), raw, { expirationTtl: ENQ_KEY_FLASH_TTL })
}

const KEY_DEST = '/app/forms/enquiry#api'

form.get('/app/form', (c) => c.redirect('/app/forms/enquiry'))

form.post('/app/form/generate-key', async (c) => {
  const vendor = c.get('vendor')!
  if (!(await isProVendor(c.env.DB, vendor.id))) return c.redirect('/app/forms/enquiry?error=' + encodeURIComponent('The API requires a Pro subscription'))
  if (!vendor.enquiry_key) await issueEnquiryKey(c.env, vendor.id)
  return c.redirect(KEY_DEST)
})

form.post('/app/form/rotate-key', async (c) => {
  const vendor = c.get('vendor')!
  if (!(await isProVendor(c.env.DB, vendor.id))) return c.redirect('/app/forms/enquiry?error=' + encodeURIComponent('The API requires a Pro subscription'))
  await issueEnquiryKey(c.env, vendor.id)
  return c.redirect(KEY_DEST)
})

form.post('/app/form/revoke-key', async (c) => {
  const vendor = c.get('vendor')!
  await updateVendor(c.env.DB, vendor.id, { enquiry_key: null })
  return c.redirect(KEY_DEST)
})

// Any other old field-editing sub-path → the unified editor.
form.all('/app/form/*', (c) => c.redirect('/app/forms/enquiry'))

export default form
