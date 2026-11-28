/**
 * The card a reference shows copies its number and its address as a card's head does, with the
 * head's words, from the pointer and from the keyboard. The clipboard is the test browser's own,
 * read back through its permission, which this spec is granted (`clipboardSpecs.ts`); the rest of
 * the card's copying and selecting is in `production-reference-preview-copy.spec.ts`.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { selected, shown, WORDS } from './previewCopyPage.ts'
import {
  card,
  cardsAfterTheDelay,
  middle,
  ontoCard,
  openReported,
  reference,
} from './previewPage.ts'
import { test } from './test.ts'

test.beforeEach(async ({ page }) => {
  // A card's delay runs on this clock (`cardsAfterTheDelay`), so a loaded machine moves no
  // verdict; until a test moves it, it keeps the wall clock's pace.
  await page.clock.install()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
})

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

for (const locale of ['en', 'ru'] as const) {
  for (const width of [1280, 390]) {
    test(`the card copies its number and its address and stays, ${locale} at ${width}px`, async ({
      page,
    }) => {
      const words = WORDS[locale]
      await shown(page, locale, width)
      const before = page.url()
      const note = card(page).locator('.identity-note')

      await page.getByRole('button', { name: words.copy, exact: true }).click()
      await expect.poll(() => clipboard(page)).toBe('MAIN-12')
      await expect(note).toContainText(words.copied)
      await expect(card(page).locator('[role="status"]')).toHaveText(words.copied)

      await page.getByRole('button', { name: words.link, exact: true }).click()
      await expect.poll(() => clipboard(page)).toBe(`${new URL(before).origin}/open/MAIN-12`)
      await expect(note).toContainText(words.linked)

      // It opened nothing and went nowhere.
      expect(page.url()).toBe(before)
      await expect(card(page)).toContainText('Keep the reader in place')
      const overflow = await card(page).evaluate((element) => {
        const { left, right } = element.getBoundingClientRect()
        return left < 0 || right > document.documentElement.clientWidth
      })
      expect(overflow).toBe(false)
    })
  }
}

test('the keyboard reaches both controls from the reference, and goes on from there', async ({
  page,
}) => {
  const { entry } = await openReported(page)
  const link = reference(entry, 'MAIN-12')
  await link.evaluate((element) => {
    const before = document.createElement('button')
    before.dataset.before = ''
    element.before(before)
  })
  await entry.locator('[data-before]').focus()
  await page.keyboard.press('Tab')
  await expect(link).toBeFocused()
  const copy = page.getByRole('button', { name: WORDS.en.copy, exact: true })
  const address = page.getByRole('button', { name: WORDS.en.link, exact: true })

  await page.keyboard.press('Tab')
  await expect(copy).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(() => clipboard(page)).toBe('MAIN-12')
  await expect(card(page)).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(address).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(copy).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(link).toBeFocused()
  await expect(card(page)).toBeVisible()

  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(reference(entry, 'MAIN-13')).toBeFocused()
  await expect(card(page)).toContainText('MAIN-13')

  // Escape from inside closes the card alone, and focus stands on the reference again.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)
  await expect(reference(entry, 'MAIN-13')).toBeFocused()
})

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
