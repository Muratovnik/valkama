/**
 * A card zoomed out past reading, as the built app draws it: its reference stands whole
 * inside the block whatever its length, and no unexplained sign stands beside it. What an
 * agent is doing on it stays in its name and its tooltip.
 *
 * Served the broad synthetic space, with the longest reference a space can give on one
 * working card and one held card.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { LiveWork } from '@/shared/api/liveWorkModel.ts'

import { broadSpace } from '../fixtures/graphSpaces.ts'
import { installBackend } from './backend.ts'
import { graphRoute } from './chainFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

/** Eight letters of the widest kind and nine digits: the most a reference can be. */
const LONGEST = ['WWWWWWWW-888888888', 'ABCDEFGH-123456789']

async function serve(page: Page) {
  const { model } = broadSpace()
  // Two the field draws as cards at this size, standing in an open frame.
  const drawn = (reference: string) => {
    const found = model.work_items.find((item) => item.reference === reference)
    if (!found) throw new Error(`the broad space holds ${reference}`)
    return found
  }
  const [working, held] = [drawn('MAIN-220'), drawn('MAIN-221')]
  const live: Record<string, LiveWork> = {
    [working.work_item_id]: { state: 'working' },
    [held.work_item_id]: { state: 'held' },
  }
  const items = model.work_items.map((item) => {
    if (item === working) return { ...item, reference: LONGEST[0], claim_ref: 'an-agent' }
    if (item === held) return { ...item, reference: LONGEST[1], claim_ref: 'an-agent' }
    return item
  })
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const body = response.body as unknown as Record<string, unknown>
      body.workflow = model.workflow
      body.work_items = items
      body.links = model.links
      body.live_work = live
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

/** Open the field and take the camera out to its farthest. */
async function zoomedOut(page: Page) {
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto(graphRoute({}))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  await page.mouse.move(750, 500)
  await page.keyboard.down('Control')
  for (let step = 0; step < 8; step += 1) await page.mouse.wheel(0, 240)
  await page.keyboard.up('Control')
  await expect(page.locator('.flow-node-overview').first()).toBeAttached()
}

/** How far each reference's text stands past its block, in the field's own units. */
const overruns = (page: Page) =>
  page.locator('.flow-node-overview-reference').evaluateAll((references) =>
    references.map((reference) => {
      const range = document.createRange()
      range.selectNodeContents(reference)
      const text = range.getBoundingClientRect()
      const card = reference.closest('.flow-node-card')?.getBoundingClientRect()
      if (!card) throw new Error('a reference stands on its card')
      const scale = card.width / 264
      return {
        reference: reference.textContent.trim(),
        left: (card.left - text.left) / scale,
        right: (text.right - card.right) / scale,
      }
    }),
  )

test('a reference of any length stands whole inside its block when zoomed out', async ({
  page,
}) => {
  await serve(page)
  await zoomedOut(page)
  const seen = await overruns(page)
  expect(seen.map((one) => one.reference)).toEqual(expect.arrayContaining(LONGEST))
  expect(seen.filter((one) => one.left > 0.5 || one.right > 0.5)).toEqual([])
})

test('a short reference keeps the size it has always been drawn at', async ({ page }) => {
  await serve(page)
  await zoomedOut(page)
  const sizes = await page.locator('.flow-node-overview-reference').evaluateAll((references) =>
    references.map((reference) => ({
      length: reference.textContent.trim().length,
      scale: new DOMMatrix(getComputedStyle(reference).transform).a,
    })),
  )
  const short = sizes.filter((size) => size.length <= 8)
  expect(short.length).toBeGreaterThan(0)
  expect(new Set(short.map((size) => size.scale))).toEqual(new Set([2.2]))
})

test('a block carries no sign of its own, and its name and tooltip say the state', async ({
  page,
}) => {
  await serve(page)
  await zoomedOut(page)
  await expect(page.locator('.flow-node-overview .work-dots')).toHaveCount(0)
  await expect(page.locator('.graph-legend-held')).toHaveCount(0)
  const working = page.locator('.flow-node-card').filter({ hasText: LONGEST[0] })
  await expect(working).toHaveAccessibleName(/ · working$/u)
  await expect(working).toHaveAttribute('title', /working/u)
  const held = page.locator('.flow-node-card').filter({ hasText: LONGEST[1] })
  await expect(held).toHaveAttribute('title', /held/u)
})

test('with the motion stopped, a block keeps the state in its name and the frame its count', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('valkama-graph-motion', 'paused')
  })
  await serve(page)
  await zoomedOut(page)
  await expect(page.locator('.graph-comet')).toHaveCount(0)
  await expect(page.locator('.graph-frame-working').first()).toContainText('1')
  await expect(page.locator('.flow-node-card').filter({ hasText: LONGEST[0] })).toHaveAttribute(
    'title',
    /working/u,
  )
})
