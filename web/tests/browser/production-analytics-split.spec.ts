/**
 * How a dimension's panel beside the rail lays out its parts, in the real app, over thirty tasks.
 * The figures that choose the measure stand whole at the top of the panel; under them the ranked
 * list across the charts' width, with no small charts, since tasks are named by free text, and the
 * table, in the panel's one scroll, the table scrolling
 * inside its own frame (`production-analytics-one-scroll.spec.ts` holds that nothing else in it
 * scrolls on its own). Each row of the table and its heading row is one line, and the figures'
 * columns are as narrow as what they hold. A wheel over the table scrolls it in its frame, the
 * panel and the document standing still, and the names stay pinned at the frame's start. The ranked list's last line and «To the table» bring the table
 * into view with the focus on it. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { noTask, task, value } from '../fixtures/analytics.ts'
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
  await page.evaluate(() => document.fonts.ready)
}

/** Where the panel's parts stand, and how many of the charts' rows show whole in it. */
function split(page: Page) {
  return page.evaluate(() => {
    const boxOf = (selector: string) => document.querySelector(selector)?.getBoundingClientRect()
    const panel = boxOf('.analytics-panel')
    const bars = boxOf('.spending-bars')
    const tiles = boxOf('.spending-tiles')
    if (!panel || !bars || !tiles) throw new Error('a part of the panel is missing')
    // This body runs in the page, so a helper at the module's own scope would not be there.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const within = (inner: DOMRect, outer: DOMRect) =>
      inner.top >= outer.top - 0.5 &&
      inner.bottom <= outer.bottom + 0.5 &&
      inner.bottom <= window.innerHeight + 0.5
    // How many lines each cell of the heading row and of the body rows holds: its height less
    // its padding, by its own line height.
    const linesOf = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '.spending-table-frame thead .chart-cell, .spending-table-frame tbody .chart-cell',
        ),
      ].map((one) => {
        const style = getComputedStyle(one)
        const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2
        const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
        return Math.floor((one.getBoundingClientRect().height - padding) / line + 0.4)
      })
    const wholeIn = (selector: string) =>
      [...document.querySelectorAll(selector)].filter((one) =>
        within(one.getBoundingClientRect(), panel),
      ).length
    const root = document.documentElement
    return {
      tilesWhole: within(tiles, panel) && tiles.bottom <= bars.top,
      tiles: Math.round(tiles.height),
      rankedRows: wholeIn('.spending-bars .ranked-row'),
      // The heading row over the frame, the controls in it and the count's row under them: the
      // title and the controls are one row as tall as the controls, the count one line under it.
      headRow: Math.round(boxOf('.spending-table-head')?.height ?? 0),
      controls: Math.round(boxOf('.spending-table-controls')?.height ?? 0),
      counts: Math.round(boxOf('.spending-table-counts')?.height ?? 0),
      countLine: Math.round(
        Number.parseFloat(
          getComputedStyle(document.querySelector('.spending-table-counts') ?? document.body)
            .lineHeight,
        ),
      ),
      rowGap: Math.round(
        Number.parseFloat(
          getComputedStyle(document.querySelector('.spending-table-head') ?? document.body).rowGap,
        ),
      ),
      // The name's column, and the table it stands in.
      name: Math.round(boxOf('.spending-table-frame tbody th')?.width ?? 0),
      figures: Math.round(
        [...document.querySelectorAll('.spending-table-frame thead th[data-numeric="true"]')]
          .map((one) => one.getBoundingClientRect().width)
          .reduce((sum, width) => sum + width, 0),
      ),
      tableWidth: Math.round(boxOf('.spending-table-frame table')?.width ?? 0),
      // How much wider each figure's column stands than the widest thing in it, padding and all.
      slack: [
        ...document.querySelectorAll<HTMLTableCellElement>(
          '.spending-table-frame thead th[data-numeric="true"]',
        ),
      ].map((heading) => {
        const cells = document.querySelectorAll(
          `.spending-table-frame tr > :nth-child(${heading.cellIndex + 1})`,
        )
        const needs = [...cells].map((cell) => {
          const range = document.createRange()
          range.selectNodeContents(cell)
          const style = getComputedStyle(cell)
          const padding =
            Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
          return range.getBoundingClientRect().width + padding
        })
        return Math.round(heading.getBoundingClientRect().width - Math.max(...needs))
      }),
      lines: linesOf(),
      multiples: wholeIn('.spending-multiples .multiple'),
      documentScrolls: root.scrollHeight - root.clientHeight,
    }
  })
}

/** How far the panel is scrolled down. */
const panelScrolled = (page: Page) =>
  page.evaluate(() => Math.round(document.querySelector('.analytics-panel')?.scrollTop ?? -1))

