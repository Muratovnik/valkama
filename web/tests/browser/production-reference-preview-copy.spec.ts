/**
 * The card a reference shows copies its number and its address as a card's head does, with the
 * head's words, and its text can be selected: the press that starts a selection was refused so
 * that focus would not move, and the card closed under a drag that left it. The clipboard is the
 * test browser's own, read back through its permission.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { card, cardsAfterTheDelay, middle, openReported, reference, rest } from './previewPage.ts'
import { test } from './test.ts'

const WORDS = {
  en: {
    copy: 'Copy MAIN-12',
    copied: 'MAIN-12 copied',
    link: 'Copy link to MAIN-12',
    linked: 'Link copied',
    refused: 'Link not copied',
  },
  ru: {
    copy: 'Скопировать MAIN-12',
    copied: 'MAIN-12 скопирован',
    link: 'Копировать ссылку на MAIN-12',
    linked: 'Ссылка скопирована',
    refused: 'Ссылка не скопирована',
  },
} as const

async function shown(page: Page, locale: 'en' | 'ru' = 'en', width = 1440) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const opened = await openReported(page)
  await rest(page, reference(opened.entry, 'MAIN-12'))
  await expect(card(page)).toBeVisible()
  return opened
}

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())
const selected = (page: Page) => page.evaluate(() => document.getSelection()?.toString() ?? '')

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Not on screen')
  return box
}

/** Press in the title's first words and drag to `to`, or along them; the press stays down. */
async function dragOverTitle(page: Page, title: Locator, to?: { x: number; y: number }) {
  const box = await boxOf(title)
  await page.mouse.move(box.x + 2, box.y + 8, { steps: 6 })
  await page.mouse.down()
  await page.mouse.move(to?.x ?? box.x + 120, to?.y ?? box.y + 8, { steps: 8 })
}

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

test('a clipboard that refuses is said as refused, with a mark of its own', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('refused')) },
    })
  })
  await shown(page)
  await page.getByRole('button', { name: WORDS.en.link, exact: true }).click()
  const note = card(page).locator('.identity-note')
  await expect(note).toContainText(WORDS.en.refused)
  await expect(note.locator('svg')).toHaveClass(/lucide-circle-alert/u)
})

test('the keyboard reaches both controls from the reference, and goes on from there', async ({
  page,
}) => {
  const { entry } = await openReported(page)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
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

test('its text can be selected with the pointer, in a colour that shows', async ({ page }) => {
  await shown(page)
  const title = card(page).locator('.preview-title')
  await dragOverTitle(page, title)
  await page.mouse.up()
  expect(await selected(page)).toMatch(/\S{3}/u)
  await expect(card(page)).toBeVisible()
  const colours = await title.evaluate((element) => ({
    background: getComputedStyle(element, '::selection').backgroundColor,
    ground: getComputedStyle(element.closest('.reference-preview') as Element).backgroundColor,
  }))
  expect(colours.background).not.toBe('rgba(0, 0, 0, 0)')
  expect(colours.background).not.toBe(colours.ground)
})

test('a drag that ends outside keeps the card and the selection until a press elsewhere', async ({
  page,
}) => {
  const { drawer } = await shown(page)
  const title = card(page).locator('.preview-title')
  const box = await boxOf(card(page))
  const outside = { x: box.x + box.width + 60, y: box.y + box.height + 60 }
  await dragOverTitle(page, title, outside)
  expect(await cardsAfterTheDelay(page)).toBe(1)
  await page.mouse.up()
  const words = await selected(page)
  expect(words).toMatch(/\S{3}/u)
  // The pointer wanders off, as a hand on its way to Ctrl+C does.
  await page.mouse.move(5, 5, { steps: 6 })
  expect(await cardsAfterTheDelay(page)).toBe(1)
  expect(await selected(page)).toBe(words)

  await drawer.getByRole('heading', { name: 'Discussion' }).click()
  await expect(card(page)).toHaveCount(0)
})

test('a drag with no selection that ends outside leaves as the pointer did', async ({ page }) => {
  await shown(page)
  const box = await boxOf(card(page))
  // On the card's edge, where nothing is under the press to select.
  await page.mouse.move(box.x + box.width - 2, box.y + 2, { steps: 6 })
  await page.mouse.down()
  await page.mouse.move(box.x + box.width + 300, box.y + box.height + 300, { steps: 8 })
  await page.mouse.up()
  await expect(card(page)).toHaveCount(0)
})

test('a selection hands focus back to a draft at the next Tab, which stays in the drawer', async ({
  page,
}) => {
  const { drawer, entry } = await openReported(page)
  const draft = drawer.locator('.discussion-form').getByRole('textbox')
  await draft.fill('A draft in progress')
  await draft.focus()
  await rest(page, reference(entry, 'MAIN-12'))
  await expect(card(page)).toBeVisible()
  await dragOverTitle(page, card(page).locator('.preview-title'))
  await page.mouse.up()
  expect(await selected(page)).toMatch(/\S{3}/u)
  await page.keyboard.press('Tab')
  await expect(draft).toHaveValue('A draft in progress')
  expect(await page.evaluate(() => document.activeElement?.closest('.overlay-host') !== null)).toBe(
    true,
  )
})

test('moving from the number onto a control keeps the card, and the press selects nothing', async ({
  page,
}) => {
  await shown(page)
  const copy = page.getByRole('button', { name: WORDS.en.copy, exact: true })
  const { x, y } = await middle(copy)
  await page.mouse.move(x, y, { steps: 8 })
  expect(await cardsAfterTheDelay(page)).toBe(1)
  // Still this reference's card, though another reference lies under it on a wide window.
  await expect(copy).toBeVisible()
  await page.mouse.down()
  await page.mouse.up()
  await expect.poll(() => clipboard(page)).toBe('MAIN-12')
  expect(await selected(page)).toBe('')
})
