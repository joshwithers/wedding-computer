import { Hono } from 'hono'
import type { Env } from '../../types'
import { requireAuth } from '../../middleware/auth'
import { csrf } from '../../middleware/csrf'

const places = new Hono<Env>()

places.use('/api/places/*', requireAuth, csrf)

type PlaceSuggestion = {
  name: string
  address: string
}

/**
 * Google Places Autocomplete proxy.
 * GET /api/places/search?q=...
 * Returns an HTML fragment of clickable suggestions for htmx.
 */
places.get('/api/places/search', async (c) => {
  const q = c.req.query('q')?.trim()
  const field = c.req.query('field') ?? 'location'

  if (!q || q.length < 2) {
    return c.html(<div id={`suggestions-${field}`} />)
  }

  const apiKey = c.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    // No API key — no suggestions
    return c.html(<div id={`suggestions-${field}`} />)
  }

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
      },
      body: JSON.stringify({
        input: q,
        includedPrimaryTypes: ['establishment', 'geocode'],
        languageCode: 'en',
      }),
    })

    if (!res.ok) {
      console.error('[places] Google API error', res.status, await res.text())
      return c.html(<div id={`suggestions-${field}`} />)
    }

    const data = (await res.json()) as {
      suggestions?: Array<{
        placePrediction?: {
          text?: { text?: string }
          structuredFormat?: {
            mainText?: { text?: string }
            secondaryText?: { text?: string }
          }
        }
      }>
    }

    const suggestions: PlaceSuggestion[] = (data.suggestions ?? [])
      .filter((s) => s.placePrediction)
      .slice(0, 6)
      .map((s) => {
        const p = s.placePrediction!
        const name = p.structuredFormat?.mainText?.text ?? p.text?.text ?? ''
        const address = p.structuredFormat?.secondaryText?.text ?? ''
        return { name, address }
      })

    if (suggestions.length === 0) {
      return c.html(<div id={`suggestions-${field}`} />)
    }

    return c.html(
      <div
        id={`suggestions-${field}`}
        class="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
      >
        {suggestions.map((s) => {
          const display = s.address ? `${s.name}, ${s.address}` : s.name
          return (
            <button
              type="button"
              class="block w-full text-left px-4 py-2.5 hover:bg-papaya-50 transition-colors border-b border-gray-100 last:border-0"
              onclick={`
                const input = this.closest('[data-places]').querySelector('input[name]');
                input.value = ${JSON.stringify(display)};
                this.closest('[id^="suggestions-"]').innerHTML = '';
              `}
            >
              <span class="text-sm font-medium text-gray-900">{s.name}</span>
              {s.address && (
                <span class="text-xs text-gray-500 block">{s.address}</span>
              )}
            </button>
          )
        })}
      </div>
    )
  } catch (err: any) {
    console.error('[places] fetch error', err.message)
    return c.html(<div id={`suggestions-${field}`} />)
  }
})

export default places
