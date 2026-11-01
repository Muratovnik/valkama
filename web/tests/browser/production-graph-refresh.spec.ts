import { expect, test } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope } from './planningFixtures.ts'

/**
 * A refresh lays the graph out again in the background, and work in the
 * background takes no room while a drawing is on the field. The field used to
 * be pushed down by a line announcing the new layout and pulled back when it
 * landed, on every refresh; the line could live for one frame and still move
 * the field, so the geometry is recorded at every change of the graph's tree
 * and every resize of its field, not sampled.
 */
test('a background refresh of the graph moves neither the field nor the camera', async ({
  page,
}) => {
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
  const camera = await pane.getAttribute('style')
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

  // The rail's refresh: one button whose name is the connection state it shows.
  await page.locator('.nav-refresh').click()
  // The refresh reached the graph: it laid the field out again, and finished.
  await expect
    .poll(async () => {
      const { busy } = await recorded()
      return busy
    })
    .toEqual(['true', 'false'])
  const { field } = await recorded()
  expect(new Set(field)).toEqual(new Set([field[0]]))
  await expect(pane).toHaveAttribute('style', camera ?? '')
})

/**
 * The camera is the operator's: a new queue narrows what is drawn and leaves
 * the zoom the operator chose. It used to frame the field afresh, which threw
 * the zoom away on every narrowing.
 */
test('a new queue keeps the zoom the operator chose', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
  const chosen = await scale()
  expect(chosen).toBeDefined()

  const queue = page.getByRole('group', { name: 'Work queue' })
  for (const segment of [/^Blocked/u, /^All/u]) {
    await queue.getByRole('button', { name: segment }).click()
    await expect(page.locator('.graph')).not.toHaveAttribute('aria-busy', 'true')
    await expect.poll(scale).toBe(chosen)
  }
})
