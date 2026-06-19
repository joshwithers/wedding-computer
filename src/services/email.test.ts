import { describe, it, expect } from 'vitest'
import { enquiryConfirmationEmail, vendorWelcomeInviteEmail, vendorInviteReminderEmail, timelineUpdatedEmail } from './email'
import { runWithI18n } from '../i18n'

describe('enquiryConfirmationEmail', () => {
  it('renders the enquirer name, vendor name, and body', () => {
    const html = enquiryConfirmationEmail({
      vendorName: 'Married by Josh',
      contactName: 'Sam',
      bodyText: 'Thanks for reaching out!\n\nWe will be in touch soon.',
    })
    expect(html).toContain('Hi Sam,')
    expect(html).toContain('Married by Josh')
    expect(html).toContain('Thanks for reaching out!')
    expect(html).toContain('We will be in touch soon.')
  })

  it('splits double-newlines into separate paragraphs', () => {
    const html = enquiryConfirmationEmail({ vendorName: 'V', contactName: 'A', bodyText: 'One.\n\nTwo.' })
    expect((html.match(/<p /g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('converts single newlines within a paragraph to <br>', () => {
    const html = enquiryConfirmationEmail({ vendorName: 'V', contactName: 'A', bodyText: 'Line one\nLine two' })
    expect(html).toContain('Line one<br>Line two')
  })

  it('escapes HTML in all fields', () => {
    const html = enquiryConfirmationEmail({
      vendorName: '<b>V</b>',
      contactName: '<script>x</script>',
      bodyText: 'a & b < c',
    })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('a &amp; b &lt; c')
  })
})

describe('vendorWelcomeInviteEmail', () => {
  const base = {
    inviterName: 'Married by Josh',
    weddingTitle: 'Sam & Alex',
    weddingDate: 'Sat, 18 Oct 2026',
    vendorRole: 'photographer',
    loginUrl: 'https://wedding.computer/login/verify?token=abc',
  }

  it('reflects the current pricing, not the old "free, full stop" pitch', () => {
    const html = vendorWelcomeInviteEmail(base)
    expect(html).toContain('up to 12 active weddings')
    expect(html).toContain('Couples never pay')
    // Guard against the stale copy that predated the wedding cap.
    expect(html).not.toContain('Not a trial')
  })

  it('uses peer social proof when the inviter is a vendor', () => {
    const html = vendorWelcomeInviteEmail({ ...base, inviterRole: 'florist' })
    expect(html).toContain("a florist you're working with")
    expect(html).toContain('runs their weddings on Wedding Computer')
  })

  it('omits the role clause when no inviter role is given', () => {
    const html = vendorWelcomeInviteEmail({ ...base, inviterRole: null })
    expect(html).not.toContain("you're working with")
    expect(html).toContain('Married by Josh')
  })
})

describe('vendorInviteReminderEmail', () => {
  const base = {
    inviterName: 'Married by Josh',
    weddingTitle: 'Sam & Alex',
    weddingDate: 'Sat, 18 Oct 2026',
    loginUrl: 'https://wedding.computer/login/verify?token=abc',
  }

  it('nudges with the wedding and the free pitch', () => {
    const html = vendorInviteReminderEmail({ ...base, finalReminder: false })
    expect(html).toContain('Sam &amp; Alex')
    expect(html).toContain('up to 12 active weddings')
  })

  it('signals the last reminder when final', () => {
    const html = vendorInviteReminderEmail({ ...base, finalReminder: true })
    expect(html).toContain("last reminder")
  })
})

describe('timelineUpdatedEmail localisation', () => {
  const data = { weddingTitle: 'Sam & Alex', appUrl: 'https://wedding.computer', weddingId: 'w1' }

  it('renders English by default (no i18n context)', () => {
    const html = timelineUpdatedEmail(data)
    expect(html).toContain('The run sheet for Sam &amp; Alex was updated')
    expect(html).toContain('View the run sheet')
  })

  it('renders in the recipient locale when wrapped in runWithI18n', () => {
    const html = runWithI18n({ locale: 'fr-FR' }, () => timelineUpdatedEmail(data))
    expect(html).toContain('Le déroulé de Sam &amp; Alex a été mis à jour')
    expect(html).toContain('Voir le déroulé')
    expect(html).not.toContain('View the run sheet')
  })

  it('escapes the wedding title in the interpolated heading', () => {
    const html = runWithI18n({ locale: 'de-DE' }, () => timelineUpdatedEmail({ ...data, weddingTitle: '<b>x</b>' }))
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})
