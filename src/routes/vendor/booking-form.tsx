import { Hono } from 'hono'
import type { Env } from '../../types'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { requireEmailHandle } from '../../middleware/email-handle'
import { csrf } from '../../middleware/csrf'

// The booking form is now edited through the unified builder at
// /app/forms/booking (migration 075). This module is a redirect shim from the
// old /app/booking-form URLs.
const bookingForm = new Hono<Env>()

bookingForm.use('/app/booking-form', requireAuth, csrf, requireVendor)
bookingForm.use('/app/booking-form/*', requireAuth, csrf, requireVendor)
bookingForm.use('/app/booking-form', requireEmailHandle)
bookingForm.use('/app/booking-form/*', requireEmailHandle)

bookingForm.get('/app/booking-form', (c) => c.redirect('/app/forms/booking'))
bookingForm.all('/app/booking-form/*', (c) => c.redirect('/app/forms/booking'))

export default bookingForm
