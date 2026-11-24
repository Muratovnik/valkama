/**
 * What stands still in the space window as it is worked, at every width its layout changes at,
 * in English and in Russian, by the window's contract in DESIGN.md («The space window»): the
 * key's field holds the room of every hint and reason it can come to say, so a reason appearing
 * or another taking its place moves nothing under the field. At 390px a reason a line longer than
 * the hint pushed the projects down by a line. Each folder cut in its middle ends its start in a
 * «…» that stands as far from its last folder as every other row's: the start's box gave way
 * by the pixel while its words gave way by the letter, so the space after the «…» was what was
 * left of a letter, from none to some 8px. A folder whose last folder is cut too still shows the
 * first letter of its start and the whole «…»: given 1.5em, the start drew its first letter and
 * one dot. An emptied key says the key's form, not that the projects move to a new key, and
 * moves nothing either. A rename says what it changes over the buttons from the first letter
 * typed, and moves nothing in the form: the buttons go down by its words, and no room is held
 * for them before, which stood as a blank over the buttons.
 *
 * No control the keyboard reaches in the window stands under what it says over its buttons, a
 * rename's words or a refused save's reason (DESIGN.md, «Dialogs and drawers»): the remove
 * buttons, «Add project» and «New project from folder…» stood wholly under them.
 *
 * The server is `spaceWindowBackend.ts`'s double.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { bodyOverflows, walkFocus } from './dialogFocus.ts'
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

/** A project of the long space whose last folder no row at these widths holds whole. */
const LONG_TAIL = {
  project_id: 'long-tail',
  display_name: 'Ledger exports',
  root: 'D:/work/clients/northern-region/shared-services/archived-and-active-projects/very-long-last-folder-name-for-this-project-and-its-nightly-archive',
  space: 'LNG',
  default: false,
}

/**
 * Every folder whose start is cut: how wide its start stands, how wide its first letter and a
 * «…» are in its type, measured on their own, and whether its last folder is cut too.
 */
const cutStarts = (dialog: Locator) =>
  dialog.locator('[data-project]').evaluateAll((rows) =>
    rows.flatMap((row) => {
      const head = row.querySelector<HTMLElement>('[data-part="root-head"]')
      const tail = row.querySelector<HTMLElement>('[data-part="root-tail"]')
      const words = head?.firstChild
      if (!head || !tail || !(words instanceof Text) || head.scrollWidth <= head.clientWidth)
        return []
      const first = document.createRange()
      first.setStart(words, 0)
      first.setEnd(words, 1)
      const dots = document.createElement('span')
      dots.style.font = getComputedStyle(head).font
      dots.style.position = 'absolute'
      dots.style.whiteSpace = 'pre'
      dots.textContent = '…'
      document.body.append(dots)
      const dotsWidth = dots.getBoundingClientRect().width
      dots.remove()
      return [
        {
          project: row instanceof HTMLElement ? (row.dataset.project ?? '') : '',
          start: head.getBoundingClientRect().width,
          least: first.getBoundingClientRect().width + dotsWidth,
          tailCut: tail.scrollWidth > tail.clientWidth,
        },
      ]
    }),
  )

