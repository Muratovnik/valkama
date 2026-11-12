/**
 * The frame of the Analytics page in the real app: a bar over a rail of sections and the panel of
 * the one on show, the whole of the module's frame.
 *
 * The rail and the panel stand side by side only where the panel then has 640 pixels or more,
 * and the page decides that on its own box, not on the window: at 1440 pixels they do, at 1024
 * and 390 they take turns, and a page narrowed inside a wide window takes turns too. Taking
 * turns, the rail is the screen, a list; a section chosen there takes its place, and the
 * browser's Back returns to the list.
 *
 * At any of those widths the document never scrolls: the bar stays where it is, and the rail and
 * the panel each scroll on their own, as does the list or the section where they take turns.
 * Beside the rail, a dimension's panel is held to its height and scrolls its parts instead, the
 * charts on their own and the table on its own; in place of the list, and for the overview
 * taller than its panel, the panel scrolls. A window too low for the report leaves the scroll to
 * the panel or its parts, never to the document. Every other module keeps the frame's own scroll.
 * The section on show is in the address, so a reload keeps it; the plain address is the
 * overview, and an address the page wrote before it had sections that names its breakdown opens
 * the same period, measure and filters in the section of that breakdown. Each run prints what it
 * measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { pageAt, record, serve, TASK_REPORT } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { globalScope } from './planningFixtures.ts'
import { test } from './test.ts'

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

/** How the document, the module's frame, the bar, the rail and the panel stand and scroll. */
async function scrolling(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement
    const area = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)
      if (!element) return null
      const { y, height } = element.getBoundingClientRect()
      return {
        overflowY: getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        scrollTop: Math.round(element.scrollTop),
        y: Math.round(y),
        height: Math.round(height),
        shown: element.checkVisibility(),
      }
    }
    return {
      document: {
        scrollHeight: root.scrollHeight,
        clientHeight: root.clientHeight,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        scrollTop: Math.round(document.scrollingElement?.scrollTop ?? 0),
      },
      frame: area('.module-frame'),
      bar: area('.analytics-page-bar'),
      rail: area('.analytics-page-rail'),
      panel: area('.analytics-panel'),
      charts: area('.dimension-charts'),
    }
  })
}

/** How far an area of the page is scrolled down, as measured. */
const scrolledBy = (
  measured: Awaited<ReturnType<typeof scrolling>>,
  area: 'charts' | 'frame' | 'panel' | 'rail',
) => measured[area]?.scrollTop ?? 0

/** Turns the wheel over the middle of an element. */
async function wheelOver(page: Page, selector: string, by: number) {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`${selector} is not on screen`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, by)
}

/** Opens the page on the task section's report, which is taller than any window here. */
async function openAt(page: Page, width: number, height: number, address = TASK_REPORT) {
  await serve(page)
  await page.setViewportSize({ width, height })
  await page.goto(address)
  await expect(page.locator('.analytics-panel .spending-days')).toBeVisible()
}

for (const [width, height] of [
  [1440, 900],
  [1440, 600],
] as const)
  test(`the document stands still while the rail and the panel's parts scroll at ${width}×${height}`, async ({
    page,
  }, info) => {
    await openAt(page, width, height)
    const before = await scrolling(page)
    await record(info, `analytics frame ${width}x${height}`, before)
    expect(before.document.scrollHeight).toBe(before.document.clientHeight)
    expect(before.document.scrollWidth).toBe(before.document.clientWidth)
    // The module's frame holds the page at its own size and has nothing of it to scroll.
    expect(before.frame?.scrollHeight).toBe(before.frame?.clientHeight)
    expect(before.rail?.overflowY).toBe('auto')
    expect(before.panel?.overflowY).toBe('auto')
    expect(before.rail?.shown && before.panel?.shown).toBe(true)
    // The section of a dimension is held to its panel, which has nothing to scroll; its charts,
    // taller than the part they are given, hold the rest under their own scroll.
    expect(before.panel?.scrollHeight).toBe(before.panel?.clientHeight)
    expect(before.charts?.overflowY).toBe('auto')
    expect(before.charts?.scrollHeight).toBeGreaterThan(before.charts?.clientHeight ?? 0)

    await wheelOver(page, '.dimension-charts', 600)
    await expect.poll(async () => scrolledBy(await scrolling(page), 'charts')).toBeGreaterThan(0)
    const after = await scrolling(page)
    expect(after.document.scrollTop).toBe(0)
    expect(after.panel?.scrollTop).toBe(0)
    expect(after.bar?.y).toBe(before.bar?.y)
    expect(after.rail?.y).toBe(before.rail?.y)
    expect(after.rail?.scrollTop).toBe(0)
    await page.screenshot(shot(info, `analytics-frame-${width}x${height}.png`))
  })

