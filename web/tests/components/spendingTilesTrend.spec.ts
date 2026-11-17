/**
 * The small trend beside each of the period's figures. The oracle is the requirement: each figure
 * draws its own measure over the steps the main chart draws — days, the hours of a single day —
 * one column per step as tall as its share of the tallest, the step still running hatched; its
 * words say the trend as the rail's tile of the overview says its own; a period with nothing to
 * draw keeps the trend's place, with the total in words. The figures are worked out by hand.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SpendingTiles from '@/pages/analytics/components/SpendingTiles.vue'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage } from '@/shared/api/analyticsApi.ts'

import { figuresAnswer, serveUsage, task, usageAnswer } from '../fixtures/analytics.ts'
import type { Stretch } from '../fixtures/analytics.ts'
import { analyticsI18n } from '../support/analyticsReads.ts'

const MONDAY = new Date(2026, 10, 9)
/** Wednesday afternoon: the third day is still running. */
const NOW = new Date(2026, 10, 11, 14, 30)
const HOUR = 3600

const at = (day: number, spend: Stretch['spend']): Stretch => ({
  day,
  group: { work_item: task(day + 1, 'A task') },
  spend,
})

/** Monday 2 h, Tuesday 4 h, Wednesday half an hour, still running; tokens and a price each day. */
const WEEK = usageAnswer({
  first: MONDAY,
  days: 3,
  end: NOW,
  groupBy: ['work_item'],
  stretches: [
    at(0, { seconds: 2 * HOUR, tokens: 3000, cost: 4 }),
    at(1, { seconds: 4 * HOUR, tokens: 1000, cost: 2 }),
    at(2, { seconds: HOUR / 2, tokens: 1500, cost: 1 }),
  ],
  before: [],
}).usage

function mountTiles(usage: Usage, locale: 'en' | 'ru' = 'en') {
  return mount(SpendingTiles, {
    props: { usage, readAt: NOW, measure: 'time' },
    global: { plugins: [analyticsI18n(locale)] },
  })
}

/**
 * A label with its days named «Mon 9» whatever order the locale gives a weekday and its date:
 * the days chart's own names, which this test does not hold.
 */
const dayFirst = (label: string) =>
  label
    .replaceAll(/(\d{1,2}) (Mon|Tue|Wed|Thu|Fri|Sat|Sun)/gu, '$2 $1')
    .replaceAll(/(пн|вт|ср|чт|пт|сб|вс), (\d{1,2})/gu, '$1 $2')

/** The trend of a measure's cell: its words, its steps and each step's column height. */
function trendOf(tiles: ReturnType<typeof mountTiles>, measure: Measure) {
  const cell = tiles
    .get(`.tile-figure[data-measure="${measure}"]`)
    .element.closest('[role="radio"]')
  const trend = cell?.querySelector<HTMLElement>('.mini-trend')
  if (!trend) throw new Error(`no trend in the ${measure} cell`)
  const steps = [...trend.querySelectorAll<HTMLElement>('.mini-trend-period')]
  return {
    role: trend.getAttribute('role'),
    label: dayFirst((trend.getAttribute('aria-label') ?? '').replaceAll(/\s/gu, ' ')),
    keys: steps.map((step) => step.dataset.key),
    heights: steps.map((step) => {
      const column = step.querySelector<HTMLElement>('.mini-trend-column')
      return column ? Math.round(Number.parseFloat(column.style.blockSize)) : null
    }),
    hatched: steps.map((step) => Boolean(step.querySelector('.mini-trend-column.hatched'))),
  }
}

describe('the trend beside each figure', () => {
  it('draws each measure over the days of the period, the running one hatched', () => {
    const tiles = mountTiles(WEEK)
    const time = trendOf(tiles, 'time')
    expect(time.role).toBe('img')
    expect(time.keys).toEqual(WEEK.series.map((day) => day.start))
    // 2 h, 4 h and half an hour of the tallest 4 h.
    expect(time.heights).toEqual([50, 100, 13])
    expect(time.hatched).toEqual([false, false, true])
    // Each cell draws its own measure, not the one chosen.
    expect(trendOf(tiles, 'tokens').heights).toEqual([100, 33, 50])
    expect(trendOf(tiles, 'cost').heights).toEqual([100, 50, 25])
  })

  it('says the trend in words, as the rail’s tile of the overview does', () => {
    const tiles = mountTiles(WEEK)
    expect(trendOf(tiles, 'time').label).toBe(
      'Agent time per day from Mon 9 to Wed 11: highest 4 h (Tue 10), last 30 min running',
    )
    expect(trendOf(tiles, 'tokens').label).toBe(
      'Tokens per day from Mon 9 to Wed 11: highest 3K (Mon 9), last 1.5K running',
    )
    expect(trendOf(tiles, 'cost').label).toBe(
      'Cost per day from Mon 9 to Wed 11: highest $4.00 (Mon 9), last $1.00 running',
    )
    expect(trendOf(mountTiles(WEEK, 'ru'), 'time').label).toBe(
      'Время агентов по дням с пн 9 по ср 11: наибольшее 4 ч (вт 10), последнее 30 мин идёт',
    )
  })

  it('draws a single day by its hours', () => {
    const query = new URLSearchParams({
      from: '2026-11-10',
      to: '2026-11-11',
      utc_offset: String(-MONDAY.getTimezoneOffset()),
      step: 'hour',
      group_by: 'work_item',
    })
    const { usage } = serveUsage(
      [
        {
          at: new Date(2026, 10, 10, 10),
          group: { work_item: task(1, 'One') },
          spend: { seconds: HOUR },
        },
      ],
      query,
    )
    const time = trendOf(mountTiles(usage), 'time')
    expect(time.keys).toHaveLength(24)
    expect(time.heights.filter((height) => height !== null)).toEqual([100])
    expect(time.label).toMatch(/^Agent time per hour from 00:00 to 23:00: highest 1 h \(10:00\)/u)
  })

  it('keeps its place with nothing to draw, and says the total instead', () => {
    // A period with no steps, and one whose steps spent nothing: the floor alone, in words.
    for (const usage of [
      figuresAnswer({ seconds: 0 }),
      usageAnswer({ first: MONDAY, days: 3, end: NOW, groupBy: [], stretches: [] }).usage,
    ]) {
      const tiles = mountTiles(usage)
      for (const measure of ['time', 'tokens', 'cost'] as const) {
        const trend = trendOf(tiles, measure)
        expect(trend.heights.every((height) => height === null)).toBe(true)
      }
      expect(trendOf(tiles, 'time').label).toBe('Agent time per day: 0 min')
      // Nothing spent is a zero cost, as the figure itself says it.
      expect(trendOf(tiles, 'cost').label).toBe('Cost per day: ≈ $0.00')
    }
  })
})
