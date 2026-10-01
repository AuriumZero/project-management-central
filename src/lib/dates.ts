import type { ISODate } from './types'

// Dates are handled as whole UTC day numbers (days since 1970-01-01) so that
// durations and drag offsets never drift across daylight-saving changes.
const DAY_MS = 86_400_000

export function toDay(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}

export function fromDay(day: number): ISODate {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

/** Today's day number in the viewer's local time zone. */
export function today(now: Date = new Date()): number {
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS)
}

/** 0 = Sunday … 6 = Saturday. Day 0 (1970-01-01) was a Thursday. */
export function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7
}

export function dayOfMonth(day: number): number {
  return new Date(day * DAY_MS).getUTCDate()
}

export function formatDay(day: number, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  return new Date(day * DAY_MS).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
}

/** Inclusive length in days of a start–end range. */
export function spanDays(start: ISODate, end: ISODate): number {
  return toDay(end) - toDay(start) + 1
}

export function isValidDate(value: unknown): value is ISODate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && fromDay(toDay(value)) === value
}
