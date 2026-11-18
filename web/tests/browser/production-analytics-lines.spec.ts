/**
 * The grid of columns the Analytics page stands on, in the real app in Russian, at the window
 * sizes it is used at: the module's name over the page, the bar's first control and the edge of
 * the chosen entry of the rail on one left line; the bar and the panel ending on one right edge;
 * and the rail as wide as its entries need, so no section's name is cut, with the panel beside it
 * 640 pixels or more wherever the two stand side by side. The rail keeps its scrollbar's room
 * whether it scrolls or not, and its width moves neither when an entry is chosen nor when the
 * figures arrive. Each run prints what it measured, the bar's second group and the panel's left
 * line among it.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { seatValue, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { pageAt, record, serve, shortfalls } from './analyticsPage.ts'
import { test } from './test.ts'

test.use({ locale: 'ru-RU' })

/**
 * Twelve stretches of this week with a value in every dimension, so every entry has a count: the
 * longest name, «Способ запуска», the longest count of the fixture beside it.
 */
const EVERY_DIMENSION: TimedStretch[] = Array.from({ length: 12 }, (_, index) => ({
  at: new Date(2026, 10, 9 + (index % 3), 10),
  group: {
    work_item: task(index + 1, `Задача ${index + 1}`),
    seat: seatValue(`organization-${index % 2}/account-${index % 4}`),
    account: value(`organization-${index % 2}`),
    project: value(`project-${index % 3}`),
    executor: value(`executor-${index % 4}`),
    role: value(index % 2 ? 'main' : 'subagent'),
    launch_class: value(`launch-${index}`),
    model: value(`model-${index % 5}`),
    effort: value(`effort-${index % 3}`),
    environment: value(`environment-${index % 2}`),
  },
  spend: { seconds: 3600 * (index + 1), tokens: 1000 * (index + 1), cost: index + 1 },
}))

/** The window sizes the page is used at, the owner's own among them. */
const SIZES = [
  [1280, 800],
  [1440, 900],
  [1670, 985],
  [1920, 1080],
] as const

/** The least width of the panel beside the rail. */
const PANEL_LEAST = 640

/** Where the page's lines stand, to the fraction of a pixel. */
const lines = (page: Page) =>
  page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect()
    const shown = (element: Element) =>
      element instanceof HTMLElement && element.checkVisibility()
        ? element.getBoundingClientRect()
        : undefined
    const panel = document.querySelector<HTMLElement>('.analytics-panel')
    const panelStyle = panel ? getComputedStyle(panel) : undefined
    const panelBox = panel && shown(panel)
    const rail = document.querySelector<HTMLElement>('.analytics-page-rail')
    const railBox = rail && shown(rail)
    const bar = document.querySelector<HTMLElement>('.analytics-page-bar')
    const period = document.querySelector('.analytics-period')
    // The bar's parts in their order, the filters' among them, which lay theirs out in the line.
    const parts = [...(document.querySelector('.analytics-bar-line')?.children ?? [])].flatMap(
      (part) => (getComputedStyle(part).display === 'contents' ? [...part.children] : [part]),
    )
    const second = parts
      .slice(parts.indexOf(period as Element) + 1)
      .map((part) => shown(part))
      .find((found) => found && found.width > 0)
    return {
      heading: box('.module-title')?.left,
      first: period?.getBoundingClientRect().left,
      entry: box('.analytics-rail-entry[aria-current="page"]')?.left,
      second: second?.left,
      panelLine:
        panelBox && panelStyle ? panelBox.left + Number.parseFloat(panelStyle.paddingLeft) : 0,
      barEnd: bar
        ? bar.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(bar).paddingRight)
        : 0,
      // Where what the panel holds ends: inside its scrollbar's room, which it keeps.
      panelEnd:
        panel && panelBox && panelStyle
          ? panelBox.left +
            panel.clientLeft +
            panel.clientWidth -
            Number.parseFloat(panelStyle.paddingRight)
          : 0,
      page: box('.analytics-page')?.width ?? 0,
      rail: railBox?.width ?? 0,
      panel: panelBox?.width ?? 0,
      railGutter: rail ? rail.offsetWidth - rail.clientWidth : 0,
      railScrolls: rail !== null && rail.scrollHeight > rail.clientHeight,
    }
  })

/** Whether the rail scrolls. */
async function scrolls(page: Page) {
  const measured = await lines(page)
  return measured.railScrolls
}

/** How far an edge stands off a line; never within reach when either is missing. */
const off = (edge: number | undefined, line: number | undefined) =>
  Math.abs((edge ?? Number.NaN) - (line ?? Number.NaN))