for (const [width, height] of [
  [1024, 768],
  [1024, 600],
] as const)
  test(`the document stands still while the section in place of the list scrolls at ${width}×${height}`, async ({
    page,
  }, info) => {
    await openAt(page, width, height, pageAt({ by: 'work_item', open: 'section' }))
    const before = await scrolling(page)
    await record(info, `analytics frame ${width}x${height}`, before)
    expect(before.document.scrollHeight).toBe(before.document.clientHeight)
    expect(before.document.scrollWidth).toBe(before.document.clientWidth)
    expect(before.frame?.scrollHeight).toBe(before.frame?.clientHeight)
    expect(before.panel?.overflowY).toBe('auto')
    expect(before.rail?.shown, 'the rail beside the section').toBe(false)
    expect(before.panel?.shown).toBe(true)
    // In place of the list the section is not held: its report is taller than the panel, which
    // holds the rest under its own scroll.
    expect(before.panel?.scrollHeight).toBeGreaterThan(before.panel?.clientHeight ?? 0)

    // Turned over the section's figures, where one scrolling the section reads: where the window
    // is tall enough, the table stays at the panel's bottom edge, half the window high, and a wheel
    // over it moves the table alone (`production-analytics-split.spec.ts`).
    await wheelOver(page, '.spending-tiles', 600)
    await expect.poll(async () => scrolledBy(await scrolling(page), 'panel')).toBeGreaterThan(0)
    const after = await scrolling(page)
    expect(after.document.scrollTop).toBe(0)
    expect(after.bar?.y).toBe(before.bar?.y)
    await page.screenshot(shot(info, `analytics-frame-${width}x${height}.png`))
  })

/** How wide the page, the rail and the panel stand; nothing for one that is not shown. */
const widths = (page: Page) =>
  page.evaluate(() => {
    // This body runs in the page, so a helper at the module's own scope would not be there.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const width = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)
      return element?.checkVisibility() ? element.getBoundingClientRect().width : 0
    }
    return {
      page: width('.analytics-page'),
      rail: width('.analytics-page-rail'),
      panel: width('.analytics-panel'),
    }
  })

/** The least width of the panel beside the rail. */
const PANEL_LEAST = 640
/** The rail's width beside the panel: 15 of the root's 16-pixel ems. */
const RAIL = 240

test('at 1440px the rail and the panel stand side by side, the panel 640 pixels or more', async ({
  page,
}, info) => {
  await openAt(page, 1440, 900)
  const shown = await widths(page)
  await record(info, 'analytics frame widths 1440', shown)
  expect(shown.rail, 'the rail').toBeCloseTo(RAIL, 1)
  expect(shown.panel, 'the panel beside the rail').toBeGreaterThanOrEqual(PANEL_LEAST)
  expect(shown.rail + shown.panel).toBeCloseTo(shown.page, 1)
})

for (const width of [1024, 390])
  test(`at ${width}px the rail and the panel take turns, the section having the page`, async ({
    page,
  }, info) => {
    await openAt(page, width, 900, pageAt({ open: 'section' }))
    const shown = await widths(page)
    await record(info, `analytics frame widths ${width}`, shown)
    // Beside the rail, the section would have had under 640 pixels.
    expect(shown.page - RAIL).toBeLessThan(PANEL_LEAST)
    expect(shown.rail, 'the rail beside the section').toBe(0)
    expect(shown.panel).toBeCloseTo(shown.page, 1)
  })