/** How far the table's frame is scrolled down. */
const frameScrolled = (page: Page) =>
  page.evaluate(() => Math.round(document.querySelector('.spending-table-frame')?.scrollTop ?? -1))

/** How far the document is scrolled down. */
const documentScrolled = (page: Page) =>
  page.evaluate(() => Math.round(document.scrollingElement?.scrollTop ?? 0))

/** Turns the wheel over the middle of an element, the table's frame unless named. */
async function wheelOver(page: Page, selector = '.spending-table-frame') {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`${selector} is not drawn`)
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 100))
  await page.mouse.wheel(0, 400)
}

/** Whether the focus is on the table, and where the table stands against the panel's top. */
const tableFocused = (page: Page) =>
  page.evaluate(() => {
    const table = document.querySelector('.spending-table')
    const panel = document.querySelector('.analytics-panel')
    if (!table || !panel) throw new Error('no table')
    return {
      focused: document.activeElement === table,
      top: Math.abs(
        Math.round(table.getBoundingClientRect().top - panel.getBoundingClientRect().top),
      ),
    }
  })

for (const [width, height] of [
  [1440, 900],
  [1920, 1080],
] as const)
  test(`at ${width}×${height} the figures stand whole over the charts and the table`, async ({
    page,
  }, info) => {
    await openSplit(page, width, height)
    const measured = await split(page)
    await record(info, `analytics split ${width}x${height}`, measured)

    expect(measured.tilesWhole, 'figures cut or under a scroll').toBe(true)
    expect(measured.documentScrolls).toBe(0)
    expect(measured.rankedRows, 'ranked rows in view').toBeGreaterThanOrEqual(5)
    expect(new Set(measured.lines), 'lines in a cell').toEqual(new Set([1]))
    expect(measured.counts, 'the count on one line').toBeLessThanOrEqual(measured.countLine + 1)
    expect(measured.headRow, 'the title and the controls on one line').toBeLessThanOrEqual(
      measured.controls + measured.rowGap + measured.counts + 2,
    )
    expect(measured.controls).toBeLessThanOrEqual(36)
    // The figures' columns are as narrow as what they hold, so the name's column has the rest.
    expect(Math.max(...measured.slack), 'room left in a figure column').toBeLessThanOrEqual(2)
    expect(measured.name + 2).toBeGreaterThanOrEqual(measured.tableWidth - measured.figures)
    expect(measured.multiples, 'no small charts beside a list of tasks').toBe(0)

    // The day chart's value axis counts agent time in one unit.
    const steps = await page.locator('.spending-days .period-scale .chart-tick').allTextContents()
    await record(info, `analytics time axis ${width}x${height}`, { steps })
    expect(steps.length).toBeGreaterThan(1)
    for (const step of steps) expect(step.trim()).toMatch(/^(0|\d+\s(min|h|d))$/u)

    // A wheel over the table scrolls it in its own frame, and the panel and the document stand
    // still; the names stay pinned at the frame's start.
    await page.locator('.spending-table-frame').evaluate((frame) => {
      frame.scrollIntoView({ block: 'start' })
    })
    const before = await panelScrolled(page)
    await wheelOver(page)
    await expect.poll(async () => frameScrolled(page)).toBeGreaterThan(0)
    expect(await panelScrolled(page)).toBe(before)
    expect(await documentScrolled(page)).toBe(0)
    const name = await page
      .locator('.spending-table-frame tbody th')
      .first()
      .evaluate((one) => getComputedStyle(one).position)
    expect(name).toBe('sticky')
  })

test('the ranked list names ten tasks and the rest in one row, and its last line brings the table into view, focused', async ({
  page,
}) => {
  await openSplit(page, 1440, 900)
  await expect(page.locator('.spending-bars .ranked-row')).toHaveCount(11)
  await expect(page.locator('.spending-bars .ranked-rest .ranked-label')).toHaveText([
    'Other, 20 more',
  ])
  const more = page
    .locator('.spending-bars')
    .getByRole('button', { name: '20 more — in the table' })
  await more.click()
  await expect.poll(() => tableFocused(page)).toEqual({ focused: true, top: 0 })
  // The charts are still there over the table, in the same scroll.
  await expect(page.locator('.spending-bars')).toBeAttached()
  await expect(page.getByRole('button', { name: /^(Expand|Collapse) table$/u })).toHaveCount(0)
})

/** How wide a ranked row's bar is drawn, in pixels. */
const barWidth = (row: Locator) =>
  row.locator('.ranked-bar').evaluate((one) => one.getBoundingClientRect().width)

