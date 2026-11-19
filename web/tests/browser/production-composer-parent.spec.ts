/**
 * The window «Новая работа» at the widths it is drawn at: a desktop's, a narrow window's and
 * a phone's, a phone's in both languages.
 *
 * Its parent is chosen from every goal and stage of the space, at any depth: a stage five
 * levels down is found by its title, with the path above it in its note, and is sent as the
 * parent; another space's goal is not offered. A space with no goal or stage offers «Без
 * цели» alone. A write the server did not answer keeps everything typed and says, below the
 * fields and in the window's own words, that the work was not created, never `HTTP 503`.
 *
 * Served `served/graphSpaceFrames.ts`.
 */
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { spaceScope, workItem } from './planningFixtures.ts'
import { ITEMS, spaceFramesRead } from './served/graphSpaceFrames.ts'
import { spaceAnswer } from './servedAnswers.ts'
import { test } from './test.ts'

const BOARD = serializePlatformRoute({ module_id: 'planning', scope: spaceScope })
const DEEPEST = 'MAIN-1005 · Stage 1005'
const PATH = 'MAIN-1001 › MAIN-1002 › MAIN-1003 › MAIN-1004'

/** What the window is called and says, in each language. */
const WORDS = {
  'ru-RU': {
    open: 'Новая работа',
    dialog: 'Новая работа',
    title: 'Название',
    parent: 'Родитель',
    noGoal: 'Без цели',
    noMatch: 'Такого родителя нет',
    progress: 'В работе',
    noAnswer: 'Работа не создана: сервер не ответил. Введённое сохранено — попробуйте ещё раз.',
  },
  'en-US': {
    open: 'New work item',
    dialog: 'New work',
    title: 'Title',
    parent: 'Parent',
    noGoal: 'No goal',
    noMatch: 'No parent matches',
    progress: 'In progress',
    noAnswer:
      'The work was not created: the server did not answer. What you typed is kept; try again.',
  },
} as const

type Locale = keyof typeof WORDS

/** The board over `items`, its create answered by `answer`, and the window opened on it. */
async function openWindow(
  page: Page,
  width: number,
  locale: Locale,
  { items = ITEMS, answer = 200 }: { answer?: number; items?: readonly object[] } = {},
) {
  await page.setViewportSize({ width, height: width > 600 ? 900 : 844 })
  await installBackend(page)
  await page.route('**/api/planning?*', (route) =>
    route.fulfill(spaceAnswer(new URL(route.request().url()).searchParams, spaceFramesRead(items))),
  )
  const sent: Record<string, unknown>[] = []
  await page.route('**/api/planning/work-items', (route) => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>)
    return answer === 200
      ? route.fulfill({ json: workItem })
      : route.fulfill({ status: answer, body: '' })
  })
  await page.goto(BOARD)
  const words = WORDS[locale]
  await page.getByRole('button', { name: words.open, exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: words.dialog })
  await expect(dialog).toHaveCSS('transform', 'none')
  return { dialog, sent, words }
}

async function shoot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`) })
}

for (const { width, locale } of [
  { width: 1280, locale: 'ru-RU' },
  { width: 620, locale: 'ru-RU' },
  { width: 390, locale: 'ru-RU' },
  { width: 390, locale: 'en-US' },
] as const) {
  test.describe(`at ${width}px in ${locale}`, () => {
    test.use({ locale })

    test('finds a stage five levels down and sends it as the parent', async ({ page }, info) => {
      const { dialog, sent, words } = await openWindow(page, width, locale)
      await dialog.getByRole('textbox', { name: words.title }).fill('Rehearse the restore')
      const parent = dialog.getByRole('combobox', { name: words.parent, exact: true })
      await expect(parent).toHaveValue(words.noGoal)
      const list = page.getByRole('listbox', { name: words.parent })

      // Another space's goal holds work only in its own space.
      await parent.click()
      await page.keyboard.type('ALPHA')
      await expect(list.getByRole('option')).toHaveCount(0)
      await expect(page.getByText(words.noMatch)).toBeVisible()

      await parent.fill('Stage 1005')
      await expect(list.getByRole('option')).toHaveText([`${DEEPEST}${PATH} · ${words.progress}`])
      // The option stands whole in the list, which stands within the window's width.
      const [listBox, windowBox] = await Promise.all([list.boundingBox(), dialog.boundingBox()])
      expect(listBox && windowBox && listBox.x + listBox.width).toBeLessThanOrEqual(
        (windowBox?.x ?? 0) + (windowBox?.width ?? 0) + 0.5,
      )
      await shoot(page, info, `new-work-${width}-parent-search-${locale}`)

      await page.keyboard.press('Enter')
      await expect(parent).toHaveValue(DEEPEST)
      await dialog.getByRole('button', { name: words.open, exact: true }).click()
      await expect(dialog).toHaveCount(0)
      expect(sent).toEqual([
        expect.objectContaining({ title: 'Rehearse the restore', parent: 'MAIN-1005' }),
      ])
    })

    test('offers «Без цели» alone where the space has no goal or stage', async ({ page }) => {
      const tasks = ITEMS.filter((item) => item.kind === 'task').map((item) => ({
        ...item,
        parent_id: null,
      }))
      const { dialog, words } = await openWindow(page, width, locale, { items: tasks })
      const parent = dialog.getByRole('combobox', { name: words.parent, exact: true })
      await parent.click()
      await expect(
        page.getByRole('listbox', { name: words.parent }).getByRole('option'),
      ).toHaveText([words.noGoal])
    })

    test('keeps what was typed when the server does not answer, and says so', async ({
      page,
    }, info) => {
      const { dialog, sent, words } = await openWindow(page, width, locale, { answer: 503 })
      const title = dialog.getByRole('textbox', { name: words.title })
      await title.fill('Rehearse the restore')
      const parent = dialog.getByRole('combobox', { name: words.parent, exact: true })
      await parent.click()
      await page.keyboard.type('Stage 1005')
      await page.keyboard.press('Enter')
      await dialog.locator('textarea').fill('Steps in the runbook.')
      await dialog.getByRole('button', { name: words.open, exact: true }).click()

      const reason = dialog.locator('.dialog-frame-error')
      await expect(reason).toHaveText(words.noAnswer)
      await expect(reason).not.toContainText('HTTP')
      expect(sent).toHaveLength(1)
      await expect(title).toHaveValue('Rehearse the restore')
      await expect(parent).toHaveValue(DEEPEST)
      await expect(dialog.locator('textarea')).toHaveValue('Steps in the runbook.')
      // The reason stands below the fields, inside the window, whole.
      const [reasonBox, windowBox] = await Promise.all([reason.boundingBox(), dialog.boundingBox()])
      expect(reasonBox).not.toBeNull()
      expect((reasonBox?.x ?? 0) + (reasonBox?.width ?? 0)).toBeLessThanOrEqual(
        (windowBox?.x ?? 0) + (windowBox?.width ?? 0) + 0.5,
      )
      expect(await reason.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
      await shoot(page, info, `new-work-${width}-write-failed-${locale}`)
    })
  })
}
