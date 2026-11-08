/**
 * What the window's one hint shows under the keyboard's focus, and what it lets through.
 *
 * Focus shows the focused element's own hint or none: a control inside a hinted element
 * showed that element's hint, and beside a why tip of its own that was two hints for one
 * focus.
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
