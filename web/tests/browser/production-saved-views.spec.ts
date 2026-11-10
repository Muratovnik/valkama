/**
 * The Work header after its presets and its grouping button left it, in the built
 * application, in English and in Russian, at a desk's width and a phone's.
 *
 * The presets were filters standing beside the filter, the grouping a third button
 * among them that filtered nothing. Now their conditions are rows of the filter's
 * menu, which filter as the presets did; the grouping is a choice in the view's
 * menu beside «Kanban / List / Graph»; and that menu saves the address state under
 * a name for the space, applies it back, and deletes it. A view saved in one space
 * is not offered in another, and a reload keeps the list, because it is the
 * owner's setting on this machine.
 *
 * The header is measured, not looked at: every control of its row stands at one
 * height, and nothing in it reaches past its edge.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { boardSpace } from './boardFixtures.ts'
import { routeState } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import {
  attachedSpaceRef,
  dataScopeId,
  planningReadModel,
  projectScope,
  spaceRef,
} from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

const WORDS = {
  en: {
    menu: 'View',
    grouping: 'By parent',
    flat: 'No grouping',
    save: 'Save view…',
    name: 'Name',
    confirm: 'Save',
    delete: (name: string) => `Delete view “${name}”`,
    filter: 'Filter work',
    ready: 'Workable',
    held: 'Has an assignee',
    list: 'List',
    // What stood in the header before, as buttons of its own.
    gone: ['Workable', 'Assigned', 'Has a holder', 'By parent', 'Group the board by epic'],
  },
  ru: {
    menu: 'Вид',
    grouping: 'По родителю',
    flat: 'Без группировки',
    save: 'Сохранить вид…',
    name: 'Название',
    confirm: 'Сохранить',
    delete: (name: string) => `Удалить вид «${name}»`,
    filter: 'Фильтр работы',
    ready: 'Можно брать',
    held: 'Есть исполнитель',
    list: 'Список',
    gone: [
      'Можно брать',
      'Назначено',
      'Есть ответственный',
      'По родителю',
      'Группировать доску по эпикам',
    ],
  },
} as const

type Locale = keyof typeof WORDS

/** The space's work as the read answers it: the shared fixture and the board's epics. */
async function seed(page: Page, locale: Locale, width: number) {
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

const spaceRoute = (space = spaceRef, state: Record<string, string> = {}) =>
  serializePlatformRoute({
    module_id: 'planning',
    scope: projectScope,
    entity: planningSpaceEntity(space),
    state: { view: 'kanban', ...state },
  })

async function openSpace(page: Page, space = spaceRef, state: Record<string, string> = {}) {
  await page.goto(spaceRoute(space, state))
  await expect(page.locator('.workspace-head')).toBeVisible()
  await expect(page.locator('[data-reference]').first()).toBeVisible()
}

/** The references the stage draws now. */
const drawn = (page: Page) =>
  page
    .locator('.workspace-stage [data-reference]')
    .evaluateAll((nodes) =>
      [...new Set(nodes.map((node) => (node as HTMLElement).dataset.reference))].toSorted(
        (a = '', b = '') => a.localeCompare(b),
      ),
    )

/** The space's work that a condition lets through, worked out from the fixture itself. */
function expected(condition: 'held' | 'ready') {
  return [...planningReadModel.work_items, ...boardSpace()]
    .filter((item) =>
      condition === 'ready' ? item.ready : item.claim_ref !== '' && !item.state.is_terminal,
    )
    .map((item) => item.reference)
}

const menuButton = (page: Page, locale: Locale) =>
  page.locator('.workspace-head').getByRole('button', { name: WORDS[locale].menu, exact: true })

async function openMenu(page: Page, locale: Locale) {
  await menuButton(page, locale).click()
  await expect(page.getByRole('menu')).toBeVisible()
}

/** An entry of the view's menu, chosen with the menu opened for it. */
async function choose(
  page: Page,
  locale: Locale,
  role: 'menuitem' | 'menuitemradio',
  name: string,
) {
  await openMenu(page, locale)
  await page.getByRole('menu').getByRole(role, { name }).click()
}

/** The views the menu lists for this space. */
async function listed(page: Page, locale: Locale) {
  await openMenu(page, locale)
  const names = await page.getByRole('menu').getByRole('menuitemradio').allInnerTexts()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  const grouping = new Set<string>([WORDS[locale].grouping, WORDS[locale].flat])
  return names.map((name) => name.trim()).filter((name) => !grouping.has(name))
}

/** The header's row: each visible control's box, and whatever in the head reaches past its edge. */
function measureHead(page: Page) {
  return page.locator('.workspace-head').evaluate((head) => {
    const edge = head.getBoundingClientRect()
    const right = Math.min(edge.right, document.documentElement.clientWidth)
    // What is drawn: a box with room, and not a hidden copy kept only to be measured.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- serialized into the page
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect()
      return (
        box.width > 0 &&
        box.height > 0 &&
        element.checkVisibility({ visibilityProperty: true, opacityProperty: true })
      )
    }
    const controls = [
      ...head.querySelectorAll(
        '.workspace-view-segments, .workspace-view-menu, .menu-trigger, .filter-text .control, .workspace-action',
      ),
    ]
      .filter((element) => visible(element))
      .map((element) => {
        const box = element.getBoundingClientRect()
        return { name: element.className, top: box.top, height: box.height }
      })
    const outside = [...head.querySelectorAll('*')]
      .filter((element) => visible(element))
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.left < edge.left - 0.5 || box.right > right + 0.5)
      .map(({ element, box }) => `${element.tagName}.${element.className} ${box.left}-${box.right}`)
    return { controls, outside, edge: { left: edge.left, right } }
  })
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [1280, 390])
    test(`the Work header holds the view's menu and no presets (${locale}, ${width}px)`, async ({
      page,
    }) => {
      const words = WORDS[locale]
      await seed(page, locale, width)
      await openSpace(page)
      const head = page.locator('.workspace-head')

      // No preset and no grouping stands in the header as a button of its own.
      for (const word of words.gone)
        await expect(head.getByRole('button', { name: word, exact: true })).toHaveCount(0)
      await expect(menuButton(page, locale)).toBeVisible()

      // One height for every control of the row, and nothing past the head's edge.
      const geometry = await measureHead(page)
      expect(geometry.controls.length, 'the row’s controls').toBeGreaterThanOrEqual(4)
      const heights = new Set(geometry.controls.map((control) => Math.round(control.height)))
      expect([...heights], JSON.stringify(geometry.controls)).toHaveLength(1)
      const tops = new Set(geometry.controls.map((control) => Math.round(control.top)))
      expect([...tops], 'one row').toHaveLength(1)
      expect(geometry.outside, 'reaching past the head').toEqual([])
      await expectNoSilentClipping(page, `Work header ${locale} ${width}px`, '.workspace-head')

      // Each former preset is a condition in the filter's menu, and filters as it did.
      for (const condition of ['ready', 'held'] as const) {
        await page.getByRole('combobox', { name: words.filter }).click()
        await page.getByRole('option', { name: new RegExp(`^${words[condition]}`, 'u') }).click()
        await page.keyboard.press('Escape')
        await expect.poll(() => routeState(page)).toEqual({ view: 'kanban', [condition]: true })
        await expect
          .poll(() => drawn(page))
          .toEqual(expected(condition).toSorted((a, b) => a.localeCompare(b)))
        await page.getByRole('combobox', { name: words.filter }).click()
        await page.getByRole('option', { name: new RegExp(`^${words[condition]}`, 'u') }).click()
        await page.keyboard.press('Escape')
        await expect.poll(() => routeState(page)).toEqual({ view: 'kanban' })
      }

      // The view's menu groups the board into lanes and back.
      await choose(page, locale, 'menuitemradio', words.grouping)
      await expect.poll(() => routeState(page)).toEqual({ view: 'kanban', group: 'epic' })
      await expect(page.locator('.board-lane').first()).toBeVisible()
      // Grouped, the row is still one row of one height, whole.
      const grouped = await measureHead(page)
      expect(new Set(grouped.controls.map((control) => Math.round(control.height))).size).toBe(1)
      expect(grouped.outside).toEqual([])
      await choose(page, locale, 'menuitemradio', words.flat)
      await expect.poll(() => routeState(page)).toEqual({ view: 'kanban' })
      await expect(page.locator('.board-lane')).toHaveCount(0)
    })

