// Shared weather-card handlers for the wedding dashboard (vendor + couple).
// The card is loaded lazily into a container (id="wx-card") and refreshed
// hourly; the °C/°F toggle posts a new preference and re-renders in place.

import type { Context } from 'hono'
import type { Env } from '../types'
import { getMembership, getWedding } from '../db/weddings'
import { updateUser } from '../db/users'
import { daysUntil } from '../lib/date'
import { getVenueForecast, resolveTempUnit } from '../services/weather'
import { WeatherCard, WeatherUnavailable, shouldShowWeather } from '../views/weather'

type Ctx = Context<Env>

// Render the forecast card for a wedding, scoped to the viewer's membership and
// temperature-unit preference. `basePath` is the wedding's route root
// (/app/weddings/:id or /wedding/:id); the toggle posts to `${basePath}/weather/unit`.
export async function renderWeatherCard(c: Ctx, weddingId: string, basePath: string) {
  const user = c.get('user')
  if (!user) return c.text('Forbidden', 403)
  const membership = await getMembership(c.env.DB, weddingId, user.id)
  if (!membership) return c.text('Forbidden', 403)
  const wedding = await getWedding(c.env.DB, weddingId)
  if (!wedding) return c.text('Not found', 404)

  const days = wedding.date ? daysUntil(wedding.date) : null
  if (!shouldShowWeather(days, wedding.location_lat, wedding.location_lng)) return c.html(<WeatherUnavailable />)
  const forecast = await getVenueForecast(c.env, { lat: wedding.location_lat!, lng: wedding.location_lng! })
  if (!forecast) return c.html(<WeatherUnavailable />)

  return c.html(
    <WeatherCard
      forecast={forecast}
      weddingDate={wedding.date!}
      daysUntil={days!}
      unit={resolveTempUnit(user)}
      weatherBase={`${basePath}/weather`}
    />
  )
}

// Persist the viewer's temperature unit, then re-render the card in that unit.
export async function setWeatherUnit(c: Ctx, weddingId: string, basePath: string) {
  const user = c.get('user')
  if (user) {
    const unit = c.req.query('unit') === 'f' ? 'f' : 'c'
    await updateUser(c.env.DB, user.id, { temperature_unit: unit })
    // Reflect the change immediately for this request's re-render.
    user.temperature_unit = unit
  }
  return renderWeatherCard(c, weddingId, basePath)
}
