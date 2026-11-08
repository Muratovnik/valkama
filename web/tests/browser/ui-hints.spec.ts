/**
 * What the window's one hint shows under the keyboard's focus, and what it lets through.
 *
 * Focus shows the focused element's own hint or none: a control inside a hinted element
 * showed that element's hint, and beside a why tip of its own that was two hints for one
 * focus. A hint is read, never pressed: one the keyboard held up took a tap meant for the
 * control it stood over.
 */
import { expect } from '@playwright/test'

import { test } from './test.ts'

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