test('the page’s own box decides, whatever the window: narrowed in a wide one, it takes turns', async ({
  page,
}) => {
  await openAt(page, 1440, 900)
  const rail = page.locator('.analytics-rail')
  const panel = page.locator('.analytics-panel')
  const narrowTo = (inlineSize: string) =>
    page.locator('.analytics-page').evaluate((element, size) => {
      element.style.inlineSize = size
    }, inlineSize)
  await expect(panel).toBeVisible()
  // The page given 879 pixels of a window of 1440: the rail would leave the panel 639.
  await narrowTo('879px')
  await expect(panel).toBeHidden()
  await expect(rail).toBeVisible()
  // One pixel more, and the panel has its 640 beside the rail.
  await narrowTo('880px')
  await expect(panel).toBeVisible()
  await expect(rail).toBeVisible()
  const beside = await widths(page)
  expect(beside.panel).toBeCloseTo(PANEL_LEAST, 1)
})

test('the overview, taller than its panel, scrolls the panel while the document stands still', async ({
  page,
}, info) => {
  await serve(page)
  await page.setViewportSize({ width: 1024, height: 600 })
  await page.goto(pageAt({ open: 'section' }))
  await expect(page.locator('.analytics-panel .spending-days')).toBeVisible()
  const before = await scrolling(page)
  await record(info, 'analytics frame overview 1024x600', before)
  expect(before.panel?.scrollHeight).toBeGreaterThan(before.panel?.clientHeight ?? 0)

  await wheelOver(page, '.analytics-panel', 600)
  await expect.poll(async () => scrolledBy(await scrolling(page), 'panel')).toBeGreaterThan(0)
  const after = await scrolling(page)
  expect(after.document.scrollTop).toBe(0)
  expect(after.bar?.y).toBe(before.bar?.y)
  expect(after.rail?.scrollTop).toBe(0)
})

test('the rail scrolls on its own when the window is too low for its sections', async ({
  page,
}, info) => {
  await openAt(page, 1440, 480)
  const before = await scrolling(page)
  await record(info, 'analytics frame rail 1440x480', before)
  expect(before.document.scrollHeight).toBe(before.document.clientHeight)
  expect(before.rail?.scrollHeight).toBeGreaterThan(before.rail?.clientHeight ?? 0)
  await wheelOver(page, '.analytics-page-rail', 2000)
  await expect.poll(async () => scrolledBy(await scrolling(page), 'rail')).toBeGreaterThan(0)
  const after = await scrolling(page)
  expect(after.panel?.scrollTop).toBe(0)
  expect(after.document.scrollTop).toBe(0)
  // The last section is reachable.
  await expect(page.locator('[data-section="environment"]')).toBeInViewport()
})

test('another module keeps the frame scrolling it', async ({ page }, info) => {
  await serve(page)
  await page.setViewportSize({ width: 1024, height: 480 })
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: globalScope }))
  await expect(page.locator('.module-frame .module-settings')).toBeVisible()
  const before = await scrolling(page)
  await record(info, 'settings frame 1024x480', before)
  expect(before.frame?.overflowY).toBe('auto')
  expect(before.frame?.scrollHeight).toBeGreaterThan(before.frame?.clientHeight ?? 0)
  await wheelOver(page, '.module-frame', 400)
  await expect.poll(async () => scrolledBy(await scrolling(page), 'frame')).toBeGreaterThan(0)
})

