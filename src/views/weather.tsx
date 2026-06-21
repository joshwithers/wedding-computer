// The weather card shown on the wedding dashboard within a week of the date.
// Renders a daily strip for the run-up (2 days before, 1 day before, the day)
// and — once the wedding is close enough that hourly data is meaningful — an
// hour-by-hour strip for the wedding day. Swapped into a pre-styled container
// by htmx, so this renders the inner content only.

import type { MessageKey } from '../i18n'
import { t } from '../i18n'
import { formatDayLabel } from '../lib/date'
import { wmoCondition, displayTemp, type Forecast, type WeatherDaily, type WeatherHourly } from '../services/weather'

// Shift a YYYY-MM-DD date by whole days (UTC math; dates are date-only).
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function hourLabel(hour: number): string {
  const ampm = hour < 12 ? 'am' : 'pm'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}${ampm}`
}

function Temp({ celsius, locale, class: cls }: { celsius: number | null; locale: string; class?: string }) {
  const t2 = displayTemp(celsius, locale)
  return <span class={cls}>{t2 ? `${t2.value}°` : '—'}</span>
}

function Rain({ prob }: { prob: number | null }) {
  if (prob == null || prob <= 0) return null
  return <span class="text-[11px] text-horizon-600 whitespace-nowrap">💧{prob}%</span>
}

function DailyCell({ day, isWeddingDay, locale }: { day: WeatherDaily; isWeddingDay: boolean; locale: string }) {
  const cond = wmoCondition(day.code, true)
  return (
    <div class={`rounded-xl p-2.5 text-center ${isWeddingDay ? 'bg-papaya-100 ring-1 ring-grapefruit-300' : 'bg-gray-50'}`}>
      <p class={`text-[11px] font-bold ${isWeddingDay ? 'text-grapefruit-700' : 'text-gray-500'}`}>
        {isWeddingDay ? t('weather.weddingDay') : formatDayLabel(day.date)}
      </p>
      <p class="text-2xl leading-tight my-0.5" title={t(cond.labelKey as MessageKey)}>{cond.icon}</p>
      <p class="text-xs text-gray-700">
        <Temp celsius={day.tempMax} locale={locale} class="font-bold" />
        <span class="text-gray-400"> / </span>
        <Temp celsius={day.tempMin} locale={locale} class="text-gray-400" />
      </p>
      <div class="mt-0.5"><Rain prob={day.precipProb} /></div>
    </div>
  )
}

function HourCell({ h, locale }: { h: WeatherHourly; locale: string }) {
  const cond = wmoCondition(h.code, h.isDay)
  return (
    <div class="shrink-0 w-12 text-center">
      <p class="text-[10px] text-gray-400">{hourLabel(h.hour)}</p>
      <p class="text-lg leading-tight" title={t(cond.labelKey as MessageKey)}>{cond.icon}</p>
      <p class="text-[11px] font-medium text-gray-700"><Temp celsius={h.temp} locale={locale} /></p>
      <div class="leading-none"><Rain prob={h.precipProb} /></div>
    </div>
  )
}

export function WeatherUnavailable() {
  return <p class="text-xs text-gray-400">{t('weather.unavailable')}</p>
}

export function WeatherCard({
  forecast,
  weddingDate,
  daysUntil,
  locale,
}: {
  forecast: Forecast
  weddingDate: string
  daysUntil: number
  locale: string
}) {
  // Run-up strip: 2 days before, 1 day before, the day — whichever the forecast
  // actually covers (earlier days drop off once the wedding is very close).
  const cells = [shiftDate(weddingDate, -2), shiftDate(weddingDate, -1), weddingDate]
    .map((date) => ({ date, isWeddingDay: date === weddingDate, day: forecast.daily.find((d) => d.date === date) }))
    .filter((c): c is { date: string; isWeddingDay: boolean; day: WeatherDaily } => !!c.day)

  if (cells.length === 0) return <WeatherUnavailable />

  // Transition to an hour-by-hour view of the wedding day once it's within ~2
  // days, where hourly forecasts become meaningful.
  const showHourly = daysUntil <= 2
  const hours = showHourly
    ? forecast.hourly.filter((h) => h.time.slice(0, 10) === weddingDate && h.hour >= 6 && h.hour <= 23)
    : []

  return (
    <div>
      <div class={`grid gap-2 ${cells.length === 1 ? 'grid-cols-1' : cells.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {cells.map((c) => <DailyCell day={c.day} isWeddingDay={c.isWeddingDay} locale={locale} />)}
      </div>

      {hours.length > 0 && (
        <div class="mt-3 pt-3 border-t border-gray-100">
          <p class="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1.5">{t('weather.onTheDay')}</p>
          <div class="flex gap-1 overflow-x-auto pb-1">
            {hours.map((h) => <HourCell h={h} locale={locale} />)}
          </div>
        </div>
      )}

      <p class="text-[10px] text-gray-300 mt-2">
        {t('weather.source')}{' '}
        <a href="https://open-meteo.com" target="_blank" rel="noopener" class="underline hover:text-gray-500">Open-Meteo</a>
      </p>
    </div>
  )
}

// Whether the weather card should appear at all: a date within a week + coords.
export function shouldShowWeather(daysUntil: number | null, lat: number | null, lng: number | null): boolean {
  return daysUntil != null && daysUntil >= 0 && daysUntil <= 7 && lat != null && lng != null
}
