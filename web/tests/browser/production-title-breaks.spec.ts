/**
 * What the places a long title breaks at do to its words. Where it breaks on each
 * surface is measured in `production-title-surfaces.spec.ts`; here, that a word wider
 * than its line breaks after a `/` and inside as well.
 *
 * A place to break is not text: the title's text, a selection's copy and the
 * accessible name of what the title names stay the title as written. A `<wbr>`
 * after each `/` broke the lines right, and Chromium named the element with a
 * space at each one: «loading/ empty/ error/ unavailable».
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { boardRoute, openList } from './boardPage.ts'
import { projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'
import { breaksOf } from './titleBreaks.ts'
import { linkedTo, routeFinder, routePicker } from './titleSurfaces.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/**
 * The accessible name Chromium gives an element, read from its accessibility tree through
 * CDP: what a screen reader announces, which neither `textContent` nor a locator's
 * accessible-name matcher reports, since both are computed apart from the browser's tree.
 */
async function accessibleName(page: Page, element: Locator) {
  const cdp = await page.context().newCDPSession(page)
  await element.evaluate((node) => {
    node.dataset.named = ''
  })
  try {
    await cdp.send('Accessibility.enable')
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '[data-named]',
    })
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
      nodeId,
      fetchRelatives: false,
    })
    return String(nodes[0]?.name?.value ?? '')
  } finally {
    await element.evaluate((node) => {
      delete node.dataset.named
    })
    await cdp.detach()
  }
}

/** What a selection of the whole text holds, which is what a copy of it takes. */
const copyOf = (text: Locator) =>
  text.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    const copied = selection?.toString() ?? ''
    selection?.removeAllRanges()
    return copied
  })

/**
 * The name of what a title is drawn in, once its text and a selection's copy were found to be
 * the title as written, and the name to hold the title as written too.
 */
async function nameOf(page: Page, { named, text }: { named: Locator; text: Locator }) {
  const title = workItem.title
  await expect(text).toHaveText(title)
  expect(await text.evaluate((element) => element.textContent)).toBe(title)
  expect(await copyOf(text), 'what a copy takes').toBe(title)
  const name = await accessibleName(page, named)
  expect(name, 'the name holds the title as written').toContain(title)
  return name
}

/**
 * The name the same element has with its title as plain text, no place to break in it: what
 * a name made of the title and more, a list cell's or a link's, should be. The title is no
 * longer drawn by the application after it, so it ends a test.
 */
async function plainNameOf(page: Page, { named, text }: { named: Locator; text: Locator }) {
  await text.evaluate((element, plain) => element.replaceChildren(plain), workItem.title)
  return accessibleName(page, named)
}

const openCard = async (page: Page) => {
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  return drawer
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
})

test('a word wider than its line still breaks inside, and nothing is pushed past the edge', async ({
  page,
}) => {
  const word = 'Supercalifragilisticexpialidociousandthensomemoreofit'
  await installBackend(page, { card: (read) => ({ ...read, title: `${word}/${word}` }) })
  const drawer = await openCard(page)
  const name = drawer.locator('.drawer-frame-name')
  await expect(name).toHaveText(`${word}/${word}`)
  const breaks = await breaksOf(name)
  // After the slash, and inside each word as well, since neither fits a line.
  expect(breaks.map(({ before }) => before)).toContain('/')
  expect(breaks.some(({ before }) => before !== '/')).toBe(true)
  const overflow = await name.evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(overflow, 'the title stays inside its box').toBeLessThanOrEqual(0)
})

test('a title is read, copied and named as written in the list', async ({ page }) => {
  await installBackend(page)
  await openList(page)
  const row = page.locator('.work-item-list tbody tr').filter({ hasText: workItemRef.reference })
  const drawn = { named: row.locator('td.list-title'), text: row.locator('.list-name') }
  const name = await nameOf(page, drawn)
  expect(name).toBe(await plainNameOf(page, drawn))
})

test('a title is read, copied and named as written on the board', async ({ page }) => {
  await installBackend(page)
  await page.goto(boardRoute())
  const tile = page.locator(`.work-item-board [data-reference="${workItemRef.reference}"]`)
  const name = await nameOf(page, {
    named: tile.locator('.tile-open'),
    text: tile.locator('.tile-title'),
  })
  expect(name).toBe(`${workItemRef.reference} ${workItem.title}`)
})

test("a title is read, copied and named as written at a card's head", async ({ page }) => {
  await installBackend(page)
  const drawer = await openCard(page)
  const heading = drawer.locator('.drawer-frame-name')
  expect(await nameOf(page, { named: heading, text: heading })).toBe(workItem.title)
})

test("a linked item's title is named as written among a card's links", async ({ page }) => {
  await installBackend(page, linkedTo(workItem.title))
  const drawer = await openCard(page)
  await drawer.getByRole('tab', { name: /Relations/iu }).click()
  const link = drawer.locator('.link-open').first()
  const text = link.locator('.link-title')
  const name = await nameOf(page, { named: link, text })
  expect(name).toBe(await plainNameOf(page, { named: link, text }))
})

test("a found item's title is named as written in the finder", async ({ page }) => {
  await installBackend(page)
  await routeFinder(page, workItem.title)
  await page.goto(boardRoute())
  await expect(page.locator('.work-item-board')).toBeVisible()
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Go to a task', exact: true })
  await dialog.getByRole('combobox').fill('main')
  const option = dialog.getByRole('option')
  await expect(option).toHaveCount(1)
  const text = option.locator('.command-title')
  const name = await nameOf(page, { named: option, text })
  expect(name).toBe(await plainNameOf(page, { named: option, text }))
})

test("a candidate's title is named as written in the picker of related work", async ({ page }) => {
  await installBackend(page)
  await routePicker(page, workItem.title)
  const drawer = await openCard(page)
  await drawer.getByRole('tab', { name: /Relations/iu }).click()
  await drawer.getByRole('button', { name: 'Add link', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Related task', exact: true })
  await dialog.getByLabel('Reference, number or title').fill('loading')
  const radio = dialog.getByRole('radio')
  await expect(radio).toHaveCount(1)
  // The title's own words, after the reference and its dot.
  const text = dialog.locator('.result-title > span')
  const name = await nameOf(page, { named: radio, text })
  expect(name).toBe(await plainNameOf(page, { named: radio, text }))
})
