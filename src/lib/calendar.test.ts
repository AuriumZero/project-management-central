import { describe, expect, it } from 'vitest'
import { addWorkdays, isWorkday, nextWorkday, prevWorkday, snapWorkday, workdayOffset, workdaysBetween } from './calendar'
import { toDay } from './dates'

// 2026-10-02 is a Friday; 10-03/04 are the weekend; 10-05 is a Monday.
const fri = toDay('2026-10-02')
const sat = fri + 1
const mon = fri + 3

describe('calendar', () => {
  it('knows weekends from working days', () => {
    expect(isWorkday(fri, 'weekdays')).toBe(true)
    expect(isWorkday(sat, 'weekdays')).toBe(false)
    expect(isWorkday(sat, 'all')).toBe(true)
  })

  it('snaps to the nearest working day in the direction of travel', () => {
    expect(nextWorkday(sat, 'weekdays')).toBe(mon)
    expect(prevWorkday(sat, 'weekdays')).toBe(fri)
    expect(snapWorkday(sat, -1, 'weekdays')).toBe(fri)
    expect(snapWorkday(sat, 0, 'weekdays')).toBe(mon)
  })

  it('adds working days across weekends, both ways', () => {
    expect(addWorkdays(fri, 1, 'weekdays')).toBe(mon)
    expect(addWorkdays(fri, 6, 'weekdays')).toBe(mon + 7)
    expect(addWorkdays(mon, -1, 'weekdays')).toBe(fri)
    expect(addWorkdays(sat, 0, 'weekdays')).toBe(mon)
    expect(addWorkdays(fri, 1, 'all')).toBe(sat)
  })

  it('counts working days in a range', () => {
    expect(workdaysBetween(fri, mon, 'weekdays')).toBe(2)
    expect(workdaysBetween(mon, mon + 13, 'weekdays')).toBe(10)
    expect(workdaysBetween(sat, sat + 1, 'weekdays')).toBe(0)
    expect(workdaysBetween(fri, mon, 'all')).toBe(4)
    expect(workdaysBetween(mon, fri, 'weekdays')).toBe(0)
  })

  it('measures signed offsets between working days', () => {
    expect(workdayOffset(fri, mon, 'weekdays')).toBe(1)
    expect(workdayOffset(mon, fri, 'weekdays')).toBe(-1)
  })
})
