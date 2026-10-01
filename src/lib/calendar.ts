import { weekday } from './dates'

/**
 * Which days count as working days. `weekdays` skips Saturday and Sunday,
 * as Microsoft Project's standard calendar does; `all` counts every day.
 */
export type WorkWeek = 'weekdays' | 'all'

export function isWorkday(day: number, week: WorkWeek): boolean {
  if (week === 'all') return true
  const wd = weekday(day)
  return wd !== 0 && wd !== 6
}

/** The day itself if it's a working day, otherwise the next one. */
export function nextWorkday(day: number, week: WorkWeek): number {
  let d = day
  while (!isWorkday(d, week)) d++
  return d
}

/** The day itself if it's a working day, otherwise the previous one. */
export function prevWorkday(day: number, week: WorkWeek): number {
  let d = day
  while (!isWorkday(d, week)) d--
  return d
}

/** Snaps a day to a working day in the direction it was moved (forward when not moving). */
export function snapWorkday(day: number, direction: number, week: WorkWeek): number {
  return direction < 0 ? prevWorkday(day, week) : nextWorkday(day, week)
}

/**
 * Moves `n` working days from `day` (backwards when negative). A non-working
 * start day is first snapped onto the calendar in the direction of travel.
 */
export function addWorkdays(day: number, n: number, week: WorkWeek): number {
  if (week === 'all') return day + n
  let d = n < 0 ? prevWorkday(day, week) : nextWorkday(day, week)
  const step = n < 0 ? -1 : 1
  for (let left = Math.abs(n); left > 0; left--) {
    d += step
    while (!isWorkday(d, week)) d += step
  }
  return d
}

/** Working days from `start` to `end`, both included. */
export function workdaysBetween(start: number, end: number, week: WorkWeek): number {
  if (end < start) return 0
  if (week === 'all') return end - start + 1
  const full = Math.floor((end - start + 1) / 7)
  let count = full * 5
  for (let d = start + full * 7; d <= end; d++) if (isWorkday(d, week)) count++
  return count
}

/** Signed number of working days to move from working day `from` to working day `to`. */
export function workdayOffset(from: number, to: number, week: WorkWeek): number {
  return to >= from ? workdaysBetween(from, to, week) - 1 : -(workdaysBetween(to, from, week) - 1)
}
