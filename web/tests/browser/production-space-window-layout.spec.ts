/**
 * The space window's layout in the real app with long names, at 1280px, 620px and 390px, in
 * English and in Russian, by the window's contract in DESIGN.md («The space window»).
 *
 * A space of long names holds the layout to the same contract: its rows by name, each row's
 * folder given room and its last folder whole, the radio on the name's first line, the way out
 * and the save on one line, a rename that moves no field, a refusal seen with nothing scrolled,
 * a search that finds a name before a folder and keeps every path inside its option. Under the
 * cards, and under the empty state too, the projects in no space keep each name on one line,
 * apart from the next, and stand further from the cards than the page's head does; each card's
 * gear stands where its title starts. Those measurements are soft, so one run reports every one
 * of them that fails.
 *
 * The server is `spaceWindowBackend.ts`'s double, which changes its spaces and projects as
 * the real save does.
 */
import { expect } from '@playwright/test'

import { record } from './analyticsPage.ts'
import { settledBox } from './editorPage.ts'
import {
  installSpaceWindowBackend,
  LONG_SPACE_NAMES,
  longFolderOf,
  longSpaceWorld,
  UNPLACED_NAMES,
  unplacedWorld,
} from './spaceWindowBackend.ts'
import {
  gearOffsets,
  inView,
  measureDialog,
  measureFolders,
  measureUnplaced,
} from './spaceWindowMeasures.ts'
import { openPortfolio, SIZES, WORDS } from './spaceWindowPage.ts'
import { test } from './test.ts'

