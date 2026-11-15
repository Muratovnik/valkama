/**
 * The Work header's view menu as the saved-view specs drive it: the space the read answers, its
 * address, the menu's words in each language, and the menu opened, chosen from and listed.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { boardSpace } from './boardFixtures.ts'
import { dataScopeId, projectScope, spaceRef } from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'

export const WORDS = {
  en: {
    menu: 'View',
    grouping: 'By goal',
    flat: 'No grouping',
    save: 'Save view…',
    name: 'Name',
    confirm: 'Save',
    delete: (name: string) => `Delete view “${name}”`,
    dropped: (name: string) => `Removed a view with values this version does not know: “${name}”`,
    filter: 'Filter work',
    ready: 'Workable',
    held: 'Has an assignee',
    list: 'List',
    // What stood in the header before, as buttons of its own.
    gone: ['Workable', 'Assigned', 'Has a holder', 'By goal', 'Group the board by goal'],
  },
  ru: {
    menu: 'Вид',
    grouping: 'По цели',
    flat: 'Без группировки',
    save: 'Сохранить вид…',
    name: 'Название',
    confirm: 'Сохранить',
    delete: (name: string) => `Удалить вид «${name}»`,
    dropped: (name: string) => `Убран вид со значениями, которых эта версия не знает: «${name}»`,
    filter: 'Фильтр работы',
    ready: 'Можно брать',
    held: 'Есть исполнитель',
    list: 'Список',
    gone: [
      'Можно брать',
      'Назначено',
      'Есть ответственный',
      'По цели',
      'Группировать доску по эпикам',
    ],
  },
} as const

export type Locale = keyof typeof WORDS

/** The space's work as the read answers it: the shared fixture and the board's goals. */
export async function seed(page: Page, locale: Locale, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.addInitScript((language) => localStorage.setItem('valkama-locale', language), locale)
  await installBackend(page, { includeAttachedDuplicate: true })
  await page.route('**/api/planning?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    const response = planningReadFor(query, true)
    if (
      response.status === 200 &&
      'work_items' in response.body &&
      query.get('data_scope_id') === dataScopeId
    )
      response.body.work_items = [...response.body.work_items, ...(boardSpace() as never[])]
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

export const spaceRoute = (space = spaceRef, state: Record<string, string> = {}) =>
  serializePlatformRoute({
    module_id: 'planning',
    scope: projectScope,
    entity: planningSpaceEntity(space),
    state: { view: 'kanban', ...state },
  })

export async function openSpace(page: Page, space = spaceRef, state: Record<string, string> = {}) {
  await page.goto(spaceRoute(space, state))
  await expect(page.locator('.workspace-head')).toBeVisible()
  await expect(page.locator('[data-reference]').first()).toBeVisible()
}

export const menuButton = (page: Page, locale: Locale) =>
  page.locator('.workspace-head').getByRole('button', { name: WORDS[locale].menu, exact: true })

export async function openMenu(page: Page, locale: Locale) {
  await menuButton(page, locale).click()
  await expect(page.getByRole('menu')).toBeVisible()
}

/** An entry of the view's menu, chosen with the menu opened for it. */
export async function choose(
  page: Page,
  locale: Locale,
  role: 'menuitem' | 'menuitemradio',
  name: string,
) {
  await openMenu(page, locale)
  await page.getByRole('menu').getByRole(role, { name }).click()
}

/** The views the menu lists for this space. */
export async function listed(page: Page, locale: Locale) {
  await openMenu(page, locale)
  const names = await page.getByRole('menu').getByRole('menuitemradio').allInnerTexts()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  const grouping = new Set<string>([WORDS[locale].grouping, WORDS[locale].flat])
  return names.map((name) => name.trim()).filter((name) => !grouping.has(name))
}
