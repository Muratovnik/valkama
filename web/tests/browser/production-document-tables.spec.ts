import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { LINK, linkIn } from './documentBackend.ts'
import { openBesideCard, paneOf, settled } from './documentBeside.ts'
import { test } from './test.ts'

/**
 * A table in a document beside a card, at the narrowest a pane commonly stands: columns as
 * wide as their words, a frame that says it goes on past its edge and, while it is a stop on
 * the keyboard's way, is a region named by the table's head.
 */

const NAME = 'Table: Step, Owner, State, Where it stands, What it still waits for from anyone else'

async function tableBeside(page: Page) {
  const { drawer } = await openBesideCard(page)
  await linkIn(drawer, LINK).click()
  const { pane, target } = paneOf(page)
  await expect(target).toBeFocused()
  await settled(drawer)
  return pane.locator('.rich-table-frame').first()
}

async function heightOf(locator: Locator) {
  const box = await locator.boundingBox()
  return box?.height ?? 0
}

async function widthOf(page: Page, words: string) {
  const box = await page.locator('.rich-head', { hasText: words }).boundingBox()
  return box?.width ?? 0
}

test('columns take the width their words ask for, and the rows no more height than that', async ({
  page,
}) => {
  const frame = await tableBeside(page)
  const step = await widthOf(page, 'Step')
  const waits = await widthOf(page, 'What it still waits for')
  // A word's column and a sentence's: one floor for every column made them the same.
  expect(step).toBeLessThan(waits / 2)
  const line = await heightOf(frame.locator('.rich-head .rich-cell-words').first())
  const row = await heightOf(frame.locator('tbody tr').first())
  // The sentence of the first row on two lines at most, with its cell's room.
  expect(row).toBeLessThan(3 * line)
})

test('the frame is a named region, draws its edge where more is hidden, and follows the reader', async ({
  page,
}) => {
  const frame = await tableBeside(page)
  await expect(frame).toHaveAttribute('tabindex', '0')
  await expect(frame).toHaveAccessibleName(NAME)
  await expect(frame).toHaveRole('region')
  await expect(frame).toHaveAttribute('data-more', 'end')
  await expect(frame).toHaveCSS('border-inline-end-width', '2px')
  await expect(frame).toHaveCSS('border-inline-start-width', '0px')
  await frame.evaluate((node) => node.scrollTo({ left: node.scrollWidth }))
  await expect(frame).toHaveAttribute('data-more', 'start')
  await expect(frame).toHaveCSS('border-inline-start-width', '2px')
  await expect(frame).toHaveCSS('border-inline-end-width', '0px')
})

test.describe('in a forced palette', () => {
  test.use({ forcedColors: 'active' })

  test('the edge is a line, which the palette keeps', async ({ page }) => {
    const frame = await tableBeside(page)
    await expect(frame).toHaveAttribute('data-more', 'end')
    await expect(frame).toHaveCSS('border-inline-end-style', 'solid')
    await expect(frame).toHaveCSS('border-inline-end-width', '2px')
  })
})
