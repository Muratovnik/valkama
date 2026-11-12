/**
 * A refresh of the live period «Now» moves nothing and keeps the reader's place, in the real app
 * over the browser double.
 *
 * Between two reads every task did twice the work, so every figure on the page is new while the
 * order of the tasks is not. The bar, the rail, the panel, the period chart's plot and the head of
 * the table stand where they stood at the same size, the panel and the table are scrolled as far
 * as they were, and the section, the measure, the table's sort and the minute under the pointer
 * stay. Nothing blanks on the way: the old answer stays drawn until the new one replaces it.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, record } from './analyticsPage.ts'
import { at, NOW, serveLive, settled, watchPage } from './liveDouble.ts'
import { test } from './test.ts'

const ONE = value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f')
const TWO = value('d4e8a1f0-7c2b-4e5d-8f36-a1b2c3d4e5f6')

/**
 * Thirty tasks in the live hour, each one or a few whole minutes, enough for the table to scroll,
 * the first half under one account and the rest under another, and ten of them in the hour before
 * it; `times` scales every one of them, which keeps their order.
 */
const busyHour = (times: number): TimedStretch[] => [
  ...Array.from({ length: 30 }, (_, index) => ({
    at: at(13, 32 + index, 10),
    group: {
      work_item: task(index + 1, `Task number ${index + 1}`),
      account: index < 15 ? ONE : TWO,
    },
    spend: { seconds: ((index % 4) + 1) * 60 * times },
  })),
  ...Array.from({ length: 10 }, (_, index) => ({
    at: at(12, 40 + index * 2),
    group: { work_item: task(index + 1, `Task number ${index + 1}`), account: ONE },
    spend: { seconds: 120 * times },
  })),
]

/** The parts whose place and size a refresh must keep, against the document. */
const PARTS = [
  '.analytics-page-bar',
  '.analytics-page-rail',
  '.analytics-panel',
  '.spending-days .period-frame',
  '.spending-days .period-field',
  '.spending-table thead',
]

/** The parts that scroll, which a refresh must leave as far scrolled as they were. */
const SCROLLERS = [
  '.analytics-page-rail',
  '.analytics-panel',
  '.dimension-charts',
  '.spending-table-frame',
]

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
 * stacks, the mark of the hour before and the marks of the accounts, and the table's rows.
 */
const DRAWN = {
  minutes: '.spending-days .period-column',
  stacks: '.spending-days .period-stack',
  before: '.spending-days .period-before',
  marks: '.spending-days .period-mark',
  rows: '.spending-table tbody tr',
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

/** The reader's place: the address, the table's sort and the minute the readout stands on. */
const place = async (page: Page) => ({
  address: page.url(),
  sort: await page
    .locator('.spending-table thead th[aria-sort]')
    .evaluateAll((cells) => cells.map((cell) => `${cell.textContent?.trim()} ${cell.ariaSort}`)),
  pointed: await page
    .locator('.spending-days .period-slot[data-shown="true"]')
    .evaluateAll((slots) => slots.map((slot) => slot.dataset.key)),
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
  const analytics = await openReport(page, 1440, pageAt({ period: 'now', by }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.clock.pauseAt(new Date(NOW.getTime() + 10_000))
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
    // The table sorted by its first column and scrolled down, the charts to the period chart.
    const table = analytics.locator('.spending-table')
    await table.locator('thead .table-sort').first().click()
    await expect(table.locator('thead th[aria-sort]')).toHaveCount(1)
    const scrolledTable = await table.locator('.spending-table-frame').evaluate((frame) => {
      frame.scrollTop = 120
      return frame.scrollTop
    })
    expect(scrolledTable, 'the table scrolls').toBeGreaterThan(0)
    expect(await scrollToDays(analytics, '.dimension-charts'), 'the charts scroll').toBeGreaterThan(
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
  // The overview stands whole in the window, so there is no scroll to keep.
  const refresh = await refreshOf(page, 'overview', async () => {})
  expect(refresh.after.layout).toEqual(refresh.before.layout)
  expect(refresh.after.place).toEqual(refresh.before.place)
  expect(refresh.drawn.start.minutes).toBe(60)
  expect(refresh.drawn.start.before).toBeGreaterThan(0)
  expect(refresh.drawn.start.marks).toBeGreaterThan(0)
  expect(refresh.drawn.fewest).toEqual(refresh.drawn.start)
  await record(info, 'live-steady-overview', refresh)
})
