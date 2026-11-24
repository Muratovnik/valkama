/**
 * What stands still in the space window as it is worked, at every width its layout changes at,
 * in English and in Russian, by the window's contract in DESIGN.md («The space window»): the
 * key's field holds the room of every hint and reason it can come to say, so a reason appearing
 * or another taking its place moves nothing under the field. At 390px a reason a line longer than
 * the hint pushed the projects down by a line. Each folder cut in its middle ends its start in a
 * «…» that stands as far from its last folder as every other row's: the start's box gave way
 * by the pixel while its words gave way by the letter, so the space after the «…» was what was
 * left of a letter, from none to some 8px.
 *
 * The server is `spaceWindowBackend.ts`'s double.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import {
  installSpaceWindowBackend,
  LONG_SPACE_NAMES,
  longSpaceWorld,
} from './spaceWindowBackend.ts'
import { ellipsisGaps } from './spaceWindowMeasures.ts'
import { openPortfolio, WORDS } from './spaceWindowPage.ts'
import { test } from './test.ts'

const SIZES = [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 620, height: 800 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
] as const

/** Where the projects' heading, the first thing under the key's field, stands. */
async function headingTop(heading: Locator) {
  const box = await heading.boundingBox()
  return box?.y ?? Number.NaN
}

for (const lang of ['en', 'ru'] as const)
  for (const { width, height } of SIZES) {
    const words = WORDS[lang]

    test.describe(`the space window at ${width}px in ${lang}`, () => {
      test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

      test('a key of a wrong form and a moved key move nothing under the key', async ({ page }) => {
        await installSpaceWindowBackend(page, longSpaceWorld())
        await openPortfolio(page, { width, height })
        await page.getByRole('button', { name: words.configure('LNG') }).click()
        const dialog = page.getByRole('dialog', { name: words.editTitle('LNG') })
        await expect(dialog.locator('[data-project]').first()).toBeVisible()
        const key = dialog.getByLabel(words.key, { exact: true })
        const heading = dialog.getByRole('heading', { name: words.projects, exact: true })
        // The reader's first press holds the window's top, so what follows can only grow down.
        await expect(dialog).toHaveCSS('transform', 'none')
        await key.click()
        const start = await headingTop(heading)
        for (const [typed, said] of [
          ['1', words.keyInvalid],
          ['LNGX', words.keyMoves],
          ['A', words.keyInvalid],
          ['LNG', words.keyHint('LNG')],
        ] as const) {
          await key.fill(typed)
          await expect(key).toHaveAccessibleDescription(said)
          expect
            .soft(await headingTop(heading), `the key «${typed}»: ${said}`)
            .toBeCloseTo(start, 1)
        }
      })

      test.describe('drawn at twice the pixels', () => {
        test.use({ deviceScaleFactor: 2 })

        test('every folder cut in its middle stands its «…» as far from its last folder', async ({
          page,
        }) => {
          await installSpaceWindowBackend(page, longSpaceWorld())
          await openPortfolio(page, { width, height })
          await page.getByRole('button', { name: words.configure('LNG') }).click()
          const dialog = page.getByRole('dialog', { name: words.editTitle('LNG') })
          await expect(dialog.locator('[data-project]').first()).toBeVisible()
          await expect(dialog).toHaveCSS('transform', 'none')
          await page.mouse.move(0, 0)
          const gaps = await ellipsisGaps(page, dialog, 2)
          // Every row's folder starts with the same long path, which no row holds whole.
          expect(gaps).toHaveLength(LONG_SPACE_NAMES.length)
          const each = gaps.map(({ gap }) => gap)
          expect(
            each.every((gap) => Number.isFinite(gap)),
            JSON.stringify(gaps),
          ).toBe(true)
          expect(Math.max(...each) - Math.min(...each), JSON.stringify(gaps)).toBeLessThanOrEqual(1)
        })
      })

      test('a name that gives no key and a key typed after it move nothing under the key', async ({
        page,
      }) => {
        await installSpaceWindowBackend(page, longSpaceWorld())
        await openPortfolio(page, { width, height })
        await page.locator('[data-part="new-space"]').click()
        const dialog = page.getByRole('dialog', { name: words.newSpace })
        const heading = dialog.getByRole('heading', { name: words.projects, exact: true })
        const name = dialog.getByLabel(words.name, { exact: true })
        const key = dialog.getByLabel(words.key, { exact: true })
        await expect(name).toBeFocused()
        // Measured once the window has stepped up to where it rests.
        await expect(dialog).toHaveCSS('transform', 'none')
        const start = await headingTop(heading)
        await name.pressSequentially('Ёлка')
        await expect(key).toHaveAccessibleDescription(new RegExp(words.underivable, 'u'))
        expect.soft(await headingTop(heading), 'no key from the name').toBeCloseTo(start, 1)
        for (const [typed, said] of [
          ['AB', words.keyHint('AB')],
          ['1', words.keyInvalid],
          ['WWWWWWWW', words.keyHint('WWWWWWWW')],
        ] as const) {
          await key.fill(typed)
          await expect(key).toHaveAccessibleDescription(said)
          expect
            .soft(await headingTop(heading), `the key «${typed}»: ${said}`)
            .toBeCloseTo(start, 1)
        }
      })
    })
  }
