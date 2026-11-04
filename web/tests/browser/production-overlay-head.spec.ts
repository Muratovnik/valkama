import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { aCardAsking, linkIn, NAMED_PATH } from './documentBackend.ts'
import { paneOf, settled } from './documentBeside.ts'
import { heldCard, openPlanFor, threeAgents } from './openSessionFixtures.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * The head every overlay wears, where the room in it runs short: a document beside a card,
 * whose title and path have to share a pane with four icons, and a dialog whose title has
 * what it is about under it.
 */

/** Where each part of a head stands, in the page's pixels. */
const headParts = (head: Locator) =>
  head.evaluate((node) => {
    // This body is serialized and evaluated in the page, so a module-scope helper would not
    // be in scope there.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const box = (element: Element | null) => {
      const {
        bottom = 0,
        left = 0,
        right = 0,
        top = 0,
        width = 0,
      } = element?.getBoundingClientRect() ?? {}
      return { bottom, left, right, top, width }
    }
    const style = getComputedStyle(node)
    const inner =
      node.getBoundingClientRect().width -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight)
    return {
      inner,
      title: box(node.querySelector('.overlay-header-name')),
      close: box(node.querySelector('.overlay-header-close')),
      actions: [...node.querySelectorAll('.overlay-header-actions > *')].map((each) => box(each)),
    }
  })

async function namedBesideCard(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  const { drawer } = await aCardAsking(page, `Read \`${NAMED_PATH}\` first.`)
  await linkIn(drawer, NAMED_PATH).click()
  const { pane, title } = paneOf(page)
  await expect(title).toHaveText(/^Document links in the card/u)
  await settled(drawer)
  return pane
}

test('beside a card the title and the path keep the row, and the actions stand under it', async ({
  page,
}) => {
  const pane = await namedBesideCard(page, 1500)
  const parts = await headParts(pane.locator('.overlay-header'))
  const [first] = parts.actions
  // Only the way out shares the title's row: four icons beside it left the title 219 of 480.
  expect(first?.top).toBeGreaterThanOrEqual(parts.close.bottom)
  expect(parts.title.width).toBeGreaterThanOrEqual(parts.inner - parts.close.width - 16 - 1)
  const path = pane.getByRole('button', { name: `Copy the path ${NAMED_PATH}` })
  expect(await path.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0)
})

test('the actions are one group, closer to each other than to the way out', async ({ page }) => {
  // At 1920 the pane is wide enough for the actions to stay on the title's row.
  const pane = await namedBesideCard(page, 1920)
  const { actions, close, title } = await headParts(pane.locator('.overlay-header'))
  expect(actions.length).toBeGreaterThan(1)
  for (const action of actions) expect(action.top).toBeLessThan(title.bottom)
  const gaps = actions.slice(1).map((action, index) => action.left - (actions[index]?.right ?? 0))
  for (const gap of gaps) expect(gap).toBeCloseTo(4, 0)
  expect(close.left - (actions.at(-1)?.right ?? 0)).toBeCloseTo(16, 0)
})

test('what a dialog is about stands a step under its title, in the weight of a note', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1500, height: 1200 })
  await installBackend(page, { agents: threeAgents, card: heldCard, openPlan: openPlanFor })
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  await page.locator('.drawer .card-holder button.open-action').click()
  await expect(page.locator('.open-panel')).toBeVisible()
  const head = page.getByRole('dialog').last().locator('.overlay-header')
  const context = head.locator('.overlay-header-context')
  await expect(context).toBeVisible()
  const below = await head.evaluate(
    (node) =>
      (node.querySelector('.overlay-header-context')?.getBoundingClientRect().top ?? 0) -
      (node.querySelector('.overlay-header-name')?.getBoundingClientRect().bottom ?? 0),
  )
  // The subtitle's step: flush under the title it read as a second line of it.
  expect(below).toBeCloseTo(8, 0)
  await expect(context).toHaveCSS('font-weight', '400')
})
