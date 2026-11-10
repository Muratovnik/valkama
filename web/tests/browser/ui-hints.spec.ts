/**
 * What the window's one hint shows under the keyboard's focus, and what it lets through.
 *
 * Focus shows the focused element's own hint or none: a control inside a hinted element
 * showed that element's hint, and beside a why tip of its own that was two hints for one
 * focus. A hint is read, never pressed: one the keyboard held up took a tap meant for the
 * control it stood over.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { test } from './test.ts'

/** Where something stands, read in the page so that a missing one fails there. */
const boxOf = (locator: Locator) =>
  locator.evaluate((node) => {
    const { x, y } = node.getBoundingClientRect()
    return { x, y }
  })

test('focus shows the focused control’s own hint, and none of the element it is in', async ({
  page,
}) => {
  // The hint's delay runs on this clock, so the test can say that no hint came after it.
  await page.clock.install()
  await page.goto('/tests/browser/harness.html?lang=en&surface=hints')
  const words = page.getByRole('tooltip')
  await expect(page.locator('.hints-under')).toBeVisible()

  await page.keyboard.press('Tab')
  await expect(page.locator('.hints-under')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.locator('.hints-own')).toBeFocused()
  await expect(words).toHaveText('A hint of its own')

  await page.keyboard.press('Tab')
  await expect(page.locator('.hints-inner')).toBeFocused()
  await page.clock.runFor(1000)
  await expect(words).toHaveCount(0)
  await expect(page.locator('.tooltip-hint')).toHaveCount(0)
})

test('the pointer moved straight to the next cut word shows its hint at once', async ({ page }) => {
  await page.clock.install()
  await page.goto('/tests/browser/harness.html?lang=en&surface=hints')
  const words = page.getByRole('tooltip')
  const [name, title] = [page.locator('.hints-name'), page.locator('.hints-title')]
  await expect(title).toBeVisible()
  await name.hover()
  await page.clock.runFor(1000)
  await expect(words).toHaveText('A name cut short by its box')
  // Straight across onto the start of the next word, which stands in the room between the
  // first word and its wider hint: the library's way to a hint the pointer may enter, which a
  // hint the pointer passes through has no use for.
  const box = await boxOf(title)
  await page.mouse.move(box.x + 4, box.y + 3, { steps: 8 })
  await expect(words).toHaveText('A title cut short beside it')
  // And still, once the moment for passing on is long gone.
  await page.clock.runFor(1000)
  await expect(words).toHaveText('A title cut short beside it')
})

test('a hint the keyboard holds up lets a press through to what it covers', async ({ page }) => {
  await page.goto('/tests/browser/harness.html?lang=en&surface=hints')
  const under = page.locator('.hints-under')
  await expect(under).toBeVisible()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const hint = page.locator('.tooltip-hint')
  await expect(hint).toBeVisible()
  // What a press at the middle of the hint lands on, and whether the hint stands over the
  // control above its own there, which is the case this asks about.
  const landed = await page.evaluate(() => {
    const card = document.querySelector('.tooltip-hint')?.getBoundingClientRect()
    const below = document.querySelector('.hints-under')?.getBoundingClientRect()
    if (!card || !below) return { over: false, on: null }
    const [x, y] = [card.left + card.width / 2, card.top + card.height / 2]
    return {
      over: below.top < y && y < below.bottom,
      on: document.elementFromPoint(x, y)?.className,
    }
  })
  expect(landed).toEqual({ over: true, on: 'hints-under' })
})

/** The hint's lines: its element's whole words when it says them, and the detail under them. */
const hintLines = (page: Page) =>
  page.locator('.tooltip-hint').evaluate((node) => {
    const words = node.querySelector('.tooltip-words')
    const text = [...node.childNodes].find(
      (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
    )
    const range = document.createRange()
    range.selectNodeContents(text ?? node)
    const [line] = range.getClientRects()
    return {
      words: words?.textContent ?? null,
      text: text?.textContent?.trim() ?? '',
      under: words ? (line?.top ?? 0) >= words.getBoundingClientRect().bottom - 1 : null,
    }
  })

test('a detail on a cut name says the name whole over it, and on a whole name the detail alone', async ({
  page,
}) => {
  await page.clock.install()
  await page.goto('/tests/browser/harness.html?lang=en&surface=hints')
  const [held, short, bare] = [
    page.locator('.hints-held'),
    page.locator('.hints-short'),
    page.locator('.hints-bare'),
  ]
  await expect(held).toBeVisible()
  // The setting this asks about: the first name is cut, the second is not.
  expect(await held.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
  expect(await short.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(false)

  await held.hover()
  await page.clock.runFor(1000)
  expect(await hintLines(page)).toEqual({
    words: 'A holder whose name is long',
    text: 'Held since Monday',
    under: true,
  })

  await short.hover()
  await page.clock.runFor(1000)
  expect(await hintLines(page)).toEqual({ words: null, text: 'Held since Monday', under: null })

  // With nothing to add, a cut name's hint is its words, as a `clipped` one is.
  await bare.hover()
  await page.clock.runFor(1000)
  expect(await hintLines(page)).toEqual({
    words: null,
    text: 'A name with nothing to add',
    under: null,
  })
})

test('a whole word with a clipped hint leaves the pointer to the hint of the control it is in', async ({
  page,
}) => {
  await page.clock.install()
  await page.goto('/tests/browser/harness.html?lang=en&surface=hints')
  const words = page.getByRole('tooltip')
  await page.locator('.hints-whole').hover()
  await page.clock.runFor(1000)
  await expect(words).toHaveText('What the control does')
  // A cut word still says itself, over whatever holds it.
  await page.locator('.hints-name').hover()
  await page.clock.runFor(1000)
  await expect(words).toHaveText('A name cut short by its box')
})
