/**
 * How a dimension's panel held beside the rail shares its height, in the real app, over thirty
 * tasks. The figures that choose the measure stand whole at the top, outside any scroll; the
 * charts under them take up to 55% of the rest and scroll inside past that, and the table takes
 * the remainder, never less than 14rem. At 1440×900 that leaves five ranked rows and a whole row of
 * small charts in view, and a wheel over the table scrolls it alone while the document and the
 * panel stand still. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { pageAt, record, serve, TASK_REPORT } from './analyticsPage.ts'
import { test } from './test.ts'

/** Thirty tasks over the three days of the week so far, each with a title a row has to fold. */
const THIRTY_TASKS: TimedStretch[] = Array.from({ length: 30 }, (_, index) => ({
  at: new Date(2026, 10, 9 + (index % 3), 10),
  group: {
    work_item: task(
      index + 1,
      `Move the import of long planning documents onto the new board reader, step ${index + 1}`,
    ),
    account: value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f'),
  },
  spend: { seconds: (31 - index) * 3600, tokens: (31 - index) * 900_000, cost: (31 - index) * 4 },
}))

/** Opens the task section at a window size and waits for its table's rows and its fonts. */
async function openSplit(page: Page, width: number, height: number) {
  await serve(page, THIRTY_TASKS)
  await page.setViewportSize({ width, height })
  await page.goto(TASK_REPORT)
  await expect(page.locator('.spending-table-frame tbody tr').first()).toBeVisible()
  await expect(page.locator('.dimension-panel')).toHaveAttribute('data-fills', 'true')
  await page.evaluate(() => document.fonts.ready)
}

/** Where the held panel's parts stand, and how many of the charts' rows show whole. */
function split(page: Page) {
  return page.evaluate(() => {
    const boxOf = (selector: string) => document.querySelector(selector)?.getBoundingClientRect()
    const panel = boxOf('.analytics-panel')
    const charts = boxOf('.dimension-charts')
    const body = boxOf('.dimension-body')
    const table = boxOf('.spending-table')
    const tiles = boxOf('.spending-tiles')
    if (!panel || !charts || !body || !table || !tiles)
      throw new Error('a part of the panel is missing')
    // This body runs in the page, so a helper at the module's own scope would not be there.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const within = (inner: DOMRect, outer: DOMRect) =>
      inner.top >= outer.top - 0.5 &&
      inner.bottom <= outer.bottom + 0.5 &&
      inner.bottom <= window.innerHeight + 0.5
    const wholeIn = (selector: string) =>
      [...document.querySelectorAll(selector)].filter((one) =>
        within(one.getBoundingClientRect(), charts),
      ).length
    const scrollers = [...document.querySelectorAll<HTMLElement>('.dimension-panel *')].filter(
      (one) =>
        ['auto', 'scroll'].includes(getComputedStyle(one).overflowY) &&
        one.scrollHeight > one.clientHeight + 1,
    )
    const chartsStyle = getComputedStyle(document.querySelector('.dimension-charts') as Element)
    const reach = (side: 'marginBottom' | 'marginTop') => Number.parseFloat(chartsStyle[side])
    const root = document.documentElement
    const panelElement = document.querySelector<HTMLElement>('.analytics-panel')
    return {
      tilesWhole: within(tiles, panel) && tiles.bottom <= charts.top,
      tiles: Math.round(tiles.height),
      rest: Math.round(body.height),
      // The charts' track: their box less the air they reach past it at the top and the bottom.
      charts: Math.round(charts.height + reach('marginTop') + reach('marginBottom')),
      table: Math.round(table.height),
      rankedRows: wholeIn('.spending-bars .ranked-row'),
      multiples: wholeIn('.spending-multiples .multiple'),
      scrollers: scrollers.map((one) => one.className),
      documentScrolls: root.scrollHeight - root.clientHeight,
      panelScrolls: (panelElement?.scrollHeight ?? 0) - (panelElement?.clientHeight ?? 0),
    }
  })
}

/** How far the document, the panel, the charts and the table's frame are scrolled. */
const scrolled = (page: Page) =>
  page.evaluate(() => {
    const top = (selector: string) => Math.round(document.querySelector(selector)?.scrollTop ?? -1)
    return {
      document: Math.round(document.scrollingElement?.scrollTop ?? 0),
      panel: top('.analytics-panel'),
      charts: top('.dimension-charts'),
      table: top('.spending-table-frame'),
    }
  })

/** How far the table's frame is scrolled down. */
const tableScrolled = async (page: Page) => {
  const now = await scrolled(page)
  return now.table
}

/** Turns the wheel over the middle of the table's frame. */
async function wheelOverTable(page: Page) {
  const box = await page.locator('.spending-table-frame').boundingBox()
  if (!box) throw new Error('the table drew no frame')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 400)
}

