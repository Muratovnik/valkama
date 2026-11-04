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
