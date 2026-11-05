import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { aCardAsking, BROKEN_PATH, HUGE_PATH, linkTo } from './documentBackend.ts'
import { test } from './test.ts'

/**
 * A document opened from a card takes focus whatever its read comes to — its text, a file
 * too large to show, a read the server failed, a file that is not there — so the next
 * Escape is the document's: it closes the document alone, gives focus back to the link it
 * was opened from, and leaves the card open. Beside the card on a wide window, over it on
 * a phone, in either language.
 */

const OUTCOMES = [
  ['its text', 'docs/notes.md'],
  ['a file too large to show', HUGE_PATH],
  ['a failed read', BROKEN_PATH],
  ['no file', 'docs/gone.md'],
] as const

const viewer = (page: Page) => page.locator('.document-viewer')

const focusInViewer = (page: Page) =>
  page.evaluate(() => Boolean(document.activeElement?.closest('.document-viewer')))

for (const locale of ['en-US', 'ru-RU'])
  test.describe(`in ${locale}`, () => {
    test.use({ locale })

    for (const width of [1500, 1280, 390])
      for (const [outcome, path] of OUTCOMES)
        test(`at ${width}px, ${outcome}: focus goes in, and Escape closes the document alone`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 900 })
          const { drawer } = await aCardAsking(page, `Read \`${path}\` first.`)
          const link = linkTo(page, path)
          await link.focus()
          await page.keyboard.press('Enter')
          // The read has come to what it comes to: a text or a refusal, no longer waiting.
          await expect(
            viewer(page).locator(
              '.document-text, .document-refusal .platform-state-panel:not([aria-busy])',
            ),
          ).toBeVisible()
          await expect.poll(() => focusInViewer(page)).toBe(true)

          await page.keyboard.press('Escape')
          await expect(viewer(page)).toHaveCount(0)
          await expect(drawer).toBeVisible()
          await expect(link).toBeFocused()
        })
  })