test('work on no task, larger than any task, stands apart after the tasks with a longer bar than theirs', async ({
  page,
}) => {
  await serve(page, [
    ...THIRTY_TASKS,
    {
      at: new Date(2026, 10, 9, 12),
      group: { work_item: noTask, account: value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f') },
      spend: { seconds: 200 * 3600, tokens: 1000, cost: 1 },
    },
  ])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(TASK_REPORT)
  const none = page.locator('.spending-bars .ranked-rest .ranked-row').last()
  await expect(none).toHaveAttribute('data-kind', 'none')
  await expect(none.locator('.ranked-label')).toHaveText('No task')
  // Work on no task takes the darker neutral, never the folded rest's lighter one, and its bar is
  // on the tasks' scale, longer than the largest task's.
  const bar = none.locator('.ranked-bar')
  await expect(bar).toHaveAttribute('data-slot', 'apart')
  const first = page.locator('.spending-bars .ranked-row').first()
  await expect(first).toHaveAttribute('data-kind', 'category')
  expect(await barWidth(none)).toBeGreaterThan(await barWidth(first))
})

test('the table counts the values of the period as the rail’s tile does', async ({ page }) => {
  await serve(page, [
    ...THIRTY_TASKS,
    {
      at: new Date(2026, 10, 9, 12),
      group: { work_item: noTask, account: value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f') },
      spend: { seconds: 3600, tokens: 1000, cost: 1 },
    },
  ])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(TASK_REPORT)
  const line = page.locator('.spending-table-summary')
  // The line says how many tasks in a few words; its hint gives the whole account and the order.
  await expect(line).toHaveText('30 tasks')
  await expect(line).toHaveAttribute(
    'data-tooltip',
    /^30 in the period · and «No task», sorted by «Agent time», largest first$/u,
  )
  expect(await line.evaluate((one) => one.scrollWidth <= one.clientWidth)).toBe(true)
  const tile = page.locator('.analytics-page-rail').getByRole('button', { name: /^Task\b/u })
  const tileText = (await tile.textContent()) ?? ''
  const lineText = (await line.textContent()) ?? ''
  const values = /(\d+) values?/u.exec(tileText)?.[1]
  const first = /^(\d+) tasks$/u.exec(lineText.trim())?.[1]
  expect(values).toBe('30')
  expect(first).toBe(values)
})

// At 1024×768 the app's navigation leaves the page too narrow for the rail beside the section, so
// the section takes the list's place. It runs in the panel's one scroll as it does beside the rail:
// a wheel over its figures moves the panel, and «To the table» brings the table up, focused.
test('at 1024×768 in place of the list the section scrolls in the panel and reaches its table', async ({
  page,
}, info) => {
  await serve(page, THIRTY_TASKS)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto(pageAt({ by: 'work_item', open: 'section' }))
  await expect(page.locator('.spending-table-frame tbody tr').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const measured = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.analytics-panel')
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect()
    if (!panel) throw new Error('no panel')
    return {
      nav: Math.round(box('.app-nav-frame')?.width ?? 0),
      section: Math.round(box('.dimension-panel')?.width ?? 0),
      panel: panel.clientHeight,
      panelContent: panel.scrollHeight,
    }
  })
  await record(info, 'analytics section in place 1024x768', measured)
  expect(measured.nav, 'the app’s navigation').toBeGreaterThan(0)
  expect(measured.section, 'the section narrower than two charts side by side').toBeLessThan(
    48 * 16,
  )
  expect(measured.panelContent, 'a panel that scrolls').toBeGreaterThan(measured.panel)

  await wheelOver(page, '.spending-tiles')
  await expect.poll(async () => panelScrolled(page)).toBeGreaterThan(0)
  expect(await documentScrolled(page)).toBe(0)

  await page.locator('.analytics-panel').evaluate((panel) => panel.scrollTo({ top: 0 }))
  await page.getByRole('button', { name: 'To the table' }).click()
  await expect.poll(() => tableFocused(page)).toEqual({ focused: true, top: 0 })
})

test('at 1024×768 a column’s heading takes two lines at most', async ({ page }, info) => {
  await serve(page, THIRTY_TASKS)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto(pageAt({ by: 'work_item', open: 'section' }))
  await expect(page.locator('.spending-table-frame tbody tr').first()).toBeVisible()
  // At this width a column's heading takes two lines at most, and a row's name still one.
  const lines = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.spending-table-frame thead .table-sort')].map(
      (one) => {
        const style = getComputedStyle(one)
        const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2
        return Math.round(one.getBoundingClientRect().height / line)
      },
    ),
  )
  await record(info, 'analytics table heading lines 1024x768', lines)
  expect(Math.max(...lines)).toBeLessThanOrEqual(2)
})
