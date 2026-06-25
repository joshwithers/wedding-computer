import { describe, expect, it } from 'vitest'
import { FormEnhancements } from './form-enhance'

describe('FormEnhancements', () => {
  it('does not emit the Maps script when no key is provided', () => {
    const html = String(FormEnhancements({ mapsKey: undefined }))
    expect(html).not.toContain('maps.googleapis.com/maps/api/js')
    expect(html).toContain('data-future-date')
  })

  it('emits the Maps script only when requested', () => {
    const html = String(FormEnhancements({ mapsKey: 'abc 123' }))
    expect(html).toContain('maps.googleapis.com/maps/api/js?key=abc%20123')
  })
})
