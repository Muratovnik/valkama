/**
 * Which way the chain graph draws a discovery: from the work it was found in to the
 * work that grew out of it. The root stands before what was discovered from it and
 * the arrow lands on the discovered item, while a block keeps running from the
 * blocker. Drawn as stored, the root stood after its own discovery with the arrow
 * on it, and the dashed line read as that task done into the goal.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { graphRoute, serve } from './chainFixtures.ts'
import { workItemRef } from './planningFixtures.ts'
import { discoveryChain } from './served/graphDiscovery.ts'
import { test } from './test.ts'

const card = (page: Page, reference: string) =>
  page.locator('.flow-node-card').filter({
    has: page.locator('.flow-node-id').getByText(reference, { exact: true }),
  })

/** Where a line's path starts and where it ends, its arrow, on the screen. */
function ends(line: Locator) {
  return line.evaluate((path: SVGPathElement) => {
    const matrix = path.getScreenCTM()
    if (!matrix) throw new Error('a drawn line has a screen transform')
    const at = (length: number) => {
      const point = path.getPointAtLength(length)
      return new DOMPoint(point.x, point.y).matrixTransform(matrix)
    }
    const start = at(0)
    const end = at(path.getTotalLength())
    return {
      marker: path.getAttribute('marker-end'),
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
    }
  })
}

async function box(locator: Locator) {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the card is drawn')
  return found
}

/** A point stands on a card's side: at its x, within a few pixels, and inside its height. */
function onSide(point: { x: number; y: number }, x: number, card: { height: number; y: number }) {
  expect(Math.abs(point.x - x)).toBeLessThanOrEqual(4)
  expect(point.y).toBeGreaterThanOrEqual(card.y)
  expect(point.y).toBeLessThanOrEqual(card.y + card.height)
}

test('a chain draws a discovery from its root to the discovered work, and a block from the blocker', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const { chain, items, edges } = discoveryChain()
  await serve(page, chain, items, edges)
  await page.goto(graphRoute({ chain: workItemRef.reference, chain_scope: 'chain' }))
  await expect(page.locator('.graph:not([aria-busy])')).toHaveCount(1)
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  await expect(page.locator('.flow-node-card')).toHaveCount(3)

  const root = await box(card(page, workItemRef.reference))
  const found = await box(card(page, 'MAIN-1103'))
  const blocked = await box(card(page, 'MAIN-1105'))
  // The root stands before the work discovered from it, and that before what it blocks.
  expect(root.x + root.width).toBeLessThan(found.x)
  expect(found.x + found.width).toBeLessThan(blocked.x)

  const discovery = page.locator('.vue-flow__edge.discovered-from .vue-flow__edge-path')
  const block = page.locator('.vue-flow__edge.blocks .vue-flow__edge-path')
  await expect(discovery).toHaveCount(1)
  await expect(block).toHaveCount(1)
  const dashed = await ends(discovery)
  // The line leaves the root's right side and its arrow stands on the discovered card's left.
  expect(dashed.marker).toMatch(/^url\(/u)
  onSide(dashed.start, root.x + root.width, root)
  onSide(dashed.end, found.x, found)
  const solid = await ends(block)
  expect(solid.marker).toMatch(/^url\(/u)
  onSide(solid.start, found.x + found.width, found)
  onSide(solid.end, blocked.x, blocked)
})
