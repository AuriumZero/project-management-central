import { describe, expect, it } from 'vitest'
import { fromDay, isValidDate, spanDays, toDay, today, weekday } from './dates'

describe('dates', () => {
  it('round-trips ISO dates through day numbers', () => {
    expect(toDay('1970-01-01')).toBe(0)
    expect(fromDay(toDay('2026-10-01'))).toBe('2026-10-01')
    expect(toDay('2026-03-01') - toDay('2026-02-28')).toBe(1)
  })

  it('counts days across a daylight-saving change without drift', () => {
    // US clocks change on 2026-03-08 and 2026-11-01.
    expect(spanDays('2026-03-07', '2026-03-09')).toBe(3)
    expect(spanDays('2026-10-31', '2026-11-02')).toBe(3)
  })

  it('knows the weekday', () => {
    expect(weekday(toDay('1970-01-01'))).toBe(4) // Thursday
    expect(weekday(toDay('2026-10-04'))).toBe(0) // Sunday
    expect(weekday(-1)).toBe(3)
  })

  it('uses the local calendar date for today', () => {
    expect(fromDay(today(new Date(2026, 9, 1, 23, 30)))).toBe('2026-10-01')
  })

  it('validates dates', () => {
    expect(isValidDate('2026-02-28')).toBe(true)
    expect(isValidDate('2026-02-30')).toBe(false)
    expect(isValidDate('next tuesday')).toBe(false)
    expect(isValidDate(20261001)).toBe(false)
  })
})
