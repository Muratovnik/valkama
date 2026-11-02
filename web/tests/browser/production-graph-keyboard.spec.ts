/**
 * The graph from the keyboard: the field is one Tab stop, the arrows, Home and
 * End walk its nodes with the camera following, Enter opens the card and Esc
 * from the card comes back to the node.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { graphRoute, longChainHere, serve } from './chainFixtures.ts'
import { test } from './test.ts'

/** The focused card's reference, and whether all of it is drawn inside the flow. */
async function focusedCard(page: Page) {
  return page.evaluate(() => {
    const card = document.activeElement
    const flow = document.querySelector('.graph-flow')?.getBoundingClientRect()
    if (!card?.classList.contains('flow-node-card') || !flow) return null
    const box = card.getBoundingClientRect()
    return {
      reference: card.querySelector('.flow-node-id')?.textContent ?? '',
      drawn:
        box.left >= flow.left &&
        box.right <= flow.right &&
        box.top >= flow.top &&
        box.bottom <= flow.bottom,
    }
  })
}

test('the field is one Tab stop and the arrows walk it with the camera', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const { chain, items, edges } = longChainHere()
  await serve(page, chain, items, edges)
  await page.goto(graphRoute({ chain: 'MAIN-264', chain_scope: 'chain' }))
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  const cards = page.locator('.graph-flow .flow-node-card')
  const drawn = await cards.count()
  expect(drawn).toBeGreaterThan(20)
  // One stop, on the node the camera stands on: the chain's root.
  await expect(page.locator('.graph-flow .flow-node-card[tabindex="0"]')).toHaveCount(1)
  await expect(page.locator('.graph-flow .flow-node-card[tabindex="-1"]')).toHaveCount(drawn - 1)
  // From the chip, Tab passes the closed switch and lands on the field's stop.
  await page.locator('.graph-chip').focus()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('switch', { name: 'Draw the closed members of the chain' }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  expect(await focusedCard(page)).toEqual({ reference: 'MAIN-264', drawn: true })
  await page.keyboard.press('Tab')
  expect(await focusedCard(page)).toBeNull()
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  expect(await focusedCard(page)).toEqual({ reference: 'MAIN-264', drawn: true })

  const layout = await page
    .locator('.vue-flow__node')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).style.transform).join('|'))
  const seen = new Set<string>()
  for (const key of ['ArrowRight', 'ArrowDown', 'End', 'ArrowLeft', 'Home', 'ArrowRight']) {
    const from = await focusedCard(page)
    await page.keyboard.press(key)
    const to = await focusedCard(page)
    // Focus moved to another node, and the camera brought all of it into sight.
    expect(to?.reference, key).not.toBe(from?.reference)
    expect(to?.drawn, key).toBe(true)
    seen.add(to?.reference ?? '')
    await expect(page.locator('.graph-flow .flow-node-card[tabindex="0"]')).toHaveCount(1)
  }
  expect(seen.size).toBeGreaterThanOrEqual(4)
  // The keys walk the field; they never move a node.
  expect(
    await page
      .locator('.vue-flow__node')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).style.transform).join('|')),
  ).toBe(layout)
  // No node is described to a screen reader as one the arrows move.
  await expect(page.locator('.vue-flow__node[aria-describedby]')).toHaveCount(0)

  const walked = await focusedCard(page)
  await page.keyboard.press('Enter')
  await expect(page.locator('.drawer')).toBeVisible()
  await expect(page.locator('.drawer')).toContainText(walked?.reference ?? '-')
  await page.keyboard.press('Escape')
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expect.poll(() => focusedCard(page)).toEqual({ reference: walked?.reference, drawn: true })
})
