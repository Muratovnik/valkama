/**
 * A control a dialog disables while a save or a create waits gets the focus back once the wait
 * ends (DESIGN.md, «Dialogs and drawers»): Chrome takes focus off a control disabled under it,
 * to the page, and a refused save left it there, so the next Tab went to Cancel. It stays
 * disabled while it waits, so a second press sends nothing.
 *
 * Read in the window of a space with eleven projects, saved from its Save and from its default
 * project's choice with Enter, and in «New work», created from its description with Ctrl+Enter,
 * at a desktop's and a narrow window's widths, in both languages. Served
 * `spaceWindowBackend.ts`'s double and `served/graphSpaceFrames.ts`.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { frames } from './frames.ts'
import { focusedByKey, holdBack, onThePage } from './heldWrite.ts'
import { spaceScope } from './planningFixtures.ts'
import { ITEMS, spaceFramesRead } from './served/graphSpaceFrames.ts'
import { spaceAnswer } from './servedAnswers.ts'
import {
  installSpaceWindowBackend,
  LONG_SPACE_NAMES,
  longSpaceWorld,
} from './spaceWindowBackend.ts'
import { openPortfolio, WORDS } from './spaceWindowPage.ts'
import { test } from './test.ts'

for (const { width, height } of [
  { width: 1280, height: 800 },
  { width: 620, height: 800 },
] as const)
  for (const lang of ['en', 'ru'] as const)
    test.describe(`the window of a long space at ${String(width)} in ${lang}`, () => {
      test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })
      const words = WORDS[lang]

      /** The space's window, renamed so it can be saved, its save held back and refused. */
      async function openRenamed(page: Page) {
        const state = longSpaceWorld()
        await installSpaceWindowBackend(page, state)
        const { held, release } = holdBack()
        await page.route('**/api/planning/space/save', async (route) => {
          await held
          await route.fallback()
        })
        await openPortfolio(page, { width, height })
        await page.getByRole('button', { name: words.configure('LNG') }).click()
        const dialog = page.getByRole('dialog', { name: words.editTitle('LNG') })
        await expect(dialog.locator('[data-project]').first()).toBeVisible()
        await expect(dialog).toHaveCSS('transform', 'none')
        await dialog
          .getByLabel(words.name, { exact: true })
          .fill('Long-running client programme, renamed')
        state.saveRefuses = 'name_taken'
        return { dialog, state, release }
      }

      test('Save pressed from the keyboard has the focus back once its save is refused', async ({
        page,
      }) => {
        const { dialog, state, release } = await openRenamed(page)
        const save = dialog.getByRole('button', { name: words.save, exact: true })
        await save.focus()
        await page.keyboard.press('Enter')
        await expect(save).toBeDisabled()
        await onThePage(page)
        // A second press while it waits sends nothing.
        await page.keyboard.press('Enter')

        release()
        await expect(dialog.getByRole('alert')).toHaveText(words.nameTaken)
        await frames(dialog)
        await focusedByKey(save)
        expect(state.saves).toHaveLength(1)
      })

      test('the default project’s choice, saved with Enter, has the focus back once refused', async ({
        page,
      }) => {
        const { dialog, state, release } = await openRenamed(page)
        const choice = dialog.getByRole('radio', { name: LONG_SPACE_NAMES[0], exact: true })
        await choice.focus()
        await expect(choice).toBeChecked()
        await page.keyboard.press('Enter')
        await expect(choice).toBeDisabled()
        await onThePage(page)

        release()
        await expect(dialog.getByRole('alert')).toHaveText(words.nameTaken)
        await frames(dialog)
        await focusedByKey(choice)
        await expect(choice).toBeChecked()
        expect(state.saves).toHaveLength(1)
      })
    })

/** What «New work» is called and says, in each language. */
const COMPOSER = {
  'ru-RU': {
    open: 'Новая работа',
    dialog: 'Новая работа',
    title: 'Название',
    description: 'Описание',
    noAnswer: 'Работа не создана: сервер не ответил. Введённое сохранено — попробуйте ещё раз.',
  },
  'en-US': {
    open: 'New work item',
    dialog: 'New work',
    title: 'Title',
    description: 'Description',
    noAnswer:
      'The work was not created: the server did not answer. What you typed is kept; try again.',
  },
} as const

for (const width of [1280, 620] as const)
  for (const locale of ['ru-RU', 'en-US'] as const)
    test.describe(`«New work» at ${String(width)} in ${locale}`, () => {
      test.use({ locale })

      test('a description sent with Ctrl+Enter has the focus and its caret back once refused', async ({
        page,
      }) => {
        const words = COMPOSER[locale]
        await page.setViewportSize({ width, height: 800 })
        await installBackend(page)
        await page.route('**/api/planning?*', (route) =>
          route.fulfill(
            spaceAnswer(new URL(route.request().url()).searchParams, (model) => ({
              ...spaceFramesRead(ITEMS),
              planning_space: model.planning_space,
            })),
          ),
        )
        const { held, release } = holdBack()
        let creates = 0
        await page.route('**/api/planning/work-items', async (route) => {
          creates += 1
          await held
          await route.fulfill({ status: 503, body: '' })
        })
        await page.goto(serializePlatformRoute({ module_id: 'planning', scope: spaceScope }))
        await page.getByRole('button', { name: words.open, exact: true }).first().click()
        const dialog = page.getByRole('dialog', { name: words.dialog })
        await expect(dialog).toHaveCSS('transform', 'none')
        await dialog.getByRole('textbox', { name: words.title }).fill('Rehearse the restore')
        const field = dialog.getByRole('textbox', { name: words.description, exact: true })
        await field.fill('Stop the service.\nCopy the store aside.')
        // The caret after «Stop the service.», where the reader stopped typing.
        await field.press('Control+Home')
        await field.press('End')
        await page.keyboard.press('Control+Enter')
        await expect(field).toBeDisabled()
        await onThePage(page)

        release()
        await expect(dialog.getByRole('alert')).toHaveText(words.noAnswer)
        await frames(dialog)
        await expect(field).toBeFocused()
        const caret = await field.evaluate((node) => {
          const area = node as HTMLTextAreaElement
          return [area.selectionStart, area.selectionEnd]
        })
        expect(caret).toEqual(['Stop the service.'.length, 'Stop the service.'.length])
        expect(creates).toBe(1)
      })
    })
