/**
 * What each quota window card's step line draws (`sectionLines`) and the parts a line of several
 * windows draws (`stepParts`), against the rule (DESIGN.md, Analytics, the quota's panel) and its
 * decision table, the fixture `quotaTable`. How far back from now the period starts decides: no
 * further back than the card's window lasts, the line is that one window; further back, every
 * window the period overlaps, each whole. The lines of a section run over one length. The line
 * under a card names the window before it only where the line does not hold that window, the
 * server's reset slack apart; and a line of several windows falls to nothing at each reset, the
 * windows before the current one apart from it, the current one from the fall at its start.
 */
import { describe, expect, it } from 'vitest'

import {
  holdsPrevious,
  lineKey,
  namedAfter,
  sectionLines,
} from '@/pages/analytics/utils/quotaLine.ts'

import type { Quota, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'
import { stepParts } from '@/shared/ui/windowGeometry.ts'

import { earlierWindows, servedOver } from './fixtures/quotaHistory.ts'
import { quotaTable, TABLE } from './fixtures/quotaTable.ts'
import { corners } from './support/stepDrawing.ts'

/** Wednesday, 11 November 2026, 14:30 UTC: the table's moment, every time written at UTC. */
const NOW = Date.UTC(2026, 10, 11, 14, 30)
const TODAY = new Date(NOW).toISOString()
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/** The periods of the page, by where each starts: «Now», «Today», «This week», «4 weeks». */
const PERIODS = {
  now: NOW - HOUR,
  today: Date.UTC(2026, 10, 11),
  week: Date.UTC(2026, 10, 9),
  weeks4: Date.UTC(2026, 9, 15),
  /** A custom range of one day three weeks back, shorter than a week. */
  custom: Date.UTC(2026, 9, 21),
} as const

/** The answer as the read over `from` gives it, and the lines of `section` the panel draws of it. */
function linesOver(quota: Quota, from: number, section: 'quota_week' | 'quota_five_hour') {
  const asked = new Date(from).toISOString()
  const served = servedOver(quota, `http://127.0.0.1/?from=${encodeURIComponent(asked)}`)
  const lines = sectionLines(served.accounts, section, TODAY, asked)
  const of = (name: string, kind: string) => {
    const account = served.accounts.find((one) => one.name === name)
    const window = account?.windows.find(
      (one): one is QuotaShareWindow => one.kind === kind && 'readings' in one,
    )
    const line = account && window ? lines.get(lineKey(account, window)) : undefined
    if (!window || !line) throw new Error(`${name} draws a ${kind} line`)
    return { window, line }
  }
  return { lines, of }
}

describe('what a quota window’s line holds', () => {
  for (const period of ['now', 'today', 'week'] as const)
    it(`at a period that starts no further back than a week, «${period}», a week is its one window`, () => {
      const { of } = linesOver(quotaTable(NOW, 0), PERIODS[period], 'quota_week')
      const { line } = of('Alpha', 'week')
      // The live week started a day ago, so «This week», from Monday, starts in the week before
      // it, which the answer holds; the line is the current week alone, whole, all the same.
      expect(line.earlier).toEqual([])
      expect(line.span).toEqual({ from: NOW + TABLE.alphaStart, to: NOW + TABLE.alphaReset })
      expect(line.holds).toEqual(line.span)
      expect(line.current).toEqual(line.span)
    })

  it('at «This week» the section runs over one week, each line its own window', () => {
    const { lines } = linesOver(quotaTable(NOW, 0), PERIODS.week, 'quota_week')
    expect(lines.size).toBe(4)
    for (const [key, line] of lines) expect(line.span.to - line.span.from, key).toBe(WEEK)
  })

  it('at «Today» on a reset day a week is its one window', () => {
    // The week reset at 09:00 today, after the period's midnight: the answer holds the week before.
    const quota = quotaTable(NOW, 0)
    const week = quota.accounts[0]?.windows[1]
    if (!week || !('readings' in week)) throw new Error('«Alpha» reads its week')
    const reset = Date.UTC(2026, 10, 11, 9)
    week.started_at = new Date(reset).toISOString()
    week.resets_at = new Date(reset + WEEK).toISOString()
    week.earlier = earlierWindows(reset, 0, { kind: 'week', source: 'poll' }, [
      { readings: [[DAY, 30]] },
    ])
    const { line } = linesOver(quota, PERIODS.today, 'quota_week').of('Alpha', 'week')
    expect(line.earlier).toEqual([])
    expect(line.span).toEqual({ from: reset, to: reset + WEEK })
  })

  it('at «Now» just after a reset five hours are their one window', () => {
    // The five hours reset half an hour ago and the next started twenty minutes ago.
    const quota = quotaTable(NOW, 0)
    const five = quota.accounts[0]?.windows[0]
    if (!five || !('readings' in five)) throw new Error('«Alpha» reads its five hours')
    const start = NOW - 20 * MINUTE
    five.started_at = new Date(start).toISOString()
    five.resets_at = new Date(start + 5 * HOUR).toISOString()
    five.readings = [
      { at: new Date(NOW - 2 * MINUTE).toISOString(), used_percent: 3, source: 'poll' },
    ]
    five.earlier = [
      {
        started_at: new Date(NOW - 330 * MINUTE).toISOString(),
        resets_at: new Date(NOW - 30 * MINUTE).toISOString(),
        readings: [
          { at: new Date(NOW - 2 * HOUR).toISOString(), used_percent: 70, source: 'poll' },
        ],
        restarts: [],
      },
    ]
    const { line } = linesOver(quota, PERIODS.now, 'quota_five_hour').of('Alpha', 'five_hour')
    expect(line.earlier).toEqual([])
    expect(line.span).toEqual({ from: start, to: start + 5 * HOUR })
  })

  it('at «Today» five hours hold every five-hour window since midnight', () => {
    const { line } = linesOver(quotaTable(NOW, 0), PERIODS.today, 'quota_five_hour').of(
      'Alpha',
      'five_hour',
    )
    // Fourteen and a half hours back, further than five hours: the two windows that reset today.
    expect(line.earlier.map((one) => Date.parse(one.resets_at))).toEqual([
      NOW - 11 * HOUR,
      NOW - 4 * HOUR,
    ])
    expect(line.holds).toEqual({ from: NOW - 16 * HOUR, to: NOW + TABLE.fiveReset })
  })

  it('at «4 weeks» a week holds every week the period overlaps, each whole', () => {
    const { of } = linesOver(quotaTable(NOW, 0), PERIODS.weeks4, 'quota_week')
    const { line } = of('Alpha', 'week')
    // From midnight 27 days back: the four weeks that reset after it, the first from its start.
    expect(line.earlier.map((one) => Date.parse(one.resets_at))).toEqual(
      [4, 3, 2, 1].map((back) => NOW + TABLE.alphaStart - (back - 1) * WEEK),
    )
    expect(line.holds.from).toBe(NOW + TABLE.alphaStart - 4 * WEEK)
    expect(line.current).toEqual({ from: NOW + TABLE.alphaStart, to: NOW + TABLE.alphaReset })
  })

  it('reaches a custom range shorter than a week that ended weeks ago', () => {
    // One day three weeks back: shorter than a week, but far further back from now than one.
    const { line } = linesOver(quotaTable(NOW, 0), PERIODS.custom, 'quota_week').of('Alpha', 'week')
    expect(line.earlier).toHaveLength(3)
    expect(line.holds.from).toBe(NOW + TABLE.alphaStart - 3 * WEEK)
    expect(line.holds.from).toBeLessThanOrEqual(PERIODS.custom)
  })

  it('names the window before where the line does not hold it, the reset slack apart', () => {
    const quota = quotaTable(NOW, 0)
    const short = linesOver(quota, PERIODS.week, 'quota_week').of('Alpha', 'week')
    const long = linesOver(quota, PERIODS.weeks4, 'quota_week').of('Alpha', 'week')
    // At «This week» the line holds no week before, whatever the answer gives: the line under the
    // card names it; at «4 weeks» the line holds it, so nothing names it again.
    expect(holdsPrevious(short.window, short.line)).toBe(false)
    expect(holdsPrevious(long.window, long.line)).toBe(true)
    const previous = long.window.previous
    if (!previous) throw new Error('the week names the week before')
    const reset = Date.parse(previous.resets_at)
    for (const off of [9 * MINUTE, -9 * MINUTE, 11 * MINUTE]) {
      const moved = { ...previous, resets_at: new Date(reset + off).toISOString() }
      expect(
        holdsPrevious({ ...long.window, previous: moved }, long.line),
        `${off / MINUTE} min off`,
      ).toBe(Math.abs(off) <= 10 * MINUTE)
    }
    expect(holdsPrevious({ ...long.window, previous: null }, long.line)).toBe(false)
  })
})

describe('one account’s lines on one time axis', () => {
  for (const period of ['weeks4', 'custom'] as const)
    it(`over «${period}» an account’s lines end at its latest reset, each window at its real time`, () => {
      const { of } = linesOver(quotaTable(NOW, 0), PERIODS[period], 'quota_week')
      const live = of('Alpha', 'week').line
      const model = of('Alpha', 'week_model')
      // The model's week had no reading since its last reset, the live week's start: its line ends
      // where the live week's does, empty from its reset on, which its words name.
      expect(model.line.span.to).toBe(NOW + TABLE.alphaReset)
      expect(live.span.to).toBe(NOW + TABLE.alphaReset)
      expect(model.line.current).toEqual({
        from: NOW + TABLE.modelReset - WEEK,
        to: NOW + TABLE.modelReset,
      })
      expect(model.line.quietSince).toBe(model.window.resets_at)
      expect(model.line.holds.to).toBe(NOW + TABLE.alphaReset)
      // The section keeps one length, so the pair's spans are one span, moment for moment.
      expect(model.line.span).toEqual(live.span)
      // «Beta» resets on another day and ends there, as long; «Gamma», with no reading in any window
      // since its reset, ends at its own last reset with nothing past it.
      const beta = of('Beta', 'week').line
      const gamma = of('Gamma', 'week').line
      expect(beta.span.to).toBe(NOW + TABLE.betaReset)
      expect(gamma.span.to).toBe(NOW + TABLE.gammaReset)
      expect(gamma.quietSince).toBeNull()
      for (const line of [beta, gamma])
        expect(line.span.to - line.span.from).toBe(live.span.to - live.span.from)
    })

  it('at «This week» a week with no reading since its reset beside a live one is the live one’s span, empty', () => {
    const { of } = linesOver(quotaTable(NOW, 0), PERIODS.week, 'quota_week')
    const live = of('Alpha', 'week').line
    const model = of('Alpha', 'week_model')
    expect(model.line.empty).toBe(true)
    expect(model.line.span).toEqual(live.span)
    expect(model.line.current).toEqual(live.current)
    expect([model.line.start, model.line.reset]).toEqual([live.start, live.reset])
    expect(model.line.quietSince).toBe(model.window.resets_at)
    // The line under its card names its last window, which reset where the live week started.
    const named = namedAfter(model.window, model.line)
    expect(named.previous?.resets_at).toBe(model.window.resets_at)
    expect(named.started_at).toBe(model.window.resets_at)
    expect(holdsPrevious(named, model.line)).toBe(false)
    // A live window is named after itself.
    expect(namedAfter(of('Alpha', 'week').window, live)).toBe(of('Alpha', 'week').window)
  })

  it('keeps the last window whole where no window of the account has a reading since its reset', () => {
    for (const period of ['now', 'today', 'week'] as const) {
      const { of } = linesOver(quotaTable(NOW, 0), PERIODS[period], 'quota_week')
      const { window, line } = of('Gamma', 'week')
      expect(line.empty, period).toBe(false)
      expect(line.span, period).toEqual({
        from: NOW + TABLE.gammaReset - WEEK,
        to: NOW + TABLE.gammaReset,
      })
      expect(namedAfter(window, line), period).toBe(window)
    }
  })
})

describe('a line of several windows', () => {
  // 300 ms across a drawing 300 wide and values to 100 a drawing 100 tall: x is the moment, y is
  // 100 less the share.
  const frame = { from: 0, to: 300, top: 100 }
  const points = [
    { at: 10, value: 10 },
    { at: 50, value: 40 },
    { at: 120, value: 20 },
    { at: 180, value: 70 },
    { at: 230, value: 15 },
  ]

  it('falls to nothing at each reset, the windows before the current one apart from it', () => {
    const { earlier, current } = stepParts(frame, {
      end: 260,
      live: 200,
      points,
      zeros: [100, 200],
    })
    expect(corners(earlier)).toEqual([
      [10, 90],
      [50, 90],
      [50, 60],
      [100, 60],
      [100, 100],
      [120, 100],
      [120, 80],
      [180, 80],
      [180, 30],
      [200, 30],
      [200, 100],
      [200, 100],
    ])
    // The current window from the fall at its start, at nothing, to its reading and on to now.
    expect(corners(current)).toEqual([
      [200, 100],
      [230, 100],
      [230, 85],
      [260, 85],
    ])
  })

  it('carries the last share into the current window where no reset fell between', () => {
    const { earlier, current } = stepParts(frame, { end: 260, live: 200, points, zeros: [100] })
    expect(corners(earlier).at(-1)).toEqual([200, 30])
    expect(corners(current)[0]).toEqual([200, 30])
  })

  it('draws the current window alone where nothing came before it', () => {
    const { earlier, current } = stepParts(frame, {
      end: 260,
      live: 200,
      points: points.slice(4),
      zeros: [],
    })
    expect(earlier).toBe('')
    expect(corners(current)).toEqual([
      [230, 85],
      [260, 85],
    ])
  })
})
