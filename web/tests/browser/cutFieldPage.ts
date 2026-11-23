/**
 * The graph's field with every title too long for its card and its frame, any other view of the
 * planning space with the titles a spec gives it, a card whose outcome a spec writes, and what the
 * specs of the whole words laid over a cut text read off them: which cut text the pointer rests
 * on, and where the whole words stand against it.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { graphRoute } from './chainFixtures.ts'
import { installDiscussionBackend } from './discussionBackend.ts'
import { broadModel } from './graphFieldCamera.ts'
import { spaceScope, workItemRef } from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'

/** Run on after every title of the broad space, so the field's cards cut their titles. */
const LONGER = ': a title that runs on past the two lines a card on the field gives it'

/** The planning space's read as `reshape` leaves it, and the page opened at `url` in this window. */
async function openRead(
  page: Page,
  width: number,
  url: string,
  reshape: (read: Record<string, unknown>) => void,
) {
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body)
      reshape(response.body as unknown as Record<string, unknown>)
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
  await page.goto(url)
}

/** The broad space with every title too long for its card, its field open at this window. */
export async function openCutField(page: Page, width: number, longer = LONGER) {
  await openRead(page, width, graphRoute({}), (body) => {
    body.workflow = broadModel.workflow
    // The read refuses a title past 200 characters, so the longest is cut there.
    body.work_items = broadModel.work_items.map((item) => ({
      ...item,
      title: `${item.title}${longer}`.slice(0, 200),
    }))
    body.links = broadModel.links
  })
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

/** The whole words laid over a cut text. */
export const whole = (page: Page) => page.locator('.whole-text')

/**
 * Marks `clamp`, a text its clamp must cut, and returns where its first letter's middle is, or
 * null where the clamp leaves it whole: the whole words over it would prove nothing.
 */
export async function markClamp(clamp: Locator) {
  await clamp.scrollIntoViewIfNeeded()
  return clamp.evaluate((element: HTMLElement) => {
    if (element.scrollHeight <= element.clientHeight + 1) return null
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text
      const at = text.data.search(/\S/u)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(text, at)
      range.setEnd(text, at + 1)
      const { left, top, width, height } = range.getBoundingClientRect()
      element.dataset.probeCut = ''
      return { x: left + width / 2, y: top + height / 2 }
    }
    return null
  })
}

/** The pointer away from everything, then resting on `point` past the wait of a hint. */
export async function restAt(page: Page, point: { x: number; y: number }) {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  await page.mouse.move(viewport.width - 2, viewport.height - 2)
  await expect(whole(page)).toHaveCount(0)
  await page.mouse.move(point.x, point.y)
  await page.clock.runFor(1000)
}

/** Longer than three lines of a board column, and than two lines of the card or the finder. */
export const LONG_TITLE =
  'Read an attached planning store that an older build wrote without migrating it, name every scope the read had to skip instead of dropping it, and say which of them a newer build can still open'

/** The board, the item `workItemRef` names under `title` and `MAIN-265` under its short one. */
export const openBoard = (page: Page, width: number, title = LONG_TITLE) =>
  openRead(
    page,
    width,
    serializePlatformRoute({ module_id: 'planning', scope: spaceScope }),
    (read) => {
      for (const item of read.work_items as { reference: string; title: string }[])
        if (item.reference === workItemRef.reference) item.title = title
    },
  )

/** What was done, as an agent writes it: markdown, which the preview draws as words. */
export const DONE =
  'Shipped **the reader** for an attached store that an older build wrote, kept every scope it could not read in a list of its own instead of dropping it, named each in the card with the build that can still open it, and left the store as it found it'
export const DONE_WORDS = DONE.replaceAll('**', '')

/** The card of the item whose outcome is `done`, and the preview of that outcome on it. */
export async function outcomePreview(page: Page, done: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  const backend = await installDiscussionBackend(page)
  backend.item.summary = { done, next: 'Review' }
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: spaceScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const preview = page.locator('.drawer .outcome-preview-text')
  await expect(preview).toBeVisible()
  return preview
}
