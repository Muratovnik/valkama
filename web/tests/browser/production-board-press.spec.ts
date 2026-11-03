import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { centre, openBoard, serve } from './boardPage.ts'
import { test } from './test.ts'

/**
 * A board press in the moment after something has come back into view, before the browser
 * has drawn a frame of it. A scroll made by the page reaches that moment at once, and a main
 * thread busy with anything reaches it after any scroll. Chromium 156 skips the layout of a
 * `content-visibility: auto` element out of sight, and learns that it is back only from that
 * next frame. So a press there could reach no tile, and one that took focus out of the
 * element crashed the renderer. These presses come from a real pointer that stands still.
 */
async function awayAndBack(
  page: Page,
  scroller: Locator,
  target: Locator,
  away: { left?: number; top?: number },
) {
  const frame = () =>
    page.evaluate(() => new Promise((done) => requestAnimationFrame(() => setTimeout(done))))
  await scroller.evaluate((node, to) => node.scrollTo(to), away)
  // Out of the scroller's sight, and known to be: the browser takes a frame to learn it.
  const [seen, around] = await Promise.all([target.boundingBox(), scroller.boundingBox()])
  const inSight =
    (seen?.x ?? 0) + (seen?.width ?? 0) > (around?.x ?? 0) &&
    (seen?.y ?? 0) < (around?.y ?? 0) + (around?.height ?? 0)
  expect(inSight).toBe(false)
  await frame()
  await frame()
  await target.scrollIntoViewIfNeeded()
  const { x, y } = await centre(target)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.up()
}

async function board(page: Page, state?: Record<string, string>) {
  await page.setViewportSize({ width: 820, height: 500 })
  await installBackend(page)
  await serve(page)
  await openBoard(page, state)
}

const tileIn = (where: Locator) =>
  where.locator('.work-item-tile', { has: where.page().locator('[data-facet="kind"]') }).first()

const markOf = (tile: Locator) => tile.locator('[data-facet="kind"]').first()

test('a press on a tile just back in view opens its card, with focus held in it', async ({
  page,
}) => {
  await board(page, {})
  const tile = tileIn(page.locator('.work-item-column').first())
  await tile.locator('.tile-open').focus()
  await awayAndBack(page, page.locator('.work-item-board'), markOf(tile), { left: 30_000 })
  await expect(page.locator('.drawer')).toBeVisible()
})

test('a press on a tile just back in view opens its card, with focus elsewhere', async ({
  page,
}) => {
  await board(page, {})
  const tile = tileIn(page.locator('.work-item-column').first())
  await awayAndBack(page, page.locator('.work-item-board'), markOf(tile), { left: 30_000 })
  await expect(page.locator('.drawer')).toBeVisible()
})

test('a press on a tile in a lane just back in view opens its card, with focus held in it', async ({
  page,
}) => {
  await board(page)
  // A long space. A lane near the fold is laid out all the same, and this one is the last.
  await page.addStyleTag({ content: '.board-lane:first-of-type { padding-bottom: 6000px; }' })
  const tile = page.locator('.board-lane [data-reference="MAIN-264"] .work-item-tile')
  await tile.locator('.tile-open').focus()
  await awayAndBack(
    page,
    page.locator('.work-item-lanes'),
    tile.locator('[data-facet="priority"]'),
    { top: 0 },
  )
  await expect(page.locator('.drawer')).toBeVisible()
})

test('a press on what a lane says keeps focus in that lane, with no ring', async ({ page }) => {
  await board(page)
  const epic = page.locator('.board-lane.open').first()
  const { x, y } = await centre(epic.locator('.lane-counts'))
  await page.mouse.click(x, y)
  await expect(epic).toBeFocused()
  await page.keyboard.press('Shift')
  await expect(epic).toHaveCSS('outline-style', 'none')
  await page.keyboard.press('Tab')
  expect(await epic.evaluate((node) => node.contains(document.activeElement))).toBe(true)
})

/** The card is open and the keys that read it work, so focus is still inside it. */
async function readable(page: Page) {
  await expect(page.locator('.overlay-surface-drawer')).toHaveCSS('transform', 'none')
  await expect(page.locator('.drawer-frame-body > *').first()).toBeVisible()
  // A card long enough to have somewhere to go.
  await page.addStyleTag({
    content: '.drawer-frame-body::after { content: ""; display: block; height: 3000px; }',
  })
  await page.keyboard.press('PageDown')
  await expect
    .poll(() => page.locator('.drawer-frame-body').evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0)
}

test('a double click on a tile leaves its card open, its keys alive', async ({ page }) => {
  await board(page, {})
  const title = tileIn(page.locator('.work-item-column').first()).locator('.tile-open')
  await title.scrollIntoViewIfNeeded()
  const { x, y } = await centre(title)
  await page.mouse.dblclick(x, y)
  // The second press reached the scrim that had just appeared, and closed what it opened.
  await readable(page)
  await page.mouse.click(5, 5)
  await expect(page.locator('.drawer')).toHaveCount(0)
})

test('a second press past the double click interval, on a card reading slowly, leaves it open', async ({
  page,
}) => {
  await board(page, {})
  await page.route('**/api/modules/planning/work-item?*', async (route) => {
    await new Promise((done) => setTimeout(done, 700))
    await route.fallback()
  })
  const title = tileIn(page.locator('.work-item-column').first()).locator('.tile-open')
  await title.scrollIntoViewIfNeeded()
  const { x, y } = await centre(title)
  await page.mouse.click(x, y)
  await new Promise((done) => setTimeout(done, 750))
  // A browser counts this press as a first one, so only where it stands can tell it apart.
  await page.mouse.click(x, y)
  await readable(page)
  await page.mouse.click(5, 5)
  await expect(page.locator('.drawer')).toHaveCount(0)
})

test('a card closed by Escape leaves no ring around the whole board', async ({ page }) => {
  await board(page, {})
  const mark = markOf(tileIn(page.locator('.work-item-column').first()))
  await mark.scrollIntoViewIfNeeded()
  const { x, y } = await centre(mark)
  await page.mouse.click(x, y)
  await expect(page.locator('.drawer')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.drawer')).toHaveCount(0)
  // A press on a mark names no control to go back to, so focus lands on the stage.
  await expect(page.locator('.module-stage')).toBeFocused()
  await expect(page.locator('.module-stage')).toHaveCSS('outline-style', 'none')
})
