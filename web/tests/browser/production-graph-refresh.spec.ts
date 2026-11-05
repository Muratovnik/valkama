import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope } from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

/** From now on every read of the space carries one more open item, under no epic. */
async function arriveWithOneMore(page: Page) {
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const model = response.body
      const extra = {
        ...model.work_items[0],
        work_item_id: '00000000-0000-4000-8000-000000005001',
        number: 5001,
        reference: 'MAIN-5001',
        title: 'Arrived with the refresh',
        parent_id: null,
      }
      model.work_items = [...model.work_items, extra]
      model.planning_spaces[0] = {
        ...model.planning_spaces[0],
        work_items: model.planning_spaces[0].work_items + 1,
        open: model.planning_spaces[0].open + 1,
      }
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

/**
 * The graph opened on the space, with every change of its busy state and every
 * position and size of its field recorded from now on — at every change of the
 * graph's tree and every resize of its field, not sampled, since a line that
 * lives one frame can still move the field.
 */
async function openRecorded(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      state: { view: 'graph' },
    }),
  )
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  await expect(page.locator('.flow-node-card').first()).toBeVisible()
  const pane = page.locator('.vue-flow__transformationpane')
  const camera = (await pane.getAttribute('style')) ?? ''
  await page.locator('.graph').evaluate((graph) => {
    const record = { busy: [] as string[], field: [] as string[] }
    const measure = () => {
      const field = graph.querySelector('.graph-canvas')?.getBoundingClientRect()
      record.field.push(field ? `${field.top}:${field.height}` : 'gone')
    }
    measure()
    new MutationObserver((changes) => {
      for (const change of changes)
        if (change.type === 'attributes') record.busy.push(graph.getAttribute('aria-busy') ?? '')
      measure()
    }).observe(graph, { attributeFilter: ['aria-busy'], childList: true, subtree: true })
    const field = graph.querySelector('.graph-canvas')
    if (field) new ResizeObserver(measure).observe(field)
    Object.assign(window, { __graphRecord: record })
  })
  const recorded = () =>
    page.evaluate(
      () =>
        (window as unknown as { __graphRecord: { busy: string[]; field: string[] } }).__graphRecord,
    )
  return { camera, pane, recorded }
}

/** The rail's refresh, until the space's read it sends has answered. */
async function refresh(page: Page) {
  const read = page.waitForResponse((response) => response.url().includes('/api/planning?'))
  // One button whose name is the connection state it shows.
  await page.locator('.nav-refresh').click()
  await read
}

/**
 * A refresh that changes what is drawn lays the graph out again in the
 * background, and work in the background takes no room while a drawing is on
 * the field. The field used to be pushed down by a line announcing the new
 * layout and pulled back when it landed, on every refresh.
 */
test('a background refresh that brings an item moves neither the field nor the camera', async ({
  page,
}) => {
  const { camera, pane, recorded } = await openRecorded(page)
  await arriveWithOneMore(page)
  await refresh(page)
  // The refresh reached the graph: it laid the field out again, and finished.
  await expect
    .poll(async () => {
      const { busy } = await recorded()
      return busy
    })
    .toEqual(['true', 'false'])
  await expect(page.locator('.flow-node-card').filter({ hasText: 'MAIN-5001' })).toHaveCount(1)
  const { field } = await recorded()
  expect(new Set(field)).toEqual(new Set([field[0]]))
  await expect(pane).toHaveAttribute('style', camera)
})

/** A refresh that changes nothing drawn lays nothing out at all. */
test('a background refresh that changes nothing drawn lays nothing out', async ({ page }) => {
  const { camera, pane, recorded } = await openRecorded(page)
  await refresh(page)
  await expect(page.locator('.graph')).toHaveAttribute('aria-busy', 'false')
  const { busy, field } = await recorded()
  expect(busy).toEqual([])
  expect(new Set(field)).toEqual(new Set([field[0]]))
  await expect(pane).toHaveAttribute('style', camera)
})

/**
 * The camera is the operator's: a new filter narrows what is drawn and leaves
 * the zoom the operator chose. It used to frame the field afresh, which threw
 * the zoom away on every narrowing.
 */
test('a new filter keeps the zoom the operator chose', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      state: { view: 'graph' },
    }),
  )
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  const pane = page.locator('.vue-flow__transformationpane')
  const scale = async () =>
    /scale\(([0-9.]+)\)/u.exec((await pane.getAttribute('style')) ?? '')?.[1]
  // This field fits at its opening zoom, so the operator's own choice is nearer in.
  const opening = await scale()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect.poll(scale).not.toBe(opening)
  const chosen = await scale()
  expect(chosen).toBeDefined()

  // A state picked from the filter's menu, then the filter reset.
  await page.getByRole('combobox', { name: 'Filter work' }).click()
  await page.getByRole('option', { name: 'In progress' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.graph')).not.toHaveAttribute('aria-busy', 'true')
  await expect.poll(scale).toBe(chosen)
  await page.locator('.workspace-figures').getByRole('button', { name: 'Reset' }).click()
  await expect(page.locator('.graph')).not.toHaveAttribute('aria-busy', 'true')
  await expect.poll(scale).toBe(chosen)
})
