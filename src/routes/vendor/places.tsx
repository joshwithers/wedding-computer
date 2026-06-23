import { Hono } from 'hono'
import type { Env } from '../../types'
import { requireAuth } from '../../middleware/auth'
import { csrf } from '../../middleware/csrf'
import { geocodeAddress } from '../../services/geocode'

const places = new Hono<Env>()

places.use('/api/places/*', requireAuth, csrf)

type PlaceSuggestion = {
  name: string
  address: string
}

/** Render an inline error hint (auto-hides after 5s). */
function ErrorHint({ field, message }: { field: string; message: string }) {
  return (
    <div class="text-xs text-grapefruit-600 bg-grapefruit-50 border border-grapefruit-200 rounded-lg px-3 py-2 mt-1">
      {message}
    </div>
  )
}

/**
 * Google Places Autocomplete proxy.
 * GET /api/places/search?q=...&field=...
 * Returns an HTML fragment of clickable suggestions for htmx.
 */
places.get('/api/places/search', async (c) => {
  const field = c.req.query('field') ?? 'location'
  const mode = c.req.query('mode') // 'region' = cities/regions only

  // hx-include="this" sends the input as field_name=value;
  // also accept ?q= for direct calls
  const q = (c.req.query('q') ?? c.req.query(field) ?? '').trim()

  // Require 3+ chars before hitting Google — 2-char queries return generic
  // results and just burn Autocomplete quota across every location field.
  if (!q || q.length < 3) {
    return c.html('')
  }

  const apiKey = c.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return c.html(
      <ErrorHint field={field} message="Google Maps API key not configured. Add GOOGLE_MAPS_API_KEY in Settings → Secrets." />
    )
  }

  const includedPrimaryTypes = mode === 'region'
    ? ['locality', 'administrative_area_level_1', 'administrative_area_level_2', 'sublocality', 'postal_code']
    : ['establishment', 'geocode']

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // Referer-restricted keys need an allowlisted referer on server calls.
        Referer: `${c.env.APP_URL}/`,
      },
      body: JSON.stringify({
        input: q,
        includedPrimaryTypes,
        languageCode: 'en',
      }),
    })

    if (!res.ok) {
      const errorBody = await res.text()
      console.error('[places] Google API error', res.status, errorBody)

      // Parse common error reasons
      let hint = `Google Places API error (${res.status})`
      if (res.status === 403) {
        hint = 'Google Places API key is invalid or the Places API is not enabled in your Google Cloud project.'
      } else if (res.status === 429) {
        hint = 'Google Places API rate limit exceeded. Try again in a moment.'
      } else if (res.status === 400) {
        try {
          const parsed = JSON.parse(errorBody)
          hint = parsed?.error?.message ?? hint
        } catch {}
      }

      return c.html(<ErrorHint field={field} message={hint} />)
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
      return c.html('')
    }

    // Each suggestion button fills the visible text input and the hidden `q` mirror,
    // then clears the dropdown. The `data-places` wrapper scopes the querySelector.
    return c.html(
      <div class="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
        {suggestions.map((s) => {
          const storedValue = s.address ? `${s.name}, ${s.address}` : s.name
          return (
            <button
              type="button"
              class="block w-full text-left px-4 py-2.5 hover:bg-papaya-50 transition-colors border-b border-gray-100 last:border-0"
              onclick={`
                var w = this.closest('[data-places]');
                w.querySelector('input[type=text]').value = ${JSON.stringify(storedValue)};
                w.querySelector('[id^="suggestions-"]').innerHTML = '';
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
    return c.html(
      <ErrorHint field={field} message={`Connection error: ${err.message}`} />
    )
  }
})

/** Quick health check for Places API configuration. */
places.get('/api/places/status', async (c) => {
  const apiKey = c.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return c.json({ ok: false, error: 'GOOGLE_MAPS_API_KEY not set' })
  }

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        Referer: `${c.env.APP_URL}/`,
      },
      body: JSON.stringify({
        input: 'test',
        languageCode: 'en',
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      return c.json({ ok: false, status: res.status, error: body.slice(0, 500) })
    }

    return c.json({ ok: true })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message })
  }
})

places.post('/api/places/geocode', async (c) => {
  const body = await c.req.parseBody()
  const address = String(body.address ?? '').trim()
  if (!address) return c.json({ error: 'address required' }, 400)

  if (!c.env.GOOGLE_MAPS_API_KEY) return c.json({ error: 'GOOGLE_MAPS_API_KEY not set' }, 500)

  try {
    const location = await geocodeAddress(c.env, address)
    if (!location) return c.json({ error: 'No results found' }, 404)
    return c.json(location)
  } catch (err: any) {
    console.error('[places] geocode error', err.message)
    return c.json({ error: err.message }, 500)
  }
})

export default places
