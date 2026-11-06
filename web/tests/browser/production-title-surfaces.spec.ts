/**
 * A long title on every surface that draws one, at a phone's width and a desktop's.
 *
 * A run of slash-joined words is one word to a browser, so a title such as
 * `…/acceptance/loading/empty/error/unavailable/permission-denied` broke wherever a line
 * ran out: «unavail» above «able/p» in the finder, «/empty» above «/error» on the graph's
 * frame, and in the new task's epic list after the rest had been mended. Each surface breaks
 * it at a space, after a `/` or a hyphen and nowhere else.
 *
 * One word wider than a line breaks inside, and stays in its box: the branch map's tip cut
 * such a word 285 px past its edge, with no ellipsis to say it went on.
 */
import { expect } from '@playwright/test'

import { test } from './test.ts'
import { breaksIn, ONE_WORD, overflowOf, SLASHED } from './titleBreaks.ts'
import { TITLE_SURFACES } from './titleSurfaces.ts'

for (const width of [390, 1280]) {
  test.describe(`at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.setViewportSize({ width, height: 900 })
    })

    for (const [surface, open] of Object.entries(TITLE_SURFACES)) {
      test(`a slash-joined title breaks between words in ${surface}`, async ({ page }) => {
        const text = await open(page, SLASHED)
        const { count, inside } = await breaksIn(text)
        // The title has to be too long for its line here, or nothing was tested.
        expect(count, 'the title takes more than one line').toBeGreaterThan(0)
        expect(inside, 'breaks inside a word').toEqual([])
        expect(await overflowOf(text), 'past its box, in px').toBeLessThanOrEqual(0.5)
      })

      test(`a word wider than its line stays inside its box in ${surface}`, async ({ page }) => {
        const text = await open(page, ONE_WORD)
        await expect(text).toBeVisible()
        expect(await overflowOf(text), 'past its box, in px').toBeLessThanOrEqual(0.5)
      })
    }
  })
}
