/**
 * A refresh of the live period «Now» moves nothing and keeps the reader's place, in the real app
 * over the browser double.
 *
 * Between two reads every task did twice the work, so every figure on the page is new while the
 * order of the tasks is not. The bar, the rail, the panel, the period chart's plot and the head of
 * the table stand where they stood at the same size, the panel is scrolled as far as it was, and
 * the section, the measure, the table's sort and the minute under the pointer
 * stay. Nothing blanks on the way: the old answer stays drawn until the new one replaces it.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { openReport, pageAt, record } from './analyticsPage.ts'
import { NOW, serveLive, settled, watchPage } from './liveDouble.ts'
import { busyHour } from './served/analyticsLiveSteady.ts'
import { test } from './test.ts'

/** The parts whose place and size a refresh must keep, against the document. */
const PARTS = [
  '.analytics-page-bar',
  '.analytics-page-rail',
  '.analytics-panel',
  '.spending-days .period-frame',
  '.spending-days .period-field',
  '.spending-table thead',
  '.spending-tiles',
  '.spending-tiles .mini-trend',
]

/** The parts that scroll, which a refresh must leave as far scrolled as they were. */
const SCROLLERS = ['.analytics-page-rail', '.analytics-panel', '.section-table-frame']

/** Where the parts stand and how far each scroller is scrolled, to the hundredth of a pixel. */
const layout = (page: Page) =>
  page.evaluate(
    ({ parts, scrollers }) => {
      const boxes = parts.map((selector) => {
        const element = document.querySelector(selector)
        if (!element) return `${selector}: missing`
        const { x, y, width, height } = element.getBoundingClientRect()
        const box = [x, y, width, height].map((number) => Math.round(number * 100) / 100)
        return `${selector}: ${box.join(' ')}`
      })
      const scrolled = scrollers.map((selector) => {
        const element = document.querySelector(selector)
        const offsets = element ? [element.scrollTop, element.scrollLeft].join(' ') : 'missing'
        return `${selector}: ${offsets}`
      })
      return { boxes, scrolled }
    },
    { parts: PARTS, scrollers: SCROLLERS },
  )

/**
 * What the page draws that a refresh must never blank, even for a moment: the minutes, their
 * stacks, the mark of the hour before, the marks of the accounts, the table's rows and the steps
 * of the figures' trends.
 */
const DRAWN = {
  minutes: '.spending-days .period-column',
  stacks: '.spending-days .period-stack',
  before: '.spending-days .period-before',
  marks: '.spending-days .period-mark',
  rows: '.spending-table tbody tr',
  trends: '.spending-tiles .mini-trend-period',
}

/**
 * Watches the page from now on, every change of it, and keeps how many of each drawn part it had
 * at the start and the fewest it ever had since.
 */
const watchBlanks = (page: Page) =>
  page.evaluate((drawn) => {
    const look = () =>
      Object.fromEntries(
        Object.entries(drawn).map(([part, selector]) => [
          part,
          document.querySelectorAll(selector).length,
        ]),
      )
    const start = look()
    const fewest = { ...start }
    new MutationObserver(() => {
      for (const [part, count] of Object.entries(look()))
        fewest[part] = Math.min(fewest[part] ?? count, count)
    }).observe(document.body, { childList: true, subtree: true, attributes: true })
    Object.assign(globalThis, { drawnParts: { start, fewest } })
  }, DRAWN)

type Drawn = Record<keyof typeof DRAWN, number>

const drawnParts = (page: Page) =>
  page.evaluate(
    () => (globalThis as unknown as { drawnParts: { fewest: Drawn; start: Drawn } }).drawnParts,
  )

/** The reader's place: the address, the table's sort and the minute the pointer stands on. */
const place = async (page: Page) => ({
  address: page.url(),
  sort: await page
    .locator('.spending-table thead th[aria-sort]')
    .evaluateAll((cells) => cells.map((cell) => `${cell.textContent?.trim()} ${cell.ariaSort}`)),
  pointed: await page
    .locator('.spending-days .period-slot:hover')
    .evaluateAll((slots) => slots.map((slot) => (slot as HTMLElement).dataset.key)),
})

/**
 * Opens «Now» at `by`, lets `prepare` take the reader's place, then has every task do twice the
 * work and the page read itself again at the end of the interval: where everything stood and the
 * reader's place before and after, and how many of each drawn part there were at the start and
 * at the fewest in between.
 */
async function refreshOf(page: Page, by: string, prepare: (analytics: Locator) => Promise<void>) {
  await page.clock.install({ time: NOW })
  const { count } = await watchPage(page)
  const double = await serveLive(page, busyHour(1))
  // The page's time stops before it opens, so a slow open cannot move the pause into the past.
  await page.clock.pauseAt(new Date(NOW.getTime() + 10_000))
  const analytics = await openReport(page, 1440, pageAt({ period: 'now', by }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await settled(count, double)
  const time = analytics.locator('.tile-figure[data-measure="time"]')
  const shown = (await time.textContent()) ?? ''
  await prepare(analytics)
  await analytics.locator('.spending-days .period-slot').nth(40).hover()
  const before = { layout: await layout(page), place: await place(page) }
  expect(before.place.pointed).toHaveLength(1)

  double.world = busyHour(2)
  await watchBlanks(page)
  await page.clock.runFor(30_000)
  await expect(time).not.toHaveText(shown)
  await settled(count, double)
  const after = { layout: await layout(page), place: await place(page) }
  const totals = [shown, (await time.textContent()) ?? '']
  return { before, after, drawn: await drawnParts(page), totals }
}

/** Scrolls the period chart's scroller to the chart, which it must be scrolled to see. */
const scrollToDays = (analytics: Locator, scroller: string) =>
  analytics.locator(scroller).evaluate((element) => {
    element.querySelector('.spending-days')?.scrollIntoView({ block: 'end' })
    return element.scrollTop
  })

test('a refresh of «Now» moves nothing on a section and keeps the reader’s place', async ({
  page,
}, info) => {
  const refresh = await refreshOf(page, 'work_item', async (analytics) => {
    // The table sorted by its first column, and the panel scrolled down to the period chart.
    const table = analytics.locator('.spending-table')
    await table.locator('thead .table-sort').first().click()
    await expect(table.locator('thead th[aria-sort]')).toHaveCount(1)
    expect(await scrollToDays(analytics, '.analytics-panel'), 'the panel scrolls').toBeGreaterThan(
      0,
    )
  })
  expect(refresh.after.layout).toEqual(refresh.before.layout)
  expect(refresh.after.place).toEqual(refresh.before.place)
  expect(refresh.drawn.start).toMatchObject({ minutes: 60, rows: 30 })
  expect(refresh.drawn.start.marks).toBeGreaterThan(0)
  expect(refresh.drawn.fewest).toEqual(refresh.drawn.start)
  await record(info, 'live-steady-section', refresh)
})

test('a refresh of «Now» moves nothing on the overview and keeps the reader’s place', async ({
  page,
}, info) => {
  // The overview's panel unscrolled: its top is the place a refresh keeps.
  const refresh = await refreshOf(page, 'overview', async () => {})
  expect(refresh.after.layout).toEqual(refresh.before.layout)
  expect(refresh.after.place).toEqual(refresh.before.place)
  expect(refresh.drawn.start.minutes).toBe(60)
  expect(refresh.drawn.start.before).toBeGreaterThan(0)
  expect(refresh.drawn.start.marks).toBeGreaterThan(0)
  expect(refresh.drawn.fewest).toEqual(refresh.drawn.start)
  await record(info, 'live-steady-overview', refresh)
})
