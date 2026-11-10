/**
 * The rail's width is the reader's, and a name it cuts short says itself in a hint.
 *
 * The rail stood at 260px with no way to widen it, and most names in the list of work
 * going on now were cut by an ellipsis whose only rescue was the browser's `title`. Its
 * right edge is now a window splitter, dragged or stepped by the arrow keys between 200px
 * and what the window leaves, and kept across a reload; a phone's icon rail has no edge.
 * A name the rail cuts shows a hint beside the rail, anchored to the name and inside the
 * window, and a name it does not cut shows none.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { busyFrame, liveRow as frameRow } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { installLiveStreams } from './liveWorkPage.ts'
import { globalScope } from './planningFixtures.ts'
import { test } from './test.ts'

const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: globalScope })
const LONG_NAME = 'A space whose name runs well past the rail at the width it starts at'
const LONG_LABEL = `LONG · ${LONG_NAME}`
const LONG_TITLE = 'An item whose title runs well past the rail at its narrowest'

async function open(page: Page, viewport: { height: number; width: number }) {
  await page.setViewportSize(viewport)
  // The hint's delay runs on this clock, so a test can say that no hint came after it.
  await page.clock.install()
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.goto(SETTINGS)
  await expect.poll(() => streams.open()).toHaveLength(1)
  const frame = busyFrame()
  frame.spaces.push({
    key: 'LONG',
    name: LONG_NAME,
    project_id: 'example-project',
    rows: [frameRow('LONG-1', { title: LONG_TITLE, state: 'working' })],
    sessions: [],
  })
  await streams.live(frame)
  await expect(page.locator('.nav-tree-space-name', { hasText: LONG_NAME })).toBeVisible()
}

/** Where an element stands, read in the page so that a missing one fails there. */
const boxOf = (locator: Locator) =>
  locator.evaluate((node) => {
    const { bottom, height, right, x, y } = node.getBoundingClientRect()
    return { bottom, height, right, x, y }
  })

const railWidth = (page: Page) =>
  page.locator('.app-nav-shell').evaluate((node) => node.getBoundingClientRect().width)

test('the rail is resized from its edge by the keys and the pointer, and keeps its width', async ({
  page,
}) => {
  await open(page, { width: 1280, height: 800 })
  const edge = page.getByRole('separator', { name: 'Navigation width' })
  expect(await railWidth(page)).toBe(260)
  await expect(edge).toHaveAttribute('aria-valuenow', '260')
  await expect(edge).toHaveAttribute('aria-valuemin', '200')
  await expect(edge).toHaveAttribute('aria-valuemax', '480')
  // The workspace starts where the rail ends.
  const main = () => page.locator('.app-main').evaluate((node) => node.getBoundingClientRect().x)
  expect(await main()).toBe(260)

  await edge.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  expect(await railWidth(page)).toBe(292)
  await page.keyboard.press('ArrowLeft')
  expect(await railWidth(page)).toBe(276)
  await expect(edge).toHaveAttribute('aria-valuenow', '276')
  await page.keyboard.press('Home')
  expect(await railWidth(page)).toBe(200)
  await page.keyboard.press('End')
  expect(await railWidth(page)).toBe(480)
  expect(await main()).toBe(480)

  // Dragged: the edge follows the pointer, and the rail stops at its narrowest.
  const box = await edge.boundingBox()
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2
  const x = (box?.x ?? 0) + (box?.width ?? 0) / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 140, y, { steps: 4 })
  await page.mouse.up()
  expect(await railWidth(page)).toBe(340)
  await page.mouse.move(x - 140, y)
  await page.mouse.down()
  await page.mouse.move(0, y, { steps: 4 })
  await page.mouse.up()
  expect(await railWidth(page)).toBe(200)

  await page.keyboard.press('End')
  await page.reload()
  await expect(page.getByRole('separator', { name: 'Navigation width' })).toHaveAttribute(
    'aria-valuenow',
    '480',
  )
  expect(await railWidth(page)).toBe(480)
})

test('the window keeps the workspace its room, and a phone’s icon rail has no edge', async ({
  page,
}) => {
  await open(page, { width: 900, height: 800 })
  const edge = page.getByRole('separator', { name: 'Navigation width' })
  await expect(edge).toHaveAttribute('aria-valuemax', '400')
  await edge.focus()
  await page.keyboard.press('End')
  expect(await railWidth(page)).toBe(400)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(edge).toHaveCount(0)
  expect(await railWidth(page)).toBe(64)
})

test('a name the rail cuts shows a hint beside it, and one it does not cut shows none', async ({
  page,
}) => {
  await open(page, { width: 1280, height: 800 })
  const long = page.locator('.nav-tree-space-name', { hasText: LONG_NAME })
  const short = page.locator('.nav-tree-space-name', { hasText: 'MAIN space' })
  const hint = page.locator('.tooltip-hint')
  // The words assistive technology is given while it shows; the hint draws them once more.
  const words = page.getByRole('tooltip')

  await short.hover()
  await page.clock.runFor(1000)
  await expect(hint).toHaveCount(0)

  await long.hover()
  await page.clock.runFor(1000)
  await expect(words).toHaveText(LONG_LABEL)
  const [name, shown] = await Promise.all([boxOf(long), boxOf(hint)])
  // At the rail's right, past the name's end, level with it, and inside the window.
  expect(shown.x).toBeGreaterThanOrEqual(name.right)
  expect(Math.abs(shown.y + shown.height / 2 - (name.y + name.height / 2))).toBeLessThanOrEqual(1)
  expect(shown.right).toBeLessThanOrEqual(1280)
  expect(shown.y).toBeGreaterThanOrEqual(0)
  expect(shown.bottom).toBeLessThanOrEqual(800)

  await page.keyboard.press('Escape')
  await expect(hint).toHaveCount(0)
  await expect(page.locator('.nav-work-list')).toBeVisible()
})

test('a row the rail cuts hints beside the row, clear of the row’s own ring', async ({ page }) => {
  await open(page, { width: 1280, height: 800 })
  const row = page.locator('.nav-row', { has: page.locator('[aria-label^="LONG-1 "]') })
  const words = page.getByRole('tooltip')
  await page.getByRole('separator', { name: 'Navigation width' }).focus()
  await page.keyboard.press('Home')
  await row.hover()
  await page.clock.runFor(1000)
  await expect(words).toHaveText(new RegExp(`^LONG-1 ${LONG_TITLE}`, 'u'))
  const [box, shown] = await Promise.all([boxOf(row), boxOf(page.locator('.tooltip-hint'))])
  expect(shown.x).toBeGreaterThanOrEqual(box.right)
})

test('focus brought by a key shows an icon’s hint, and a press shows none', async ({ page }) => {
  await open(page, { width: 1280, height: 800 })
  const fold = page.locator('.nav-tree-fold').first()
  const words = page.getByRole('tooltip')
  // The fold is named by its words, so the hint describes nothing more.
  const label = await fold.getAttribute('aria-label')
  expect(await fold.getAttribute('aria-describedby')).toBeNull()

  await page.locator('.nav-tree-space-name').first().focus()
  await page.keyboard.press('Shift+Tab')
  await expect(fold).toBeFocused()
  await expect(words).toHaveText(label ?? '')
  // Escape closes the hint and goes on to the list, which folds the space back.
  await page.keyboard.press('Escape')
  await expect(words).toHaveCount(0)
  await expect(fold).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Enter')
  await expect(fold).toHaveAttribute('aria-expanded', 'true')

  await fold.click()
  await page.mouse.move(900, 400)
  await page.clock.runFor(1000)
  await expect(words).toHaveCount(0)
})
