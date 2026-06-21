import { describe, it, expect } from 'vitest'
import { wmoCondition, displayTemp, resolveTempUnit, normalizeOpenMeteo } from './weather'
import { shouldShowWeather } from '../views/weather'

describe('wmoCondition', () => {
  it('maps WMO codes to the right condition + label', () => {
    expect(wmoCondition(0).labelKey).toBe('weather.cond.clear')
    expect(wmoCondition(2).labelKey).toBe('weather.cond.partlyCloudy')
    expect(wmoCondition(3).labelKey).toBe('weather.cond.overcast')
    expect(wmoCondition(45).labelKey).toBe('weather.cond.fog')
    expect(wmoCondition(63).labelKey).toBe('weather.cond.rain')
    expect(wmoCondition(75).labelKey).toBe('weather.cond.snow')
    expect(wmoCondition(81).labelKey).toBe('weather.cond.showers')
    expect(wmoCondition(95).labelKey).toBe('weather.cond.thunderstorm')
    expect(wmoCondition(999).labelKey).toBe('weather.cond.overcast') // unknown falls back
  })
  it('uses day/night icon variants for clear sky', () => {
    expect(wmoCondition(0, true).icon).toBe('☀️')
    expect(wmoCondition(0, false).icon).toBe('🌙')
  })
})

describe('displayTemp', () => {
  it('returns null for a missing temperature', () => {
    expect(displayTemp(null, 'c')).toBeNull()
  })
  it('renders °C when the unit is celsius', () => {
    expect(displayTemp(20.4, 'c')).toEqual({ value: 20, unit: '°C' })
    expect(displayTemp(-0.4, 'c')).toEqual({ value: 0, unit: '°C' })
  })
  it('converts to °F when the unit is fahrenheit', () => {
    expect(displayTemp(20, 'f')).toEqual({ value: 68, unit: '°F' })
    expect(displayTemp(0, 'f')).toEqual({ value: 32, unit: '°F' })
  })
})

describe('resolveTempUnit', () => {
  it('defaults to Celsius (null, undefined, or unknown values)', () => {
    expect(resolveTempUnit(null)).toBe('c')
    expect(resolveTempUnit(undefined)).toBe('c')
    expect(resolveTempUnit({ temperature_unit: null })).toBe('c')
    expect(resolveTempUnit({ temperature_unit: 'x' })).toBe('c')
  })
  it('honours an explicit fahrenheit preference', () => {
    expect(resolveTempUnit({ temperature_unit: 'f' })).toBe('f')
  })
  it('honours an explicit celsius preference', () => {
    expect(resolveTempUnit({ temperature_unit: 'c' })).toBe('c')
  })
})

describe('normalizeOpenMeteo', () => {
  const sample = {
    timezone: 'Australia/Brisbane',
    daily: {
      time: ['2027-08-06', '2027-08-07', '2027-08-08'],
      weather_code: [1, 61, 0],
      temperature_2m_max: [22.1, 18.9, 24.0],
      temperature_2m_min: [9.2, 11.0, 8.5],
      precipitation_probability_max: [10, 80, 5],
    },
    hourly: {
      time: ['2027-08-08T14:00', '2027-08-08T15:00'],
      weather_code: [0, 2],
      temperature_2m: [23.0, 22.5],
      precipitation_probability: [0, 15],
      is_day: [1, 0],
    },
  }

  it('parses daily + hourly arrays into normalized shape', () => {
    const f = normalizeOpenMeteo(sample)!
    expect(f.timezone).toBe('Australia/Brisbane')
    expect(f.daily).toHaveLength(3)
    expect(f.daily[2]).toEqual({ date: '2027-08-08', tempMax: 24.0, tempMin: 8.5, precipProb: 5, code: 0 })
    expect(f.hourly[0]).toEqual({ time: '2027-08-08T14:00', hour: 14, temp: 23.0, precipProb: 0, code: 0, isDay: true })
    expect(f.hourly[1].isDay).toBe(false)
    expect(f.hourly[1].hour).toBe(15)
  })

  it('returns null when there is no daily data', () => {
    expect(normalizeOpenMeteo({ timezone: 'UTC' })).toBeNull()
    expect(normalizeOpenMeteo(null)).toBeNull()
  })

  it('tolerates missing fields (null values, default code 0)', () => {
    const f = normalizeOpenMeteo({ daily: { time: ['2027-08-08'], temperature_2m_max: [null] } })!
    expect(f.daily[0]).toEqual({ date: '2027-08-08', tempMax: null, tempMin: null, precipProb: null, code: 0 })
  })
})

describe('shouldShowWeather', () => {
  it('shows within a week with coordinates', () => {
    expect(shouldShowWeather(0, -27.47, 153.02)).toBe(true)
    expect(shouldShowWeather(7, -27.47, 153.02)).toBe(true)
  })
  it('hides outside the window or without coordinates', () => {
    expect(shouldShowWeather(8, -27.47, 153.02)).toBe(false)
    expect(shouldShowWeather(-1, -27.47, 153.02)).toBe(false) // past
    expect(shouldShowWeather(3, null, 153.02)).toBe(false)
    expect(shouldShowWeather(null, -27.47, 153.02)).toBe(false)
  })
})
