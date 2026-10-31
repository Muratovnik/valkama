/**
 * When a chain's open part closes, at the pace of its last seven days.
 *
 * Every expectation is worked out by hand from the rule the card states: the
 * pace is what closed minus what was added over the seven days, the days left
 * are what is open over that pace, and when the days of the window disagree a
 * lot — a standard error over a quarter of the pace — the answer is the range
 * from the pace plus one error to the pace minus one, rounded outward.
 */
import { describe, expect, it } from 'vitest'

import {
  dayAfter,
  forecastChain,
  forecastSpan,
} from '@/widgets/work-item-inspector/utils/chainForecast.ts'

import { historyOf } from './fixtures/chainMap.ts'
import type { DayChanges } from './fixtures/chainMap.ts'

const TODAY = '2026-10-31'

/** A chain answer with `open` open, its history `changes` as the server sums them. */
function answer(open: number, changes: DayChanges) {
  return { open, ...historyOf(TODAY, changes) }
}

/** A long history before the window, so the window is a full seven days. */
const BEFORE: DayChanges = { 40: [200, 0] }

/** The same change on each of the window's seven days. */
function everyDay(created: number, closed: number): DayChanges {
  return Object.fromEntries(Array.from({ length: 7 }, (_, ago) => [ago, [created, closed]]))
}

describe('the forecast of a chain', () => {
  it('has nothing to say when nothing is open', () => {
    expect(forecastChain(answer(0, { ...BEFORE, ...everyDay(1, 10) }), TODAY)).toEqual({
      kind: 'none',
    })
  })

  it('closes a chain that loses nine open items a day, steadily, in open ÷ 9 days', () => {
    // Every day one added and ten closed: 9 a day, the same each day.
    expect(forecastChain(answer(81, { ...BEFORE, ...everyDay(1, 10) }), TODAY)).toEqual({
      kind: 'converging',
      low: 9,
      high: 9,
    })
  })

  it('gives a range when the days of the window disagree', () => {
    // 63 closed in three bursts: 30, 30 and 3, so 9 a day on average. The
    // daily nets 30,0,0,30,0,0,3 have a standard error of √(1242/6/7) ≈ 5.44,
    // three fifths of the pace: 90 ÷ 14.44 ≈ 6.2 days at best, 90 ÷ 3.56 ≈ 25.3
    // at worst, rounded outward.
    const bursts: DayChanges = { ...BEFORE, 6: [0, 30], 3: [0, 30], 0: [0, 3] }
    expect(forecastChain(answer(90, bursts), TODAY)).toEqual({
      kind: 'converging',
      low: 6,
      high: 26,
    })
  })

  it('leaves the range open when one day did all the closing', () => {
    // 63 closed on one day: the error equals the pace, so its slow end is no
    // pace at all; the fast end is 90 ÷ (9 + 9) = 5 days.
    expect(forecastChain(answer(90, { ...BEFORE, 2: [0, 63] }), TODAY)).toEqual({
      kind: 'converging',
      low: 5,
      high: null,
    })
  })

  it('says the open part grows, and what must close a day to turn it, when more is added', () => {
    // The owner's chain: 126 discovered and 107 closed in seven days.
    const growing = answer(132, { ...BEFORE, 5: [70, 50], 1: [56, 57] })
    expect(forecastChain(growing, TODAY)).toEqual({ kind: 'growing', needed: 18 })
  })

  it('reads a window with nothing closed as growing, not as a division by zero', () => {
    expect(forecastChain(answer(20, { ...BEFORE, 3: [5, 0] }), TODAY)).toEqual({
      kind: 'growing',
      needed: 5 / 7,
    })
  })

  it('says the open part holds when as much closes as is added', () => {
    expect(forecastChain(answer(20, { ...BEFORE, ...everyDay(2, 2) }), TODAY)).toEqual({
      kind: 'steady',
      needed: 2,
    })
  })

  it('says nothing moved when the window added and closed nothing', () => {
    expect(forecastChain(answer(20, BEFORE), TODAY)).toEqual({ kind: 'quiet' })
  })

  it('does not forecast from less than seven days of history', () => {
    // Begun three days ago: everything in it was added inside the window, so
    // "added faster than closed" would only say the chain is new.
    expect(forecastChain(answer(30, { 2: [40, 5], 0: [0, 5] }), TODAY)).toEqual({
      kind: 'young',
      days: 3,
    })
    // Exactly seven days is a full window.
    expect(forecastChain(answer(30, { 6: [40, 5], 0: [0, 5] }), TODAY).kind).toBe('growing')
  })

  it('reads a chain of a single day by when that day was', () => {
    // All of it today: one day of history.
    expect(forecastChain(answer(16, { 0: [20, 4] }), TODAY)).toEqual({ kind: 'young', days: 1 })
    // All of it long ago, and nothing since.
    expect(forecastChain(answer(16, { 30: [20, 4] }), TODAY)).toEqual({ kind: 'quiet' })
  })

  it('reads an epic’s scope by the same arithmetic as a chain’s', () => {
    const chain = answer(81, { ...BEFORE, ...everyDay(1, 10) })
    const epic = { ...chain, scope: 'epic' as const }
    expect(forecastChain(epic, TODAY)).toEqual(forecastChain(chain, TODAY))
  })
})

describe('the size a forecast is said in', () => {
  it('keeps days under two weeks, weeks under nine, and months up to a year', () => {
    expect(forecastSpan(9, 9)).toEqual({ unit: 'day', low: 9, high: 9 })
    expect(forecastSpan(13, 13)).toEqual({ unit: 'day', low: 13, high: 13 })
    // 17 days is two and a half weeks: the nearest whole week is 2.
    expect(forecastSpan(17, 17)).toEqual({ unit: 'week', low: 2, high: 2 })
    // 100 days is 3.3 months.
    expect(forecastSpan(100, 100)).toEqual({ unit: 'month', low: 3, high: 3 })
  })

  it('rounds a range outward, in the unit its far end needs', () => {
    expect(forecastSpan(6, 13)).toEqual({ unit: 'day', low: 6, high: 13 })
    // 6 to 26 days: under a week at best, four weeks at worst.
    expect(forecastSpan(6, 26)).toEqual({ unit: 'week', low: 1, high: 4 })
    expect(forecastSpan(40, 100)).toEqual({ unit: 'month', low: 1, high: 4 })
  })

  it('keeps an open range open, and its near end not rounded up', () => {
    expect(forecastSpan(5, null)).toEqual({ unit: 'day', low: 5, high: null })
    expect(forecastSpan(20, null)).toEqual({ unit: 'week', low: 2, high: null })
    // A far end past a year is no far end.
    expect(forecastSpan(30, 900)).toEqual({ unit: 'week', low: 4, high: null })
  })

  it('gives no figure past a year', () => {
    expect(forecastSpan(400, 400)).toBeNull()
    expect(forecastSpan(400, null)).toBeNull()
  })
})

describe('the day a forecast lands on', () => {
  it('counts calendar days in UTC across a month end', () => {
    expect(dayAfter(TODAY, 9)).toBe('2026-11-09')
    expect(dayAfter(TODAY, -6)).toBe('2026-10-25')
  })
})
