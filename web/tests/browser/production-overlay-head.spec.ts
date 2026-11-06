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

/**
 * The middle of a head's first title line, every control on that row by its name and middle,
 * and how far the head's content runs on under the title block.
 */
const rowAxes = (head: Locator) =>
  head.evaluate((node) => {
    const name = node.querySelector('.overlay-header-name')
    const title = node.querySelector('.overlay-header-title')
    if (!name || !title) throw new Error('A head without a title')
    const top = name.getBoundingClientRect().top
    const line = top + Number.parseFloat(getComputedStyle(name).lineHeight) / 2
    const controls = [...node.querySelectorAll('button, a[href]')]
      .filter((each) => !title.contains(each) && each.getBoundingClientRect().top < line)
      .map((each) => {
        const { bottom, top: from } = each.getBoundingClientRect()
        return { name: each.getAttribute('aria-label') ?? '', middle: (from + bottom) / 2 }
      })
    const style = getComputedStyle(node)
    const end =
      node.getBoundingClientRect().bottom -
      Number.parseFloat(style.paddingBottom) -
      Number.parseFloat(style.borderBottomWidth)
    return { line, controls, under: end - title.getBoundingClientRect().bottom }
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
  // A title with a line under it still has its way out on its own first line.
  const { line, controls } = await rowAxes(head)
  expect(controls).toHaveLength(1)
  for (const control of controls) expect(control.middle).toBeCloseTo(line, 0)
})

for (const width of [1280, 390]) {
  test(`at ${width}px a dialog's title and its way out stand on one line, and nothing pads the head under them`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
    await page.getByRole('button', { name: 'New work item' }).click()
    const dialog = page.getByRole('dialog', { name: 'New work' })
    await expect(dialog).toHaveCSS('transform', 'none')
    const { line, controls, under } = await rowAxes(dialog.locator('.overlay-header'))
    expect(controls).toHaveLength(1)
    // Laid out at its own 44px the button stood 10px under the title's middle, and the head
    // kept 21px under the title that it did not keep over it.
    for (const control of controls) expect(control.middle).toBeCloseTo(line, 0)
    expect(under).toBeCloseTo(0, 0)
  })
}

test('a document head stands Back, its actions and the way out on its title line', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 900 })
  const { drawer } = await aCardAsking(page, 'Read `docs/plan.md:9` first.')
  await linkIn(drawer, 'docs/plan.md:9').click()
  const { pane, title } = paneOf(page)
  await expect(title).toHaveText('The migration plan')
  await settled(drawer)
  await linkIn(pane, 'notes.md').click()
  await expect(title).toHaveText('The notes')
  const { line, controls } = await rowAxes(pane.locator('.overlay-header'))
  const names = controls.map(({ name }) => name)
  expect(names[0]).toBe('Back to docs/plan.md')
  expect(names.at(-1)).toBe('Close the document')
  // Back, the actions between and the way out: all of them, not the first one.
  expect(names.length).toBeGreaterThan(3)
  for (const control of controls) expect(control.middle).toBeCloseTo(line, 0)
})
