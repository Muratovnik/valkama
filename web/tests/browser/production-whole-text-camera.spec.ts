/**
 * The whole words of a cut text on the graph stay on it while the camera moves, in the built app.
 * A transform moves and scales the field's texts with no resize and no scroll, and the wheel's
 * zoom makes no scroll event: laid once, the whole words stayed where they opened and at the
 * scale they opened at. After the wheel brought the field from a scale of 0.625 to 0.947 they
 * stood 2.8px and 2.9px off the cut text's first letter, their letters 10.6px tall over letters
 * 16.1px tall. Now each zoom in and out under the resting pointer lays them on the text again,
 * and a move of the camera the keys bring either lays them where the text went or takes them down.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { graphRoute } from './chainFixtures.ts'
import { broadModel, camera, settledCamera } from './graphFieldCamera.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

/** Run on after every title of the broad space, so the field's cards cut their titles. */
const LONGER = ': a title that runs on past the two lines a card on the field gives it'

/** The broad space with every title too long for its card, its field open at this window. */
async function openCutField(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const body = response.body as unknown as Record<string, unknown>
      body.workflow = broadModel.workflow
      body.work_items = broadModel.work_items.map((item) => ({
        ...item,
        title: `${item.title}${LONGER}`,
      }))
      body.links = broadModel.links
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
  await page.goto(graphRoute({}))
  // The layout runs in a worker, which a busy machine slows past the default wait.
  await expect(page.locator('.graph-canvas.settled')).toBeVisible({ timeout: 20_000 })
}

/** How far the whole words' first letter may stand from the cut text's, and differ in height. */
const ROOM = 0.5

/**
 * Marks the first cut text of the field that stands whole in sight, with room under it for the
 * pointer, and returns where its first letter's middle is: the pointer rests there.
 */
const markCut = (page: Page) =>
  page.evaluate(() => {
    const flow = document.querySelector('.graph-flow')?.getBoundingClientRect()
    if (!flow) return null
    for (const element of document.querySelectorAll<HTMLElement>(
      '.graph-flow .flow-node-title[data-tooltip-kind="clipped"]',
    )) {
      const box = element.getBoundingClientRect()
      // Cut across, by an ellipsis: a word trimmed to its capitals is taller than its box.
      // Clamped to its two lines.
      const cut = element.scrollHeight > element.clientHeight + 1
      const inSight =
        box.left > flow.left + 40 &&
        box.right < flow.right - 40 &&
        box.top > flow.top + 40 &&
        box.bottom < flow.bottom - 40
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      const text = walker.nextNode() as Text | null
      const at = text?.data.search(/\S/u) ?? -1
      if (!cut || !inSight || !text || at < 0) continue
      const range = document.createRange()
      range.setStart(text, at)
      range.setEnd(text, at + 1)
      const letter = range.getBoundingClientRect()
      element.dataset.probeCut = ''
      return { x: letter.left + letter.width / 2, y: letter.top + letter.height / 2 }
    }
    return null
  })

/**
 * Where the whole words stand against the marked cut text: on it, gone, or off it by how much.
 * Both first letters are read the same way, from the first text each draws.
 */
const standing = (page: Page) =>
  page.evaluate((room) => {
    const firstLetter = (root: Element | null) => {
      if (!root) return null
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text
        const at = text.data.search(/\S/u)
        if (at < 0) continue
        const range = document.createRange()
        range.setStart(text, at)
        range.setEnd(text, at + 1)
        return range.getBoundingClientRect()
      }
      return null
    }
    const own = firstLetter(document.querySelector('[data-probe-cut]'))
    const laid = firstLetter(document.querySelector('.whole-text'))
    if (!laid) return 'gone'
    if (!own) return 'the cut text is gone'
    const [x, y, height] = [laid.left - own.left, laid.top - own.top, laid.height - own.height]
    return Math.max(Math.abs(x), Math.abs(y), Math.abs(height)) <= room
      ? 'on its text'
      : `off by ${x.toFixed(1)}, ${y.toFixed(1)}, letters ${laid.height.toFixed(1)} over ${own.height.toFixed(1)}`
  }, ROOM)

test('the whole words of a cut text on the graph stay on it as the camera zooms and moves', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
  await openCutField(page, 1440)
  const point = await markCut(page)
  expect(point, 'a cut text of the field in sight').not.toBeNull()
  // The field's stop takes focus now, so the key at the end walks from it.
  await page.locator('.graph-flow [tabindex="0"]').first().focus()
  await page.mouse.move(point?.x ?? 0, point?.y ?? 0)
  await expect(page.locator('.whole-text')).toBeVisible()
  expect(await standing(page)).toBe('on its text')
  const opened = await camera(page)

  // Nearer in under the resting pointer, which the zoom keeps on the same letter.
  await page.mouse.wheel(0, -300)
  const nearer = await settledCamera(page)
  expect(nearer.zoom).toBeGreaterThan(opened.zoom)
  await expect.poll(() => standing(page)).toBe('on its text')

  // And farther out again.
  await page.mouse.wheel(0, 200)
  const farther = await settledCamera(page)
  expect(farther.zoom).toBeLessThan(nearer.zoom)
  await expect.poll(() => standing(page)).toBe('on its text')

  // The camera follows the key to the field's last node, moving the text out from under the
  // pointer: the whole words go with it or go.
  await page.keyboard.press('End')
  const moved = await settledCamera(page)
  expect(Math.hypot(moved.x - farther.x, moved.y - farther.y)).toBeGreaterThan(20)
  await expect.poll(() => standing(page)).toMatch(/^(?:on its text|gone)$/u)
})
