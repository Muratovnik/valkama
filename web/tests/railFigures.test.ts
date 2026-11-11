/**
 * The figures of the rail's tiles, held to the requirement rather than to the code: the overview
 * says the period's total, how it moved — in words, not a percentage, where the period before
 * spent nothing or a tenth of it or less — and its days, the one still running marked; a
 * dimension says how many values worked, its first real value with that value's share of the
 * whole, and the shares of its first few with what they leave out as one rest. Expected figures
 * are worked out by hand from the stretches below.
 */
import { describe, expect, it } from 'vitest'

import {
  dimensionFigures,
  overviewFigures,
  railChange,
} from '@/pages/analytics/utils/railFigures.ts'
import { spentOf } from '@/pages/analytics/utils/usageFigures.ts'

import { noTask, task, unknownTask, usageAnswer, value } from './fixtures/analytics.ts'
import type { Stretch } from './fixtures/analytics.ts'

const MONDAY = new Date(2026, 10, 9)
const HOUR = 3600

const answer = (stretches: Stretch[], before: Stretch[] | null = [], days = 3) =>
  usageAnswer({
    first: MONDAY,
    days,
    groupBy: ['work_item'],
    stretches,
    before,
    end: new Date(2026, 10, 11, 14, 30),
  }).usage

const at = (day: number, seconds: number, extra: Partial<Stretch['spend']> = {}): Stretch => ({
  day,
  group: { work_item: task(day + 1, 'A task') },
  spend: { seconds, ...extra },
})

describe('the overview', () => {
  it('is the total, its change from the period before, and the period day by day', () => {
    const usage = answer([at(0, 2 * HOUR), at(1, 4 * HOUR)], [at(0, 4 * HOUR)])
    const figures = overviewFigures(usage, 'time', new Date(2026, 10, 11, 14, 30))
    expect(figures.total.seconds).toBe(6 * HOUR)
    // Six hours against four: half as much again.
    expect(figures.change).toEqual({ direction: 'up', ratio: 0.5 })
    expect(figures.trend.map((day) => day.value)).toEqual([2, 4, 0])
    // Wednesday is not over at half past two.
    expect(figures.trend.map((day) => day.incomplete)).toEqual([false, false, true])
  })

  it('says no change at all when the period before was not read', () => {
    const usage = answer([at(0, HOUR)], null)
    expect(overviewFigures(usage, 'time', MONDAY).change).toBeNull()
  })

  it('says a rise from nothing, or from a tenth or less, by the base and not a percentage', () => {
    const now = spentOf(answer([at(0, 10 * HOUR)]).total)
    const nothing = spentOf(answer([]).total)
    const tenth = spentOf(answer([at(0, HOUR)]).total)
    const more = spentOf(answer([at(0, HOUR + 60)]).total)
    expect(railChange('time', now, nothing)).toEqual({ direction: 'none' })
    expect(railChange('time', now, tenth)).toEqual({ direction: 'from', before: tenth })
    // Just over a tenth is a percentage again: a rise of a little under 900 %.
    expect(railChange('time', now, more).direction).toBe('up')
    // A fall to a tenth is a fall, said by its percentage.
    expect(railChange('time', tenth, now)).toEqual({ direction: 'down', ratio: -0.9 })
  })
})

describe('a dimension', () => {
  /** Six tasks of 40, 20, 10, 5, 3 and 1 hours, 15 hours on no task and 6 nobody can place. */
  const tasks: Stretch[] = [
    ...[40, 20, 10, 5, 3, 1].map((hours, index) => ({
      day: 0,
      group: { work_item: task(index + 1, `Task ${index + 1}`) },
      spend: { seconds: hours * HOUR, cost: hours },
    })),
    { day: 1, group: { work_item: noTask }, spend: { seconds: 15 * HOUR, cost: 15 } },
    { day: 2, group: { work_item: unknownTask }, spend: { seconds: 6 * HOUR, cost: 6 } },
  ]
  const WHOLE = 100

  it('counts its real values, and names the largest with its share of the whole', () => {
    const figures = dimensionFigures(answer(tasks).rows, 'work_item', 'time')
    expect(figures?.count).toBe(6)
    expect(figures?.first.line.value?.reference).toBe('MAIN-1')
    expect(figures?.first.share).toBeCloseTo(40 / WHOLE)
  })

  it('shares the first four, a part a reader can see each, and folds the rest into one', () => {
    const figures = dimensionFigures(answer(tasks).rows, 'work_item', 'time')
    const shares = figures?.parts.map((part) => [
      part.line?.value?.reference ?? part.key,
      part.share,
    ])
    expect(shares?.map(([name]) => name)).toEqual(['MAIN-1', 'MAIN-2', 'MAIN-3', 'MAIN-4', 'rest'])
    // The rest: the two smallest tasks, no task and unknown work, 3 + 1 + 15 + 6 hours.
    expect(shares?.at(-1)?.[1]).toBeCloseTo(25 / WHOLE)
    expect(figures?.parts.reduce((sum, part) => sum + part.share, 0)).toBeCloseTo(1)
  })

  it('names a real value first even when work on no task is larger', () => {
    const lopsided: Stretch[] = [
      { day: 0, group: { work_item: noTask }, spend: { seconds: 9 * HOUR } },
      { day: 0, group: { work_item: task(1, 'Small') }, spend: { seconds: HOUR } },
    ]
    const figures = dimensionFigures(answer(lopsided).rows, 'work_item', 'time')
    expect(figures?.first.line.value?.reference).toBe('MAIN-1')
    expect(figures?.first.share).toBeCloseTo(0.1)
  })

  it('names the largest of the rest when no real value worked, and counts no value', () => {
    const unplaced: Stretch[] = [
      { day: 0, group: { work_item: noTask }, spend: { seconds: HOUR } },
      { day: 0, group: { work_item: unknownTask }, spend: { seconds: 2 * HOUR } },
    ]
    const figures = dimensionFigures(answer(unplaced).rows, 'work_item', 'time')
    expect(figures?.count).toBe(0)
    expect(figures?.first.line.kind).toBe('unknown')
    expect(figures?.parts).toEqual([{ key: 'rest', line: null, share: 1 }])
  })

  it('has no share in a measure the period has no figure for, and draws no part', () => {
    const unpriced: Stretch[] = [
      { day: 0, group: { model: value('model-a') }, spend: { seconds: HOUR, unpriced: 500 } },
    ]
    const usage = usageAnswer({ first: MONDAY, days: 1, groupBy: ['model'], stretches: unpriced })
    const figures = dimensionFigures(usage.usage.rows, 'model', 'cost')
    expect(figures?.first.share).toBeNull()
    expect(figures?.parts).toEqual([])
  })

  it('is nothing at all when the period spent nothing, which the tile says in words', () => {
    expect(dimensionFigures(answer([]).rows, 'work_item', 'time')).toBeNull()
  })
})
