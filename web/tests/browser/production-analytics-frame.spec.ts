/**
 * The frame of the Analytics page in the real app: a bar over a rail of sections and the panel of
 * the one on show, the whole of the module's frame.
 *
 * At a window 1024 pixels wide or wider and 700 or more high the document never scrolls: the bar
 * stays where it is, and the rail and the panel each scroll on their own. Lower than that, the
 * panel takes the scroll and the document still does not. Every other module keeps the frame's
 * own scroll. The section on show is in the address, so a reload keeps it, and an address the
 * page wrote before it had sections opens the same period, measure and filters in the section of
 * its breakdown. Under 1024 pixels the rail is the screen, a list; a section chosen there takes
 * its place, and the browser's Back returns to the list. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { pageAt, record, serve } from './analyticsPage.ts'
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
    }
  })
}

/** How far an area of the page is scrolled down, as measured. */
const scrolledBy = (
  measured: Awaited<ReturnType<typeof scrolling>>,
  area: 'frame' | 'panel' | 'rail',
) => measured[area]?.scrollTop ?? 0

/** Turns the wheel over the middle of an element. */
async function wheelOver(page: Page, selector: string, by: number) {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`${selector} is not on screen`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, by)
}

async function openAt(page: Page, width: number, height: number, address = pageAt()) {
  await serve(page)
  await page.setViewportSize({ width, height })
  await page.goto(address)
  await expect(page.locator('.analytics-panel .spending-days')).toBeVisible()
}

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
  [1024, 600],
] as const)
  test(`the document stands still while the rail and the panel scroll at ${width}×${height}`, async ({
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
    // The report is taller than its panel, which holds the rest under its own scroll.
    expect(before.panel?.scrollHeight).toBeGreaterThan(before.panel?.clientHeight ?? 0)

    await wheelOver(page, '.analytics-panel', 600)
    await expect.poll(async () => scrolledBy(await scrolling(page), 'panel')).toBeGreaterThan(0)
    const after = await scrolling(page)
    expect(after.document.scrollTop).toBe(0)
    expect(after.bar?.y).toBe(before.bar?.y)
    expect(after.rail?.y).toBe(before.rail?.y)
    expect(after.rail?.scrollTop).toBe(0)
    await page.screenshot(shot(info, `analytics-frame-${width}x${height}.png`))
  })

test('the rail scrolls on its own when the window is too low for its sections', async ({
  page,
}, info) => {
  await openAt(page, 1024, 480)
  const before = await scrolling(page)
  await record(info, 'analytics frame rail 1024x480', before)
  expect(before.document.scrollHeight).toBe(before.document.clientHeight)
  expect(before.rail?.scrollHeight).toBeGreaterThan(before.rail?.clientHeight ?? 0)
  await wheelOver(page, '.analytics-page-rail', 400)
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
  await openAt(page, 1440, 900)
  const rail = page.getByRole('navigation', { name: 'Sections of the usage' })
  await expect(rail.locator('[aria-current="page"]')).toHaveText('Task')
  await rail.getByRole('button', { name: 'Model' }).click()
  await expect.poll(() => path(page)).toBe(pageAt({ by: 'model' }))
  await expect(page.locator('.spending-bars h2')).toHaveText('Agent time by model')
  await page.reload()
  await expect(rail.locator('[aria-current="page"]')).toHaveText('Model')
  await expect(page.locator('.spending-bars h2')).toHaveText('Agent time by model')

  // From the keyboard: the overview, which shows the figures and the days alone.
  await rail.getByRole('button', { name: 'Overview' }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => path(page)).toBe(pageAt({ by: 'overview' }))
  await expect(rail.getByRole('button', { name: 'Overview' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.locator('.analytics-panel .spending-tiles')).toBeVisible()
  await expect(page.locator('.analytics-panel .spending-days')).toBeVisible()
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
  await expect(page.locator('.analytics-rail [aria-current="page"]')).toHaveText('Model')
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
