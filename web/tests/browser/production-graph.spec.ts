import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { blockedWorkItem, projectScope } from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'

for (const width of [1440, 390]) {
  test(`graph worker renders aligned geometry and preserves its camera under the inspector at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    await page.goto(
      serializePlatformRoute({
        module_id: 'planning',
        scope: projectScope,
        state: { view: 'graph' },
      }),
    )
    const canvas = page.locator('.graph-canvas.settled')
    await expect(canvas).toBeVisible()
    const card = page.locator('.flow-node-card').filter({ hasText: blockedWorkItem.reference })
    await expect(card).toBeVisible()
    const toolbar = await page.locator('.workspace-head').boundingBox()
    const frame = await page.locator('.graph-flow').boundingBox()
    expect(toolbar).not.toBeNull()
    expect(frame).not.toBeNull()
    expect(Math.abs((toolbar?.x ?? Infinity) - (frame?.x ?? 0))).toBeLessThanOrEqual(1)
    const rendered = await card.evaluate((element) => ({
      width: element.clientWidth,
      height: element.clientHeight,
    }))
    expect(rendered).toEqual({ width: 262, height: 110 })
    const pane = page.locator('.vue-flow__transformationpane')
    const camera = await pane.getAttribute('style')
    await card.click()
    await expect(page.locator('.drawer')).toBeVisible()
    await expect(pane).toHaveAttribute('style', camera ?? '')
    await page.keyboard.press('Escape')
    await expect(page.locator('.drawer')).toHaveCount(0)
    await expect(pane).toHaveAttribute('style', camera ?? '')
    await expect(card).toBeFocused()
    await page.setViewportSize({ width: width === 1440 ? 390 : 1440, height: 900 })
    await expect(card).toBeInViewport({ ratio: 0.95 })
    await expect(canvas).toBeVisible()
    const controlsBox = await page.locator('.vue-flow__controls').boundingBox()
    const cardBox = await card.boundingBox()
    expect(controlsBox?.height).toBeLessThan(100)
    expect(cardBox && controlsBox && cardBox.y + cardBox.height <= controlsBox.y).toBe(true)
  })
}

async function addTerminalGraphWork(page: Page, terminalOnly = false) {
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const model = response.body
      const terminal = {
        ...model.work_items[0],
        work_item_id: '00000000-0000-4000-8000-000000005000',
        number: 5000,
        reference: 'MAIN-5000',
        title: 'Finished context remains visible when All is selected',
        state: {
          ...model.work_items[0].state,
          name: 'Done',
          category: 'completed' as const,
          is_terminal: true,
        },
      }
      model.work_items = terminalOnly ? [terminal] : [...model.work_items, terminal]
      model.links = terminalOnly
        ? []
        : [
            ...model.links,
            {
              from: blockedWorkItem.work_item_id,
              to: terminal.work_item_id,
              kind: 'discovered-from',
            },
          ]
      model.planning_spaces[0] = {
        ...model.planning_spaces[0],
        work_items: model.work_items.length,
        open: terminalOnly ? 0 : 2,
        active: terminalOnly ? 0 : 2,
        completed: 1,
      }
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

async function assertSettledGraph(page: Page, count: number) {
  await expect(page.locator('.graph')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  await expect(page.locator('.vue-flow__transformationpane')).toHaveCSS('opacity', '1')
  await expect(page.locator('.flow-node-card')).toHaveCount(count)
}

for (const width of [1440, 390]) {
  test(`open/all filters retain one usable native canvas at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await installBackend(page)
    await addTerminalGraphWork(page)
    await page.goto(
      serializePlatformRoute({
        module_id: 'planning',
        scope: projectScope,
        state: { view: 'graph' },
      }),
    )
    await assertSettledGraph(page, 2)
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await page.getByRole('button', { name: 'All · 3', exact: true }).click()
      await assertSettledGraph(page, 3)
      await page.getByRole('button', { name: 'Open · 2', exact: true }).click()
      await assertSettledGraph(page, 2)
    }
    const pane = page.locator('.vue-flow__transformationpane')
    const previous = await pane.getAttribute('style')
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(pane).not.toHaveAttribute('style', previous ?? '')
    await page.getByRole('button', { name: 'Fit whole graph', exact: true }).click()
    await assertSettledGraph(page, 2)
    expect(errors).toEqual([])
  })

  test(`an empty open graph can reveal terminal work repeatedly at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    await addTerminalGraphWork(page, true)
    await page.goto(
      serializePlatformRoute({
        module_id: 'planning',
        scope: projectScope,
        state: { view: 'graph' },
      }),
    )
    await expect(page.getByText('No open work to draw.', { exact: true })).toBeVisible()
    await expect(page.locator('.graph-canvas')).toBeHidden()
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await page.getByRole('button', { name: 'All · 1', exact: true }).click()
      await assertSettledGraph(page, 1)
      await expect(page.locator('.flow-node-owner')).toContainText('Assigned to')
      await page.getByRole('button', { name: 'Open · 0', exact: true }).click()
      await expect(page.getByText('No open work to draw.', { exact: true })).toBeVisible()
      await expect(page.locator('.graph-canvas')).toBeHidden()
    }
  })
}