/** Where the element's top stands, such as the projects' heading's, first under the key. */
async function topOf(element: Locator) {
  const box = await element.boundingBox()
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
        const start = await topOf(heading)
        for (const [typed, said] of [
          ['1', words.keyInvalid],
          ['LNGX', words.keyMoves],
          ['A', words.keyInvalid],
          ['', words.keyForm],
          ['LNG', words.keyHint('LNG')],
        ] as const) {
          await key.fill(typed)
          await expect(key).toHaveAccessibleDescription(said)
          expect.soft(await topOf(heading), `the key «${typed}»: ${said}`).toBeCloseTo(start, 1)
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

        test('a folder cut at its last folder too shows its first letter and its whole «…»', async ({
          page,
        }) => {
          const state = longSpaceWorld()
          state.projects.unshift(LONG_TAIL)
          await installSpaceWindowBackend(page, state)
          await openPortfolio(page, { width, height })
          await page.getByRole('button', { name: words.configure('LNG') }).click()
          const dialog = page.getByRole('dialog', { name: words.editTitle('LNG') })
          await expect(dialog.locator('[data-project="long-tail"]')).toBeVisible()
          await expect(dialog).toHaveCSS('transform', 'none')
          const cuts = await cutStarts(dialog)
          // Every row's start is cut, and the long one's last folder with it.
          expect(cuts, JSON.stringify(cuts)).toHaveLength(LONG_SPACE_NAMES.length + 1)
          expect(
            cuts.find((cut) => cut.project === 'long-tail')?.tailCut,
            JSON.stringify(cuts),
          ).toBe(true)
          for (const cut of cuts)
            expect.soft(cut.start, JSON.stringify(cut)).toBeGreaterThanOrEqual(cut.least - 0.5)
        })
      })

      test('no control the keyboard reaches stands under a rename’s words or a refusal', async ({
        page,
      }) => {
        const state = longSpaceWorld()
        await installSpaceWindowBackend(page, state)
        await openPortfolio(page, { width, height })
        await page.getByRole('button', { name: words.configure('LNG') }).click()
        const dialog = page.getByRole('dialog', { name: words.editTitle('LNG') })
        await expect(dialog.locator('[data-project]').first()).toBeVisible()
        await expect(dialog).toHaveCSS('transform', 'none')
        const name = dialog.getByLabel(words.name, { exact: true })
        const save = dialog.getByRole('button', { name: words.save })
        await name.fill('Long-running client programme, renamed')
        await expect(name).toHaveAccessibleDescription(new RegExp(words.renamed, 'u'))
        // The form is longer than the window, so the words over the buttons stand over some of it.
        expect(await bodyOverflows(dialog)).toBe(true)
        const covered = (stops: Awaited<ReturnType<typeof walkFocus>>) =>
          stops.filter((stop) => stop.covered > 0)
        // The name, the key, the default, eleven removes, «Add project», «New project from folder…».
        const renamed = await walkFocus(page, dialog, name)
        expect(renamed.length, JSON.stringify(renamed)).toBeGreaterThanOrEqual(15)
        expect.soft(covered(renamed), 'renamed, Tab').toEqual([])

        state.saveRefuses = 'name_taken'
        await save.click()
        await expect(dialog.getByRole('alert')).toHaveText(words.nameTaken)
        // Back from the foot's first button, «Remove space», into the end of the form.
        const back = await walkFocus(
          page,
          dialog,
          dialog.getByRole('button', { name: words.remove }),
          {
            back: true,
          },
        )
        expect(back.length, JSON.stringify(back)).toBeGreaterThanOrEqual(15)
        expect.soft(covered(back), 'refused, Shift+Tab from the foot').toEqual([])
        expect.soft(covered(await walkFocus(page, dialog, name)), 'refused, Tab').toEqual([])
      })

      for (const [world, key] of [
        [spaceWindowWorld, 'DRF'],
        [longSpaceWorld, 'LNG'],
      ] as const)
        test(`a rename of ${key} says what it changes over the buttons and moves no field`, async ({
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
          }
          await expect(dialog).toHaveCSS('transform', 'none')
          await name.click()
          const start = await boxes(parts)
          const saveAt = await topOf(save)
          // Nothing is said over the buttons yet, and no room stands there for it.
          const room = dialog.locator('[data-part="said"]')
          await expect(room).toHaveCount(0)
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
          await expect(room).toHaveCount(1)
          expectStill(await boxes(parts), start, 'renamed')
          // The buttons go down by the words, or stay where the window already stands its tallest.
          const savedAt = await topOf(save)
          expect.soft(savedAt, 'the buttons, renamed').toBeGreaterThanOrEqual(saveAt - 0.5)
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
          expect.soft(saidBox?.y ?? Number.NaN, 'over the buttons').toBeLessThan(savedAt)
          expect.soft(await seen(said), 'in sight').toBe(true)

          // The name given back takes the words away, and the buttons come back up.
          await name.fill(named)
          await expect(said).toHaveCount(0)
          await expect(room).toHaveCount(0)
          await expect(name).not.toHaveAccessibleDescription(new RegExp(words.renamed, 'u'))
          expectStill(await boxes(parts), start, 'named back')
          expect.soft(await topOf(save), 'the buttons, named back').toBeCloseTo(saveAt, 0)

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
        const start = await topOf(heading)
        await name.pressSequentially('Ёлка')
        await expect(key).toHaveAccessibleDescription(new RegExp(words.underivable, 'u'))
        expect.soft(await topOf(heading), 'no key from the name').toBeCloseTo(start, 1)
        for (const [typed, said] of [
          ['AB', words.keyHint('AB')],
          ['1', words.keyInvalid],
          ['WWWWWWWW', words.keyHint('WWWWWWWW')],
        ] as const) {
          await key.fill(typed)
          await expect(key).toHaveAccessibleDescription(said)
          expect.soft(await topOf(heading), `the key «${typed}»: ${said}`).toBeCloseTo(start, 1)
        }
      })
    })
  }
