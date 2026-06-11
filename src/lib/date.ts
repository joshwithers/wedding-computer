import { getI18n } from '../i18n'

/**
 * Parse a date string from D1 into a Date object.
 * Handles:
 *   - Date-only: "2026-07-12" → parse as local date (no timezone shift)
 *   - Datetime: "2026-07-12 15:00:00" → treat as UTC
 *   - ISO datetime: "2026-07-12T15:00:00Z" → standard parse
 *   - Already has timezone: "2026-07-12T15:00:00+10:00" → standard parse
 */
function parseDate(str: string): Date {
  if (!str) return new Date(NaN)
  const trimmed = str.trim()

  // Date-only (YYYY-MM-DD): parse components directly to avoid timezone issues
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number)
    return new Date(y, m - 1, d)
  }

  // D1 datetime format "YYYY-MM-DD HH:MM:SS" — treat as UTC
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    return new Date(trimmed.replace(' ', 'T') + 'Z')
  }

  // Everything else: let the native parser try
  return new Date(trimmed)
}

// All date rendering reads the viewer's locale and timezone from the i18n
// request context (src/i18n) — never hardcode a locale or zone in routes.

export function formatDate(iso: string): string {
  const d = parseDate(iso)
  if (isNaN(d.getTime())) return iso || '—'
  return d.toLocaleDateString(getI18n().locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(iso: string): string {
  const d = parseDate(iso)
  if (isNaN(d.getTime())) return iso || '—'
  const { locale, timezone } = getI18n()
  return d.toLocaleString(locale, {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Weekday + date ("Sat, 19 Sept") in the viewer's locale. */
export function formatDayLabel(dateStr: string): string {
  const d = parseDate(dateStr)
  if (isNaN(d.getTime())) return dateStr || '—'
  return d.toLocaleDateString(getI18n().locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function daysUntil(dateStr: string): number {
  const target = new Date(dateStr)
  const now = new Date()
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

// ─── Calendar helpers ───

export function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1).toLocaleDateString(getI18n().locale, { month: 'long', year: 'numeric' })
}

export function prevMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function firstDayOffset(year: number, month: number): number {
  const day = new Date(year, month - 1, 1).getDay()
  // Convert Sunday=0 to Monday-start: Mon=0, Tue=1, ..., Sun=6
  return day === 0 ? 6 : day - 1
}

export function toDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Today's date (YYYY-MM-DD) in the viewer's timezone — NOT the server's,
 * which runs in UTC and is a day behind for much of the Australian morning.
 * en-CA is used purely because it formats as YYYY-MM-DD.
 */
export function todayString(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: getI18n().timezone }).format(new Date())
}

export function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'pm' : 'am'
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${hour}${period}` : `${hour}:${String(m).padStart(2, '0')}${period}`
}

/**
 * Add hours to a time string. Returns "HH:MM" format.
 * Handles overflow past midnight by capping at 23:59.
 *   addHoursToTime("14:00", 2)   → "16:00"
 *   addHoursToTime("14:00", 1.5) → "15:30"
 */
export function addHoursToTime(startTime: string, hours: number): string {
  const [h, m] = startTime.split(':').map(Number)
  const totalMinutes = h * 60 + m + Math.round(hours * 60)
  const endH = Math.min(Math.floor(totalMinutes / 60), 23)
  const endM = totalMinutes >= 24 * 60 ? 59 : totalMinutes % 60
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`
}

/**
 * Subtract hours from a time string. Returns "HH:MM" format.
 * Clamps at 00:00.
 *   subtractHoursFromTime("14:00", 1) → "13:00"
 */
export function subtractHoursFromTime(startTime: string, hours: number): string {
  const [h, m] = startTime.split(':').map(Number)
  const totalMinutes = Math.max(0, h * 60 + m - Math.round(hours * 60))
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
}

export const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
