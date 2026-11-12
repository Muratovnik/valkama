/**
 * Whether the overview's panel scrolls, in the real app over the browser double. The oracle is
 * the requirement: the panel may scroll only where the chart's drawing field would otherwise be
 * lower than 200 pixels, and then what it scrolls to is content; a scroll of a few pixels of the
 * air under the cards is a defect. So the panel either fits its content exactly or its content
 * reaches past the panel's visible edge, and the field keeps its 200 pixels: at 1440 by 900 and
 * 1920 by 1080 in every period, at every window height where the field stands at its floor, and
 * after the panel was scrolled and its box changed. Each run prints what it measured.
 *
 * Every box is read from where it is drawn; the panel's scroll is read as its scroll height.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { TimedStretch } from '../fixtures/analytics.ts'
import { pageAt, record } from './analyticsPage.ts'
import { at, serveLive } from './liveDouble.ts'
import { TASKS, worked, WORLD } from './overviewPage.ts'
import { test } from './test.ts'

/** The overview's week, and work in the live hour, so every period has a chart. */
const WEEK_AND_HOUR: TimedStretch[] = [
  ...WORLD,
  { ...worked(11, TASKS[0], ['model-a', 'main', 'alpha'], 0.5), at: at(13, 50) },
  { ...worked(11, TASKS[1], ['model-b', 'subagent', 'alpha'], 0.25), at: at(14, 20) },
]

/** How far the panel scrolls, how far its content reaches past its visible edge, the field. */
const panelFit = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.analytics-panel')
    const overview = document.querySelector('.overview-panel')
    const field = document.querySelector('.overview-chart .period-field')
    if (!panel || !overview || !field) throw new Error('no overview')
    return {
      scroll: panel.scrollHeight - panel.clientHeight,
      past:
        overview.getBoundingClientRect().bottom +
        panel.scrollTop -
        panel.getBoundingClientRect().bottom,
      field: field.getBoundingClientRect().height,
    }
  })
type Fit = Awaited<ReturnType<typeof panelFit>>

/** The panel scrolls though all its content stands inside its visible edge: by air alone. */
const scrollsByAir = (fit: Fit) => fit.scroll > 0 && fit.past <= 0.5

/** Lets a change of the window reach the field, which the panel works out as it is resized. */
const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )

/** The window height, opened at 900, at which the field comes down to its floor of 200. */
async function floorHeight(page: Page) {
  const { field } = await panelFit(page)
  return 900 - Math.round(field - 200)
}

/** Opens the overview of a period and waits until its field holds still. */
async function openPeriod(page: Page, period: string) {
  await page.goto(pageAt(period === 'week' ? {} : { period }))
  const panel = page.locator('.analytics-panel')
  await expect(panel.locator('.overview-panel')).toBeVisible()
  for (const card of await panel.locator('.overview-top').all())
    await expect(card.locator('.ranked-row').first()).toBeVisible()
  let last = Number.NaN
  await expect
    .poll(async () => {
      await settle(page)
      const { field } = await panelFit(page)
      const still = field === last
      last = field
      return still
    })
    .toBe(true)
}

for (const [width, height] of [
  [1440, 900],
  [1920, 1080],
] as const)
  test(`at ${width} by ${height} the overview fits its panel or scrolls to content, in every period`, async ({
    page,
  }, info) => {
    await serveLive(page, WEEK_AND_HOUR)
    await page.setViewportSize({ width, height })
    const seen: Record<string, Fit> = {}
    for (const period of ['now', 'today', 'week', 'weeks4']) {
      await openPeriod(page, period)
      const fit = await panelFit(page)
      seen[period] = fit
      expect(Math.round(fit.field), `${period}: the field`).toBeGreaterThanOrEqual(200)
      expect(scrollsByAir(fit), `${period}: the panel scrolls by air alone`).toBe(false)
    }
    await record(info, `overview-fit ${width}x${height}`, seen)
  })

test('a panel short of the field’s floor by no more than its air fits, never scrolling by the air', async ({
  page,
}, info) => {
  await serveLive(page, WEEK_AND_HOUR)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openPeriod(page, 'now')
  // The window height at which the field comes down to its floor, and the heights under it.
  const floor = await floorHeight(page)
  const seen: Record<number, Fit> = {}
  for (let height = floor + 2; height >= floor - 40; height -= 2) {
    await page.setViewportSize({ width: 1440, height })
    await settle(page)
    const fit = await panelFit(page)
    seen[height] = fit
    expect(Math.round(fit.field), `${height}: the field`).toBeGreaterThanOrEqual(200)
    expect(scrollsByAir(fit), `${height}: the panel scrolls by air alone`).toBe(false)
  }
  await record(info, 'overview-fit heights', { floor, seen })
})

test('a panel scrolled to its end keeps the field at its floor when its box changes', async ({
  page,
}, info) => {
  await serveLive(page, WEEK_AND_HOUR)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openPeriod(page, 'now')
  const floor = await floorHeight(page)
  // Well under the floor: the panel scrolls to its cards.
  await page.setViewportSize({ width: 1440, height: floor - 120 })
  await settle(page)
  const before = await panelFit(page)
  await page
    .locator('.analytics-panel')
    .evaluate((panel) => panel.scrollTo({ top: panel.scrollHeight }))
  // A box a pixel narrower is worked out again where it stands, scrolled.
  await page.setViewportSize({ width: 1439, height: floor - 120 })
  await settle(page)
  const after = await panelFit(page)
  await record(info, 'overview-fit scrolled', { floor, before, after })
  expect(Math.round(before.field)).toBe(200)
  expect(Math.round(after.field), 'the field after a change of a scrolled box').toBe(200)
})
