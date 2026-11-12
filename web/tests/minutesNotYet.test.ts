/**
 * Which minutes of the live hour have data and which have none yet: a minute that starts after
 * the newest record the store read has nothing in yet, which is not the same as nothing spent.
 * The expectations are counted by hand from the minutes and the record's moment.
 */
import { describe, expect, it } from 'vitest'

import { dayColumns, notYet } from '@/pages/analytics/utils/dayFigures.ts'

import { usageParameters } from '@/shared/api/analyticsApi.ts'
import type { UsageStep } from '@/shared/api/analyticsApi.ts'

import { serveUsage, task } from './fixtures/analytics.ts'

const at = (hour: number, minute: number, second = 0) =>
  new Date(2026, 10, 11, hour, minute, second)
const iso = (moment: Date) => moment.toISOString()

describe('minutes with data and minutes with none yet', () => {
  const minutes = [25, 26, 27, 28, 29, 30].map((minute) => iso(at(14, minute)))

  it('splits at the minute the newest record falls in, which has data', () => {
    const record = iso(at(14, 27, 30))
    expect(minutes.map((start) => notYet(start, record))).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ])
  })

  it('counts a record on the first moment of a minute as data of that minute', () => {
    expect(notYet(iso(at(14, 27)), iso(at(14, 27)))).toBe(false)
    expect(notYet(iso(at(14, 28)), iso(at(14, 27, 59)))).toBe(true)
  })

  it('has no minute with data when no record was ever read', () => {
    expect(minutes.every((start) => notYet(start, null))).toBe(true)
  })
})

describe('the columns of the live hour', () => {
  const NOW = at(14, 30, 5)
  const work = [{ at: at(14, 5), group: { work_item: task(1, 'Fix') }, spend: { seconds: 120 } }]
  const read = (step: UsageStep, from: Date, record: Date) =>
    serveUsage(
      work,
      usageParameters({
        from: iso(from),
        to: iso(NOW),
        groupBy: ['work_item'],
        filters: {},
        compare: false,
        step,
        utcOffset: -NOW.getTimezoneOffset(),
      }),
      record,
    ).usage
  const pending = (step: UsageStep, from: Date, record: Date) =>
    dayColumns({ usage: read(step, from, record), by: 'work_item', measure: 'time' }, [], NOW)
      .filter((column) => column.pending)
      .map((column) => new Date(column.key).getMinutes())

  it('mark the three minutes after a record three minutes old as having no data yet', () => {
    expect(pending('minute', at(13, 31), at(14, 27, 5))).toEqual([28, 29, 30])
  })

  it('leave the hours of a day unmarked, even hours after an old record', () => {
    expect(pending('hour', at(0, 0), at(9, 30))).toEqual([])
  })
})
