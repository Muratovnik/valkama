/**
 * Live work as it changes and as it is filtered, on the whole space's graph.
 *
 * A read that makes a line live, or stops it being live, is a background
 * update: the line takes its new look at once, paused or not, as every
 * background change on the page does. And the key's «work going on» and the
 * switch that stops the motion speak only of motion on the field: a working
 * item the filter leaves out moves nothing there.
 *
 * Served the broad synthetic space, with the live work each test names.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { LiveWork } from '@/shared/api/liveWorkModel.ts'

import { broadSpace, liveWorkFor } from '../fixtures/graphSpaces.ts'
import { installBackend } from './backend.ts'
import { graphRoute } from './chainFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

/** The suite's space, whose n-th read (from 0) carries `liveOn(n)` as its live work. */
async function serveSpace(page: Page, liveOn: (read: number) => Record<string, LiveWork>) {
  const { model } = broadSpace()
  let reads = 0
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const body = response.body as unknown as Record<string, unknown>
      body.workflow = model.workflow
      body.work_items = model.work_items
      body.links = model.links
      body.live_work = liveOn(reads)
      reads += 1
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

/** The rail's refresh, until the space's read it sends has answered. */
async function refresh(page: Page) {
  const read = page.waitForResponse((response) => response.url().includes('/api/planning?'))
  await page.locator('.nav-refresh').click()
  await read
}

/** How long a live line's stroke takes to change: 0 when it changes at once. */
const strokeTransition = (page: Page) =>
  page
    .locator('.vue-flow__edge.graph-edge.live .vue-flow__edge-path')
    .first()
    .evaluate((path) => {
      const style = getComputedStyle(path)
      const names = style.transitionProperty.split(',').map((name) => name.trim())
      const durations = style.transitionDuration.split(',').map((value) => Number.parseFloat(value))
      let longest = 0
      for (const [index, name] of names.entries()) {
        if (['all', 'stroke'].includes(name))
          longest = Math.max(longest, durations[index % durations.length])
      }
      return longest
    })

for (const motion of ['paused', 'running'] as const) {
  test(`a read that makes a line live changes it at once while the motion is ${motion}`, async ({
    page,
  }) => {
    await page.addInitScript((choice) => {
      localStorage.setItem('valkama-graph-motion', choice)
    }, motion)
    await page.setViewportSize({ width: 1500, height: 900 })
    const { model } = broadSpace()
    await serveSpace(page, (read) => (read === 0 ? {} : liveWorkFor(model)))
    await page.goto(graphRoute({}))
    await expect(page.locator('.graph-canvas.settled')).toBeVisible()
    await expect(page.locator('.vue-flow__edge.graph-edge.live')).toHaveCount(0)
    await refresh(page)
    await expect(page.locator('.vue-flow__edge.graph-edge.live').first()).toBeAttached()
    expect(await strokeTransition(page)).toBe(0)
  })
}

/** The broad space's item linked only to its epic, and a working item under another epic. */
function twoItems() {
  const { lone, model } = broadSpace()
  if (!lone) throw new Error('the broad space holds a lone item')
  const elsewhere = model.work_items.find(
    (item) =>
      !item.state.is_terminal &&
      item.kind !== 'epic' &&
      item.parent_id !== null &&
      item.parent_id !== lone.epic.work_item_id,
  )
  if (!elsewhere) throw new Error('the broad space holds work under another epic')
  return { lone: lone.item, elsewhere }
}

/** The field narrowed by a search to the lone item, with one item working. */
async function searchWith(page: Page, working: string, reference: string) {
  await page.setViewportSize({ width: 1500, height: 900 })
  await serveSpace(page, () => ({ [working]: { state: 'working' } }))
  await page.goto(graphRoute({}))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  await page.getByPlaceholder('Filter: reference, title…').fill(reference)
  await expect(
    page.locator('.flow-node-card .flow-node-id').getByText(reference, { exact: true }),
  ).toBeVisible()
}

test('work moving where the filter leaves it out offers no key to its line and no switch', async ({
  page,
}) => {
  const { lone, elsewhere } = twoItems()
  await searchWith(page, elsewhere.work_item_id, lone.reference)
  await expect(page.locator('.graph-flow .graph-live')).toHaveCount(0)
  await expect(page.locator('.graph-frame-working')).toHaveCount(0)
  await expect(page.locator('.graph-motion-toggle')).toHaveCount(0)
  await expect(page.locator('.graph-legend-on-field')).not.toContainText('work going on')
})

test('the same work moving on the field brings the key to its line and the switch', async ({
  page,
}) => {
  const { lone } = twoItems()
  await searchWith(page, lone.work_item_id, lone.reference)
  await expect(page.locator('.graph-flow .graph-live[data-live="working"]')).toHaveCount(1)
  await expect(page.locator('.graph-motion-toggle')).toBeVisible()
  await expect(page.locator('.graph-legend-on-field')).toContainText('work going on')
})
