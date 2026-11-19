/**
 * One value, one colour, in the real app at 1440 by 900: the Task section's tile in the rail, the
 * section's ranked bars and the day chart's legend draw each of the first four tasks in the same
 * computed colour, and work on no task in none of the palette's hues. The tasks' ranking (3, 1,
 * 2, 4) is not the order of their ids, and no task holds more than any of them: a colour taken
 * from a position in whatever set a chart is handed paints one task two colours here. The run
 * prints the colours it read.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import { LEGEND_SERIES, openReport, record, serve } from './analyticsPage.ts'
import { FOLDED, RANKED, RANKING } from './served/analyticsColour.ts'
import { test } from './test.ts'
/** The computed fill of every mark that draws `key`: tile part, section bar, day legend key. */
const colours = async (page: Page, key: string) => {
  const [tile, bar, legend] = await page.evaluate(
    (selectors) =>
      selectors.map((selector) => {
        const mark = document.querySelector(selector)
        return mark ? getComputedStyle(mark).backgroundColor : null
      }),
    [
      `[data-section="work_item"] .mini-share-part[data-key="${key}"]`,
      `.analytics-panel .ranked-line[data-key="${key}"] .ranked-bar`,
      `.spending-days [data-series="${key}"] [data-slot]`,
    ],
  )
  return { tile, bar, legend }
}

test('at 1440px a task is one colour in its tile, its bar and the day chart', async ({
  page,
}, info) => {
  await serve(page, RANKED)
  await openReport(page, 1440)
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('[data-section="work_item"] .mini-share-part')).not.toHaveCount(0)

  const read: Record<string, Awaited<ReturnType<typeof colours>>> = {}
  for (const number of RANKING)
    read[`Task ${number}`] = await colours(page, `v:${task(number, '').id}`)
  const neutral = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-series-other').trim(),
  )
  await record(info, 'colours', { read, neutral })

  const hues = new Set<string>()
  for (const [name, { tile, bar, legend }] of Object.entries(read)) {
    expect(tile, name).not.toBeNull()
    expect(bar, name).toBe(tile)
    expect(legend, name).toBe(tile)
    hues.add(tile ?? '')
  }
  // Four tasks, four hues.
  expect(hues.size).toBe(RANKING.length)
  // Work on no task is in none of them.
  const none = await colours(page, 'none')
  expect(none.legend).not.toBeNull()
  expect(hues.has(none.legend ?? '')).toBe(false)
})

/** The day chart's legend, in its order: each key and its swatch's fill. */
const legendKeys = (page: Page) =>
  page
    .locator(`.spending-days ${LEGEND_SERIES}`)
    .evaluateAll((keys) =>
      keys.map((key) => [
        (key as HTMLElement).dataset.series ?? '',
        getComputedStyle(key.querySelector('[data-slot]') ?? key).backgroundColor,
      ]),
    )

/** The series of Wednesday's stack from the baseline up. */
const stackOrder = (page: Page) =>
  page
    .locator('.spending-days .period-slot')
    .last()
    .locator('.period-segment')
    .evaluateAll((segments) =>
      segments
        .map((segment) => ({
          key: (segment as HTMLElement).dataset.series ?? '',
          bottom: segment.getBoundingClientRect().bottom,
        }))
        .toSorted((low, high) => high.bottom - low.bottom)
        .map((segment) => segment.key),
    )

/** The three channels of a computed colour. */
const channels = (colour: string) => (colour.match(/\d+/gu) ?? []).slice(0, 3).map(Number)

test('at 1440px work on no task and the folded rest are two greys, and the legend reads as the stack', async ({
  page,
}, info) => {
  await serve(page, FOLDED)
  await openReport(page, 1440)
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('.spending-days .period-segment[data-series="other"]')).toHaveCount(1)

  const keys = await legendKeys(page)
  const stack = await stackOrder(page)
  const none = await colours(page, 'none')
  const fills = Object.fromEntries(keys)
  await record(info, 'neutrals', { keys, stack, none })

  // The legend names the stack's series in the stack's order, the baseline's first.
  expect(keys.map(([key]) => key)).toEqual(stack)
  expect(stack.slice(-2)).toEqual(['none', 'other'])
  // Both are greys, no hue; they are two greys, and no task is the one it is in its tile and bar.
  for (const key of ['none', 'other']) {
    const [red, green, blue] = channels(fills[key] ?? '')
    expect(red, `${key} is a grey`).toBe(green)
    expect(green, `${key} is a grey`).toBe(blue)
  }
  expect(fills.none).not.toBe(fills.other)
  expect(none.tile).toBe(fills.none)
  expect(none.bar).toBe(fills.none)
})
