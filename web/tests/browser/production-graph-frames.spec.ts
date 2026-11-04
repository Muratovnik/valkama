/**
 * The whole space's graph as frames: every epic with open work drawn round it,
 * with its edge of progress, and no open item left out for being linked to its
 * own epic alone.
 *
 * Served the broad synthetic space, whose second epic holds an item whose only
 * link is to that epic: the graph used to leave it out as unlinked.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { broadSpace } from '../fixtures/graphSpaces.ts'
import { installBackend } from './backend.ts'
import { graphRoute } from './chainFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

/** The broad space's item whose only link is to its own epic, and that epic. */
function loneItem() {
  const { lone } = broadSpace()
  if (!lone) throw new Error('the broad space holds a lone item')
  return lone
}

/** The suite's space, holding the broad space's work, workflow and links. */
async function serveBroadSpace(page: Page) {
  const { model } = broadSpace()
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const body = response.body as unknown as Record<string, unknown>
      body.workflow = model.workflow
      body.work_items = model.work_items
      body.links = model.links
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

for (const width of [1500, 390]) {
  test(`an item linked only to its epic stands in that epic's frame at ${width}px`, async ({
    page,
  }) => {
    const lone = loneItem()
    await page.setViewportSize({ width, height: 900 })
    await serveBroadSpace(page)
    await page.goto(graphRoute({}))
    await expect(page.locator('.graph-canvas.settled')).toBeVisible()
    // Linked to nothing but its epic, it was left out as unlinked; it is drawn.
    const card = page.locator('.flow-node-card').filter({
      has: page.locator('.flow-node-id').getByText(lone.item.reference, { exact: true }),
    })
    await expect(card).toHaveCount(1, { timeout: 10_000 })
    // And it stands in its epic's frame, which says how far the epic has come.
    const frame = page.locator(`.graph-frame[data-frame="${lone.epic.work_item_id}"]`)
    await expect(frame).toHaveCount(1)
    await expect(frame.locator('.frame-progress')).toHaveCount(1)
    await expect(frame.locator('.graph-frame-count').first()).toHaveText(/^2 of 15 done$/u)
    const [frameBox, cardBox] = await Promise.all([frame.boundingBox(), card.boundingBox()])
    expect(frameBox && cardBox && cardBox.x >= frameBox.x && cardBox.y >= frameBox.y).toBe(true)
  })
}

test('a frame header’s buttons are the field’s Tab stop once the keyboard stands on them', async ({
  page,
}) => {
  const lone = loneItem()
  await page.setViewportSize({ width: 1500, height: 900 })
  await serveBroadSpace(page)
  await page.goto(graphRoute({}))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  const stops = page.locator('.graph-flow [tabindex="0"]')
  const frame = `frame:${lone.epic.work_item_id}`
  const fold = page.locator(`[data-walk-target="${frame}:fold"]`)
  await fold.focus()
  // Focus on the fold button makes it the one stop of the field.
  await expect(fold).toHaveAttribute('tabindex', '0')
  await expect(stops).toHaveCount(1)
  // The arrow across the header reaches the epic's button, which takes the stop.
  await page.keyboard.press('ArrowRight')
  const open = page.locator(`[data-walk-target="${frame}"]`)
  await expect(open).toBeFocused()
  await expect(open).toHaveAttribute('tabindex', '0')
  await expect(stops).toHaveCount(1)
})

/** Where the focused element stands on the screen, and what it stands for. */
async function focused(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement
    if (!(element instanceof HTMLElement) || !element.closest('.graph-flow')) return null
    const box = element.getBoundingClientRect()
    return { target: element.dataset.walkTarget ?? '', x: box.x, y: box.y }
  })
}

/** Walk left from the focused target to the nearest fold button, and say where it stands. */
async function walkToFold(page: Page) {
  for (let step = 0; step < 40; step += 1) {
    const at = await focused(page)
    if (at?.target.endsWith(':fold')) return at
    await page.keyboard.press('ArrowLeft')
  }
  throw new Error('no fold button to the left of the last target')
}

for (const width of [1500, 390]) {
  test(`Tab reaches a frame header, and folding holds it where it was pressed at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await serveBroadSpace(page)
    await page.goto(graphRoute({}))
    await expect(page.locator('.graph-canvas.settled')).toBeVisible()
    // From the zoom controls back, Shift+Tab lands on the field's one stop.
    await page.getByRole('button', { name: 'Zoom in', exact: true }).focus()
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => focused(page).then((at) => at?.target ?? '')).toMatch(/^frame:/u)
    // The frame at the top left keeps its place whatever folds; the last one
    // moves when it does, so its header is the one a fold could lose.
    await page.keyboard.press('End')
    const before = await walkToFold(page)
    expect(before.target).toMatch(/^frame:.+:fold$/u)
    const fold = page.locator(`[data-walk-target="${before.target}"]`)
    const expanded = await fold.getAttribute('aria-expanded')
    await page.keyboard.press('Enter')
    await expect(fold).not.toHaveAttribute('aria-expanded', expanded ?? '')
    await expect(page.locator('.graph-canvas.settled')).toBeVisible()
    // The header stays under the hand: focus kept, and the button where it was.
    await expect(fold).toBeFocused()
    await expect
      .poll(async () => {
        const after = await focused(page)
        return Math.max(Math.abs((after?.x ?? 0) - before.x), Math.abs((after?.y ?? 0) - before.y))
      })
      .toBeLessThan(2)
    await expect(fold).toBeInViewport()
  })
}

test('a header’s counts, wrapped to a second line, stay clear of its edge', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 })
  await serveBroadSpace(page)
  await page.goto(graphRoute({}))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  const gaps = await page.locator('.graph-frame:not(.folded)').evaluateAll((frames) =>
    frames.map((frame) => {
      const texts = [...frame.querySelectorAll('.graph-frame-head .graph-frame-count')]
      const edge = frame.querySelector('.frame-progress')?.getBoundingClientRect()
      const lowest = Math.max(...texts.map((text) => text.getBoundingClientRect().bottom))
      return edge ? edge.top - lowest : Number.NaN
    }),
  )
  // The broad space's narrow open frames wrap their counts under the name.
  expect(gaps.length).toBeGreaterThan(2)
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2)
})
