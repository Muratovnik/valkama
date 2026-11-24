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
  spaceWindowWorld,
} from './spaceWindowBackend.ts'
import { ellipsisGaps, inView } from './spaceWindowMeasures.ts'
import { openPortfolio, WORDS } from './spaceWindowPage.ts'
import { test } from './test.ts'

const SIZES = [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 620, height: 800 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
] as const

type Box = Awaited<ReturnType<Locator['boundingBox']>>

/** The boxes of the window's parts, one by one. */
async function boxes(parts: Record<string, Locator>) {
  const each: Record<string, Box> = {}
  for (const [part, locator] of Object.entries(parts)) each[part] = await locator.boundingBox()
  return each
}

/** That every part stands where it stood at the start. */
function expectStill(now: Record<string, Box>, start: Record<string, Box>, when: string) {
  for (const [part, box] of Object.entries(start))
    expect.soft(now[part]?.y, `${part}, ${when}`).toBeCloseTo(box?.y ?? Number.NaN, 1)
}

/** Whether the reader sees the words, nothing over them. */
async function seen(words: Locator) {
  const where = await inView(words)
  return where.seen
}

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

      for (const [world, key] of [
        [spaceWindowWorld, 'DRF'],
        [longSpaceWorld, 'LNG'],
      ] as const)
        test(`a rename of ${key} says what it changes over the buttons and moves nothing`, async ({
          page,
        }) => {
          const state = world()
          await installSpaceWindowBackend(page, state)
          await openPortfolio(page, { width, height })
          await page.getByRole('button', { name: words.configure(key) }).click()
          const dialog = page.getByRole('dialog', { name: words.editTitle(key) })
          const name = dialog.getByLabel(words.name, { exact: true })
          const fieldOf = (label: string) =>
            dialog.locator('.field', { has: page.getByLabel(label, { exact: true }) })
          const save = dialog.getByRole('button', { name: words.save })
          const parts = {
            key: fieldOf(words.key),
            projects: dialog.getByRole('region', { name: words.projects }),
            save,
          }
          await expect(dialog).toHaveCSS('transform', 'none')
          await name.click()
          const start = await boxes(parts)
          // The name stands as far from the key as the key from the projects: no room is held
          // between them for what a rename says.
          const nameBox = await fieldOf(words.name).boundingBox()
          const after = (start.key?.y ?? Number.NaN) - (nameBox?.y ?? 0) - (nameBox?.height ?? 0)
          const keyBottom = (start.key?.y ?? 0) + (start.key?.height ?? 0)
          const under = (start.projects?.y ?? Number.NaN) - keyBottom
          expect
            .soft(after, 'the name to the key, against the key to the projects')
            .toBeCloseTo(under, 0)

          const named = state.spaces.find((space) => space.key === key)?.name ?? ''
          await name.fill(`${named}, renamed`)
          await expect(name).toHaveAccessibleDescription(new RegExp(words.renamed, 'u'))
          const said = dialog.locator(
            `[id="${(await name.getAttribute('aria-describedby')) ?? ''}"]`,
          )
          await expect(said).toBeVisible()
          expectStill(await boxes(parts), start, 'renamed')
          // Under the form, over the buttons, in sight however long the form.
          expect
            .soft(
              await said.evaluate((node) => {
                const form = node.closest('[role="dialog"]')?.querySelector('section')
                return Boolean(form && form.compareDocumentPosition(node) & 4)
              }),
              'after the projects',
            )
            .toBe(true)
          const saidBox = await said.boundingBox()
          expect.soft(saidBox?.y ?? Number.NaN, 'over the buttons').toBeLessThan(start.save?.y ?? 0)
          expect.soft(await seen(said), 'in sight').toBe(true)

          // The name given back takes the words away and moves nothing either.
          await name.fill(named)
          await expect(said).toHaveCount(0)
          await expect(name).not.toHaveAccessibleDescription(new RegExp(words.renamed, 'u'))
          expectStill(await boxes(parts), start, 'named back')

          // A refused save says why under it, nearer the buttons, and neither covers the other.
          await name.fill(`${named}, renamed`)
          await expect(said).toBeVisible()
          state.saveRefuses = 'name_taken'
          await save.click()
          const alert = dialog.getByRole('alert')
          await expect(alert).toHaveText(words.nameTaken)
          const alertBox = await alert.boundingBox()
          const saidNow = await said.boundingBox()
          expect
            .soft((saidNow?.y ?? 0) + (saidNow?.height ?? 0), 'the rename over the refusal')
            .toBeLessThanOrEqual((alertBox?.y ?? Number.NaN) + 0.5)
          expect.soft(await seen(alert), 'the refusal in sight').toBe(true)
          expect.soft(await seen(said), 'the rename in sight').toBe(true)
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