test('a section chosen on the rail is the address, and a reload keeps it', async ({ page }) => {
  await openAt(page, 1440, 900, pageAt())
  const rail = page.getByRole('navigation', { name: 'Sections of the usage' })
  const current = rail.locator('[aria-current="page"] .analytics-rail-name')
  // The plain address is the overview.
  await expect(current).toHaveText('Overview')
  await rail.getByRole('button', { name: 'Model' }).click()
  await expect.poll(() => path(page)).toBe(pageAt({ by: 'model' }))
  await expect(page.locator('.spending-bars h2')).toHaveText('Agent time by model')
  await page.reload()
  await expect(current).toHaveText('Model')
  await expect(page.locator('.spending-bars h2')).toHaveText('Agent time by model')

  // From the keyboard: the task section, named in the address as every dimension is.
  await rail.getByRole('button', { name: 'Task' }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => path(page)).toBe(pageAt({ by: 'work_item' }))
  await expect(page.locator('.spending-bars h2')).toHaveText('Agent time by task')

  // And back to the overview, the plain address, which shows the period at a glance.
  await rail.getByRole('button', { name: 'Overview' }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => new URL(page.url()).search).toBe('')
  await expect(rail.getByRole('button', { name: 'Overview' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.locator('.analytics-panel .spending-tiles')).toBeVisible()
  await expect(page.locator('.analytics-panel .spending-days')).toBeVisible()
  await expect(page.locator('.analytics-panel .overview-changes')).toBeVisible()
  await expect(page.locator('.spending-bars, .spending-table')).toHaveCount(0)
})

test('an address the page wrote before it had sections opens the same view', async ({ page }) => {
  const released = pageAt({
    period: 'weeks4',
    by: 'model',
    measure: 'tokens',
    filters: '{"model":["model-a"]}',
  })
  await openAt(page, 1440, 900, released)
  await expect(page.getByRole('radio', { name: 'Past 4 weeks' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(
    page.locator('.analytics-rail [aria-current="page"] .analytics-rail-name'),
  ).toHaveText('Model')
  await expect(page.locator('.analytics-bar-filters .combo-chip')).toHaveText(['Model: model-a'])
  await expect(page.locator('.spending-bars h2')).toHaveText('Tokens by model')
  expect(path(page)).toBe(released)
})

test('a phone shows the list or a section, and Back returns to the list', async ({
  page,
}, info) => {
  await serve(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(pageAt({ by: 'model' }))
  const rail = page.locator('.analytics-rail')
  const panel = page.locator('.analytics-panel')
  await expect(rail).toBeVisible()
  await expect(panel).toBeHidden()
  await expect(rail.locator('[aria-current="page"]')).toHaveText(/^Model/u)
  const list = await scrolling(page)
  await record(info, 'analytics frame list 390', list)
  expect(list.document.scrollWidth).toBe(list.document.clientWidth)
  expect(list.document.scrollHeight).toBe(list.document.clientHeight)
  await page.screenshot(shot(info, 'analytics-frame-list-390.png'))

  await rail.getByRole('button', { name: 'Role' }).click()
  await expect.poll(() => path(page)).toBe(pageAt({ by: 'role', open: 'section' }))
  await expect(rail).toBeHidden()
  await expect(panel.locator('.spending-tiles')).toBeVisible()
  await expect(panel.locator('.analytics-panel-name')).toHaveText('Role')
  await expect(panel.locator('.analytics-panel-back')).toBeFocused()
  const section = await scrolling(page)
  await record(info, 'analytics frame section 390', section)
  expect(section.document.scrollWidth).toBe(section.document.clientWidth)
  expect(section.document.scrollHeight).toBe(section.document.clientHeight)
  await page.screenshot(shot(info, 'analytics-frame-section-390.png'))

  await page.goBack()
  await expect.poll(() => path(page)).toBe(pageAt({ by: 'model' }))
  await expect(rail).toBeVisible()
  await expect(panel).toBeHidden()
  await expect(rail.getByRole('button', { name: 'Model' })).toBeFocused()

  // Forward and a reload keep the section in place of the list.
  await page.goForward()
  await expect(panel.locator('.analytics-panel-name')).toHaveText('Role')
  await page.reload()
  await expect(panel.locator('.analytics-panel-name')).toHaveText('Role')
  await expect(rail).toBeHidden()
})
