/**
 * The span a quota window's step line runs over (`quotaLine`) and the parts a line of several
 * windows draws (`stepParts`), against the rule (DESIGN.md, Analytics, the quota's panel): a line
 * runs from the first window it holds to its current window's reset; the lines of a section run
 * over as long a time as the longest, each to its own reset; the line under a card names the
 * window before it only where the line does not hold that window, the server's reset slack
 * apart; and a line of several windows falls to nothing at each reset, the windows before the
 * current one apart from it, the current one from the fall at its start.
 */
import { describe, expect, it } from 'vitest'

import {
  holdsPrevious,
  lineSpan,
  scaledSpan,
  sectionLength,
} from '@/pages/analytics/utils/quotaLine.ts'

import type { QuotaAccount, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'
import { stepParts } from '@/shared/ui/windowGeometry.ts'

import { quotaAt } from './fixtures/quota.ts'
import { earlierWindows } from './fixtures/quotaHistory.ts'
import { corners } from './support/stepDrawing.ts'

const NOW = new Date(Date.UTC(2026, 10, 11, 11, 30))
const MINUTE = 60_000
const DAY = 86_400_000
const TODAY = NOW.toISOString()

/** «Work»'s week from the fixture, with `count` weeks before it. */
function weekOf(count: number): { account: QuotaAccount; week: QuotaShareWindow } {
  const quota = structuredClone(quotaAt(NOW, 0))
  const [account] = quota.accounts
  const week = account?.windows[1]
  if (!account || !week || !('readings' in week)) throw new Error('«Work» reads its week')
  week.earlier = earlierWindows(
    Date.parse(week.started_at ?? ''),
    0,
    { kind: 'week', source: 'poll' },
    Array.from({ length: count }, () => ({ readings: [[DAY, 20] as [number, number]] })),
  )
  return { account, week }
}

describe('the span of a quota window’s line', () => {
  it('runs from the first window it holds to the current reset, and is the window alone with none', () => {
    const { week } = weekOf(2)
    const start = Date.parse(week.started_at ?? '')
    const reset = Date.parse(week.resets_at ?? '')
    expect(lineSpan(week, TODAY)).toEqual({ from: start - 14 * DAY, to: reset })
    week.earlier = []
    expect(lineSpan(week, TODAY)).toEqual({ from: start, to: reset })
  })

  it('is as long as the section’s longest line, each line to its own reset', () => {
    const { account, week } = weekOf(3)
    const night = quotaAt(NOW, 0).accounts[1]
    if (!night) throw new Error('the fixture holds a second account')
    // «Work»'s week holds four weeks; the second account's week and «Work»'s model week one each.
    const length = sectionLength([account, night], 'quota_week', TODAY)
    expect(length).toBe(4 * 7 * DAY)
    const nightWeek = night.windows[1]
    if (!nightWeek || !('readings' in nightWeek)) throw new Error('the second account reads a week')
    const nightReset = Date.parse(nightWeek.resets_at ?? '')
    expect(scaledSpan(nightWeek, TODAY, length)).toEqual({
      from: nightReset - 4 * 7 * DAY,
      to: nightReset,
    })
    // The longest line runs over exactly the time it holds; no scale is the line's own span.
    expect(scaledSpan(week, TODAY, length)).toEqual(lineSpan(week, TODAY))
    expect(scaledSpan(nightWeek, TODAY, null)).toEqual(lineSpan(nightWeek, TODAY))
    expect(sectionLength([], 'quota_week', TODAY)).toBeNull()
  })

  it('holds the window before the current one where a window it holds reset when that one did', () => {
    const { week } = weekOf(1)
    const before = week.earlier?.[0]
    if (!before) throw new Error('a week before')
    const ended = (resets: number) => ({
      started_at: before.started_at,
      resets_at: new Date(resets).toISOString(),
      latest: week.latest,
      ran_out: false,
    })
    const reset = Date.parse(before.resets_at)
    // At the moment the line's last week reset, or within the server's ten minutes of slack.
    for (const off of [0, 9 * MINUTE, -9 * MINUTE]) {
      week.previous = ended(reset + off)
      expect(holdsPrevious(week), `${off / MINUTE} min off`).toBe(true)
    }
    // A reset the line holds no window for, a window with no previous, and a line of none.
    week.previous = ended(reset - 7 * DAY)
    expect(holdsPrevious(week)).toBe(false)
    week.previous = null
    expect(holdsPrevious(week)).toBe(false)
    week.previous = ended(reset)
    week.earlier = []
    expect(holdsPrevious(week)).toBe(false)
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
