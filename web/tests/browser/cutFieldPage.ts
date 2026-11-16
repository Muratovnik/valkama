/**
 * The graph's field with every title too long for its card and its frame, and what the specs of
 * the whole words laid over a cut text read off it: which cut text the pointer rests on, and where
 * the whole words stand against it.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { graphRoute } from './chainFixtures.ts'
import { broadModel } from './graphFieldCamera.ts'
import { planningReadFor } from './planningReadFixture.ts'

/** Run on after every title of the broad space, so the field's cards cut their titles. */
const LONGER = ': a title that runs on past the two lines a card on the field gives it'

/** The broad space with every title too long for its card, its field open at this window. */
export async function openCutField(page: Page, width: number, longer = LONGER) {
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const body = response.body as unknown as Record<string, unknown>
      body.workflow = broadModel.workflow
      body.work_items = broadModel.work_items.map((item) => ({
        ...item,
        title: `${item.title}${longer}`,
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

/**
 * Marks the first text of the field matching `selector` that a clamp cuts down to its lines and
 * that stands whole in sight, with room around it for the pointer, and returns where its first
 * letter's middle is: the pointer rests there.
 */
export const markCut = (page: Page, selector = '.flow-node-title') =>
  page.evaluate((chosen) => {
    const flow = document.querySelector('.graph-flow')?.getBoundingClientRect()
    if (!flow) return null
    for (const element of document.querySelectorAll<HTMLElement>(
      `.graph-flow ${chosen}[data-tooltip-kind="clipped"]`,
    )) {
      const box = element.getBoundingClientRect()
      // Cut across, by an ellipsis: a word trimmed to its capitals is taller than its box.
      // Clamped to its lines.
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
  }, selector)

/** How far the whole words' first letter may stand from the cut text's, and differ in height. */
const ROOM = 0.5

/**
 * Where the whole words stand against the marked cut text: on it, gone, or off it by how much.
 * Both first letters are read the same way, from the first text each draws.
 */
export const standing = (page: Page) =>
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
