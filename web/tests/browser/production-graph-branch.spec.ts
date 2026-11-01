/**
 * «Show on graph» from a card whose map has a branch chosen: the graph opens on
 * the chain, framed on that branch and lit, the address keeps the branch, and
 * focus lands on the graph rather than falling to the page as the card closes.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { rootFramed, routeState, serve, smallChain } from './chainFixtures.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'

const CHAIN = { view: 'graph', chain: 'MAIN-264', chain_scope: 'chain' }
/** Where a card writes its reference, read or, zoomed out past reading, as a block. */
const REFERENCE = '.flow-node-id, .flow-node-overview-reference'

/** The chain's root opened as a card, at its chain section. */
async function chainSection(page: Page) {
  const entity = planningWorkItemEntity(workItemRef)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope, entity }))
  const section = page.locator('.drawer section.chain')
  await expect(section).toBeVisible()
  return section
}

/** The lit cards — the branch — and whether every one of them is drawn inside the flow. */
async function litCards(page: Page) {
  return page.evaluate((reference) => {
    const flow = document.querySelector('.graph-flow')?.getBoundingClientRect()
    const lit = [...document.querySelectorAll('.flow-node-card:not(.recessed)')]
    const boxes = lit.map((card) => card.getBoundingClientRect())
    return {
      references: lit.map((card) => card.querySelector(reference)?.textContent ?? ''),
      framed: Boolean(
        flow &&
        boxes.every(
          (box) =>
            box.left >= flow.left &&
            box.right <= flow.right &&
            box.top >= flow.top &&
            box.bottom <= flow.bottom,
        ),
      ),
    }
  }, REFERENCE)
}

/** Whether the focused element lies wholly inside the flow. */
async function focusedDrawn(page: Page) {
  return page.evaluate(() => {
    const box = document.activeElement?.getBoundingClientRect()
    const flow = document.querySelector('.graph-flow')?.getBoundingClientRect()
    return Boolean(
      box &&
      flow &&
      box.left >= flow.left &&
      box.right <= flow.right &&
      box.top >= flow.top &&
      box.bottom <= flow.bottom,
    )
  })
}

/** The focused element: a graph card's reference, or the tag of whatever else holds focus. */
async function focused(page: Page) {
  return page.evaluate((reference) => {
    const active = document.activeElement
    return active?.classList.contains('flow-node-card')
      ? (active.querySelector(reference)?.textContent ?? '')
      : (active?.tagName ?? 'none')
  }, REFERENCE)
}

// Wide, the whole branch reads at once; on a phone it opens on its beginning.
for (const [width, whole] of [
  [1440, true],
  [390, false],
] as const) {
  test(`a branch chosen on the map is framed, lit and kept in the address at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    const { chain, items, edges } = smallChain()
    await serve(page, chain, items, edges)
    const section = await chainSection(page)
    await section.locator('.branch-map-label', { hasText: 'no epic' }).click()
    await section.getByRole('button', { name: 'Show on graph' }).click()
    // The pointer rests off the field: a node under it would show its own lineage.
    await page.mouse.move(0, 0)

    await expect.poll(() => routeState(page)).toEqual({ ...CHAIN, branch: 'none' })
    await expect(page.locator('.drawer')).toHaveCount(0)
    await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
    const branchChip = page.locator('.graph-branch-chip')
    await expect(branchChip).toHaveText('Branch no epic')
    // Ten drawn: the root, two open children of it, and the branch's seven open
    // members — the lit ones, all inside the frame where the field has room.
    await expect(page.locator('.flow-node-card')).toHaveCount(10)
    await expect(page.locator('.flow-node-card.recessed')).toHaveCount(3)
    const lit = await litCards(page)
    expect(lit.references).toHaveLength(7)
    expect(lit.framed || !whole).toBe(true)
    // The card that asked has closed; focus is on the branch's first work, in
    // sight, not on the page.
    await expect.poll(() => focused(page)).toMatch(/^MAIN-11\d\d$/u)
    expect(lit.references).toContain(await focused(page))
    expect(await focusedDrawn(page)).toBe(true)

    await page.reload()
    await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
    await expect(branchChip).toHaveText('Branch no epic')
    await expect(page.locator('.flow-node-card.recessed')).toHaveCount(3)
    const relit = await litCards(page)
    expect(relit.framed || !whole).toBe(true)

    // Letting the branch go keeps the chain, framed on its root as before.
    await branchChip.click()
    await expect.poll(() => routeState(page)).toEqual(CHAIN)
    await expect(branchChip).toHaveCount(0)
    await expect(page.locator('.graph-chip')).toHaveText('Chain MAIN-264 · 17')
    await expect(page.locator('.flow-node-card.recessed')).toHaveCount(0)
    expect(await rootFramed(page)).toBe(true)
  })
}

test('with no branch chosen the graph is framed on the root, and focus lands there', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const { chain, items, edges } = smallChain()
  await serve(page, chain, items, edges)
  const section = await chainSection(page)
  await section.getByRole('button', { name: 'Show on graph' }).click()
  await expect.poll(() => routeState(page)).toEqual(CHAIN)
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  await expect(page.locator('.graph-branch-chip')).toHaveCount(0)
  expect(await rootFramed(page)).toBe(true)
  await expect.poll(() => focused(page)).toBe('MAIN-264')
})
