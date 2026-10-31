import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { graphRoute, longChainHere, routeState, serve, smallChain } from './chainFixtures.ts'
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
      const terminal = page.locator('.flow-node-card.is-terminal')
      await expect(terminal).toHaveCSS('opacity', '1')
      await expect(terminal.locator('.flow-node-title')).toHaveCSS('font-size', '14px')
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
      await expect(page.locator('.flow-node-owner')).toContainText('Previously responsible')
      await expect(page.locator('.flow-node-owner')).not.toContainText('Assigned to')
      await page.getByRole('button', { name: 'Open · 0', exact: true }).click()
      await expect(page.getByText('No open work to draw.', { exact: true })).toBeVisible()
      await expect(page.locator('.graph-canvas')).toBeHidden()
    }
  })
}

test('a link naming a chain no item answers to says so in its own words and keeps the chain', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const { chain, items, edges } = smallChain()
  await serve(page, chain, items, edges)
  const asked: string[] = []
  await page.route('**/api/planning/work-item/chain?*', (route) => {
    asked.push(new URL(route.request().url()).searchParams.get('id') ?? '')
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'invalid_request', message: 'no work item MAIN-9999' },
      }),
    })
  })
  const failure = page.locator('.chain-failure')
  const chip = page.locator('.graph-chip')

  await page.goto(graphRoute({ chain: 'MAIN-9999', chain_scope: 'chain' }))
  // The cause in the product's words, never the server's.
  await expect(failure.locator('.chain-failure-message')).toHaveText(
    'Could not open chain MAIN-9999: there is no such work item. The whole space is shown.',
  )
  // Asking again cannot help a reference nothing answers to.
  await expect(failure.getByRole('button', { name: 'Retry' })).toHaveCount(0)
  await expect(page.locator('.graph')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.flow-node-card').first()).toBeVisible()
  await expect(chip).toHaveCount(0)
  // The address keeps naming the chain until the operator lets it go.
  expect(routeState(page)).toEqual({ view: 'graph', chain: 'MAIN-9999', chain_scope: 'chain' })
  await failure.getByRole('button', { name: 'Dismiss' }).click()
  await expect(failure).toHaveCount(0)
  await expect.poll(() => routeState(page)).toEqual({ view: 'graph' })

  // A value that is no reference at all is refused without asking the server.
  const notice = page.locator('.notice')
  await page.goto(graphRoute({ chain: 'not a reference' }))
  await expect(notice).toHaveText(
    'This link names no chain this space can read; the whole space is shown.',
  )
  await expect(page.locator('.flow-node-card').first()).toBeVisible()
  await expect(chip).toHaveCount(0)
  await expect.poll(() => routeState(page)).toEqual({ view: 'graph' })
  expect(asked).toEqual(['MAIN-9999'])
})

test('a chain whose read failed is read again on Retry', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const { chain, items, edges } = smallChain()
  await serve(page, chain, items, edges)
  let failing = true
  await page.route('**/api/planning/work-item/chain?*', (route) =>
    failing
      ? route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' })
      : route.fallback(),
  )
  const failure = page.locator('.chain-failure')
  await page.goto(graphRoute({ chain: 'MAIN-264', chain_scope: 'chain' }))
  await expect(failure.locator('.chain-failure-message')).toHaveText(
    'Could not open chain MAIN-264: the server answered with an error. The whole space is shown.',
  )
  await expect(failure).not.toContainText('HTTP')
  failing = false
  await failure.getByRole('button', { name: 'Retry' }).click()
  await expect(failure).toHaveCount(0)
  await expect(page.locator('.graph-chip')).toHaveText('Chain MAIN-264 · 17')
  await expect(page.locator('.flow-node-card')).toHaveCount(10)
})

/** How many drawn cards a box on the field covers. */
async function cardsUnder(page: Page, selector: string): Promise<number> {
  return page.evaluate((target) => {
    const box = document.querySelector(target)?.getBoundingClientRect()
    return box
      ? [...document.querySelectorAll('.flow-node-card')]
          .map((card) => card.getBoundingClientRect())
          .filter(
            (card) =>
              card.right > box.left &&
              card.left < box.right &&
              card.bottom > box.top &&
              card.top < box.bottom,
          ).length
      : -1
  }, selector)
}

for (const width of [1440, 1024]) {
  test(`a long chain's bar stays one row and its key lies on the field at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    const { chain, items, edges } = longChainHere()
    await serve(page, chain, items, edges)
    await page.goto(graphRoute({ chain: 'MAIN-264', chain_scope: 'chain' }))
    await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
    const bar = page.locator('.graph-bar')
    const chip = await page.locator('.graph-chip').boundingBox()
    const frontier = await page.locator('.graph-frontier-count').boundingBox()
    // One row: the chip and the frontier count stand side by side.
    expect(
      chip && frontier && Math.abs(chip.y + chip.height / 2 - (frontier.y + frontier.height / 2)),
    ).toBeLessThan(4)
    const before = {
      bar: await bar.boundingBox(),
      field: await page.locator('.graph-flow').boundingBox(),
    }
    await expect(page.locator('.graph-canvas .graph-legend')).toBeVisible()
    await expect(page.locator('.graph-bar .graph-legend')).toHaveCount(0)
    const key = await page.locator('.graph-legend').boundingBox()

    const closed = page.getByRole('switch', { name: 'Draw the closed members of the chain' })
    await closed.click()
    await expect(page.locator('.flow-node-card')).toHaveCount(610, { timeout: 60_000 })
    await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u, { timeout: 60_000 })
    // Throwing the switch moves nothing: not the bar, not the field, not the key.
    expect(await bar.boundingBox()).toEqual(before.bar)
    expect(await page.locator('.graph-flow').boundingBox()).toEqual(before.field)
    expect(await page.locator('.graph-legend').boundingBox()).toEqual(key)
    await expect(page.locator('.graph-legend-state:not(.held)').first()).toHaveText('Done')

    // The whole of it, zoomed out past reading: an overview by state, framed
    // clear of the key and the controls.
    await page.getByRole('button', { name: 'Fit whole graph', exact: true }).click()
    await expect(page.locator('.flow-node-card.overview')).toHaveCount(610)
    await expect(page.locator('.flow-node-overview').first()).toBeVisible()
    expect(await cardsUnder(page, '.vue-flow__controls')).toBe(0)
    expect(await cardsUnder(page, '.graph-legend')).toBe(0)
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(page.locator('.flow-node-card.overview')).toHaveCount(610)
  })
}