for (const locale of ['en', 'ru'] as const)
  test(`a view is saved under a name, kept, applied, deleted, and stays in its space (${locale})`, async ({
    page,
  }) => {
    const words = WORDS[locale]
    await seed(page, locale, 1280)
    await openSpace(page, spaceRef, { group: 'epic' })
    await expect(page.locator('.board-lane').first()).toBeVisible()
    // The state a view keeps: the board grouped, and narrowed to a word.
    await page.getByRole('combobox', { name: words.filter }).fill('column')
    const saved = { view: 'kanban', group: 'epic', query: 'column' }
    await expect.poll(() => routeState(page)).toEqual(saved)
    const shown = await drawn(page)
    expect(shown.length).toBeGreaterThan(0)

    await choose(page, locale, 'menuitem', words.save)
    const dialog = page.getByRole('dialog')
    const name = dialog.getByRole('textbox', { name: words.name })
    // The field has the caret: the reader opened the dialog to type a name.
    await expect(name).toBeFocused()
    await page.keyboard.type('Columns')
    await page.keyboard.press('Enter')
    await expect(dialog).toHaveCount(0)
    expect(await listed(page, locale)).toEqual(['Columns'])
    // The address holds that view now, so the menu checks it.
    await openMenu(page, locale)
    await expect(page.getByRole('menuitemradio', { name: 'Columns' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await page.keyboard.press('Escape')

    await page.reload()
    await expect(page.locator('.board-lane').first()).toBeVisible()
    expect(await listed(page, locale)).toEqual(['Columns'])

    // From another state — the list, unfiltered, ungrouped — the view comes back whole.
    await page.goto(spaceRoute(spaceRef, { view: 'list' }))
    await expect(page.locator('.work-item-list tbody tr').first()).toBeVisible()
    await openMenu(page, locale)
    await expect(page.getByRole('menuitemradio', { name: 'Columns' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await page.getByRole('menuitemradio', { name: 'Columns' }).click()
    await expect.poll(() => routeState(page)).toEqual(saved)
    await expect(page.locator('.board-lane').first()).toBeVisible()
    await expect(page.getByRole('combobox', { name: words.filter })).toHaveValue('column')
    await expect.poll(() => drawn(page)).toEqual(shown)

    // Another space does not offer it.
    await openSpace(page, attachedSpaceRef)
    expect(await listed(page, locale)).toEqual([])
    await openSpace(page, spaceRef, saved)
    expect(await listed(page, locale)).toEqual(['Columns'])

    // The view the address holds can be deleted, and is gone after a reload too.
    await choose(page, locale, 'menuitem', words.delete('Columns'))
    expect(await listed(page, locale)).toEqual([])
    await page.reload()
    await expect(page.locator('[data-reference]').first()).toBeVisible()
    expect(await listed(page, locale)).toEqual([])
  })

/** An entry of the open menu reached by the arrows alone. */
async function reachByKeys(page: Page, role: 'menuitem' | 'menuitemradio', name: string) {
  const entry = page.getByRole('menu').getByRole(role, { name })
  // A menu opened from the keyboard has its first entry focused; the arrows move on from there.
  await expect(page.getByRole('menu').locator('[role^="menuitem"]:focus')).toHaveCount(1)
  for (let step = 0; step < 8; step += 1) {
    if (await entry.evaluate((node) => node === document.activeElement)) break
    await page.keyboard.press('ArrowDown')
  }
  await expect(entry).toBeFocused()
}

/** An entry of the open menu reached by the arrows alone, then chosen with Enter. */
async function pickByKeys(page: Page, role: 'menuitem' | 'menuitemradio', name: string) {
  await reachByKeys(page, role, name)
  await page.keyboard.press('Enter')
}

test('the keyboard alone saves a view, cancels a save, applies a view and deletes it', async ({
  page,
}) => {
  const words = WORDS.en
  await seed(page, 'en', 1280)
  await openSpace(page, spaceRef, { group: 'epic' })
  await expect(page.locator('.board-lane').first()).toBeVisible()
  const button = menuButton(page, 'en')
  const open = async () => {
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
  }

  // Escape in the dialog keeps nothing, and focus comes back to the menu's button.
  await open()
  await pickByKeys(page, 'menuitem', words.save)
  const name = page.getByRole('dialog').getByRole('textbox', { name: words.name })
  await expect(name).toBeFocused()
  await page.keyboard.type('Dropped')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await listed(page, 'en')).toEqual([])

  // Enter keeps it under its name.
  await open()
  await pickByKeys(page, 'menuitem', words.save)
  await expect(name).toBeFocused()
  await page.keyboard.type('Lanes')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await listed(page, 'en')).toEqual(['Lanes'])

  // From another state, the arrows and Enter put it back.
  await page.goto(spaceRoute(spaceRef, { view: 'list' }))
  await expect(page.locator('.work-item-list tbody tr').first()).toBeVisible()
  await open()
  await pickByKeys(page, 'menuitemradio', 'Lanes')
  await expect.poll(() => routeState(page)).toEqual({ view: 'kanban', group: 'epic' })
  await expect(page.locator('.board-lane').first()).toBeVisible()

  // And the view the address holds is deleted the same way.
  await open()
  await pickByKeys(page, 'menuitem', words.delete('Lanes'))
  await expect(page.getByRole('menu')).toHaveCount(0)
  expect(await listed(page, 'en')).toEqual([])
})

/**
 * «Save view…» opens its dialog as the menu goes, with no timer between them. The dialog once
 * waited for the menu's late return of focus to its button, or 300 ms, because that return took
 * focus from a dialog opened earlier. With the page's clock held no timer runs, so the field
 * has the caret only if nothing waits on one; Escape then gives focus back to the button.
 */
for (const width of [1280, 390])
  test(`the save dialog takes focus from the menu with no timer between them (${width}px)`, async ({
    page,
  }) => {
    const words = WORDS.en
    await page.clock.install()
    await seed(page, 'en', width)
    await openSpace(page)
    const button = menuButton(page, 'en')
    await button.focus()
    await page.keyboard.press('Enter')
    await reachByKeys(page, 'menuitem', words.save)

    await page.clock.pauseAt(Date.now() + 2000)
    await page.keyboard.press('Enter')
    const name = page.getByRole('dialog').getByRole('textbox', { name: words.name })
    await expect(name).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(button).toBeFocused()
    await page.clock.resume()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(button).toBeFocused()
  })
