/**
 * The card a reference shows copies its number to the system clipboard, as a card's head does
 * through the same copy: the one check of that copy on the test browser's own clipboard, read back
 * through its permission, which this spec is granted (`clipboardSpecs.ts`). The rest of the
 * card's copying and selecting, with the copies kept in the page, is in
 * `production-reference-preview-copy.spec.ts`.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { selected, shown, WORDS } from './previewCopyPage.ts'
import { cardsAfterTheDelay, middle, ontoCard } from './previewPage.ts'
import { test } from './test.ts'

test.beforeEach(async ({ page }) => {
  // A card's delay runs on this clock (`cardsAfterTheDelay`), so a loaded machine moves no
  // verdict; until a test moves it, it keeps the wall clock's pace.
  await page.clock.install()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
})

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

test('moving from the number onto a control keeps the card, and the press selects nothing', async ({
  page,
}) => {
  const { link } = await shown(page)
  const copy = page.getByRole('button', { name: WORDS.en.copy, exact: true })
  await ontoCard(page, link, { ...(await middle(copy)), steps: 8 })
  expect(await cardsAfterTheDelay(page)).toBe(1)
  // Still this reference's card, though another reference lies under it on a wide window.
  await expect(copy).toBeVisible()
  await page.mouse.down()
  await page.mouse.up()
  await expect.poll(() => clipboard(page)).toBe('MAIN-12')
  expect(await selected(page)).toBe('')
})
