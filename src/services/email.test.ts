import { describe, it, expect } from 'vitest'
import { enquiryConfirmationEmail } from './email'

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
