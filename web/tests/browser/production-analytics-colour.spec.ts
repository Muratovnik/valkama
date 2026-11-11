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

import { noTask, task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

const HOUR = 3600
const RANKING = [3, 1, 2, 4]

const RANKED: TimedStretch[] = [
  ...RANKING.map((number, rank) => ({
    at: new Date(2026, 10, 9 + (rank % 3), 10),
    group: { work_item: task(number, `Task ${number}`) },
    spend: { seconds: (5 - rank) * HOUR, tokens: (5 - rank) * 1000 },
  })),
  {
    at: new Date(2026, 10, 10, 12),
    group: { work_item: noTask },
    spend: { seconds: 8 * HOUR, tokens: 8000 },
  },
]

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
      `.spending-days [data-series="${key}"] .chart-swatch`,
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