for (const [width, height] of [
  [1440, 900],
  [1920, 1080],
] as const)
  test(`at ${width}×${height} the figures stand whole and the charts and the table share the rest`, async ({
    page,
  }, info) => {
    await openSplit(page, width, height)
    const measured = await split(page)
    await record(info, `analytics split ${width}x${height}`, measured)

    expect(measured.tilesWhole, 'figures cut or under a scroll').toBe(true)
    expect(measured.documentScrolls).toBe(0)
    expect(measured.panelScrolls).toBe(0)
    // The charts hold more than 55% of the rest, so they stop there; the table keeps the remainder.
    expect(measured.charts).toBeLessThanOrEqual(Math.ceil(measured.rest * 0.55) + 1)
    expect(measured.charts).toBeGreaterThanOrEqual(Math.floor(measured.rest * 0.55) - 1)
    expect(measured.table).toBeGreaterThanOrEqual(14 * 16)
    // Two scrollers and no third: the charts, and the table's frame.
    expect(measured.scrollers.toSorted()).toEqual(
      ['dimension-charts', 'chart-table-frame spending-table-frame'].toSorted(),
    )
    expect(measured.rankedRows, 'ranked rows in view').toBeGreaterThanOrEqual(5)
    expect(measured.multiples, 'small charts in view, title and plot').toBeGreaterThanOrEqual(1)

    // The day chart's value axis and the small charts' scale count agent time in one unit each.
    const steps = await page.locator('.spending-days .period-scale .chart-tick').allTextContents()
    const top = (await page.locator('.spending-multiples .multiples-scale').textContent()) ?? ''
    await record(info, `analytics time axis ${width}x${height}`, { steps, top })
    expect(steps.length).toBeGreaterThan(1)
    for (const step of steps) expect(step.trim()).toMatch(/^(0|\d+\s(min|h|d))$/u)
    expect(top).toMatch(/ 0 to \d+\s(min|h|d)$/u)

    await wheelOverTable(page)
    await expect.poll(async () => tableScrolled(page)).toBeGreaterThan(0)
    expect(await scrolled(page)).toMatchObject({ document: 0, panel: 0, charts: 0 })
  })

/** The button at the table that gives it the whole panel, by what it says in either state. */
const wholeButton = (page: Page) =>
  page.locator('.spending-table').getByRole('button', { name: /^(Expand|Collapse) table$/u })

/** How tall the table stands, and whether the charts are drawn beside it. */
const tableRoom = (page: Page) =>
  page.evaluate(() => ({
    table: Math.round(
      document.querySelector('.spending-table')?.getBoundingClientRect().height ?? 0,
    ),
    charts: document.querySelector('.dimension-charts')?.checkVisibility() ?? false,
  }))

test('the table takes the whole panel and gives it back, and the page keeps the choice', async ({
  page,
}, info) => {
  await openSplit(page, 1440, 900)
  const button = wholeButton(page)
  await expect(button).toHaveText('Expand table')
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  const shared = await tableRoom(page)

  await button.focus()
  await page.keyboard.press('Enter')
  await expect(button).toHaveText('Collapse table')
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(button).toBeFocused()
  const whole = await tableRoom(page)
  await record(info, 'analytics split whole table', { shared, whole })
  expect(whole.charts).toBe(false)
  expect(whole.table).toBeGreaterThan(shared.table + 200)
  expect(page.url()).not.toMatch(/whole|expand/iu)

  // A change of measure, of section, of period and a refresh keep the table whole.
  await page.locator('.spending-tiles .segmented-option').nth(1).click()
  await page.locator('.analytics-page-rail').getByRole('button', { name: 'Account' }).click()
  await page.getByRole('radio', { name: 'Past 4 weeks' }).click()
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.locator('.dimension-panel')).toHaveAttribute('data-whole', 'true')
  await expect(wholeButton(page)).toHaveAttribute('aria-pressed', 'true')
  const kept = await tableRoom(page)
  expect(kept.charts).toBe(false)

  await wholeButton(page).press('Space')
  await expect(wholeButton(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(wholeButton(page)).toBeFocused()
  await expect(page.locator('.dimension-charts')).toBeVisible()
})

test('a section that is not held has no button for the whole panel', async ({ page }) => {
  await serve(page, THIRTY_TASKS)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto(pageAt({ by: 'work_item', open: 'section' }))
  await expect(page.locator('.spending-table-frame tbody tr').first()).toBeVisible()
  await expect(page.locator('.dimension-panel')).toHaveAttribute('data-fills', 'false')
  await expect(wholeButton(page)).toHaveCount(0)
})