for (const size of SIZES) {
  const words = WORDS[size.lang]
  const tag = `${size.lang} ${size.width}`

  test.describe(`the space window with long names, ${size.lang} at ${size.width}px`, () => {
    test.use({ locale: size.lang === 'ru' ? 'ru-RU' : 'en-US' })

    test('a space of long names: each row shows its own folder, a rename moves nothing, a refusal is seen', async ({
      page,
    }, info) => {
      const state = longSpaceWorld()
      await installSpaceWindowBackend(page, state)
      await openPortfolio(page, size)
      await page.getByRole('button', { name: words.configure('LNG') }).click()
      const dialog = page.getByRole('dialog', { name: words.editTitle('LNG') })
      const rows = dialog.locator('[data-project]')
      await expect(rows).toHaveCount(LONG_SPACE_NAMES.length)
      // The rows stand by name, whatever order the projects joined in.
      await expect.soft(rows.locator('[data-part="name"]')).toHaveText([...LONG_SPACE_NAMES])
      // A long name takes no row's folder: each folder has room, and its last folder, the one
      // that tells the rows apart, stands whole inside it.
      const folders = await measureFolders(dialog)
      expect(folders).toHaveLength(LONG_SPACE_NAMES.length)
      for (const folder of folders) {
        expect.soft(folder.tail, JSON.stringify(folder)).toContain(`/${longFolderOf(folder.name)}`)
        expect.soft(folder.width, JSON.stringify(folder)).toBeGreaterThan(0)
        expect.soft(folder.tailWidth, JSON.stringify(folder)).toBeGreaterThan(0)
        expect.soft(folder.tailCut, JSON.stringify(folder)).toBeLessThanOrEqual(0)
        expect.soft(folder.tailPast, JSON.stringify(folder)).toBeLessThanOrEqual(0.5)
      }
      // The way out and the save stand on one line, beside Remove or under it, read once the
      // window has come to rest. The head's sign that closes the window carries the way out's
      // name too, and comes first.
      await settledBox(dialog)
      const cancel = await dialog
        .getByRole('button', { name: words.cancel, exact: true })
        .last()
        .boundingBox()
      const save = await dialog.getByRole('button', { name: words.save }).boundingBox()
      expect
        .soft(Math.abs((cancel?.y ?? 0) - (save?.y ?? Number.NaN)), JSON.stringify([cancel, save]))
        .toBeLessThanOrEqual(1)

      // What a new name changes is said without moving the fields under it.
      const keyField = dialog.getByLabel(words.key, { exact: true })
      const keyBefore = await settledBox(keyField)
      await dialog
        .getByLabel(words.name, { exact: true })
        .fill('Long-running client programme, renamed')
      await expect
        .soft(dialog.getByLabel(words.name, { exact: true }))
        .toHaveAccessibleDescription(new RegExp(words.renamed, 'u'))
      const keyAfter = await settledBox(keyField)
      expect
        .soft(keyAfter?.y, JSON.stringify([keyBefore, keyAfter]))
        .toBeCloseTo(keyBefore?.y ?? Number.NaN, 0)

      // A refused save says why where the reader looks, with nothing scrolled.
      state.saveRefuses = 'name_taken'
      await dialog.getByRole('button', { name: words.save }).click()
      const alert = dialog.getByRole('alert')
      await expect(alert).toHaveText(words.nameTaken)
      const seen = await inView(alert)
      expect.soft(seen.seen, JSON.stringify(seen)).toBe(true)
      await record(info, `space window refusal ${tag}`, seen)
      // The radio on each name's first line, the folders at one edge, nothing past the window.
      await measureDialog(page, info, `long ${tag}`, size.width)
    })

    test('«Add project» finds a name before a folder, and keeps every path inside its option', async ({
      page,
    }) => {
      const state = longSpaceWorld()
      await installSpaceWindowBackend(page, state)
      await openPortfolio(page, size)
      await page.getByRole('button', { name: words.configure('LNG') }).click()
      const dialog = page.getByRole('dialog', { name: words.editTitle('LNG') })
      const search = dialog.getByRole('combobox', { name: words.add })
      await search.click()
      const options = page.getByRole('option')
      await expect(options.first()).toBeVisible()
      const boxes = await options.evaluateAll((all) =>
        all.map((option) => {
          const box = option.getBoundingClientRect()
          // The lines of its words as laid out, which run on past a box that cannot hold them.
          const words = document.createRange()
          words.selectNodeContents(option)
          const lines = [...words.getClientRects()].filter((line) => line.width > 0)
          return {
            text: option.textContent.slice(0, 60),
            right: box.right,
            lines: lines.length,
            past: Math.max(...lines.map((line) => line.right)) - box.right,
            sideways: option.scrollWidth - option.clientWidth,
          }
        }),
      )
      // Every registered project outside the space: those of ATL and NW, and the two in none.
      expect(boxes).toHaveLength(7)
      for (const box of boxes) {
        expect.soft(box.lines, JSON.stringify(box)).toBeGreaterThan(0)
        expect.soft(box.past, JSON.stringify(box)).toBeLessThanOrEqual(0.5)
        expect.soft(box.sideways, JSON.stringify(box)).toBeLessThanOrEqual(0)
        expect.soft(box.right, JSON.stringify(box)).toBeLessThanOrEqual(size.width)
      }
      // «lighthouse» is two projects' names and a third's folder: the names come first, the
      // one in no space before the other.
      await search.fill('lighthouse')
      await expect(options).toHaveCount(3)
      await expect.soft(options.nth(0)).toHaveText(/^lighthouse(?! app)/u)
      await expect.soft(options.nth(1)).toHaveText(/^Lighthouse app/u)
      await expect.soft(options.nth(2)).toHaveText(/^Harbor docs/u)
      await search.press('Escape')

      // A folder of a Cyrillic name gives the project that name.
      await dialog.getByRole('button', { name: words.fromFolder }).click()
      await dialog.getByLabel(words.folder, { exact: true }).fill('D:\\work\\Новый проект')
      await expect
        .soft(dialog.getByLabel(words.projectName, { exact: true }))
        .toHaveValue('Новый проект')
    })

    test('the projects in no space keep each name whole and stand apart from the cards, also under the empty state', async ({
      page,
    }, info) => {
      await installSpaceWindowBackend(page, unplacedWorld())
      await openPortfolio(page, size)
      // Each card's gear stands on the card's text edge, where its title starts.
      for (const offset of await gearOffsets(page)) expect.soft(Math.abs(offset)).toBeLessThan(1)
      const strip = await measureUnplaced(page, UNPLACED_NAMES)
      await record(info, `unplaced ${tag}`, strip)
      for (const name of UNPLACED_NAMES) expect.soft(strip.lines[name], name).toBe(1)
      expect.soft(strip.seen).toContain(UNPLACED_NAMES.join(', '))
      expect.soft(strip.fromCards, JSON.stringify(strip)).toBeGreaterThan(strip.pageGap)

      // A store with no space yet names them under «Create a space», with no word of a card's
      // «Configure space», which is not there.
      await page.unrouteAll({ behavior: 'ignoreErrors' })
      await installSpaceWindowBackend(page, unplacedWorld(true))
      await page.reload()
      await expect(page.locator('[data-part="create-first"]')).toBeVisible()
      const empty = page.locator('[data-part="unplaced"]')
      await expect.soft(empty).toContainText(UNPLACED_NAMES.join(', '))
      await expect.soft(empty).not.toContainText(words.configureWord)
    })
  })
}
