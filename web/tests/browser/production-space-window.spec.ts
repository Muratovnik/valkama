/**
 * The space window in the real app, at 1280px, 620px and 390px, in English and in Russian.
 *
 * The oracle is the window's contract in DESIGN.md («The space window») and in the connection
 * contract («The owner's space window»): «New space» and each main-store card's «Configure
 * space» open it; a new space takes the server's key for its name, or says why a name gives
 * none; the default project has no remove while the space has others, and another space's
 * default that keeps others is offered but not choosable; a key stands as text once the space
 * has issued a number; only an empty space offers Remove, after a question; one save sends
 * the whole draft; a refusal keeps what was typed and says why in the reader's language, and
 * a creation whose binding the registry refused stays open as that space's edit, whose save
 * names the space. Each run checks that the window stays inside the window's width, prints
 * what it measured and keeps a picture.
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
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { record } from './analyticsPage.ts'
import { settledBox } from './editorPage.ts'
import { globalScope } from './planningFixtures.ts'
import {
  installSpaceWindowBackend,
  LONG_SPACE_NAMES,
  longFolderOf,
  longSpaceWorld,
  spaceRefOf as ref,
  UNPLACED_NAMES,
  unplacedWorld,
  spaceWindowWorld as world,
} from './spaceWindowBackend.ts'
import {
  describedText,
  gearOffsets,
  inView,
  measureDialog,
  measureFolders,
  measureUnplaced,
} from './spaceWindowMeasures.ts'
import { test } from './test.ts'

const SIZES = [
  { lang: 'en', width: 1280, height: 800 },
  { lang: 'en', width: 620, height: 800 },
  { lang: 'en', width: 390, height: 844 },
  { lang: 'ru', width: 1280, height: 800 },
  { lang: 'ru', width: 620, height: 800 },
  { lang: 'ru', width: 390, height: 844 },
] as const

const WORDS = {
  en: {
    newSpace: 'New space',
    configure: (key: string) => `Configure space ${key}`,
    configureWord: '«Configure space»',
    editTitle: (key: string) => `Space ${key}`,
    name: 'Name',
    key: 'Key',
    add: 'Add project',
    create: 'Create',
    save: 'Save',
    remove: 'Remove space',
    removeGo: 'Remove',
    retry: 'Retry binding',
    underivable: 'no key comes from this name',
    keyRule: /2 to 8 Latin letters/gu,
    renamed: 'will no longer find it',
    cancel: 'Cancel',
    nameTaken: 'Nothing was changed: another space already has this name.',
    fromFolder: 'New project from folder…',
    projectName: 'Project name',
    folder: 'Project folder',
    locked: 'does not change: it is in the numbers of its work items',
    held: 'unavailable: the default project of NW',
    keyTaken: 'Nothing was changed: another space already has this key.',
    busy: 'Space ATL was created; its projects were not bound: another command is writing the project registry right now; try again.',
  },
  ru: {
    newSpace: 'Новое пространство',
    configure: (key: string) => `Настроить пространство ${key}`,
    configureWord: '«Настроить пространство»',
    editTitle: (key: string) => `Пространство ${key}`,
    name: 'Название',
    key: 'Ключ',
    add: 'Добавить проект',
    create: 'Создать',
    save: 'Сохранить',
    remove: 'Удалить пространство',
    removeGo: 'Удалить',
    retry: 'Повторить привязку',
    underivable: 'из этого имени ключ не выводится',
    keyRule: /2–8 латинских букв/gu,
    renamed: 'перестанут его находить',
    cancel: 'Отмена',
    nameTaken: 'Ничего не изменено: это имя уже у другого пространства.',
    fromFolder: 'Новый проект по папке…',
    projectName: 'Название проекта',
    folder: 'Папка проекта',
    locked: 'не меняется: он в номерах задач',
    held: 'недоступно: основной проект NW',
    keyTaken: 'Ничего не изменено: этот ключ уже у другого пространства.',
    busy: 'Пространство ATL создано, проекты не привязаны: реестр проектов сейчас пишет другая команда; повторите.',
  },
} as const

async function openPortfolio(page: Page, size: (typeof SIZES)[number]) {
  await page.setViewportSize({ width: size.width, height: size.height })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: globalScope }))
  await expect(page.locator('[data-part="configure"]').first()).toBeVisible()
}

for (const size of SIZES) {
  const words = WORDS[size.lang]
  const tag = `${size.lang} ${size.width}`

  test.describe(`the space window, ${size.lang} at ${size.width}px`, () => {
    test.use({ locale: size.lang === 'ru' ? 'ru-RU' : 'en-US' })

    test('creates a space: a Cyrillic name gives no key, a typed one does, a project joins as the default', async ({
      page,
    }, info) => {
      const state = world()
      await installSpaceWindowBackend(page, state)
      await openPortfolio(page, size)
      await expect(page.locator('[data-part="unplaced"]')).toContainText('lighthouse')
      await page.locator('[data-part="new-space"]').click()
      const dialog = page.getByRole('dialog', { name: words.newSpace })
      await expect(dialog.getByLabel(words.name, { exact: true })).toBeFocused()
      await dialog.getByLabel(words.name, { exact: true }).fill('Атлас')
      await expect(dialog).toContainText(words.underivable)
      // The key's form is said once, by the reason: a hint that says it again is a second
      // sentence about one rule.
      const keyWords = await describedText(dialog.getByLabel(words.key, { exact: true }))
      expect(keyWords.match(words.keyRule), keyWords).toHaveLength(1)
      await expect(dialog.getByRole('button', { name: words.create })).toBeDisabled()
      await dialog.getByLabel(words.key, { exact: true }).fill('ats')
      await expect(dialog.getByLabel(words.key, { exact: true })).toHaveValue('ATS')
      await dialog.getByRole('combobox', { name: words.add }).click()
      await page.getByRole('option', { name: /lighthouse/u }).click()
      await expect(
        dialog.locator('[data-project="lighthouse"] [data-part="default"]'),
      ).toBeChecked()
      await expect(dialog.locator('[data-part="workflow"]')).toContainText('Delivery')
      await measureDialog(page, info, `create ${tag}`, size.width)
      await dialog.getByRole('button', { name: words.create }).click()
      await expect(dialog).toBeHidden()
      expect(state.saves).toEqual([
        {
          name: 'Атлас',
          key: 'ATS',
          projects: [{ project_id: 'lighthouse', default: true }],
          new_projects: [],
          author: 'user',
        },
      ])
      // The shell follows the new space: the bar names it.
      await expect(page.locator('[data-scope-choice="space"]')).toContainText('ATS')
    })

    test('a key another space has is refused, and the window keeps what was typed', async ({
      page,
    }) => {
      const state = world()
      await installSpaceWindowBackend(page, state)
      await openPortfolio(page, size)
      await page.locator('[data-part="new-space"]').click()
      const dialog = page.getByRole('dialog', { name: words.newSpace })
      await dialog.getByLabel(words.name, { exact: true }).fill('Northwind two')
      await dialog.getByLabel(words.key, { exact: true }).fill('NW')
      await dialog.getByRole('button', { name: words.create }).click()
      await expect(dialog.getByRole('alert')).toHaveText(words.keyTaken)
      await expect(dialog.getByLabel(words.name, { exact: true })).toHaveValue('Northwind two')
      expect(state.spaces.map((space) => space.key)).toEqual(['ATL', 'NW', 'DRF'])
    })

    test('edits a space: renames it, adds and removes a project, changes the default', async ({
      page,
    }, info) => {
      const state = world()
      await installSpaceWindowBackend(page, state)
      await openPortfolio(page, size)
      await page.getByRole('button', { name: words.configure('ATL') }).click()
      const dialog = page.getByRole('dialog', { name: words.editTitle('ATL') })
      await expect(dialog.locator('[data-project]')).toHaveCount(2)
      // The key is in the numbers of the space's work, so it stands as text.
      await expect(dialog.locator('[data-part="key-locked"]')).toContainText(words.locked)
      await expect(dialog.getByLabel(words.key, { exact: true })).toHaveCount(0)
      // The default has no remove while the space has another project.
      await expect(dialog.locator('[data-project="atlas-web"] [data-part="remove"]')).toHaveCount(0)
      await expect(dialog.getByRole('button', { name: words.remove })).toHaveCount(0)
      await expect(dialog.getByRole('button', { name: words.save })).toBeDisabled()

      const name = dialog.getByLabel(words.name, { exact: true })
      expect(await describedText(name)).not.toContain(words.renamed)
      await name.fill('Atlas works')
      await expect(name).toHaveAccessibleDescription(new RegExp(words.renamed, 'u'))
      const search = dialog.getByRole('combobox', { name: words.add })
      await search.click()
      // Another space's default, which that space keeps others beside, is offered with its
      // reason and cannot be chosen: Enter on it alone adds nothing, beside a press that adds
      // lighthouse.
      const held = page.getByRole('option', { name: /nw-app/u })
      await expect(held).toContainText(words.held)
      await expect(held).toHaveAttribute('data-disabled', '')
      await search.fill('nw-app')
      await expect(page.getByRole('option')).toHaveCount(1)
      await search.press('Enter')
      await expect(dialog.locator('[data-project="nw-app"]')).toHaveCount(0)
      await search.fill('light')
      await page.getByRole('option', { name: /lighthouse/u }).click()
      await expect(dialog.locator('[data-project="lighthouse"]')).toHaveCount(1)
      await dialog.locator('[data-project="atlas-api"] [data-part="default"]').check()
      await dialog.locator('[data-project="atlas-web"] [data-part="remove"]').click()
      await expect(dialog.locator('[data-project]')).toHaveCount(2)
      await measureDialog(page, info, `edit ${tag}`, size.width)
      await dialog.getByRole('button', { name: words.save }).click()
      await expect(dialog).toBeHidden()
      expect(state.saves).toEqual([
        {
          space: ref('ATL'),
          name: 'Atlas works',
          key: 'ATL',
          projects: [
            { project_id: 'atlas-api', default: true },
            { project_id: 'lighthouse', default: false },
          ],
          new_projects: [],
          author: 'user',
        },
      ])
      // The page reads the registry again: lighthouse is in a space now, atlas-web in none.
      await expect(page.locator('[data-part="unplaced"]')).toContainText('atlas-web')
      await expect(page.locator('[data-part="unplaced"]')).not.toContainText('lighthouse')
    })

    test('changes the key of a space that has issued no number, then removes the empty space', async ({
      page,
    }, info) => {
      const state = world()
      await installSpaceWindowBackend(page, state)
      await openPortfolio(page, size)
      await page.getByRole('button', { name: words.configure('DRF') }).click()
      let dialog = page.getByRole('dialog', { name: words.editTitle('DRF') })
      const key = dialog.getByLabel(words.key, { exact: true })
      await expect(key).toHaveValue('DRF')
      await key.fill('DRAFT')
      await dialog.getByRole('button', { name: words.save }).click()
      await expect(dialog).toBeHidden()
      expect(state.saves.at(-1)).toEqual({
        space: ref('DRF'),
        name: 'Drafts',
        key: 'DRAFT',
        projects: [],
        new_projects: [],
        author: 'user',
      })
      await page.getByRole('button', { name: words.configure('DRAFT') }).click()
      dialog = page.getByRole('dialog', { name: words.editTitle('DRAFT') })
      await dialog.getByRole('button', { name: words.remove }).click()
      // The question is asked in the window before anything is removed.
      expect(state.saves).toHaveLength(1)
      await measureDialog(page, info, `remove ${tag}`, size.width)
      await dialog.getByRole('button', { name: words.removeGo, exact: true }).click()
      await expect(dialog).toBeHidden()
      expect(state.saves.at(-1)).toEqual({ space: ref('DRAFT'), remove: true, author: 'user' })
      await expect(page.getByRole('button', { name: words.configure('DRAFT') })).toHaveCount(0)
    })

    test('a creation whose binding the registry refused stays open as that space’s edit', async ({
      page,
    }, info) => {
      const state = world()
      state.spaces = state.spaces.filter((space) => space.key !== 'ATL')
      state.registryRefuses = 'busy'
      await installSpaceWindowBackend(page, state)
      await openPortfolio(page, size)
      await page.locator('[data-part="new-space"]').click()
      const dialog = page.getByRole('dialog', { name: words.newSpace })
      await dialog.getByLabel(words.name, { exact: true }).fill('Atlas')
      await expect(dialog.getByLabel(words.key, { exact: true })).toHaveValue('ATL')
      await dialog.getByRole('combobox', { name: words.add }).click()
      await page.getByRole('option', { name: /lighthouse/u }).click()
      await dialog.getByRole('button', { name: words.create }).click()
      const edit = page.getByRole('dialog', { name: words.editTitle('ATL') })
      await expect(edit.locator('[data-part="notice"]')).toHaveText(words.busy)
      await expect(edit.locator('[data-project="lighthouse"]')).toHaveCount(1)
      await measureDialog(page, info, `refused ${tag}`, size.width)
      await edit.getByRole('button', { name: words.retry }).click()
      await expect(edit).toBeHidden()
      expect(state.saves).toHaveLength(2)
      expect(state.saves[1]).toEqual({
        space: ref('ATL'),
        name: 'Atlas',
        key: 'ATL',
        projects: [{ project_id: 'lighthouse', default: true }],
        new_projects: [],
        author: 'user',
      })
      expect(state.spaces.filter((space) => space.key === 'ATL')).toHaveLength(1)
    })

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
