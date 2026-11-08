/**
 * The pointer moving over the graph dims nothing: a card under it takes its own
 * hover ground, and every other card and line stays as it was. Hover used to
 * light the card's lineage and recede the rest of the field, which the owner
 * found only got in the way. The keyboard's focus still lights its lineage.
 *
 * Every frame is sampled in the page while the pointer moves and rests, because
 * a dim that lasted a few frames between two events would not be there to poll
 * after. The field used to wait 120ms before it dimmed and held it 200ms after a
 * leave; sampling 30 frames on a card covers both.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { graphRoute, serve, smallChain } from './chainFixtures.ts'
import { test } from './test.ts'

type Point = { x: number; y: number }

const DIMMED = '.graph-flow .flow-node-card.recessed, .graph-flow .vue-flow__edge.recessed'

const card = (page: Page, reference: string) =>
  page.locator('.graph-flow .flow-node-card').filter({
    has: page.locator('.flow-node-id').getByText(reference, { exact: true }),
  })

async function centre(page: Page, reference: string): Promise<Point> {
  const box = await card(page, reference).boundingBox()
  if (!box) throw new Error(`${reference} is not drawn`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function openChain(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const { chain, items, edges } = smallChain()
  await serve(page, chain, items, edges)
  await page.goto(graphRoute({ chain: 'MAIN-264', chain_scope: 'chain' }))
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  await page.mouse.move(0, 0)
  await expect(page.locator('.graph-flow .flow-node-card.recessed')).toHaveCount(0)
}

/** How many receded cards and lines the next `count` frames drew, summed. */
const dimmedOver = (page: Page, count: number) =>
  page.evaluate(
    ({ count, selector }) =>
      new Promise<number>((resolve) => {
        let left = count
        let dimmed = 0
        const tick = () => {
          dimmed += document.querySelectorAll(selector).length
          left -= 1
          if (left === 0) resolve(dimmed)
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    { count, selector: DIMMED },
  )

const ground = (page: Page, reference: string) =>
  card(page, reference).evaluate((node) => getComputedStyle(node).backgroundColor)

test('resting the pointer on a card and moving to its neighbour dims nothing', async ({ page }) => {
  await openChain(page)
  const resting = await ground(page, 'MAIN-1006')
  const from = await centre(page, 'MAIN-1006')
  await page.mouse.move(from.x, from.y)
  // The hovered card itself still answers the pointer.
  await expect.poll(() => ground(page, 'MAIN-1006')).not.toBe(resting)
  expect(await dimmedOver(page, 30)).toBe(0)

  const to = await centre(page, 'MAIN-1105')
  const moved = page.mouse.move(to.x, to.y, { steps: 12 })
  const during = dimmedOver(page, 30)
  await moved
  expect(await during).toBe(0)
  await page.mouse.move(0, 0)
  expect(await dimmedOver(page, 30)).toBe(0)
})

test('the keyboard still lights the lineage of the card it stands on', async ({ page }) => {
  await openChain(page)
  // From the chip, Tab passes the closed switch and lands on the field's stop.
  await page.locator('.graph-chip').focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(card(page, 'MAIN-264')).toBeFocused()
  const lit = page.locator('.graph-flow .flow-node-card:not(.recessed) .flow-node-id')
  await expect(lit).toHaveText(['MAIN-264'])
  // A pointer resting on another card changes nothing the keyboard lit.
  const over = await centre(page, 'MAIN-1006')
  await page.mouse.move(over.x, over.y)
  await dimmedOver(page, 30)
  await expect(lit).toHaveText(['MAIN-264'])
})