/**
 * Each section's name on the rail that its box cuts, by a whole pixel or a fraction of one, with
 * how many names were measured and how many sections the rail has: a section's entry is its
 * button (`data-section`, `AnalyticsRail`), so a name each is measured.
 */
async function cutNames(page: Page) {
  const scrolled = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.analytics-rail-name')]
      .filter((name) => name.scrollWidth > name.clientWidth)
      .map((name) => name.textContent),
  )
  const measured = await shortfalls(page, '.analytics-rail-name')
  const sections = await page.locator('button[data-section]').count()
  return {
    measured: measured.length,
    sections,
    scrolled,
    short: measured.filter((name) => name.short > 0),
  }
}

async function open(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height })
  await page.goto(pageAt({ by: 'launch_class' }))
  await expect(page.locator('[data-section="launch_class"] .analytics-rail-count')).toHaveText(
    /\d/u,
  )
  await expect(page.locator('.analytics-rail-entry[aria-current="page"]')).toBeVisible()
}

for (const [width, height] of SIZES)
  test(`at ${width}×${height} the heading, the bar and the rail stand on one grid`, async ({
    page,
  }, info) => {
    await serve(page, EVERY_DIMENSION)
    await open(page, width, height)
    const measured = await lines(page)
    const cut = await cutNames(page)
    await record(info, `analytics lines ${width}x${height}`, { ...measured, cut })

    expect(
      off(measured.first, measured.heading),
      "the bar's first control off the heading's line",
    ).toBeLessThanOrEqual(1)
    expect(
      off(measured.entry, measured.heading),
      "the chosen entry's box off the heading's line",
    ).toBeLessThanOrEqual(1)
    expect(
      off(measured.barEnd, measured.panelEnd),
      'the bar and the panel end apart',
    ).toBeLessThanOrEqual(1)

    // Side by side wherever the panel then keeps its 640 pixels, and only there.
    expect(measured.rail, 'the rail beside the panel').toBeGreaterThan(0)
    expect(measured.panel, 'the panel beside the rail').toBeGreaterThanOrEqual(PANEL_LEAST)
    expect(measured.rail + measured.panel).toBeCloseTo(measured.page, 1)

    expect(cut.sections, 'the sections of the rail').toBeGreaterThan(1)
    expect(cut.measured, 'a name measured a section').toBe(cut.sections)
    expect(cut.scrolled, 'names their box scrolls').toEqual([])
    expect(cut.short, 'names cut by their box').toEqual([])
    expect(measured.railGutter, "the scrollbar's room").toBeGreaterThan(0)
  })

test("the rail's width moves neither as its figures arrive nor as an entry is chosen, and keeps the scrollbar's room", async ({
  page,
}) => {
  await serve(page, EVERY_DIMENSION)
  // The rail's figures held until the rail is measured without them.
  let answer: (() => void) | undefined
  const held = new Promise<void>((resolve) => {
    answer = resolve
  })
  await page.route('**/api/analytics/usage?*', async (route) => {
    await held
    await route.fallback()
  })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto(pageAt({ by: 'launch_class' }))
  await expect(page.locator('.analytics-rail-entry[aria-current="page"]')).toBeVisible()
  const waiting = await lines(page)
  answer?.()
  await expect(page.locator('[data-section="launch_class"] .analytics-rail-count')).toHaveText(
    /\d/u,
  )
  const arrived = await lines(page)
  expect(arrived.rail, 'the rail once its figures arrived').toBe(waiting.rail)

  await page.locator('[data-section="overview"]').click()
  await expect(page.locator('[data-section="overview"]')).toHaveAttribute('aria-current', 'page')
  const chosen = await lines(page)
  expect(chosen.rail, 'the rail with another entry chosen').toBe(waiting.rail)

  // A window tall enough for every section leaves the rail still, a low one scrolls it, and the
  // rail is as wide in both, its scrollbar's room kept.
  await page.setViewportSize({ width: 1920, height: 2000 })
  await expect.poll(() => scrolls(page)).toBe(false)
  const still = await lines(page)
  await page.setViewportSize({ width: 1920, height: 480 })
  await expect.poll(() => scrolls(page)).toBe(true)
  const low = await lines(page)
  expect(still.railGutter, "the scrollbar's room in a rail that stands still").toBeGreaterThan(0)
  expect(low.railGutter, "the scrollbar's room in a rail that scrolls").toBe(still.railGutter)
  expect(low.rail, 'the rail that scrolls').toBe(still.rail)
  expect(still.rail, 'the rail that stands still').toBe(waiting.rail)
})
