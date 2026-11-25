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
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import {
  installSpaceWindowBackend,
  spaceRefOf as ref,
  spaceWindowWorld as world,
} from './spaceWindowBackend.ts'
import { describedText, measureDialog } from './spaceWindowMeasures.ts'
import { openPortfolio, SIZES, WORDS } from './spaceWindowPage.ts'
import { test } from './test.ts'

/** The space's choice and the menu after it share one line, and the menu stays in the bar. */
async function menuBesideChoice(page: Page) {
  const [bar, choice, menu] = await Promise.all(
    ['.context-bar', '[data-scope-choice="space"]', '[data-scope-choice="space-menu"]'].map(
      (selector) => page.locator(selector).boundingBox(),
    ),
  )
  const said = JSON.stringify({ bar, choice, menu })
  expect(bar && choice && menu, said).toBeTruthy()
  if (!bar || !choice || !menu) return
  expect(
    Math.abs(choice.y + choice.height / 2 - (menu.y + menu.height / 2)),
    said,
  ).toBeLessThanOrEqual(0.5)
  expect(menu.x - (choice.x + choice.width), said).toBeGreaterThan(0)
  expect(menu.x + menu.width, said).toBeLessThanOrEqual(bar.x + bar.width)
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

    test('the context bar’s menu creates a space anywhere and configures the main store’s chosen space', async ({
      page,
    }) => {
      const state = world()
      await installSpaceWindowBackend(page, state)
      await openPortfolio(page, size)
      const menu = page.getByRole('button', { name: words.menu, exact: true })
      await menuBesideChoice(page)
      // Over every space there is no chosen space to configure.
      await menu.click()
      await expect(page.getByRole('menuitem')).toHaveText([words.createEntry])
      await page.getByRole('menuitem', { name: words.createEntry }).click()
      const created = page.getByRole('dialog', { name: words.newSpace })
      await expect(created.getByLabel(words.name, { exact: true })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(created).toBeHidden()
      await expect(menu).toBeFocused()

      await page.goto(
        serializePlatformRoute({
          module_id: 'planning',
          scope: { kind: 'space', space_ref: ref('ATL') },
        }),
      )
      await expect(page.locator('[data-scope-choice="space"]')).toContainText('ATL')
      await menuBesideChoice(page)
      await menu.click()
      await expect(page.getByRole('menuitem')).toHaveText([words.createEntry, words.configureEntry])
      await page.getByRole('menuitem', { name: words.configureEntry }).click()
      const edited = page.getByRole('dialog', { name: words.editTitle('ATL') })
      await expect(edited.locator('[data-project]')).toHaveCount(2)
      await page.keyboard.press('Escape')
      await expect(edited).toBeHidden()
      expect(state.saves).toEqual([])
    })

    test('while the main store cannot be written the bar’s menu offers no way to write', async ({
      page,
    }) => {
      const state = world()
      state.writable = false
      await installSpaceWindowBackend(page, state)
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.goto(
        serializePlatformRoute({
          module_id: 'planning',
          scope: { kind: 'space', space_ref: ref('ATL') },
        }),
      )
      await expect(page.locator('[data-scope-choice="space"]')).toContainText('ATL')
      await page.getByRole('button', { name: words.menu, exact: true }).click()
      const create = page.getByRole('menuitem', { name: words.createEntry })
      await expect(page.getByRole('menuitem')).toHaveCount(1)
      await expect(create).toHaveAttribute('aria-disabled', 'true')
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
      // A screen reader announces it as unavailable, which `data-disabled` does not say.
      await expect(held).toHaveAttribute('aria-disabled', 'true')
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

    test('a removed project’s row hands the focus to the next remove, else the one before, else to the search', async ({
      page,
    }) => {
      await installSpaceWindowBackend(page, world())
      await openPortfolio(page, size)
      await page.getByRole('button', { name: words.configure('ATL') }).click()
      const dialog = page.getByRole('dialog', { name: words.editTitle('ATL') })
      const search = dialog.getByRole('combobox', { name: words.add })
      await search.click()
      await search.fill('light')
      await page.getByRole('option', { name: /lighthouse/u }).click()
      // By name: atlas-api, then the default atlas-web, which has no remove, then lighthouse.
      await expect(dialog.locator('[data-project]')).toHaveCount(3)
      const removeOf = (project: string) =>
        dialog.locator(`[data-project="${project}"] [data-part="remove"]`)
      const ringed = (project: string) =>
        removeOf(project).evaluate((node) => node.matches(':focus-visible'))

      // A press: the next remove takes the focus, past the default's row, and no ring.
      await removeOf('atlas-api').click()
      await expect(dialog.locator('[data-project="atlas-api"]')).toHaveCount(0)
      await expect(removeOf('lighthouse')).toBeFocused()
      expect(await ringed('lighthouse')).toBe(false)
      // A key on the last row: the one before takes it, ringed; alone, the default has a remove.
      await page.keyboard.press('Enter')
      await expect(dialog.locator('[data-project="lighthouse"]')).toHaveCount(0)
      await expect(removeOf('atlas-web')).toBeFocused()
      expect(await ringed('atlas-web')).toBe(true)
      // The last row: «Add project» takes it.
      await page.keyboard.press('Enter')
      await expect(dialog.locator('[data-project]')).toHaveCount(0)
      await expect(search).toBeFocused()
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
