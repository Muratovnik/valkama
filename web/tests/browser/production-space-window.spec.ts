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
 * The server is `spaceWindowBackend.ts`'s double, which changes its spaces and projects as
 * the real save does.
 */
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { record } from './analyticsPage.ts'
import { globalScope } from './planningFixtures.ts'
import {
  installSpaceWindowBackend,
  spaceRefOf as ref,
  spaceWindowWorld as world,
} from './spaceWindowBackend.ts'
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
    renamed: 'will no longer find it',
    locked: 'does not change: it is in the numbers of its work items',
    held: 'unavailable: the default project of NW',
    keyTaken: 'Nothing was changed: another space already has this key.',
    busy: 'Space ATL was created; its projects were not bound: another command is writing the project registry right now; try again.',
  },
  ru: {
    newSpace: 'Новое пространство',
    configure: (key: string) => `Настроить пространство ${key}`,
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
    renamed: 'перестанут его находить',
    locked: 'не меняется: он в номерах задач',
    held: 'недоступно: основной проект NW',
    keyTaken: 'Ничего не изменено: этот ключ уже у другого пространства.',
    busy: 'Пространство ATL создано, проекты не привязаны: реестр проектов сейчас пишет другая команда; повторите.',
  },
} as const

/** How far apart the farthest of these edges are. */
const spread = (edges: number[]) => (edges.length ? Math.max(...edges) - Math.min(...edges) : 0)

/** The open dialog stays inside the window, and nothing in it runs past its own width. */
async function measureDialog(page: Page, info: TestInfo, tag: string, width: number) {
  const box = await page.getByRole('dialog').evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect()
    const body = dialog.querySelector('.dialog-frame-body')
    const names = [...dialog.querySelectorAll('[data-part="name"]')].map((name) => ({
      text: name.textContent.trim(),
      cut: name.scrollWidth - name.clientWidth,
    }))
    return {
      left: rect.left,
      right: rect.right,
      sideways: body ? body.scrollWidth - body.clientWidth : Number.NaN,
      names,
      rows: [...dialog.querySelectorAll('[data-project]')].map((row) => {
        const edge = (part: string) =>
          row.querySelector(`[data-part="${part}"]`)?.getBoundingClientRect()
        const name = row.querySelector('[data-part="name"]')
        const line = document.createRange()
        if (name?.firstChild) line.setStart(name.firstChild, 0)
        if (name?.firstChild) line.setEnd(name.firstChild, 1)
        const first = line.getBoundingClientRect()
        const radio = edge('default')
        return {
          name: edge('name')?.left ?? Number.NaN,
          root: edge('root')?.left ?? Number.NaN,
          radioOffLine: radio
            ? Math.abs(radio.top + radio.height / 2 - (first.top + first.height / 2))
            : 0,
          removeOver: (edge('remove')?.height ?? 0) - row.getBoundingClientRect().height,
        }
      }),
    }
  })
  expect(box.left, JSON.stringify(box)).toBeGreaterThanOrEqual(0)
  expect(box.right, JSON.stringify(box)).toBeLessThanOrEqual(width)
  expect(box.sideways, JSON.stringify(box)).toBeLessThanOrEqual(0)
  expect(box.names.filter((name) => name.cut > 0.5)).toEqual([])
  // The rows' names and folders each start at one edge, the radio sits on the name's first
  // line and the remove is no taller than its row.
  expect(spread(box.rows.map((row) => row.name)), JSON.stringify(box.rows)).toBeLessThanOrEqual(1)
  expect(spread(box.rows.map((row) => row.root)), JSON.stringify(box.rows)).toBeLessThanOrEqual(1)
  for (const row of box.rows) {
    expect(row.radioOffLine, JSON.stringify(row)).toBeLessThanOrEqual(1)
    expect(row.removeOver, JSON.stringify(row)).toBeLessThanOrEqual(0)
  }
  await page.screenshot({
    path: info.outputPath(`space-window-${tag}.png`),
    animations: 'disabled',
  })
  await record(info, `space window ${tag}`, box)
}

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

      await dialog.getByLabel(words.name, { exact: true }).fill('Atlas works')
      await expect(dialog).toContainText(words.renamed)
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
  })
}
